import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './src/billing/service.ts';
export * from './src/billing/policy.ts'; export { Fault } from './src/contracts.ts';`, resolveDir: process.cwd() },
bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
const { createBillingService, billingTransition, initialBilling, publicEntitlements, Fault } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const access = { uid: 'synthetic-owner', generation: 'synthetic-generation' };
const env = { BILLING_ENABLED: 'true', ENTITLEMENTS_ENABLED: 'true', RAZORPAY_KEY_ID: 'rzp_test_syntheticKey',
  RAZORPAY_KEY_SECRET: 'synthetic-server-secret', RAZORPAY_TOTAL_COUNT: '12', RAZORPAY_PLAN_ID: 'plan_synthetic123',
  RAZORPAY_AMOUNT_PAISE: '12300', RAZORPAY_WEBHOOK_SECRET: 'synthetic-webhook-secret' };
const intent = 'synthetic_opaque_checkout_0001';
const nowSeconds = () => Math.floor(Date.now() / 1000);
const monthStart = () => { const now = new Date(); return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) / 1000; };
const monthEnd = () => { const now = new Date(); return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1) / 1000; };
const invoice = (extra = {}) => ({ id: 'inv_synthetic123', entity: 'invoice', subscription_id: 'sub_synthetic1', status: 'paid',
  currency: 'INR', amount_paid: 12300, amount_due: 0, billing_start: monthStart(), billing_end: monthEnd(), payment_id: 'pay_synthetic123', ...extra });

function fixture(overrides = {}) {
  const events = [], mappings = new Map();
  let billing = initialBilling(), member = { ...access, state: 'active', created_at: new Date().toISOString() }, created = 0;
  const controls = { beforeStore: undefined, beforeFetch: undefined, failWork: false, workspaceStatus: 'active', failBind: 0, createError: 0,
    createUnknown: false, cancelUnknown: false, cancellationPending: false };
  const remote = new Map(), invoices = new Map();
  const store = {
    get billing() { return structuredClone(billing); }, set billing(value) { billing = structuredClone(value); },
    async invoke(owner, operation, input = {}) {
      assert.deepEqual(owner, access); events.push({ kind: 'store', operation, input: structuredClone(input) });
      try {
        if (controls.beforeStore) await controls.beforeStore(operation, input);
        if (operation === 'billing.get') return { ok: true, data: { ...structuredClone(billing), workspace_status: controls.workspaceStatus } };
        const result = billingTransition(billing, operation, input); billing = result.state;
        return { ok: true, data: result.result };
      } catch (error) { return { ok: false, status: error.status ?? 503, code: error.code ?? 'SYNTHETIC_FAILURE', message: 'Synthetic storage failure.' }; }
    },
  };
  const bindings = {
    get: async id => { events.push({ kind: 'binding.get', id }); return structuredClone(mappings.get(id) ?? null); },
    async bind(value) {
      events.push({ kind: 'binding.bind', value: structuredClone(value) });
      assert.equal(store.billing.subscription.id, value.subscription_id, 'private subscription is persisted before public binding');
      if (controls.failBind-- > 0) throw new Fault(503, 'SYNTHETIC_BINDING', 'Synthetic unavailable binding.');
      const existing = mappings.get(value.subscription_id);
      if (existing) {
        assert.deepEqual({ ...existing, closed: false }, { ...value, closed: false });
        return structuredClone(existing);
      }
      mappings.set(value.subscription_id, structuredClone(value)); return structuredClone(value);
    },
    async close(id, owner) {
      events.push({ kind: 'binding.close', id }); const value = mappings.get(id);
      assert.ok(value); assert.equal(value.uid, owner.uid); assert.equal(value.generation, owner.generation);
      value.closed = true;
    },
  };
  const fetcher = async (url, options) => {
    const parsed = new URL(url), body = options.body ? JSON.parse(options.body) : undefined;
    assert.equal(parsed.origin, 'https://api.razorpay.com'); assert.equal(options.redirect, 'manual');
    events.push({ kind: 'provider', path: parsed.pathname, method: options.method, body });
    if (controls.beforeFetch) await controls.beforeFetch(parsed.pathname, options.method, body);
    if (parsed.pathname === '/v1/plans/plan_synthetic123') return Response.json({ id: 'plan_synthetic123', entity: 'plan', interval: 1,
      period: 'monthly', item: { amount: 12300, currency: 'INR', name: 'Synthetic configured plan' }, ...overrides.plan });
    if (parsed.pathname === '/v1/subscriptions' && options.method === 'POST') {
      assert.equal(billing.checkout.status, 'CREATING', 'intent persists before external submission');
      assert.deepEqual(Object.keys(body).sort(), ['customer_notify', 'expire_by', 'notes', 'plan_id', 'quantity', 'total_count']);
      assert.match(body.notes.reference, /^[a-f0-9]{64}$/);
      assert.ok(!JSON.stringify(body).includes(access.uid)); assert.ok(!JSON.stringify(body).includes(billing.checkout.intent_id));
      if (controls.createError) return new Response('{}', { status: controls.createError });
      const id = `sub_synthetic${++created}`, data = { id, entity: 'subscription', plan_id: body.plan_id, status: 'created',
        current_start: null, current_end: null, paid_count: 0, created_at: nowSeconds(), expire_by: body.expire_by,
        short_url: `https://rzp.io/rzp/synthetic${created}`, notes: structuredClone(body.notes) };
      remote.set(id, data);
      if (controls.createUnknown) throw new Error('Synthetic response lost after remote creation.');
      return Response.json(data);
    }
    const subscription = /^\/v1\/subscriptions\/(sub_[A-Za-z0-9]+)(\/cancel)?$/.exec(parsed.pathname);
    if (subscription) {
      const data = remote.get(subscription[1]); assert.ok(data, 'only known subscription references are used');
      if (subscription[2]) {
        assert.equal(options.method, 'POST');
        if (!body.cancel_at_cycle_end && !controls.cancellationPending) data.status = 'cancelled';
        if (controls.cancelUnknown) { controls.cancelUnknown = false; throw new Error('Synthetic cancellation response lost.'); }
      }
      return Response.json(data);
    }
    if (parsed.pathname === '/v1/invoices') {
      assert.equal(parsed.searchParams.get('count'), '10'); assert.equal(parsed.searchParams.get('skip'), '0');
      assert.ok(Number(parsed.searchParams.get('from')) >= nowSeconds() - 40 * 86_400 - 1);
      assert.ok(Number(parsed.searchParams.get('to')) <= nowSeconds());
      const items = [...invoices.values()].filter(row => row.subscription_id === parsed.searchParams.get('subscription_id'));
      return Response.json({ entity: 'collection', count: items.length, items });
    }
    const requestedInvoice = /^\/v1\/invoices\/(inv_[A-Za-z0-9]+)$/.exec(parsed.pathname);
    if (requestedInvoice) { assert.ok(invoices.has(requestedInvoice[1])); return Response.json(invoices.get(requestedInvoice[1])); }
    throw new Error('Unexpected synthetic provider route.');
  };
  const serviceEnv = { ...env, ...overrides.env };
  const service = createBillingService(serviceEnv, { fetcher, bindings, workspaceFor: owner => { assert.deepEqual(owner, access); return store; },
    membershipFor: async uid => { events.push({ kind: 'membership', uid }); return structuredClone(member); },
    reserveWork: async (owner, id, units) => {
      assert.deepEqual(owner, access); events.push({ kind: 'work', id, units });
      if (controls.failWork) throw new Fault(429, 'WORK_PAUSED', 'Synthetic work pool is full.');
    } });
  return { service, env: serviceEnv, store, controls, events, mappings, remote, invoices,
    get member() { return member; }, set member(value) { member = value; }, get created() { return created; },
    async checkout(id = intent) { return service.checkout(access, store, { intent_id: id }); },
    webhook(event, signed = true, rawOverride) {
      const raw = rawOverride ?? JSON.stringify(event);
      return new Request('https://synthetic.invalid/api/billing/webhook', { method: 'POST', body: raw,
        headers: signed ? { 'X-Razorpay-Signature': createHmac('sha256', env.RAZORPAY_WEBHOOK_SECRET).update(raw).digest('hex') } : {} });
    },
  };
}
const paidEvent = (invoiceId = 'inv_synthetic123') => ({ event: 'invoice.paid', payload: { invoice: { entity: { id: invoiceId,
  subscription_id: 'sub_synthetic1', ignored_private_customer: 'synthetic-PII-must-not-persist' } } } });
