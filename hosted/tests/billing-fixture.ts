// Disposable synthetic merchant. Never imported by a deploy entrypoint.
import { Fault, type Access, type Input } from '../src/contracts';
import type { BillingBinding, BillingBindings } from '../src/billing/bindings';

export class SyntheticBillingBindings implements BillingBindings {
  private rows = new Map<string, BillingBinding>();
  async get(id: string) { return structuredClone(this.rows.get(id) ?? null); }
  async bind(value: BillingBinding) {
    const prior = this.rows.get(value.subscription_id);
    if (prior && (prior.uid !== value.uid || prior.generation !== value.generation || prior.plan_id !== value.plan_id)) throw new Fault(409, 'BILLING_BINDING_CONFLICT', 'Synthetic binding conflict.');
    if (!prior) this.rows.set(value.subscription_id, structuredClone(value));
    return structuredClone(prior ?? value);
  }
  async close(id: string, access: Access) {
    const prior = this.rows.get(id);
    if (!prior || prior.uid !== access.uid || prior.generation !== access.generation) throw new Fault(409, 'BILLING_BINDING_CONFLICT', 'Synthetic binding conflict.');
    prior.closed = true;
  }
}
export const syntheticBillingBindings = new SyntheticBillingBindings();
const subscriptions = new Map<string, Input>(), invoices = new Map<string, Input>();
let creates = 0, cancels = 0, cancelUnavailable = false, createUnavailable = false;
export function billingFixtureControl(input: Input = {}) {
  if (input.restore !== undefined) {
    // Restore only an explicitly supplied synthetic merchant snapshot when a
    // test replaces its whole Worker/DO runtime. Never used by production code.
    const restore = input.restore as { subscriptions?: Input[]; invoices?: Input[]; creates?: number; cancels?: number };
    if (!restore || typeof restore !== 'object' || !Array.isArray(restore.subscriptions) || restore.subscriptions.length > 100 ||
        !Array.isArray(restore.invoices) || restore.invoices.length > 100 ||
        !Number.isSafeInteger(restore.creates) || Number(restore.creates) < 0 || Number(restore.creates) >= Number.MAX_SAFE_INTEGER ||
        !Number.isSafeInteger(restore.cancels) || Number(restore.cancels) < 0 ||
        restore.subscriptions.some(row => !row || typeof row.id !== 'string' || !/^sub_fixture\d+$/.test(row.id)) ||
        restore.invoices.some(row => !row || typeof row.id !== 'string' || !/^inv_fixture\d+$/.test(row.id)))
      throw new Fault(400, 'INVALID_SYNTHETIC_SNAPSHOT', 'Use a bounded synthetic merchant snapshot.');
    const restoredSubscriptions = restore.subscriptions.map(row => structuredClone(row)), restoredInvoices = restore.invoices.map(row => structuredClone(row));
    if (new Set(restoredSubscriptions.map(row => row.id)).size !== restoredSubscriptions.length ||
        new Set(restoredInvoices.map(row => row.id)).size !== restoredInvoices.length)
      throw new Fault(400, 'INVALID_SYNTHETIC_SNAPSHOT', 'Synthetic merchant IDs must be unique.');
    subscriptions.clear(); invoices.clear();
    for (const row of restoredSubscriptions) subscriptions.set(String(row.id), row);
    for (const row of restoredInvoices) invoices.set(String(row.id), row);
    creates = Number(restore.creates); cancels = Number(restore.cancels);
    cancelUnavailable = false; createUnavailable = false;
  }
  if (input.cancel_unavailable !== undefined) cancelUnavailable = input.cancel_unavailable === true;
  if (input.create_unavailable !== undefined) createUnavailable = input.create_unavailable === true;
  if (input.charge === true) {
    const id = String(input.subscription_id), sub = subscriptions.get(id);
    if (!sub) throw new Fault(404, 'NOT_FOUND', 'Synthetic subscription missing.');
    const start = Number(input.period_start ?? Math.floor(Date.now() / 1000) - 10), end = Number(input.period_end ?? start + 30 * 86400);
    const invoiceId = `inv_fixture${invoices.size + 1}`;
    invoices.set(invoiceId, { id: invoiceId, entity: 'invoice', subscription_id: id, status: 'paid', currency: 'INR',
      amount_paid: 19900, amount_due: 0, billing_start: start, billing_end: end, payment_id: `pay_fixture${invoices.size + 1}` });
    Object.assign(sub, { status: 'active', current_start: start, current_end: end, paid_count: Number(sub.paid_count) + 1 });
    return { invoice_id: invoiceId, subscription_id: id };
  }
  return { creates, cancels, subscriptions: [...subscriptions.values()], invoices: [...invoices.values()] };
}
export const billingFixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input)), path = url.pathname;
  if (url.origin !== 'https://api.razorpay.com') throw new Error('Synthetic merchant network is disabled.');
  if (!new Headers(init?.headers).get('Authorization')?.startsWith('Basic ')) return new Response('', { status: 401 });
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (path.startsWith('/v1/plans/')) return Response.json({ id: path.split('/').at(-1), entity: 'plan', period: 'monthly', interval: 1,
    item: { amount: 19900, currency: 'INR', name: 'Synthetic Pro' } });
  if (path === '/v1/subscriptions' && init?.method === 'POST') {
    creates++; const id = `sub_fixture${creates}`;
    const value = { id, entity: 'subscription', plan_id: body.plan_id, status: 'created', current_start: null, current_end: null,
      paid_count: 0, created_at: Math.floor(Date.now() / 1000), expire_by: body.expire_by, short_url: `https://rzp.io/rzp/fixture${creates}`, notes: body.notes };
    subscriptions.set(id, value); return createUnavailable ? new Response('', { status: 503 }) : Response.json(value);
  }
  const match = /^\/v1\/subscriptions\/(sub_[A-Za-z0-9]+)(\/cancel)?$/.exec(path);
  if (match) {
    const sub = subscriptions.get(match[1]!); if (!sub) return new Response('', { status: 404 });
    if (match[2]) {
      cancels++; if (cancelUnavailable) return new Response('', { status: 503 });
      if (!body.cancel_at_cycle_end || sub.status === 'created') sub.status = 'cancelled';
    }
    return Response.json(sub);
  }
  if (path === '/v1/invoices') {
    const items = [...invoices.values()].filter(invoice => invoice.subscription_id === url.searchParams.get('subscription_id'));
    return Response.json({ entity: 'collection', count: items.length, items });
  }
  if (path.startsWith('/v1/invoices/')) { const invoice = invoices.get(path.split('/').at(-1)!); return invoice ? Response.json(invoice) : new Response('', { status: 404 }); }
  throw new Error('Unexpected synthetic billing destination.');
};
