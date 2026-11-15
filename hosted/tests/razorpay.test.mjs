import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/billing/razorpay.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
const { createRazorpay, RazorpayFailure, verifyRazorpayWebhook, MAX_RAZORPAY_RESPONSE_BYTES,
  MAX_RAZORPAY_WEBHOOK_BYTES, RAZORPAY_TIMEOUT_MS } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

// Entirely synthetic provider data. No call reaches a provider account.
const env = { BILLING_ENABLED: 'true', RAZORPAY_KEY_ID: 'rzp_test_syntheticKey',
  RAZORPAY_KEY_SECRET: 'synthetic-server-secret', RAZORPAY_TOTAL_COUNT: '12' };
const reference = 'synthetic_opaque_reference_0001';
const currentStart = 1_800_000_000, currentEnd = 1_802_592_000;
const subscription = (extra = {}) => ({ id: 'sub_synthetic123', entity: 'subscription', plan_id: 'plan_synthetic123', status: 'created',
  short_url: 'https://rzp.io/rzp/synthetic123', current_start: null, current_end: null, paid_count: 0,
  created_at: currentStart, expire_by: currentStart + 86_400, ...extra });
const plan = (extra = {}) => ({ id: 'plan_synthetic123', entity: 'plan', period: 'monthly', interval: 1,
  item: { amount: 12300, currency: 'INR', name: 'Synthetic configured plan' }, ...extra });
const invoice = (extra = {}) => ({ id: 'inv_synthetic123', entity: 'invoice', subscription_id: 'sub_synthetic123', status: 'paid',
  currency: 'INR', amount_paid: 12300, amount_due: 0, billing_start: currentStart, billing_end: currentEnd,
  payment_id: 'pay_synthetic123', ...extra });
const json = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const input = extra => ({ planId: 'plan_synthetic123', reference, ...extra });
const failure = (code, uncertain = false) => error => error instanceof RazorpayFailure && error.code === code && error.uncertain === uncertain;

test('billing configuration fails closed before network and defaults only to test mode', async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return json(plan()); };
  for (const disabled of [{}, { ...env, BILLING_ENABLED: undefined }, { ...env, BILLING_ENABLED: 'false' }, { ...env, BILLING_ENABLED: 'TRUE' }])
    assert.throws(() => createRazorpay(disabled, fetcher), failure('BILLING_DISABLED'));
  for (const invalid of [{ ...env, RAZORPAY_KEY_ID: undefined }, { ...env, RAZORPAY_KEY_SECRET: undefined },
    { ...env, RAZORPAY_KEY_SECRET: 'secret\nnot-safe' }, { ...env, RAZORPAY_MODE: 'arbitrary' },
    { ...env, RAZORPAY_KEY_ID: 'rzp_live_syntheticKey' }, { ...env, RAZORPAY_MODE: 'test', RAZORPAY_KEY_ID: 'rzp_live_syntheticKey' },
    { ...env, RAZORPAY_MODE: 'live' }, { ...env, RAZORPAY_KEY_ID: 'rzp_test_syntheticKey:bad' }])
    assert.throws(() => createRazorpay(invalid, fetcher), failure('BILLING_CONFIGURATION_INVALID'));
  assert.equal(calls, 0);
  await createRazorpay(env, fetcher).fetchPlan('plan_synthetic123');
  await createRazorpay({ ...env, RAZORPAY_MODE: 'live', RAZORPAY_KEY_ID: 'rzp_live_syntheticKey' }, fetcher).fetchPlan('plan_synthetic123');
  assert.equal(calls, 2);
});