const providerCalls = fixture => fixture.events.filter(event => event.kind === 'provider');

test('missing merchant configuration keeps checkout closed without provider calls or intent writes', async () => {
  for (const config of [{ BILLING_ENABLED: 'false' }, { ENTITLEMENTS_ENABLED: 'false' }, { RAZORPAY_PLAN_ID: undefined },
    { RAZORPAY_AMOUNT_PAISE: undefined }, { RAZORPAY_AMOUNT_PAISE: '0' }, { RAZORPAY_AMOUNT_PAISE: '1.2' },
    { RAZORPAY_TOTAL_COUNT: undefined }, { RAZORPAY_TOTAL_COUNT: '0' }, { RAZORPAY_KEY_ID: 'rzp_live_syntheticKey' }]) {
    const fx = fixture({ env: config });
    assert.equal((await fx.service.info(access, fx.store)).available, false);
    await assert.rejects(fx.checkout());
    assert.equal(providerCalls(fx).length, 0); assert.equal(fx.store.billing.checkout, undefined);
  }
});

test('server plan, amount, currency and cadence are verified before checkout begins', async () => {
  for (const plan of [{ period: 'yearly' }, { interval: 2 }, { item: { amount: 1, currency: 'INR', name: 'Wrong amount' } },
    { item: { amount: 12300, currency: 'USD', name: 'Wrong currency' } }]) {
    const fx = fixture({ plan });
    await assert.rejects(fx.checkout(), { code: 'BILLING_PLAN_MISMATCH' });
    assert.equal(fx.created, 0); assert.equal(fx.store.billing.checkout, undefined);
  }
  const fx = fixture();
  await assert.rejects(fx.service.checkout(access, fx.store, { intent_id: intent, plan_id: 'plan_client' }), { code: 'INVALID_BILLING_INPUT' });
  await assert.rejects(fx.service.checkout(access, fx.store, { intent_id: intent, amount: 1 }), { code: 'INVALID_BILLING_INPUT' });
  assert.equal(providerCalls(fx).length, 0);
});

