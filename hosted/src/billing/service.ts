import { Fault, type Access, type Input, type Membership } from '../contracts';
import type { FirestoreEnv } from '../firestore/client';
import type { WorkspacePort } from '../jobs/orchestrator';
import type { BillingState, CheckoutState, SubscriptionState } from './policy';
import { FirestoreBillingBindings, type BillingBinding, type BillingBindings } from './bindings';
import { createRazorpay, RazorpayFailure, verifyRazorpayWebhook, MAX_RAZORPAY_WEBHOOK_BYTES,
  RAZORPAY_TIMEOUT_MS, type RazorpayEnv, type RazorpayFetch, type RazorpayInvoice, type RazorpaySubscription } from './razorpay';

export interface BillingEnv extends RazorpayEnv, FirestoreEnv {
  ENTITLEMENTS_ENABLED?: string;
  RAZORPAY_PLAN_ID?: string;
  RAZORPAY_AMOUNT_PAISE?: string;
  RAZORPAY_WEBHOOK_SECRET?: string;
}
export interface BillingDependencies {
  fetcher?: RazorpayFetch;
  bindings?: BillingBindings;
  workspaceFor(access: Access): WorkspacePort;
  membershipFor(uid: string): Promise<Membership | null>;
  reserveWork?(access: Access, id: string, units: number): Promise<unknown>;
}
interface Sale { planId: string; amount: number; currency: 'INR'; totalCount: number }
const terminal = new Set(['cancelled', 'completed', 'expired']);
function id(value: unknown, prefix: 'sub' | 'plan' | 'inv'): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value);
}
function record(value: unknown): Input | undefined { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Input : undefined; }
function unavailable(): never { throw new Fault(503, 'BILLING_UNAVAILABLE', 'Billing is not configured.'); }
function unresolved(): never { throw new Fault(409, 'BILLING_UNCERTAIN', 'A pending checkout needs reconciliation before another checkout or account deletion.'); }
function validCheckoutUrl(value: unknown): value is string {
  return typeof value === 'string' && /^https:\/\/rzp\.io\/(?:rzp|i)\/[A-Za-z0-9_-]{1,100}$/.test(value);
}
async function call<T = Input>(store: WorkspacePort, access: Access, operation: string, input: Input = {}): Promise<T> {
  const result = await store.invoke(access, operation, input);
  if (!result.ok) throw new Fault(result.status, result.code, result.message);
  return result.data as T;
}
function state(value: BillingState): BillingState {
  if (!value || value.version !== 1 || !Array.isArray(value.paid_periods)) unavailable();
  return value;
}
function original(access: Access, subscription: SubscriptionState): BillingBinding {
  if (!id(subscription.id, 'sub') || !id(subscription.plan_id, 'plan') ||
      !Number.isSafeInteger(subscription.amount) || Number(subscription.amount) <= 0 || subscription.currency !== 'INR') unavailable();
  return { ...access, subscription_id: subscription.id, plan_id: subscription.plan_id,
    amount: Number(subscription.amount), currency: 'INR', closed: false };
}
function sameOwner(binding: BillingBinding, access: Access): boolean { return binding.uid === access.uid && binding.generation === access.generation; }
async function opaqueReference(access: Access, intentId: string): Promise<string> {
  // Client operation IDs may themselves contain an account ID. Never forward
  // them verbatim; the generation also separates repeated account lifecycles.
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(['save2ship/billing-reference/v1', access.uid, access.generation, intentId])));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Billing is server-mediated; a browser success/return URL is never evidence of payment. */
export class BillingService {
  private bindings?: BillingBindings;
  constructor(private readonly env: BillingEnv, private readonly dependencies: BillingDependencies) { this.bindings = dependencies.bindings; }
  private ownerBindings(): BillingBindings { return this.bindings ??= new FirestoreBillingBindings(this.env); }
  private provider(existing = false) {
    return createRazorpay(existing ? { ...this.env, BILLING_ENABLED: 'true' } : this.env, this.dependencies.fetcher);
  }
  private sale(): Sale {
    if (this.env.BILLING_ENABLED !== 'true' || this.env.ENTITLEMENTS_ENABLED !== 'true' || !id(this.env.RAZORPAY_PLAN_ID, 'plan') ||
        typeof this.env.RAZORPAY_AMOUNT_PAISE !== 'string' || !/^[1-9]\d{0,14}$/.test(this.env.RAZORPAY_AMOUNT_PAISE) ||
        typeof this.env.RAZORPAY_TOTAL_COUNT !== 'string' || !/^[1-9]\d{0,3}$/.test(this.env.RAZORPAY_TOTAL_COUNT)) unavailable();
    const amount = Number(this.env.RAZORPAY_AMOUNT_PAISE), totalCount = Number(this.env.RAZORPAY_TOTAL_COUNT);
    if (!Number.isSafeInteger(amount) || totalCount > 1200) unavailable();
    this.provider(); // Matching test/live credentials must also be present.
    return { planId: this.env.RAZORPAY_PLAN_ID, amount, currency: 'INR', totalCount };
  }
  private async member(access: Access, allowClosing = false): Promise<void> {
    const member = await this.dependencies.membershipFor(access.uid);
    if (!member || member.uid !== access.uid || member.generation !== access.generation || member.state === 'deleted' ||
        (!allowClosing && member.state !== 'active')) throw new Fault(403, 'BILLING_MEMBERSHIP', 'This membership cannot change billing.');
  }
  private async privateState(access: Access, store: WorkspacePort) { return state(await call<BillingState>(store, access, 'billing.get')); }
  private async checkoutMember(access: Access, store: WorkspacePort): Promise<void> {
    try { await this.member(access); }
    catch { throw new Fault(409, 'ACCOUNT_DELETING', 'This account can no longer start or resume payment.'); }
    const billing = await this.privateState(access, store) as BillingState & { workspace_status?: string };
    if (billing.workspace_status !== 'active')
      throw new Fault(409, 'ACCOUNT_DELETING', 'This account can no longer start or resume payment.');
  }
  private async ensureBinding(access: Access, subscription: SubscriptionState, allowClosed = false): Promise<BillingBinding> {
    const binding = await this.ownerBindings().bind(original(access, subscription));
    if (!sameOwner(binding, access) || (binding.closed && !allowClosed)) throw new Fault(409, 'BILLING_CLOSED', 'This subscription is closed.');
    return binding;
  }
  private async verifyPlan(binding: Pick<BillingBinding, 'plan_id' | 'amount' | 'currency'>): Promise<void> {
    const plan = await this.provider(true).fetchPlan(binding.plan_id);
    if (plan.id !== binding.plan_id || plan.period !== 'monthly' || plan.interval !== 1 || plan.currency !== 'INR' ||
        plan.currency !== binding.currency || plan.amount !== binding.amount)
      throw new Fault(409, 'BILLING_PLAN_MISMATCH', 'The configured monthly plan does not match the original sale terms.');
  }
  async info(access: Access, store: WorkspacePort) {
    await this.member(access);
    const billing = await this.privateState(access, store);
    let sale: Sale | undefined;
    try { sale = this.sale(); } catch { /* Configuration remains closed until the merchant sets a price and keys. */ }
    return { available: Boolean(sale), price: sale ? { amount: sale.amount, currency: sale.currency, period: 'monthly', total_count: sale.totalCount } : null,
      checkout: billing.checkout ? { status: billing.checkout.status } : null,
      subscription: billing.subscription ? { status: billing.subscription.status, cancel_at_end: billing.subscription.cancel_at_end,
        closed: billing.subscription.closed, period_end: billing.paid_periods.reduce((end, period) => Math.max(end, period.period_end), 0) || null } : null };
  }
  async checkout(access: Access, store: WorkspacePort, input: Input) {
    await this.member(access);
    const sale = this.sale();
    if (!input || Object.keys(input).some(key => key !== 'intent_id') || typeof input.intent_id !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(input.intent_id))
      throw new Fault(400, 'INVALID_BILLING_INPUT', 'Use a valid checkout intent.');
    await this.verifyPlan({ plan_id: sale.planId, amount: sale.amount, currency: sale.currency });
    const intent = await call<CheckoutState & { submit: boolean }>(store, access, 'checkout.begin', {
      intent_id: input.intent_id, plan_id: sale.planId, amount: sale.amount, currency: sale.currency,
    });
    if (!intent.submit) {
      const billing = await this.privateState(access, store);
      if (intent.status !== 'CREATED' || !billing.subscription || !intent.subscription_id || !validCheckoutUrl(intent.checkout_url)) unresolved();
      const binding = await this.ensureBinding(access, billing.subscription);
      const remote = await this.provider(true).fetchSubscription(binding.subscription_id);
      if (remote.planId !== binding.plan_id) throw new Fault(409, 'BILLING_PLAN_MISMATCH', 'The subscription plan changed.');
      if (terminal.has(remote.status)) {
        await this.closeRecords(access, store, binding); throw new Fault(409, 'BILLING_CLOSED', 'This checkout is closed. Start a new checkout.');
      }
      if (['created', 'authenticated'].includes(remote.status) && Math.floor(Date.now() / 1000) >= (remote.expireBy ?? Math.floor(intent.created_at / 1000) + 86_400)) {
        await this.cancelImmediately(access, store, binding);
        throw new Fault(409, 'BILLING_CLOSED', 'This checkout expired. Start a new checkout.');
      }
      await this.checkoutMember(access, store);
      return { checkout_url: intent.checkout_url, replayed: true };
    }
    let created: RazorpaySubscription, submitted = false;
    try {
      // The durable intent fences concurrent checkout and deletion before this request.
      await this.member(access);
      const reference = await opaqueReference(access, intent.intent_id);
      submitted = true;
      created = await this.provider().createSubscription({ planId: sale.planId, reference, totalCount: sale.totalCount,
        expireBy: Math.floor(intent.created_at / 1000) + 86_400 });
    } catch (error) {
      const uncertain = submitted && (!(error instanceof RazorpayFailure) || error.uncertain);
      try { await call(store, access, uncertain ? 'checkout.uncertain' : 'checkout.failed', { intent_id: intent.intent_id }); } catch { /* CREATING remains a durable retry barrier. */ }
      throw error;
    }
    // Persist the returned ID first. Lost storage confirmation leaves CREATING or
    // CREATED and never permits a second provider creation.
    await call(store, access, 'checkout.complete', { intent_id: intent.intent_id, subscription_id: created.id,
      plan_id: sale.planId, checkout_url: created.checkoutUrl });
    const billing = await this.privateState(access, store);
    if (!billing.subscription) unavailable();
    await this.ensureBinding(access, billing.subscription);
    if (!validCheckoutUrl(created.checkoutUrl)) unresolved();
    await this.checkoutMember(access, store);
    return { checkout_url: created.checkoutUrl, replayed: false };
  }
  private validPaid(invoice: RazorpayInvoice, binding: BillingBinding): boolean {
    return invoice.subscriptionId === binding.subscription_id && invoice.status === 'paid' && invoice.currency === binding.currency &&
      invoice.amountPaid === binding.amount && invoice.amountDue === 0 && invoice.paymentId !== null &&
      invoice.billingStart !== null && invoice.billingEnd !== null && invoice.billingEnd > invoice.billingStart &&
      invoice.billingEnd - invoice.billingStart <= 40 * 86_400 && invoice.billingEnd * 1000 > Date.now();
  }
  private async grant(access: Access, store: WorkspacePort, binding: BillingBinding, invoice: RazorpayInvoice): Promise<boolean> {
    if (!this.validPaid(invoice, binding) || binding.closed || this.env.ENTITLEMENTS_ENABLED !== 'true') return false;
    await this.member(access); // Repeat after external reads so deletion/suspension wins.
    const current = await this.privateState(access, store);
    if (!current.subscription || current.subscription.closed || current.subscription.id !== binding.subscription_id ||
        current.subscription.plan_id !== binding.plan_id || current.subscription.amount !== binding.amount || current.subscription.currency !== binding.currency) return false;
    const latestBinding = await this.ownerBindings().get(binding.subscription_id);
    if (!latestBinding || latestBinding.closed || !sameOwner(latestBinding, access)) return false;
    const result = await call<{ applied: boolean }>(store, access, 'billing.paid', { subscription_id: binding.subscription_id,
      plan_id: binding.plan_id, invoice_id: invoice.id, period_start: invoice.billingStart! * 1000, period_end: invoice.billingEnd! * 1000 });
    return result.applied;
  }
  async sync(access: Access, store: WorkspacePort) {
    await this.member(access);
    const billing = await this.privateState(access, store);
    if (!billing.subscription || billing.subscription.closed) return this.info(access, store);
    const binding = await this.ensureBinding(access, billing.subscription), provider = this.provider(true);
    const remote = await provider.fetchSubscription(binding.subscription_id);
    if (remote.planId !== binding.plan_id) throw new Fault(409, 'BILLING_PLAN_MISMATCH', 'The subscription plan changed.');
    await this.verifyPlan(binding);
    // Apply in period order. Duplicate and out-of-order delivery are also fenced
    // by the private ledger, so a retry cannot refill organization points.
    const invoices = await provider.listSubscriptionInvoices(binding.subscription_id);
    const paid = invoices.filter(item => this.validPaid(item, binding)).sort((a, b) => a.billingStart! - b.billingStart!);
    if (paid.length > 2) throw new Fault(409, 'BILLING_PERIOD_LIMIT', 'Reconcile the pending paid periods first.');
    for (const invoice of paid)
      await this.grant(access, store, binding, invoice);
    if (terminal.has(remote.status)) await this.closeRecords(access, store, binding);
    return this.info(access, store);
  }
  private async closeRecords(access: Access, store: WorkspacePort, binding: BillingBinding): Promise<void> {
    // Tombstone first: any later webhook stops before calling a workspace.
    await this.ownerBindings().close(binding.subscription_id, access);
    await call(store, access, 'billing.closed', { subscription_id: binding.subscription_id });
  }
  private async cancelImmediately(access: Access, store: WorkspacePort, binding: BillingBinding): Promise<void> {
    const provider = this.provider(true);
    let remote = await provider.fetchSubscription(binding.subscription_id);
    if (remote.planId !== binding.plan_id) throw new Fault(409, 'BILLING_PLAN_MISMATCH', 'The subscription plan changed.');
    if (!terminal.has(remote.status)) {
      await provider.cancelSubscription(binding.subscription_id, { atPeriodEnd: false });
      remote = await provider.fetchSubscription(binding.subscription_id);
    }
    if (!terminal.has(remote.status)) throw new Fault(409, 'BILLING_CANCELLATION_PENDING', 'Confirm subscription cancellation before deleting this account.');
    await this.closeRecords(access, store, binding);
  }
  async cancel(access: Access, store: WorkspacePort) {
    await this.member(access, true);
    const billing = await this.privateState(access, store);
    if (!billing.subscription) {
      if (billing.checkout && billing.checkout.status !== 'FAILED') unresolved();
      return { cancelled: true };
    }
    if (billing.subscription.closed) {
      await this.ownerBindings().close(billing.subscription.id, access);
      return { cancelled: true };
    }
    const binding = await this.ensureBinding(access, billing.subscription, true), provider = this.provider(true);
    const remote = await provider.fetchSubscription(binding.subscription_id);
    if (remote.planId !== binding.plan_id) throw new Fault(409, 'BILLING_PLAN_MISMATCH', 'The subscription plan changed.');
    if (terminal.has(remote.status) || ['created', 'authenticated'].includes(remote.status)) {
      await this.cancelImmediately(access, store, binding);
      return { cancelled: true, cancel_at_end: true };
    }
    if (!billing.subscription.cancel_at_end) {
      await provider.cancelSubscription(binding.subscription_id, { atPeriodEnd: true });
      await call(store, access, 'billing.cancel', { subscription_id: binding.subscription_id, cancel_at_end: true });
    }
    return { cancelled: true, cancel_at_end: true };
  }
  async closeForDeletion(access: Access, store: WorkspacePort): Promise<void> {
    await this.member(access, true);
    const billing = await this.privateState(access, store);
    if (!billing.subscription) {
      if (billing.checkout && billing.checkout.status !== 'FAILED') unresolved();
      return;
    }
    if (billing.subscription.closed) { await this.ownerBindings().close(billing.subscription.id, access); return; }
    await this.cancelImmediately(access, store, await this.ensureBinding(access, billing.subscription, true));
  }
  /** Trusted operator repair only. The HTTP caller must independently verify
   * operator identity and recent authentication; never expose a customer ID API.
   * A dashboard ID is evidence to inspect, never authorization by itself.
   */
  async reconcileUncertain(access: Access, store: WorkspacePort, subscriptionId: string): Promise<{ reconciled: true; closed: boolean; checkout_status: 'CREATED' }> {
    await this.member(access, true);
    if (!id(subscriptionId, 'sub')) throw new Fault(400, 'INVALID_BILLING_INPUT', 'Use a valid merchant subscription reference.');
    const billing = await this.privateState(access, store), checkout = billing.checkout;
    if (!checkout || !['CREATING', 'UNCERTAIN', 'CREATED'].includes(checkout.status) ||
        (checkout.status === 'CREATED' && checkout.subscription_id !== subscriptionId) ||
        (checkout.subscription_id !== undefined && checkout.subscription_id !== subscriptionId) ||
        (billing.subscription && billing.subscription.id !== subscriptionId))
      throw new Fault(409, 'BILLING_RECONCILIATION_MISMATCH', 'This subscription does not match a retained checkout intent.');
    if (!id(checkout.plan_id, 'plan') || !Number.isSafeInteger(checkout.amount) || Number(checkout.amount) < 1 || checkout.currency !== 'INR' ||
        !Number.isSafeInteger(checkout.created_at) || checkout.created_at <= 0 ||
        typeof checkout.intent_id !== 'string' || !/^[A-Za-z0-9_-]{16,100}$/.test(checkout.intent_id)) unavailable();
    const terms: BillingBinding = { ...access, subscription_id: subscriptionId, plan_id: checkout.plan_id,
      amount: Number(checkout.amount), currency: 'INR', closed: false };
    const prior = await this.ownerBindings().get(subscriptionId);
    if (prior && (!sameOwner(prior, access) || prior.plan_id !== terms.plan_id || prior.amount !== terms.amount || prior.currency !== terms.currency))
      throw new Fault(409, 'BILLING_BINDING_CONFLICT', 'This subscription belongs to a different billing record.');
    const remote = await this.provider(true).fetchSubscription(subscriptionId);
    // Permit bounded merchant/server clock skew, not another checkout made days
    // later. Operator recovery itself can happen long after the original loss.
    if (remote.reference !== await opaqueReference(access, checkout.intent_id) || remote.createdAt * 1000 < checkout.created_at - 5 * 60_000 ||
        remote.createdAt * 1000 > checkout.created_at + 15 * 60_000)
      throw new Fault(409, 'BILLING_RECONCILIATION_MISMATCH', 'The merchant subscription does not match this retained checkout intent.');
    if (remote.planId !== terms.plan_id) throw new Fault(409, 'BILLING_PLAN_MISMATCH', 'The subscription plan changed.');
    await this.verifyPlan(terms);
    // This narrow transition can retain a known ID without inventing a URL.
    // It cannot create an intent, choose new sale terms, or grant paid access.
    await call(store, access, 'checkout.reconcile', { intent_id: checkout.intent_id, subscription_id: subscriptionId,
      plan_id: terms.plan_id, checkout_url: remote.checkoutUrl });
    const repaired = await this.privateState(access, store);
    if (!repaired.subscription) unavailable();
    const binding = await this.ensureBinding(access, repaired.subscription, true);
    const member = await this.dependencies.membershipFor(access.uid);
    if (!member || member.uid !== access.uid || member.generation !== access.generation) throw new Fault(403, 'BILLING_MEMBERSHIP', 'This membership cannot change billing.');
    const workspaceStatus = (repaired as BillingState & { workspace_status?: string }).workspace_status;
    if (member.state !== 'active' || workspaceStatus !== 'active' || binding.closed) {
      await this.cancelImmediately(access, store, binding);
    } else {
      try { await this.sync(access, store); }
      catch (error) {
        if (!(error instanceof Fault) || !['BILLING_MEMBERSHIP', 'MEMBERSHIP_SUSPENDED', 'ACCOUNT_DELETING'].includes(error.code)) throw error;
        // If deletion starts during authoritative reads, the recovered known ID
        // remains available for cancellation rather than reviving the account.
        await this.cancelImmediately(access, store, binding);
      }
    }
    let result = await this.privateState(access, store);
    const currentMember = await this.dependencies.membershipFor(access.uid);
    if (!result.subscription?.closed && (!currentMember || currentMember.uid !== access.uid || currentMember.generation !== access.generation ||
        currentMember.state !== 'active' || (result as BillingState & { workspace_status?: string }).workspace_status !== 'active')) {
      await this.cancelImmediately(access, store, binding);
      result = await this.privateState(access, store);
    }
    return { reconciled: true, closed: result.subscription?.closed === true, checkout_status: 'CREATED' };
  }
  async webhook(request: Request): Promise<Response> {
    const reply = (status: number, ignored = false) => Response.json({ received: status === 200, ...(ignored ? { ignored: true } : {}) },
      { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'POST') return reply(405);
    const signature = request.headers.get('X-Razorpay-Signature'), secret = this.env.RAZORPAY_WEBHOOK_SECRET;
    if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature) || typeof secret !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(secret)) return reply(401);
    const length = request.headers.get('Content-Length');
    if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RAZORPAY_WEBHOOK_BYTES)) return reply(413);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
    let raw: Uint8Array;
    try {
      reader = request.body?.getReader(); if (!reader) return reply(400);
      const read = async () => {
        const chunks: Uint8Array[] = []; let size = 0;
        for (;;) {
          const part = await reader!.read(); if (part.done) break;
          size += part.value.byteLength; if (size > MAX_RAZORPAY_WEBHOOK_BYTES) throw new Fault(413, 'WEBHOOK_TOO_LARGE', 'Webhook body exceeds its limit.');
          chunks.push(part.value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return bytes;
      };
      raw = await Promise.race([read(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Fault(408, 'WEBHOOK_TIMEOUT', 'Webhook timed out.')), RAZORPAY_TIMEOUT_MS); })]);
    } catch (error) { return reply(error instanceof Fault ? error.status : 400); }
    finally { if (timer !== undefined) clearTimeout(timer); void reader?.cancel().catch(() => {}); }
    if (!await verifyRazorpayWebhook(raw, signature, secret)) return reply(401);
    let event: Input;
    try { const parsed = record(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw))); if (!parsed) return reply(400); event = parsed; }
    catch { return reply(400); }
    if (!['invoice.paid', 'subscription.charged'].includes(String(event.event))) return reply(200, true);
    const payload = record(event.payload), invoiceEntity = record(record(payload?.invoice)?.entity),
      paymentEntity = record(record(payload?.payment)?.entity), subscriptionEntity = record(record(payload?.subscription)?.entity);
    const subscriptionId = event.event === 'invoice.paid' ? invoiceEntity?.subscription_id : subscriptionEntity?.id;
    const invoiceId = event.event === 'invoice.paid' ? invoiceEntity?.id : paymentEntity?.invoice_id;
    if (!id(subscriptionId, 'sub') || !id(invoiceId, 'inv')) return reply(400);
    try {
      const binding = await this.ownerBindings().get(subscriptionId);
      if (!binding || binding.closed || this.env.ENTITLEMENTS_ENABLED !== 'true') return reply(200, true);
      const access = { uid: binding.uid, generation: binding.generation };
      const member = await this.dependencies.membershipFor(access.uid);
      if (!member || member.uid !== access.uid || member.generation !== access.generation || member.state !== 'active') return reply(200, true);
      await this.dependencies.reserveWork?.(access, `billing-invoice:${invoiceId.slice(4, 20)}:${crypto.randomUUID()}`, 256);
      const provider = this.provider(true), invoice = await provider.fetchInvoice(invoiceId);
      if (!this.validPaid(invoice, binding)) return reply(200, true);
      const remote = await provider.fetchSubscription(binding.subscription_id);
      if (remote.planId !== binding.plan_id) return reply(200, true);
      await this.verifyPlan(binding);
      await this.grant(access, this.dependencies.workspaceFor(access), binding, invoice);
      return reply(200);
    } catch (error) {
      if (error instanceof Fault && ['BILLING_MEMBERSHIP', 'WORKSPACE_DELETING', 'ACCOUNT_DELETING', 'BILLING_CLOSED'].includes(error.code)) return reply(200, true);
      return reply(503);
    }
  }
}

export function createBillingService(env: BillingEnv, dependencies: BillingDependencies): BillingService { return new BillingService(env, dependencies); }
