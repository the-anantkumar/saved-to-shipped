/** Server-only Razorpay REST boundary. All amounts are currency subunits.
 * No method retries: an unconfirmed mutation must be reconciled by its caller.
 * Contracts: https://razorpay.com/docs/api/payments/subscriptions/create-subscription
 * https://razorpay.com/docs/api/payments/subscriptions/cancel-subscription
 * https://razorpay.com/docs/api/payments/invoices/fetch-with-id
 */
export interface RazorpayEnv {
  BILLING_ENABLED?: string;
  RAZORPAY_MODE?: string;
  RAZORPAY_KEY_ID?: string;
  RAZORPAY_KEY_SECRET?: string;
  /** Required finite billing cycles unless supplied by the trusted caller. */
  RAZORPAY_TOTAL_COUNT?: string;
}
export type RazorpayFetch = (url: string, init: RequestInit) => Promise<Response>;
export type RazorpayErrorCode = 'BILLING_DISABLED' | 'BILLING_CONFIGURATION_INVALID' | 'INVALID_BILLING_INPUT' |
  'RAZORPAY_REJECTED' | 'RAZORPAY_UNAVAILABLE' | 'RAZORPAY_RESPONSE_INVALID';
/** Fixed messages only: never retain raw provider errors, bodies or credentials. */
export class RazorpayFailure extends Error {
  readonly code: RazorpayErrorCode;
  readonly uncertain: boolean;
  readonly status?: number;
  constructor(code: RazorpayErrorCode, message: string, uncertain = false, status?: number) {
    super(message);
    this.name = 'RazorpayFailure'; this.code = code; this.uncertain = uncertain;
    if (status !== undefined) this.status = status;
  }
}

export interface RazorpayPlan {
  id: string; period: 'daily' | 'weekly' | 'monthly' | 'yearly'; interval: number;
  amount: number; currency: string; name: string;
}
export interface RazorpaySubscription {
  id: string; planId: string; status: string; checkoutUrl: string | null;
  currentStart: number | null; currentEnd: number | null; paidCount: number;
  createdAt: number; expireBy: number | null; reference: string | null;
}
export interface RazorpayInvoice {
  id: string; subscriptionId: string | null; status: string; currency: string;
  amountPaid: number; amountDue: number; billingStart: number | null; billingEnd: number | null;
  paymentId: string | null;
}
export const MAX_RAZORPAY_RESPONSE_BYTES = 65_536;
export const MAX_RAZORPAY_WEBHOOK_BYTES = 131_072;
export const RAZORPAY_TIMEOUT_MS = 10_000;
const API = 'https://api.razorpay.com/v1';
const encoder = new TextEncoder();
const subscriptionStatuses = new Set(['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused']);
const invoiceStatuses = new Set(['draft', 'issued', 'partially_paid', 'paid', 'cancelled', 'expired', 'deleted']);