test('intent, returned subscription, immutable binding and final member check precede the only payment URL', async () => {
  const fx = fixture(), result = await fx.checkout();
  assert.deepEqual(result, { checkout_url: 'https://rzp.io/rzp/synthetic1', replayed: false });
  assert.equal(fx.store.billing.checkout.status, 'CREATED'); assert.equal(fx.mappings.size, 1); assert.equal(fx.created, 1);
  const events = fx.events;
  const begin = events.findIndex(event => event.operation === 'checkout.begin'), submit = events.findIndex(event => event.path === '/v1/subscriptions'),
    complete = events.findIndex(event => event.operation === 'checkout.complete'), mapping = events.findIndex(event => event.kind === 'binding.bind');
  assert.ok(begin < submit && submit < complete && complete < mapping);
  assert.equal(events.at(-2).kind, 'membership'); assert.equal(events.at(-1).operation, 'billing.get');
  const info = await fx.service.info(access, fx.store), serialized = JSON.stringify(info);
  assert.equal(info.price.amount, 12300); assert.equal(info.price.currency, 'INR');
  for (const privateText of ['sub_synthetic1', 'plan_synthetic123', intent, env.RAZORPAY_KEY_SECRET]) assert.ok(!serialized.includes(privateText));
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'free');
});

test('concurrent checkout and ready retry create once and reuse the same owned URL', async () => {
  const fx = fixture();
  const concurrent = await Promise.allSettled([fx.checkout(), fx.checkout('synthetic_opaque_checkout_0002')]);
  assert.equal(concurrent.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(fx.created, 1);
  assert.deepEqual(await fx.checkout('synthetic_opaque_checkout_0003'), { checkout_url: 'https://rzp.io/rzp/synthetic1', replayed: true });
  assert.equal(fx.created, 1);
});

test('known subscription survives mapping outage and ready retry repairs ownership without recreation', async () => {
  const fx = fixture(); fx.controls.failBind = 1;
  await assert.rejects(fx.checkout(), { code: 'SYNTHETIC_BINDING' });
  assert.equal(fx.store.billing.subscription.id, 'sub_synthetic1'); assert.equal(fx.mappings.size, 0);
  assert.equal((await fx.checkout()).replayed, true); assert.equal(fx.created, 1); assert.equal(fx.mappings.size, 1);
});

test('unknown remote create and unconfirmed private completion never permit blind recreation or deletion', async () => {
  const unknown = fixture(); unknown.controls.createUnknown = true;
  await assert.rejects(unknown.checkout(), error => error.uncertain === true);
  assert.equal(unknown.created, 1); assert.equal(unknown.store.billing.checkout.status, 'UNCERTAIN');
  await assert.rejects(unknown.checkout('synthetic_new_checkout_0002'), { code: 'BILLING_UNCERTAIN' });
  await assert.rejects(unknown.service.closeForDeletion(access, unknown.store), { code: 'BILLING_UNCERTAIN' });
  assert.equal(unknown.created, 1);
  const completion = fixture();
  completion.controls.beforeStore = operation => { if (operation === 'checkout.complete') throw new Fault(503, 'SYNTHETIC_STORAGE', 'Synthetic unavailable storage.'); };
  await assert.rejects(completion.checkout(), { code: 'SYNTHETIC_STORAGE' });
  assert.equal(completion.store.billing.checkout.status, 'CREATING'); assert.equal(completion.created, 1);
  completion.controls.beforeStore = undefined;
  await assert.rejects(completion.checkout(), { code: 'BILLING_UNCERTAIN' });
  await assert.rejects(completion.service.closeForDeletion(access, completion.store), { code: 'BILLING_UNCERTAIN' });
  assert.equal(completion.created, 1);
});

test('definite rejected creation permits a fresh intent and pre-submit membership loss has no uncertain charge', async () => {
  const fx = fixture(); fx.controls.createError = 400;
  await assert.rejects(fx.checkout(), error => error.uncertain === false);
  assert.equal(fx.store.billing.checkout.status, 'FAILED'); assert.equal(fx.created, 0);
  fx.controls.createError = 0; await fx.checkout('synthetic_next_checkout_0002'); assert.equal(fx.created, 1);
  const before = fixture(); before.controls.beforeStore = operation => {
    if (operation === 'checkout.begin') before.member = { ...before.member, state: 'deleting' };
  };
  await assert.rejects(before.checkout(), { code: 'BILLING_MEMBERSHIP' });
  assert.equal(before.store.billing.checkout.status, 'FAILED'); assert.equal(before.created, 0);
});

test('membership change during external creation retains known subscription but withholds payment URL', async () => {
  const fx = fixture(); fx.controls.beforeFetch = (path, method) => {
    if (path === '/v1/subscriptions' && method === 'POST') fx.member = { ...fx.member, state: 'deleting' };
  };
  await assert.rejects(fx.checkout(), { code: 'ACCOUNT_DELETING', status: 409 });
  assert.equal(fx.created, 1); assert.equal(fx.store.billing.checkout.status, 'CREATED'); assert.equal(fx.mappings.size, 1);
  await fx.service.closeForDeletion(access, fx.store);
  assert.equal(fx.remote.get('sub_synthetic1').status, 'cancelled'); assert.equal(fx.mappings.get('sub_synthetic1').closed, true);
});

test('workspace freeze before Registry transition withholds new and replayed payment URLs', async () => {
  const fx = fixture(); fx.controls.beforeFetch = (path, method) => {
    if (path === '/v1/subscriptions' && method === 'POST') fx.controls.workspaceStatus = 'deleting';
  };
  await assert.rejects(fx.checkout(), { code: 'ACCOUNT_DELETING' });
  assert.equal(fx.member.state, 'active'); assert.equal(fx.store.billing.checkout.status, 'CREATED'); assert.equal(fx.mappings.size, 1);
  fx.controls.beforeFetch = undefined;
  await assert.rejects(fx.checkout(), { code: 'ACCOUNT_DELETING' }); assert.equal(fx.created, 1);
});

test('ready replay rechecks active generation after provider reads', async () => {
  const fx = fixture(); await fx.checkout();
  fx.controls.beforeFetch = path => { if (path === '/v1/subscriptions/sub_synthetic1') fx.member = { ...fx.member, generation: 'new-generation' }; };
  await assert.rejects(fx.checkout(), { code: 'ACCOUNT_DELETING' }); assert.equal(fx.created, 1);
});

test('active subscription alone never grants Pro; authoritative paid invoice grants once in milliseconds', async () => {
  const fx = fixture(); await fx.checkout(); fx.remote.get('sub_synthetic1').status = 'active';
  await fx.service.sync(access, fx.store);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'free');
  fx.invoices.set('inv_synthetic123', invoice());
  await fx.service.sync(access, fx.store); await fx.service.sync(access, fx.store);
  const billing = fx.store.billing, entitlement = publicEntitlements(env, billing, 0, 0);
  assert.equal(entitlement.plan, 'pro'); assert.equal(entitlement.points.limit, 200); assert.equal(billing.paid_periods.length, 1);
  assert.equal(billing.paid_periods[0].period_start, monthStart() * 1000); assert.equal(billing.paid_periods[0].period_end, monthEnd() * 1000);
});