test('create sends one fixed-origin Basic-auth request with finite cycles and only an opaque reference', async () => {
  const calls = [], expireBy = Math.floor(Date.now() / 1000) + 86_400;
  const provider = createRazorpay(env, async (url, init) => { calls.push({ url, init }); return json(subscription()); });
  const result = await provider.createSubscription(input({ expireBy }));
  assert.deepEqual(result, { id: 'sub_synthetic123', planId: 'plan_synthetic123', status: 'created',
    checkoutUrl: 'https://rzp.io/rzp/synthetic123', currentStart: null, currentEnd: null, paidCount: 0,
    createdAt: currentStart, expireBy: currentStart + 86_400, reference: null });
  assert.equal(calls.length, 1);
  const { url, init } = calls[0];
  assert.equal(url, 'https://api.razorpay.com/v1/subscriptions');
  assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual');
  assert.ok(init.signal instanceof AbortSignal);
  assert.equal(init.headers.Authorization, `Basic ${Buffer.from(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`).toString('base64')}`);
  assert.deepEqual(JSON.parse(init.body), { plan_id: 'plan_synthetic123', total_count: 12, quantity: 1,
    customer_notify: false, expire_by: expireBy, notes: { reference } });
  assert.ok(!JSON.stringify(result).includes(env.RAZORPAY_KEY_SECRET));
});

test('trusted cycle and expiry settings are bounded and no price or contact is forwarded', async () => {
  const calls = [], provider = createRazorpay({ ...env, RAZORPAY_TOTAL_COUNT: undefined }, async (_, init) => {
    calls.push(JSON.parse(init.body)); return json(subscription());
  });
  await assert.rejects(provider.createSubscription(input()), failure('BILLING_CONFIGURATION_INVALID'));
  for (const totalCount of [0, -1, 1.5, 1201, Infinity, '12'])
    await assert.rejects(provider.createSubscription(input({ totalCount })), failure('BILLING_CONFIGURATION_INVALID'));
  for (const expireBy of [0, Math.floor(Date.now() / 1000) - 1, Math.floor(Date.now() / 1000) + 8 * 86_400, Infinity, '2000000000'])
    await assert.rejects(provider.createSubscription(input({ totalCount: 12, expireBy })), failure('INVALID_BILLING_INPUT'));
  for (const badEnvCount of ['0', '-1', '12.0', '1e2', '1201', '12 '])
    await assert.rejects(createRazorpay({ ...env, RAZORPAY_TOTAL_COUNT: badEnvCount }, async () => { throw new Error('must not run'); })
      .createSubscription(input()), failure('BILLING_CONFIGURATION_INVALID'));
  assert.equal(calls.length, 0);
  const before = Math.floor(Date.now() / 1000);
  await provider.createSubscription(input({ totalCount: 6, email: 'synthetic@example.invalid', uid: 'private-owner', amount: 1 }));
  assert.equal(calls.length, 1); assert.equal(calls[0].total_count, 6);
  assert.ok(calls[0].expire_by >= before + 86_400 && calls[0].expire_by <= Math.floor(Date.now() / 1000) + 86_400);
  assert.ok(!JSON.stringify(calls[0]).includes('private-owner'));
  assert.ok(!Object.hasOwn(calls[0], 'email')); assert.ok(!Object.hasOwn(calls[0], 'amount'));
});

test('invalid identifiers and private/contact-like references cannot reach network', async () => {
  let calls = 0;
  const provider = createRazorpay(env, async () => { calls++; return json({}); });
  for (const bad of ['plan_x/../../secret', 'https://evil.invalid/', 'plan_x?key=secret', 'plan_x\n', 'sub_synthetic123', '', 'plan_' + 'a'.repeat(65)])
    await assert.rejects(provider.fetchPlan(bad), failure('INVALID_BILLING_INPUT'));
  for (const bad of ['owner@example.invalid', 'short', 'opaque reference with spaces', 'a'.repeat(129)])
    await assert.rejects(provider.createSubscription(input({ reference: bad })), failure('INVALID_BILLING_INPUT'));
  await assert.rejects(provider.fetchSubscription('sub_../secret'), failure('INVALID_BILLING_INPUT'));
  await assert.rejects(provider.fetchInvoice('inv_../secret'), failure('INVALID_BILLING_INPUT'));
  await assert.rejects(provider.cancelSubscription('sub_synthetic123', {}), failure('INVALID_BILLING_INPUT'));
  assert.equal(calls, 0);
});

test('plan, subscription, cancellation and invoice responses expose bounded normalized fields', async () => {
  const calls = [], bodies = [plan(), subscription({ status: 'active', short_url: 'https://rzp.io/i/synthetic123',
    current_start: currentStart, current_end: currentEnd, paid_count: 1 }),
    subscription({ status: 'active', current_start: currentStart, current_end: currentEnd, paid_count: 1 }), invoice()];
  const provider = createRazorpay(env, async (url, init) => { calls.push({ url, init }); return json(bodies.shift()); });
  assert.deepEqual(await provider.fetchPlan('plan_synthetic123'), { id: 'plan_synthetic123', period: 'monthly', interval: 1,
    amount: 12300, currency: 'INR', name: 'Synthetic configured plan' });
  assert.equal((await provider.fetchSubscription('sub_synthetic123')).checkoutUrl, 'https://rzp.io/i/synthetic123');
  assert.equal((await provider.cancelSubscription('sub_synthetic123', { atPeriodEnd: true })).status, 'active');
  assert.deepEqual(await provider.fetchInvoice('inv_synthetic123'), { id: 'inv_synthetic123', subscriptionId: 'sub_synthetic123',
    status: 'paid', currency: 'INR', amountPaid: 12300, amountDue: 0, billingStart: currentStart, billingEnd: currentEnd, paymentId: 'pay_synthetic123' });
  assert.deepEqual(calls.map(({ url, init }) => [url, init.method]), [
    ['https://api.razorpay.com/v1/plans/plan_synthetic123', 'GET'],
    ['https://api.razorpay.com/v1/subscriptions/sub_synthetic123', 'GET'],
    ['https://api.razorpay.com/v1/subscriptions/sub_synthetic123/cancel', 'POST'],
    ['https://api.razorpay.com/v1/invoices/inv_synthetic123', 'GET'],
  ]);
  assert.deepEqual(JSON.parse(calls[2].init.body), { cancel_at_cycle_end: true });
  let cancelBody;
  await createRazorpay(env, async (_, init) => { cancelBody = JSON.parse(init.body); return json(subscription({ status: 'cancelled' })); })
    .cancelSubscription('sub_synthetic123', { atPeriodEnd: false });
  assert.deepEqual(cancelBody, { cancel_at_cycle_end: false });
});

test('nullable one-off/unpaid invoice fields are retained without inferring paid access', async () => {
  const provider = createRazorpay(env, async () => json(invoice({ status: 'issued', subscription_id: null, payment_id: null,
    billing_start: null, billing_end: null, amount_paid: 0, amount_due: 12300 })));
  assert.deepEqual(await provider.fetchInvoice('inv_synthetic123'), { id: 'inv_synthetic123', subscriptionId: null, status: 'issued',
    currency: 'INR', amountPaid: 0, amountDue: 12300, billingStart: null, billingEnd: null, paymentId: null });
});

test('subscription references expose only opaque hashes and never return raw provider notes', async () => {
  const opaque = 'a'.repeat(64);
  const found = await createRazorpay(env, async () => json(subscription({ notes: { reference: opaque, private_contact: 'synthetic@example.invalid' } })))
    .fetchSubscription('sub_synthetic123');
  assert.equal(found.reference, opaque); assert.ok(!JSON.stringify(found).includes('synthetic@example.invalid'));
  assert.equal(Object.hasOwn(found, 'notes'), false);
  for (const reference of ['synthetic-owner', 'synthetic@example.invalid', 'a'.repeat(63), 'g'.repeat(64), {}, null])
    assert.equal((await createRazorpay(env, async () => json(subscription({ notes: { reference } }))).fetchSubscription('sub_synthetic123')).reference, null);
});

test('recent invoice list uses a bounded time window, filters unpaid drafts and exposes normalized paid facts only', async () => {
  let requested;
  const before = Math.floor(Date.now() / 1000);
  const provider = createRazorpay(env, async url => {
    requested = new URL(url);
    return json({ entity: 'collection', count: 2, items: [invoice({ customer_details: { email: 'synthetic@example.invalid' } }),
      invoice({ id: 'inv_draft123', status: 'draft', payment_id: null, amount_paid: null, amount_due: null })] });
  });
  const paid = await provider.listSubscriptionInvoices('sub_synthetic123');
  assert.equal(requested.origin, 'https://api.razorpay.com'); assert.equal(requested.pathname, '/v1/invoices');
  assert.equal(requested.searchParams.get('subscription_id'), 'sub_synthetic123');
  assert.equal(requested.searchParams.get('count'), '10'); assert.equal(requested.searchParams.get('skip'), '0');
  assert.ok(Number(requested.searchParams.get('from')) >= before - 40 * 86400);
  assert.ok(Number(requested.searchParams.get('to')) <= Math.floor(Date.now() / 1000));
  assert.equal(paid.length, 1); assert.equal(paid[0].id, 'inv_synthetic123'); assert.equal(paid[0].amountPaid, 12300);
  assert.ok(!JSON.stringify(paid).includes('synthetic@example.invalid'));
});

test('invoice list rejects full/truncated, inconsistent or foreign-subscription collections', async () => {
  for (const body of [{ entity: 'collection', count: 10, items: Array.from({ length: 10 }, () => invoice()) },
    { entity: 'collection', count: 2, items: [invoice()] },
    { entity: 'collection', count: 1, items: [invoice({ subscription_id: 'sub_other123' })] },
    { entity: 'collection', count: 1, items: [invoice({ status: 'unexpected' })] },
    { entity: 'not-collection', count: 0, items: [] }])
    await assert.rejects(createRazorpay(env, async () => json(body)).listSubscriptionInvoices('sub_synthetic123'), failure('RAZORPAY_RESPONSE_INVALID'));
});

test('checkout links reject alternate hosts, HTTP, credentials, queries and malformed paths after one uncertain create', async () => {
  for (const short_url of ['http://rzp.io/rzp/x', 'https://rzp.io.evil.invalid/rzp/x', 'https://evil.invalid/rzp/x',
    'https://user:secret@rzp.io/rzp/x', 'https://rzp.io:444/rzp/x', 'https://rzp.io/rzp/x?next=evil',
    'https://rzp.io/rzp/x#extra', 'https://rzp.io/anything/x', 'https://rzp.io/rzp/../x', null, '']) {
    let calls = 0;
    const provider = createRazorpay(env, async () => { calls++; return json(subscription({ short_url })); });
    await assert.rejects(provider.createSubscription(input()), failure('RAZORPAY_RESPONSE_INVALID', true));
    assert.equal(calls, 1);
  }
});

test('provider response identity and numeric schemas fail closed', async () => {
  for (const body of [subscription({ plan_id: 'plan_another' }), subscription({ id: 'sub_a/b' }), subscription({ paid_count: '1' }),
    subscription({ current_start: currentStart, current_end: currentStart }), subscription({ current_start: currentStart }),
    subscription({ status: 'unexpected' }), subscription({ created_at: undefined }), subscription({ expire_by: 'future' })])
    await assert.rejects(createRazorpay(env, async () => json(body)).createSubscription(input()), failure('RAZORPAY_RESPONSE_INVALID', true));
  await assert.rejects(createRazorpay(env, async () => json(subscription({ id: 'sub_other' }))).fetchSubscription('sub_synthetic123'), failure('RAZORPAY_RESPONSE_INVALID'));
  await assert.rejects(createRazorpay(env, async () => json(subscription({ id: 'sub_other' }))).cancelSubscription('sub_synthetic123', { atPeriodEnd: true }), failure('RAZORPAY_RESPONSE_INVALID', true));
  for (const body of [plan({ id: 'plan_other' }), plan({ interval: 0 }), plan({ item: { amount: -1, currency: 'INR', name: 'Invalid' } })])
    await assert.rejects(createRazorpay(env, async () => json(body)).fetchPlan('plan_synthetic123'), failure('RAZORPAY_RESPONSE_INVALID'));
  for (const body of [invoice({ id: 'inv_other' }), invoice({ amount_paid: -1 }), invoice({ currency: 'inr' }),
    invoice({ billing_end: currentStart }), invoice({ subscription_id: 'sub_a/b' }), invoice({ payment_id: 'untrusted' }),
    invoice({ amount_due: 1.5 }), invoice({ status: 'unexpected' }), invoice({ billing_start: undefined })])
    await assert.rejects(createRazorpay(env, async () => json(body)).fetchInvoice('inv_synthetic123'), failure('RAZORPAY_RESPONSE_INVALID'));
});

test('HTTP rejection, redirects and server errors distinguish definite rejection from uncertain mutation without retries', async () => {
  for (const status of [301, 302, 307, 400, 401, 403, 404, 408, 409, 429, 500, 502]) {
    for (const method of ['create', 'cancel', 'fetch']) {
      let calls = 0;
      const provider = createRazorpay(env, async (_, init) => {
        calls++; assert.equal(init.redirect, 'manual');
        return new Response(JSON.stringify({ error: { description: env.RAZORPAY_KEY_SECRET } }), { status, headers: { Location: 'https://evil.invalid/' } });
      });
      const operation = method === 'create' ? provider.createSubscription(input()) : method === 'cancel' ?
        provider.cancelSubscription('sub_synthetic123', { atPeriodEnd: true }) : provider.fetchSubscription('sub_synthetic123');
      const uncertain = method !== 'fetch' && (status < 400 || status >= 500 || status === 408);
      await assert.rejects(operation, error => failure('RAZORPAY_REJECTED', uncertain)(error) && error.status === status &&
        !JSON.stringify(error).includes(env.RAZORPAY_KEY_SECRET) && !error.message.includes(env.RAZORPAY_KEY_SECRET));
      assert.equal(calls, 1);
    }
  }
});

test('network and successful-body failures stay sanitized and do not repeat a mutation', async () => {
  const factories = [
    async () => { throw new Error(`network ${env.RAZORPAY_KEY_SECRET}`); },
    async () => new Response(`invalid ${env.RAZORPAY_KEY_SECRET}`),
    async () => new Response(new Uint8Array([0xff, 0xff])),
    async () => new Response(new ReadableStream({ start(controller) { controller.error(new Error(env.RAZORPAY_KEY_SECRET)); } })),
    async () => new Response('x', { headers: { 'Content-Length': String(MAX_RAZORPAY_RESPONSE_BYTES + 1) } }),
    async () => new Response('x'.repeat(MAX_RAZORPAY_RESPONSE_BYTES + 1)),
    async () => new Response(null),
  ];
  for (const fetcher of factories) {
    let calls = 0;
    const provider = createRazorpay(env, async (...args) => { calls++; return fetcher(...args); });
    await assert.rejects(provider.createSubscription(input()), error => error instanceof RazorpayFailure && error.uncertain === true &&
      !error.message.includes(env.RAZORPAY_KEY_SECRET) && !JSON.stringify(error).includes(env.RAZORPAY_KEY_SECRET));
    assert.equal(calls, 1);
  }
});

test('timeout bounds both a stalled fetch and a stalled response stream', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const stalled of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }))]) {
    let calls = 0, signal;
    const provider = createRazorpay(env, async (_, init) => { calls++; signal = init.signal; return stalled(); });
    const pending = assert.rejects(provider.createSubscription(input()), failure('RAZORPAY_UNAVAILABLE', true));
    await Promise.resolve(); await Promise.resolve();
    t.mock.timers.tick(RAZORPAY_TIMEOUT_MS);
    await pending;
    assert.equal(calls, 1); assert.equal(signal.aborted, true);
  }
});

test('HMAC verifies exact raw string and bytes and rejects tampering before parsing', async () => {
  const body = '{"event":"invoice.paid", "synthetic":"नमस्ते"}\n', secret = 'synthetic-webhook-secret';
  const mac = createHmac('sha256', secret).update(body).digest('hex');
  assert.equal(await verifyRazorpayWebhook(body, mac, secret), true);
  assert.equal(await verifyRazorpayWebhook(new TextEncoder().encode(body), mac.toUpperCase(), secret), true);
  assert.equal(await verifyRazorpayWebhook(new TextEncoder().encode(body).buffer, mac, secret), true);
  assert.equal(await verifyRazorpayWebhook(JSON.stringify(JSON.parse(body)), mac, secret), false);
  assert.equal(await verifyRazorpayWebhook(body + ' ', mac, secret), false);
  assert.equal(await verifyRazorpayWebhook(body, mac, 'different-secret'), false);
  assert.equal(await verifyRazorpayWebhook(body, '0'.repeat(64), secret), false);
});

test('webhook input limits and signature types fail closed', async () => {
  const body = '{}', secret = 'synthetic-webhook-secret', signature = createHmac('sha256', secret).update(body).digest('hex');
  for (const invalid of [undefined, null, {}, [], 123, '', 'g'.repeat(64), 'a'.repeat(63), 'a'.repeat(65), signature + '\n'])
    assert.equal(await verifyRazorpayWebhook(body, invalid, secret), false);
  for (const invalid of [undefined, null, {}, '', 'bad\nsecret', 'a'.repeat(257)])
    assert.equal(await verifyRazorpayWebhook(body, signature, invalid), false);
  for (const invalid of ['', {}, [], new Uint8Array(0), new Uint8Array(MAX_RAZORPAY_WEBHOOK_BYTES + 1),
    'a'.repeat(MAX_RAZORPAY_WEBHOOK_BYTES + 1), '🚀'.repeat(MAX_RAZORPAY_WEBHOOK_BYTES / 2)])
    assert.equal(await verifyRazorpayWebhook(invalid, signature, secret), false);
});