function invalidInput(): never {
  throw new RazorpayFailure('INVALID_BILLING_INPUT', 'The billing request is invalid.');
}
function configuration(): never {
  throw new RazorpayFailure('BILLING_CONFIGURATION_INVALID', 'Billing is not configured.');
}
function invalidResponse(mutation: boolean): never {
  throw new RazorpayFailure('RAZORPAY_RESPONSE_INVALID', 'Razorpay returned an invalid response. Reconcile any pending change before trying again.', mutation);
}
function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
function validId(value: unknown, prefix: 'plan' | 'sub' | 'inv' | 'pay'): value is string {
  return typeof value === 'string' && new RegExp(`^${prefix}_[A-Za-z0-9]{1,64}$`).test(value);
}
function inputId(value: unknown, prefix: 'plan' | 'sub' | 'inv'): string {
  if (!validId(value, prefix)) invalidInput();
  return value;
}
function count(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function timestamp(value: unknown): value is number | null { return value === null || (count(value) && value > 0 && value <= 253_402_300_799); }
function currency(value: unknown): value is string { return typeof value === 'string' && /^[A-Z]{3}$/.test(value); }
function checkoutUrl(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 256) return undefined;
  try {
    const url = new URL(value);
    // Current create responses use /rzp/; official fetch/cancel examples use /i/.
    if (url.protocol !== 'https:' || url.host !== 'rzp.io' || url.username || url.password || url.search || url.hash ||
        !/^\/(?:rzp|i)\/[A-Za-z0-9_-]{1,100}$/.test(url.pathname) || url.href !== value) return undefined;
    return value;
  } catch { return undefined; }
}
function plan(value: unknown): RazorpayPlan {
  const row = object(value), item = object(row?.item);
  if (!row || row.entity !== 'plan' || !validId(row.id, 'plan') || !['daily', 'weekly', 'monthly', 'yearly'].includes(String(row.period)) ||
      !count(row.interval) || row.interval < 1 || !item || !count(item.amount) || item.amount < 1 || !currency(item.currency) ||
      typeof item.name !== 'string' || !item.name.trim() || item.name.length > 256) invalidResponse(false);
  return { id: row.id, period: row.period as RazorpayPlan['period'], interval: row.interval,
    amount: item.amount, currency: item.currency, name: item.name };
}
function subscription(value: unknown, mutation: boolean, expected?: { id?: string; planId?: string }, requireCheckout = false): RazorpaySubscription {
  const row = object(value), url = checkoutUrl(row?.short_url);
  if (!row || row.entity !== 'subscription' || !validId(row.id, 'sub') || !validId(row.plan_id, 'plan') ||
      (expected?.id !== undefined && row.id !== expected.id) || (expected?.planId !== undefined && row.plan_id !== expected.planId) ||
      typeof row.status !== 'string' || !subscriptionStatuses.has(row.status) || !timestamp(row.current_start) || !timestamp(row.current_end) ||
      !count(row.paid_count) || !timestamp(row.created_at) || row.created_at === null || !timestamp(row.expire_by) ||
      url === undefined || (requireCheckout && url === null)) invalidResponse(mutation);
  if ((row.current_start === null) !== (row.current_end === null) ||
      (row.current_start !== null && row.current_end !== null && row.current_end <= row.current_start)) invalidResponse(mutation);
  const reference = object(row.notes)?.reference;
  return { id: row.id, planId: row.plan_id, status: row.status, checkoutUrl: url,
    currentStart: row.current_start, currentEnd: row.current_end, paidCount: row.paid_count,
    createdAt: row.created_at, expireBy: row.expire_by,
    reference: typeof reference === 'string' && /^[a-f0-9]{64}$/.test(reference) ? reference : null };
}
function invoice(value: unknown, id: string): RazorpayInvoice {
  const row = object(value);
  if (!row || row.entity !== 'invoice' || row.id !== id || !validId(row.id, 'inv') ||
      (row.subscription_id !== null && !validId(row.subscription_id, 'sub')) ||
      typeof row.status !== 'string' || !invoiceStatuses.has(row.status) || !currency(row.currency) ||
      !count(row.amount_paid) || !count(row.amount_due) || !timestamp(row.billing_start) || !timestamp(row.billing_end) ||
      (row.payment_id !== null && !validId(row.payment_id, 'pay'))) invalidResponse(false);
  if ((row.billing_start === null) !== (row.billing_end === null) ||
      (row.billing_start !== null && row.billing_end !== null && row.billing_end <= row.billing_start)) invalidResponse(false);
  return { id: row.id, subscriptionId: row.subscription_id as string | null, status: row.status, currency: row.currency,
    amountPaid: row.amount_paid, amountDue: row.amount_due, billingStart: row.billing_start,
    billingEnd: row.billing_end, paymentId: row.payment_id as string | null };
}