test('unpaid, partial, wrong-amount/currency and missing payment/period evidence cannot grant', async () => {
  for (const change of [{ status: 'issued', amount_paid: 0 }, { status: 'partially_paid', amount_paid: 12000, amount_due: 300 },
    { amount_paid: 1 }, { amount_due: 1 }, { currency: 'USD' }, { payment_id: null },
    { billing_start: null, billing_end: null }, { billing_start: nowSeconds() - 1000, billing_end: nowSeconds() - 100 },
    { billing_start: monthStart(), billing_end: monthStart() + 41 * 86_400 }]) {
    const fx = fixture(); await fx.checkout(); fx.invoices.set('inv_synthetic123', invoice(change));
    await fx.service.sync(access, fx.store);
    assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'free');
  }
  const changed = fixture(); await changed.checkout(); changed.remote.get('sub_synthetic1').plan_id = 'plan_other123';
  changed.invoices.set('inv_synthetic123', invoice());
  await assert.rejects(changed.service.sync(access, changed.store), { code: 'BILLING_PLAN_MISMATCH' });
  assert.equal(changed.store.billing.paid_periods.length, 0);
});

test('unsigned, bad-MAC, malformed and oversized webhooks cannot reach storage or provider', async () => {
  const fx = fixture();
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent(), false))).status, 401);
  const bad = fx.webhook(paidEvent()); bad.headers.set('X-Razorpay-Signature', '0'.repeat(64));
  assert.equal((await fx.service.webhook(bad)).status, 401);
  assert.equal((await fx.service.webhook(fx.webhook({}, true, '{invalid'))).status, 400);
  assert.equal((await fx.service.webhook(fx.webhook({}, true, 'x'.repeat(131073)))).status, 413);
  assert.equal((await fx.service.webhook(fx.webhook({ event: 'invoice.paid', payload: {} }))).status, 400);
  assert.deepEqual(fx.events, []);
});

