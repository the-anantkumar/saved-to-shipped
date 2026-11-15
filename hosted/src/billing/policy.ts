import { Fault, integer, string, type Input } from '../contracts';

export interface EntitlementEnv { ENTITLEMENTS_ENABLED?: string }
export const PLAN_LIMITS = Object.freeze({ free: { saves: 100, sections: 3, points: 20 }, pro: { saves: 1000, sections: 25, points: 200 } });
export interface PointBucket { key: string; period_start: number; period_end: number; limit: number; used: number; reserved: number }
export interface PaidPeriod extends PointBucket { invoice_id: string }
export interface CheckoutState extends Input {
  intent_id: string; plan_id: string; status: 'CREATING' | 'CREATED' | 'UNCERTAIN' | 'FAILED';
  amount?: number; currency?: string; subscription_id?: string; checkout_url?: string;
  created_at: number; updated_at: number;
}
export interface SubscriptionState extends Input {
  id: string; plan_id: string; status: 'active' | 'cancelled'; cancel_at_end: boolean; closed: boolean;
  amount?: number; currency?: string;
}
export interface BillingState {
  version: 1; checkout?: CheckoutState; subscription?: SubscriptionState; free?: PointBucket;
  paid_periods: PaidPeriod[]; latest_paid?: { period_start: number; period_end: number; invoice_id: string };
}
export interface PointReservation extends Input { period_key: string; limit: number; reserved: number; consumed: number; settled_ids: string[] }
function requireValue(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new Fault(409, code, message);
}
export const enabled = (env: EntitlementEnv) => env.ENTITLEMENTS_ENABLED === 'true';
export const initialBilling = (): BillingState => ({ version: 1, paid_periods: [] });
export function freeBucket(at = Date.now()): PointBucket {
  const time = new Date(at), year = time.getUTCFullYear(), month = time.getUTCMonth();
  return { key: `free:${year}-${month + 1}`, period_start: Date.UTC(year, month, 1), period_end: Date.UTC(year, month + 1, 1), limit: PLAN_LIMITS.free.points, used: 0, reserved: 0 };
}
export function currentBucket(state: BillingState, at = Date.now()): PointBucket {
  const paid = state.paid_periods.find(period => period.period_start <= at && at < period.period_end);
  if (paid) return { ...paid };
  const fresh = freeBucket(at);
  return state.free?.key === fresh.key ? { ...state.free } : fresh;
}
export function plan(state: BillingState, at = Date.now()): 'free' | 'pro' { return currentBucket(state, at).key.startsWith('paid:') ? 'pro' : 'free'; }
function replaceBucket(state: BillingState, bucket: PointBucket) {
  if (bucket.key.startsWith('free:')) state.free = bucket;
  else {
    const index = state.paid_periods.findIndex(period => period.key === bucket.key);
    if (index >= 0) state.paid_periods[index] = { ...state.paid_periods[index]!, ...bucket };
  }
}
export function reservePoints(stateValue: BillingState, count: number, at = Date.now()) {
  const state = structuredClone(stateValue), bucket = currentBucket(state, at);
  integer(count, 'Organization points', 1, 25);
  requireValue(bucket.used + bucket.reserved + count <= bucket.limit, 'AI_POINTS_LIMIT', 'There are not enough organization points for this batch.');
  bucket.reserved += count; replaceBucket(state, bucket);
  const reservation: PointReservation = { period_key: bucket.key, limit: count, reserved: count, consumed: 0, settled_ids: [] };
  return { state, reservation };
}
/** A stale job can settle only its original bucket, never the current period. */
export function settlePoint(stateValue: BillingState, reservationValue: PointReservation, id: string, consumed: boolean) {
  const state = structuredClone(stateValue), reservation = structuredClone(reservationValue);
  if (reservation.settled_ids.includes(id)) return { state, reservation };
  requireValue(reservation.reserved > 0, 'AI_POINTS_INCONSISTENT', 'Organization point accounting needs reconciliation.');
  reservation.settled_ids.push(id); reservation.reserved--; if (consumed) reservation.consumed++;
  const bucket = state.free?.key === reservation.period_key ? { ...state.free } : state.paid_periods.find(period => period.key === reservation.period_key);
  if (bucket) {
    requireValue(bucket.reserved > 0, 'AI_POINTS_INCONSISTENT', 'Organization point accounting needs reconciliation.');
    bucket.reserved--; if (consumed) bucket.used++;
    replaceBucket(state, bucket);
  }
  return { state, reservation };
}
export function publicEntitlements(env: EntitlementEnv, state: BillingState, saves: number, sections: number, at = Date.now()) {
  if (!enabled(env)) return { enabled: false };
  const activePlan = plan(state, at), limits = PLAN_LIMITS[activePlan], bucket = currentBucket(state, at);
  return { enabled: true, plan: activePlan, limits: { saves: limits.saves, sections: limits.sections },
    saves: { used: saves, limit: limits.saves, remaining: Math.max(0, limits.saves - saves) },
    sections: { used: sections, limit: limits.sections, remaining: Math.max(0, limits.sections - sections) },
    points: { limit: bucket.limit, used: bucket.used, reserved: bucket.reserved, remaining: Math.max(0, bucket.limit - bucket.used - bucket.reserved), period_start: bucket.period_start, period_end: bucket.period_end },
    subscription: { status: state.subscription?.status ?? 'none', cancel_at_end: state.subscription?.cancel_at_end ?? false,
      period_end: state.paid_periods.reduce((end, period) => Math.max(end, period.period_end), 0) || null } };
}
export function billingTransition(stateValue: BillingState, operation: string, input: Input, at = Date.now()): { state: BillingState; result: Input } {
  const state = structuredClone(stateValue);
  const intent = () => {
    const id = string(input.intent_id, 'Checkout intent', 100, false);
    requireValue(state.checkout?.intent_id === id, 'BILLING_CONFLICT', 'This checkout intent does not match.'); return state.checkout!;
  };
  const binding = () => {
    const id = string(input.subscription_id, 'Subscription', 100, false);
    requireValue(state.subscription?.id === id, 'BILLING_CONFLICT', 'This subscription does not match.'); return state.subscription!;
  };
  if (operation === 'checkout.begin') {
    const id = string(input.intent_id, 'Checkout intent', 100, false), planId = string(input.plan_id, 'Billing plan', 100, false);
    if (state.checkout && state.checkout.status !== 'FAILED') {
      const expiredClosed = state.subscription?.closed && !state.paid_periods.some(period => period.period_end > at);
      if (!expiredClosed) return { state, result: { ...state.checkout, submit: false, replayed: true } };
    }
    const amount = input.amount === undefined ? undefined : integer(input.amount, 'Plan amount', 1, Number.MAX_SAFE_INTEGER);
    const currency = input.currency === undefined ? undefined : string(input.currency, 'Currency', 3, false);
    if (currency !== undefined) requireValue(/^[A-Z]{3}$/.test(currency), 'BILLING_CONFLICT', 'Invalid plan currency.');
    state.checkout = { intent_id: id, plan_id: planId, status: 'CREATING', created_at: at, updated_at: at, ...(amount === undefined ? {} : { amount }), ...(currency === undefined ? {} : { currency }) };
    delete state.subscription;
    return { state, result: { ...state.checkout, submit: true } };
  }
  if (operation === 'checkout.complete' || operation === 'checkout.reconcile') {
    const checkout = intent(), subscriptionId = string(input.subscription_id, 'Subscription', 100, false);
    requireValue(checkout.plan_id === input.plan_id, 'BILLING_CONFLICT', 'The checkout plan changed.');
    requireValue(!checkout.subscription_id || checkout.subscription_id === subscriptionId, 'BILLING_CONFLICT', 'The checkout already has a different subscription.');
    requireValue(checkout.status !== 'FAILED', 'BILLING_CONFLICT', 'This checkout failed before confirmation.');
    if (operation === 'checkout.reconcile') {
      requireValue(['CREATING', 'UNCERTAIN', 'CREATED'].includes(checkout.status), 'BILLING_CONFLICT', 'Only a retained checkout can be reconciled.');
      requireValue(/^sub_[A-Za-z0-9]{1,64}$/.test(subscriptionId), 'BILLING_CONFLICT', 'Invalid reconciled subscription.');
      requireValue(Number.isSafeInteger(checkout.amount) && Number(checkout.amount) > 0 && checkout.currency === 'INR',
        'BILLING_CONFLICT', 'Reconciliation requires the original priced checkout.');
      requireValue(!state.subscription || (state.subscription.id === subscriptionId && state.subscription.plan_id === checkout.plan_id),
        'BILLING_CONFLICT', 'This reconciliation cannot replace a subscription.');
      requireValue(Object.keys(input).every(key => ['intent_id', 'subscription_id', 'plan_id', 'checkout_url'].includes(key)),
        'BILLING_CONFLICT', 'This reconciliation contains unsupported fields.');
    }
    const checkoutUrl = operation === 'checkout.reconcile' && input.checkout_url === null ? null : string(input.checkout_url, 'Checkout URL', 2000, false);
    requireValue(checkoutUrl === null || /^https:\/\/[^\s]+$/.test(checkoutUrl), 'BILLING_CONFLICT', 'Invalid checkout URL.');
    Object.assign(checkout, { status: 'CREATED', subscription_id: subscriptionId, updated_at: at });
    if (checkoutUrl === null) delete checkout.checkout_url;
    else checkout.checkout_url = checkoutUrl;
    state.subscription ??= { id: subscriptionId, plan_id: checkout.plan_id, status: 'active', cancel_at_end: false, closed: false,
      ...(checkout.amount === undefined ? {} : { amount: checkout.amount }), ...(checkout.currency === undefined ? {} : { currency: checkout.currency }) };
  } else if (operation === 'checkout.uncertain' || operation === 'checkout.failed') {
    const checkout = intent();
    requireValue(checkout.status !== 'CREATED', 'BILLING_CONFLICT', 'A confirmed checkout cannot be replaced.');
    if (operation === 'checkout.failed') requireValue(checkout.status !== 'UNCERTAIN', 'BILLING_UNCERTAIN', 'Reconcile the uncertain checkout before starting another.');
    checkout.status = operation === 'checkout.uncertain' ? 'UNCERTAIN' : 'FAILED';
    checkout.updated_at = at;
  } else if (operation === 'billing.paid') {
    const subscription = binding();
    requireValue(!subscription.closed, 'BILLING_CLOSED', 'This subscription was closed.');
    requireValue(subscription.plan_id === input.plan_id, 'BILLING_CONFLICT', 'The paid plan does not match.');
    const invoice = string(input.invoice_id, 'Paid invoice', 100, false);
    const start = integer(input.period_start, 'Paid period start', 1, Number.MAX_SAFE_INTEGER), end = integer(input.period_end, 'Paid period end', start + 1, Number.MAX_SAFE_INTEGER);
    requireValue(end - start <= 40 * 86400_000, 'BILLING_CONFLICT', 'Use a verified monthly billing period.');
    const known = state.paid_periods.find(period => period.invoice_id === invoice || period.period_start === start);
    if (known) {
      requireValue(known.period_start === start && known.period_end === end, 'BILLING_CONFLICT', 'The paid invoice period changed.');
      return { state, result: { applied: false, replayed: true } };
    }
    const latest = state.latest_paid;
    if (latest && start <= latest.period_start) {
      requireValue(invoice !== latest.invoice_id || (start === latest.period_start && end === latest.period_end), 'BILLING_CONFLICT', 'The paid invoice period changed.');
      // A future renewal may arrive before the currently paid invoice. Admit an
      // unseen current period once; expired history can never refill a bucket.
      if (!(start <= at && at < end && end <= latest.period_start)) return { state, result: { applied: false, replayed: true } };
    } else {
      requireValue(!latest || start >= latest.period_end, 'BILLING_CONFLICT', 'Paid allowance periods must not overlap.');
    }
    requireValue(!state.paid_periods.some(period => period.invoice_id === invoice), 'BILLING_CONFLICT', 'A paid invoice cannot fund a second period.');
    state.paid_periods = state.paid_periods.filter(period => period.period_end > at);
    requireValue(!state.paid_periods.some(period => start < period.period_end && end > period.period_start), 'BILLING_CONFLICT', 'Paid allowance periods must not overlap.');
    requireValue(state.paid_periods.length < 2, 'BILLING_PERIOD_LIMIT', 'Reconcile the retained paid periods first.');
    state.paid_periods.push({ key: `paid:${subscription.id}:${start}`, invoice_id: invoice, period_start: start, period_end: end, limit: PLAN_LIMITS.pro.points, used: 0, reserved: 0 });
    if (!latest || start > latest.period_start) state.latest_paid = { period_start: start, period_end: end, invoice_id: invoice };
    return { state, result: { applied: true } };
  } else if (operation === 'billing.cancel' || operation === 'billing.closed') {
    const subscription = binding(); subscription.cancel_at_end = true;
    if (operation === 'billing.closed') { subscription.closed = true; subscription.status = 'cancelled'; }
  } else throw new Fault(404, 'NOT_FOUND', 'Billing operation not found.');
  return { state, result: { ok: true, ...(state.checkout ? { checkout: state.checkout } : {}), ...(state.subscription ? { subscription: state.subscription } : {}) } };
}