export function createRazorpay(env: RazorpayEnv, fetcher: RazorpayFetch = fetch) {
  if (env.BILLING_ENABLED !== 'true') throw new RazorpayFailure('BILLING_DISABLED', 'Billing is unavailable.');
  const mode = env.RAZORPAY_MODE ?? 'test';
  if (!['test', 'live'].includes(mode) || typeof env.RAZORPAY_KEY_ID !== 'string' ||
      !new RegExp(`^rzp_${mode}_[A-Za-z0-9]{1,64}$`).test(env.RAZORPAY_KEY_ID) ||
      typeof env.RAZORPAY_KEY_SECRET !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(env.RAZORPAY_KEY_SECRET) ||
      env.RAZORPAY_KEY_SECRET.includes(':')) configuration();
  // Credentials are never placed in a URL, return value, error or log.
  const authorization = `Basic ${btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`)}`;

  async function request(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const mutation = body !== undefined, controller = new AbortController();
    const serialized = mutation ? JSON.stringify(body) : undefined;
    if (serialized !== undefined && encoder.encode(serialized).byteLength > 4096) invalidInput();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    const unavailable = () => new RazorpayFailure('RAZORPAY_UNAVAILABLE', 'Razorpay did not confirm the request. Reconcile any pending change before trying again.', mutation);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(unavailable()); }, RAZORPAY_TIMEOUT_MS);
    });
    const work = async () => {
      let response: Response;
      try {
        response = await fetcher(`${API}${path}`, {
          method: mutation ? 'POST' : 'GET', redirect: 'manual', signal: controller.signal,
          headers: { Authorization: authorization, Accept: 'application/json', 'Content-Type': 'application/json' },
          ...(serialized === undefined ? {} : { body: serialized }),
        });
      } catch { throw unavailable(); }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        const uncertain = mutation && (response.status < 400 || response.status >= 500 || response.status === 408);
        throw new RazorpayFailure('RAZORPAY_REJECTED', 'Razorpay did not accept a confirmed billing request. Check the merchant dashboard.', uncertain, response.status);
      }
      const length = response.headers.get('Content-Length');
      if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_RAZORPAY_RESPONSE_BYTES)) invalidResponse(mutation);
      reader = response.body?.getReader();
      if (!reader) invalidResponse(mutation);
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        for (;;) {
          const next = await reader.read();
          if (controller.signal.aborted) throw unavailable();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > MAX_RAZORPAY_RESPONSE_BYTES) invalidResponse(mutation);
          chunks.push(next.value);
        }
        const bytes = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
      } catch (error) {
        if (error instanceof RazorpayFailure) throw error;
        invalidResponse(mutation);
      }
    };
    try { return await Promise.race([work(), timeout]); }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      // A stalled custom transport must not make cleanup bypass the time bound.
      controller.abort();
      void reader?.cancel().catch(() => {});
    }
  }

  return {
    async fetchPlan(planId: string): Promise<RazorpayPlan> {
      const id = inputId(planId, 'plan'), result = plan(await request(`/plans/${id}`));
      if (result.id !== id) invalidResponse(false);
      return result;
    },
    async createSubscription(input: { planId: string; reference: string; totalCount?: number; expireBy?: number }): Promise<RazorpaySubscription> {
      if (!input || typeof input.reference !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(input.reference)) invalidInput();
      const planId = inputId(input.planId, 'plan');
      const configuredCount = env.RAZORPAY_TOTAL_COUNT;
      const totalCount = input.totalCount ?? (typeof configuredCount === 'string' && /^[1-9]\d{0,3}$/.test(configuredCount) ? Number(configuredCount) : undefined);
      if (!count(totalCount) || totalCount < 1 || totalCount > 1200) configuration();
      const now = Math.floor(Date.now() / 1000), expireBy = input.expireBy ?? now + 86_400;
      if (!count(expireBy) || expireBy <= now || expireBy > now + 7 * 86_400) invalidInput();
      // No customer/contact identifiers, addons or client-selected price are sent.
      const result = await request('/subscriptions', { plan_id: planId, total_count: totalCount, quantity: 1,
        customer_notify: false, expire_by: expireBy, notes: { reference: input.reference } });
      return subscription(result, true, { planId }, true);
    },
    async fetchSubscription(subscriptionId: string): Promise<RazorpaySubscription> {
      const id = inputId(subscriptionId, 'sub');
      return subscription(await request(`/subscriptions/${id}`), false, { id });
    },
    async cancelSubscription(subscriptionId: string, options: { atPeriodEnd: boolean }): Promise<RazorpaySubscription> {
      const id = inputId(subscriptionId, 'sub');
      if (!options || typeof options.atPeriodEnd !== 'boolean') invalidInput();
      return subscription(await request(`/subscriptions/${id}/cancel`, { cancel_at_cycle_end: options.atPeriodEnd }), true, { id });
    },
    async fetchInvoice(invoiceId: string): Promise<RazorpayInvoice> {
      const id = inputId(invoiceId, 'inv');
      return invoice(await request(`/invoices/${id}`), id);
    },
    /** Recent monthly invoices only; exact-full pages fail rather than hide a
     * possible newer result. Official SDK invoices.all supports these filters:
     * https://github.com/razorpay/razorpay-node/blob/master/lib/resources/invoices.js
     */
    async listSubscriptionInvoices(subscriptionId: string): Promise<RazorpayInvoice[]> {
      const id = inputId(subscriptionId, 'sub');
      const now = Math.floor(Date.now() / 1000);
      const query = new URLSearchParams({ subscription_id: id, from: String(Math.max(0, now - 40 * 86_400)), to: String(now), count: '10', skip: '0' });
      const row = object(await request(`/invoices?${query}`));
      if (!row || row.entity !== 'collection' || !Array.isArray(row.items) || row.items.length >= 10 ||
          !count(row.count) || row.count !== row.items.length) invalidResponse(false);
      const result: RazorpayInvoice[] = [];
      for (const value of row.items) {
        const item = object(value);
        if (!item || item.entity !== 'invoice' || !validId(item.id, 'inv') || item.subscription_id !== id ||
            typeof item.status !== 'string' || !invoiceStatuses.has(item.status)) invalidResponse(false);
        if (item.status !== 'paid') continue;
        const normalized = invoice(value, item.id);
        result.push(normalized);
      }
      return result;
    },
  };
}

/** Verify the exact raw bytes before parsing JSON. Web Crypto performs MAC verification. */
export async function verifyRazorpayWebhook(rawBody: string | Uint8Array | ArrayBuffer, signature: unknown, secret: unknown): Promise<boolean> {
  if (typeof signature !== 'string' || !/^[a-fA-F0-9]{64}$/.test(signature) ||
      typeof secret !== 'string' || !/^[\x21-\x7e]{1,256}$/.test(secret)) return false;
  // Bound strings before encoding as well as bytes after UTF-8 encoding.
  if (typeof rawBody === 'string' && rawBody.length > MAX_RAZORPAY_WEBHOOK_BYTES) return false;
  const bytes = typeof rawBody === 'string' ? encoder.encode(rawBody) :
    rawBody instanceof Uint8Array ? rawBody : rawBody instanceof ArrayBuffer ? new Uint8Array(rawBody) : undefined;
  if (!bytes || !bytes.byteLength || bytes.byteLength > MAX_RAZORPAY_WEBHOOK_BYTES) return false;
  const mac = new Uint8Array(32);
  for (let i = 0; i < mac.length; i++) mac[i] = Number.parseInt(signature.slice(i * 2, i * 2 + 2), 16);
  try {
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    return await crypto.subtle.verify('HMAC', key, mac, bytes);
  } catch { return false; }
}