test('stalled raw webhook body has a bounded timeout before any storage or provider work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fx = fixture(); let cancelled = false;
  const request = new Request('https://synthetic.invalid/api/billing/webhook', { method: 'POST', duplex: 'half',
    headers: { 'X-Razorpay-Signature': '0'.repeat(64) },
    body: new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } }) });
  const pending = fx.service.webhook(request);
  await Promise.resolve(); t.mock.timers.tick(10_000);
  assert.equal((await pending).status, 408); assert.equal(cancelled, true); assert.deepEqual(fx.events, []);
});

test('verified charged and invoice.paid webhooks fetch authoritative facts and do not refill on duplicates or older events', async () => {
  const fx = fixture(); await fx.checkout(); fx.invoices.set('inv_synthetic123', invoice());
  const current = paidEvent();
  assert.equal((await fx.service.webhook(fx.webhook(current))).status, 200);
  const first = fx.store.billing; first.paid_periods[0].used = 1; fx.store.billing = first;
  const charged = { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_synthetic1' } },
    payment: { entity: { invoice_id: 'inv_synthetic123', amount: 1, ignored_card: 'synthetic-PII-must-not-persist' } } } };
  assert.equal((await fx.service.webhook(fx.webhook(charged))).status, 200);
  fx.invoices.set('inv_older123', invoice({ id: 'inv_older123', billing_start: monthStart() - 28 * 86_400, billing_end: monthStart() }));
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent('inv_older123')))).status, 200);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).points.remaining, 199); assert.equal(fx.store.billing.paid_periods.length, 1);
  assert.ok(providerCalls(fx).some(event => event.path === '/v1/invoices/inv_synthetic123'));
  assert.ok(!JSON.stringify([...fx.mappings.values(), fx.store.billing]).includes('synthetic-PII-must-not-persist'));
  const reserved = fx.events.filter(event => event.kind === 'work');
  assert.equal(reserved.length, 3); assert.equal(new Set(reserved.map(event => event.id)).size, 3);
  assert.ok(reserved.every(event => event.units === 256 && event.id.length <= 100));
});

test('webhook work reservation precedes provider calls and budget failure asks for retry without granting', async () => {
  const fx = fixture(); await fx.checkout(); fx.invoices.set('inv_synthetic123', invoice()); fx.controls.failWork = true;
  const before = providerCalls(fx).length;
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 503);
  assert.equal(providerCalls(fx).length, before); assert.equal(fx.store.billing.paid_periods.length, 0);
  fx.controls.failWork = false; assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 200);
  const index = fx.events.findLastIndex(event => event.kind === 'work');
  assert.equal(fx.events[index + 1].kind, 'provider'); assert.equal(fx.events[index + 1].path, '/v1/invoices/inv_synthetic123');
});

test('future renewal delivered before the current paid invoice preserves both periods without refilling current points', async () => {
  const fx = fixture(); await fx.checkout();
  const futureStart = monthEnd(), futureEnd = (() => { const now = new Date(); return Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 1) / 1000; })();
  fx.invoices.set('inv_future123', invoice({ id: 'inv_future123', billing_start: futureStart, billing_end: futureEnd }));
  fx.invoices.set('inv_synthetic123', invoice());
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent('inv_future123')))).status, 200);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'free');
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 200);
  const billing = fx.store.billing; billing.paid_periods.find(period => period.period_start === monthStart() * 1000).used = 1; fx.store.billing = billing;
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent('inv_future123')))).status, 200);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).points.remaining, 199); assert.equal(fx.store.billing.paid_periods.length, 2);
});

test('webhook checks original sale terms and invoice ownership rather than trusting payload amounts or new configured prices', async () => {
  const fx = fixture(); await fx.checkout(); fx.env.RAZORPAY_AMOUNT_PAISE = '99999';
  fx.invoices.set('inv_synthetic123', invoice({ subscription_id: 'sub_another123' }));
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 200); assert.equal(fx.store.billing.paid_periods.length, 0);
  fx.invoices.set('inv_synthetic123', invoice());
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 200);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'pro');
});

test('closed, deleted, suspended and superseded generations ignore late webhook events', async () => {
  for (const change of [{ state: 'deleted' }, { state: 'deleting' }, { state: 'suspended' }, { generation: 'new-generation' }]) {
    const fx = fixture(); await fx.checkout(); fx.invoices.set('inv_synthetic123', invoice()); fx.member = { ...fx.member, ...change };
    const before = providerCalls(fx).length;
    assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 200);
    assert.equal(providerCalls(fx).length, before); assert.equal(fx.store.billing.paid_periods.length, 0);
  }
  const fx = fixture(); await fx.checkout(); await fx.service.closeForDeletion(access, fx.store);
  const before = providerCalls(fx).length;
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 200); assert.equal(providerCalls(fx).length, before);
});

test('closing checkout switch does not prevent existing cancellation, payment reconciliation or immediate deletion cancellation', async () => {
  const fx = fixture(); await fx.checkout(); fx.remote.get('sub_synthetic1').status = 'active'; fx.invoices.set('inv_synthetic123', invoice());
  fx.env.BILLING_ENABLED = 'false'; delete fx.env.RAZORPAY_PLAN_ID; delete fx.env.RAZORPAY_AMOUNT_PAISE;
  assert.equal((await fx.service.webhook(fx.webhook(paidEvent()))).status, 200);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'pro');
  await fx.service.cancel(access, fx.store); await fx.service.cancel(access, fx.store);
  assert.equal(fx.remote.get('sub_synthetic1').status, 'active'); assert.equal(fx.store.billing.subscription.cancel_at_end, true);
  assert.equal(providerCalls(fx).filter(event => event.body?.cancel_at_cycle_end === true).length, 1);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'pro');
  fx.member = { ...fx.member, state: 'deleting' }; await fx.service.closeForDeletion(access, fx.store);
  assert.equal(fx.remote.get('sub_synthetic1').status, 'cancelled'); assert.equal(fx.mappings.get('sub_synthetic1').closed, true);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'pro', 'already paid access lasts through its recorded end');
});

test('deletion waits for verified remote cancellation and retries an unknown cancellation by fetching first', async () => {
  const fx = fixture(); await fx.checkout(); fx.controls.cancellationPending = true;
  await assert.rejects(fx.service.closeForDeletion(access, fx.store), { code: 'BILLING_CANCELLATION_PENDING' });
  assert.equal(fx.mappings.get('sub_synthetic1').closed, false); assert.equal(fx.store.billing.subscription.closed, false);
  fx.controls.cancellationPending = false; fx.controls.cancelUnknown = true;
  await assert.rejects(fx.service.closeForDeletion(access, fx.store), error => error.uncertain === true);
  assert.equal(fx.remote.get('sub_synthetic1').status, 'cancelled');
  const before = providerCalls(fx).filter(event => event.body?.cancel_at_cycle_end === false).length;
  await fx.service.closeForDeletion(access, fx.store);
  assert.equal(providerCalls(fx).filter(event => event.body?.cancel_at_cycle_end === false).length, before);
  assert.equal(fx.store.billing.subscription.closed, true); assert.equal(fx.mappings.get('sub_synthetic1').closed, true);
});

test('interrupted ledger closure after tombstone repairs on deletion retry without another cancellation', async () => {
  const fx = fixture(); await fx.checkout(); let failed = false;
  fx.controls.beforeStore = operation => { if (operation === 'billing.closed' && !failed) { failed = true; throw new Fault(503, 'SYNTHETIC_STORAGE', 'Synthetic interruption.'); } };
  await assert.rejects(fx.service.closeForDeletion(access, fx.store), { code: 'SYNTHETIC_STORAGE' });
  assert.equal(fx.mappings.get('sub_synthetic1').closed, true); assert.equal(fx.store.billing.subscription.closed, false);
  await fx.service.closeForDeletion(access, fx.store);
  assert.equal(fx.store.billing.subscription.closed, true);
  assert.equal(providerCalls(fx).filter(event => event.body?.cancel_at_cycle_end === false).length, 1);
});

test('expired uncompleted checkout is cancelled and closed before any replacement is allowed', async () => {
  const fx = fixture(); await fx.checkout(); fx.remote.get('sub_synthetic1').expire_by = nowSeconds() - 1;
  await assert.rejects(fx.checkout(), { code: 'BILLING_CLOSED' });
  assert.equal(fx.remote.get('sub_synthetic1').status, 'cancelled'); assert.equal(fx.store.billing.subscription.closed, true);
  assert.equal(fx.created, 1);
  await fx.checkout('synthetic_new_checkout_0002'); assert.equal(fx.created, 2);
});

test('operator reconciliation binds an uncertain known ID and verified payment without a new provider submission', async () => {
  const fx = fixture(); fx.controls.createUnknown = true;
  await assert.rejects(fx.checkout(), error => error.uncertain === true);
  fx.remote.get('sub_synthetic1').status = 'active'; fx.invoices.set('inv_synthetic123', invoice());
  fx.env.BILLING_ENABLED = 'false'; delete fx.env.RAZORPAY_PLAN_ID; delete fx.env.RAZORPAY_AMOUNT_PAISE;
  assert.deepEqual(await fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1'), { reconciled: true, closed: false, checkout_status: 'CREATED' });
  assert.equal(fx.store.billing.subscription.id, 'sub_synthetic1'); assert.equal(fx.mappings.size, 1); assert.equal(fx.created, 1);
  assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).plan, 'pro');
  const billing = fx.store.billing; billing.paid_periods[0].used = 1; fx.store.billing = billing;
  const retry = await fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1');
  assert.equal(retry.closed, false); assert.equal(fx.created, 1); assert.equal(publicEntitlements(env, fx.store.billing, 0, 0).points.remaining, 199);
  assert.ok(!JSON.stringify(retry).includes('rzp.io')); assert.ok(!JSON.stringify(retry).includes('sub_synthetic1'));
});

test('operator reconciliation rejects wrong reference, original plan, price, currency, creation window and existing owner', async () => {
  for (const tamper of [
    fx => { fx.remote.get('sub_synthetic1').notes.reference = '0'.repeat(64); },
    fx => { fx.remote.get('sub_synthetic1').notes.reference = access.uid; },
    fx => { fx.remote.get('sub_synthetic1').plan_id = 'plan_another123'; },
    fx => { const state = fx.store.billing; state.checkout.amount = 1; fx.store.billing = state; },
    fx => { const state = fx.store.billing; state.checkout.currency = 'USD'; fx.store.billing = state; },
    fx => { fx.remote.get('sub_synthetic1').created_at = Math.floor(fx.store.billing.checkout.created_at / 1000) - 301; },
    fx => { fx.remote.get('sub_synthetic1').created_at = Math.floor(fx.store.billing.checkout.created_at / 1000) + 901; },
    fx => { fx.mappings.set('sub_synthetic1', { ...access, uid: 'another-owner', subscription_id: 'sub_synthetic1', plan_id: env.RAZORPAY_PLAN_ID, amount: 12300, currency: 'INR', closed: false }); },
  ]) {
    const fx = fixture(); fx.controls.createUnknown = true; await assert.rejects(fx.checkout()); tamper(fx);
    await assert.rejects(fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1'));
    assert.equal(fx.store.billing.checkout.status, 'UNCERTAIN'); assert.equal(fx.store.billing.subscription, undefined); assert.equal(fx.created, 1);
    assert.equal(fx.events.filter(event => event.operation === 'checkout.reconcile').length, 0);
  }
});

test('operator reconciliation cannot invent an intent, replace a known ID or bind after definite failure', async () => {
  const empty = fixture();
  await assert.rejects(empty.service.reconcileUncertain(access, empty.store, 'sub_synthetic1'), { code: 'BILLING_RECONCILIATION_MISMATCH' });
  assert.equal(providerCalls(empty).length, 0);
  const failed = fixture(); failed.controls.createError = 400; await assert.rejects(failed.checkout());
  await assert.rejects(failed.service.reconcileUncertain(access, failed.store, 'sub_synthetic1'), { code: 'BILLING_RECONCILIATION_MISMATCH' });
  const known = fixture(); await known.checkout();
  await assert.rejects(known.service.reconcileUncertain(access, known.store, 'sub_another123'), { code: 'BILLING_RECONCILIATION_MISMATCH' });
  assert.equal(known.created, 1);
});

test('operator reconciliation recovers retained CREATING and repairs interrupted immutable binding safely', async () => {
  const fx = fixture();
  fx.controls.beforeStore = operation => { if (operation === 'checkout.complete') throw new Fault(503, 'SYNTHETIC_STORAGE', 'Synthetic interruption.'); };
  await assert.rejects(fx.checkout()); assert.equal(fx.store.billing.checkout.status, 'CREATING');
  fx.controls.beforeStore = undefined; fx.controls.failBind = 1;
  await assert.rejects(fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1'), { code: 'SYNTHETIC_BINDING' });
  assert.equal(fx.store.billing.subscription.id, 'sub_synthetic1'); assert.equal(fx.created, 1);
  assert.equal((await fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1')).closed, false);
  assert.equal(fx.mappings.size, 1); assert.equal(fx.created, 1);
});

test('operator reconciliation retains terminal null-URL identity while frozen/flagoff and unblocks deletion', async () => {
  const fx = fixture(); fx.controls.createUnknown = true; await assert.rejects(fx.checkout());
  Object.assign(fx.remote.get('sub_synthetic1'), { status: 'cancelled', short_url: null });
  fx.member = { ...fx.member, state: 'deleting' }; fx.controls.workspaceStatus = 'deleting';
  fx.env.BILLING_ENABLED = 'false'; fx.env.ENTITLEMENTS_ENABLED = 'false';
  const result = await fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1');
  assert.deepEqual(result, { reconciled: true, closed: true, checkout_status: 'CREATED' });
  assert.equal(fx.store.billing.checkout.checkout_url, undefined); assert.equal(fx.store.billing.subscription.closed, true);
  assert.equal(fx.mappings.get('sub_synthetic1').closed, true); await fx.service.closeForDeletion(access, fx.store);
  assert.equal(fx.created, 1); assert.equal(providerCalls(fx).filter(event => event.path.endsWith('/cancel')).length, 0);
});

test('operator reconciliation of a frozen active subscription cancels immediately and verifies before closure', async () => {
  const fx = fixture(); fx.controls.createUnknown = true; await assert.rejects(fx.checkout());
  Object.assign(fx.remote.get('sub_synthetic1'), { status: 'active', short_url: null });
  fx.member = { ...fx.member, state: 'deleting' }; fx.controls.workspaceStatus = 'deleting'; fx.controls.cancellationPending = true;
  await assert.rejects(fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1'), { code: 'BILLING_CANCELLATION_PENDING' });
  assert.equal(fx.store.billing.subscription.id, 'sub_synthetic1'); assert.equal(fx.store.billing.subscription.closed, false);
  fx.controls.cancellationPending = false;
  assert.equal((await fx.service.reconcileUncertain(access, fx.store, 'sub_synthetic1')).closed, true);
  assert.equal(fx.remote.get('sub_synthetic1').status, 'cancelled'); assert.equal(fx.created, 1);
});
