import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { appRuntime } from './app-helpers.mjs';

const webhookSecret = 'synthetic-only-razorpay-webhook-secret';
const variables = { ENTITLEMENTS_ENABLED: 'true', BILLING_ENABLED: 'true', RAZORPAY_MODE: 'test',
  RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'synthetic-only-key', RAZORPAY_PLAN_ID: 'plan_fixture',
  RAZORPAY_AMOUNT_PAISE: '19900', RAZORPAY_TOTAL_COUNT: '12', RAZORPAY_WEBHOOK_SECRET: webhookSecret };
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const access = member => ({ uid: member.membership.uid, generation: member.membership.generation });
const post = (rt, member, path, data = {}) => rt.request(path, { ...member, data });
async function privateBilling(rt, member) {
  const response = await rt.request('/__fixture__/workspace', { data: { access: access(member), operation: 'billing.get' } });
  assert.equal(response.body.ok, true); return response.body.data;
}
async function charge(rt, member) {
  const subscription = (await privateBilling(rt, member)).subscription;
  return ok(await rt.request('/__fixture__/billing', { data: { charge: true, subscription_id: subscription.id } }));
}
async function webhook(rt, paid, secret = webhookSecret) {
  const data = { event: 'invoice.paid', payload: { invoice: { entity: { id: paid.invoice_id, subscription_id: paid.subscription_id } } } };
  const signature = createHmac('sha256', secret).update(JSON.stringify(data)).digest('hex');
  return rt.request('/api/billing/webhook', { data, headers: { 'X-Razorpay-Signature': signature } });
}

test('real API checkout grants paid capacity only from verified invoice, preserves points on replay, and closes billing before deletion', async t => {
  const rt = await appRuntime({ variables }); t.after(() => rt.dispose());
  const alice = await rt.member(), bob = await rt.member('synthetic-bob');
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.plan, 'free');
  const intent = { intent_id: randomUUID() };
  const attempts = await Promise.all([post(rt, alice, '/api/billing/checkout', intent), post(rt, alice, '/api/billing/checkout', intent)]);
  assert.ok(attempts.some(response => response.status === 200));
  const ready = ok(await post(rt, alice, '/api/billing/checkout', intent)); assert.match(ready.checkout_url, /^https:\/\/rzp\.io\/rzp\//);
  assert.equal(ok(await rt.request('/__fixture__/billing')).creates, 1);
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.plan, 'free', 'checkout success is not payment proof');
  assert.equal((await post(rt, bob, '/api/billing/sync', { subscription_id: 'sub_fixture1' })).status, 400);
  const paid = await charge(rt, alice);
  assert.equal((await webhook(rt, paid, 'incorrect-key')).status, 401);
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.plan, 'free');
  ok(await webhook(rt, paid));
  const upgraded = ok(await rt.request('/api/state', alice)).entitlements;
  assert.equal(upgraded.plan, 'pro'); assert.equal(upgraded.saves.limit, 1000); assert.equal(upgraded.points.remaining, 200);
  assert.equal(ok(await rt.request('/api/state', bob)).entitlements.plan, 'free');
  ok(await post(rt, alice, '/api/capture', { request_id: randomUUID(), url: 'https://www.linkedin.com/feed/update/urn:li:activity:900000000000000001', content: 'Learn SQLite with one small experiment', note: 'Synthetic personal note' }));
  ok(await post(rt, alice, '/api/settings', { request_id: randomUUID(), openai_key: 'synthetic-provider-key' }));
  ok(await post(rt, alice, '/api/classify-ai', { request_id: randomUUID(), limit: 1 }));
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.points.reserved, 1);
  assert.equal(ok(await post(rt, alice, '/api/jobs/poll', { request_id: randomUUID() })).status, 'COMPLETED');
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.points.remaining, 199);
  ok(await webhook(rt, paid)); ok(await post(rt, alice, '/api/billing/sync'));
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.points.remaining, 199, 'provider replays must not refill points');
  const exported = ok(await rt.request('/api/export', alice));
  assert.doesNotMatch(JSON.stringify(exported), /sub_fixture|paid_periods|checkout_url|synthetic-provider-key|synthetic-only-key/);
  ok(await rt.request('/api/billing/cancel', { token: alice.token, data: {} }));
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.plan, 'pro', 'cancellation keeps the paid period');
  ok(await post(rt, alice, '/api/account/delete'));
  assert.equal(ok(await rt.request('/__fixture__/billing')).subscriptions[0].status, 'cancelled');
  ok(await webhook(rt, paid));
  assert.equal((await rt.request('/api/session', { token: alice.token })).body.code, 'ACCOUNT_DELETED');
});

test('suspended and maintenance-mode customers cancel with recent identity alone and cannot read private workspace data', async t => {
  const rt = await appRuntime({ variables }); t.after(() => rt.dispose()); const alice = await rt.member();
  ok(await post(rt, alice, '/api/billing/checkout', { intent_id: randomUUID() }));
  ok(await webhook(rt, await charge(rt, alice)));
  ok(await post(rt, alice, '/api/admin/suspend', { target: alice.membership.uid }));
  assert.equal((await rt.request('/api/state', alice)).status, 403);
  const stale = await rt.token(alice.membership.uid, { auth_time: Math.floor(Date.now() / 1000) - 600 });
  assert.equal((await rt.request('/api/billing/cancel', { token: stale, data: {} })).body.code, 'RECENT_SIGN_IN_REQUIRED');
  ok(await rt.request('/__fixture__/billing', { data: { flags: { HOSTED_ENABLED: 'false', BILLING_ENABLED: 'false', ENTITLEMENTS_ENABLED: 'false' } } }));
  const config = ok(await rt.request('/api/config')); assert.equal(config.enabled, false); assert.equal(config.billing_recovery, true);
  const result = ok(await rt.request('/api/billing/cancel', { token: alice.token, data: {} }));
  assert.equal(result.cancelled, true); assert.doesNotMatch(JSON.stringify(result), /sub_fixture|synthetic-alice|paid_periods/);
  assert.equal(ok(await rt.request('/__fixture__/billing')).cancels, 1);
  assert.equal((await rt.request('/api/state', alice)).status, 503);
  assert.equal((await rt.request('/api/billing/cancel', { token: alice.token, data: { target: 'synthetic-bob' } })).status, 400);
});

test('failed subscription cancellation freezes deletion and retains state until a safe retry closes it', async t => {
  const rt = await appRuntime({ variables }); t.after(() => rt.dispose()); const alice = await rt.member();
  ok(await post(rt, alice, '/api/billing/checkout', { intent_id: randomUUID() }));
  ok(await webhook(rt, await charge(rt, alice)));
  ok(await rt.request('/__fixture__/billing', { data: { cancel_unavailable: true } }));
  const paused = await post(rt, alice, '/api/account/delete'); assert.equal(paused.body.code, 'BILLING_DELETION_PENDING');
  assert.equal((await privateBilling(rt, alice)).subscription.closed, false);
  assert.equal((await rt.request('/api/state', alice)).status, 403);
  assert.equal((await privateBilling(rt, alice)).workspace_status, 'deleting');
  ok(await rt.request('/__fixture__/billing', { data: { cancel_unavailable: false } }));
  ok(await post(rt, alice, '/api/account/delete'));
  assert.equal((await rt.request('/api/session', { token: alice.token })).body.code, 'ACCOUNT_DELETED');
});

test('an uncertain merchant creation is never resubmitted and only an operator can reconcile its frozen owner', async t => {
  const rt = await appRuntime({ variables }); t.after(() => rt.dispose());
  const alice = await rt.member(), bob = await rt.member('synthetic-bob');
  ok(await rt.request('/__fixture__/billing', { data: { create_unavailable: true } }));
  const intent = { intent_id: randomUUID() };
  assert.notEqual((await post(rt, alice, '/api/billing/checkout', intent)).status, 200);
  assert.notEqual((await post(rt, alice, '/api/billing/checkout', intent)).status, 200);
  const merchant = ok(await rt.request('/__fixture__/billing'));
  assert.equal(merchant.creates, 1, 'a lost response must not create a second merchant subscription');
  assert.equal((await privateBilling(rt, alice)).checkout.status, 'UNCERTAIN');
  assert.equal((await post(rt, alice, '/api/account/delete')).body.code, 'BILLING_DELETION_PENDING');
  const repair = { target: alice.membership.uid, subscription_id: merchant.subscriptions[0].id };
  assert.equal((await post(rt, bob, '/api/admin/billing/reconcile', repair)).status, 404);
  const stale = await rt.token(alice.membership.uid, { auth_time: Math.floor(Date.now() / 1000) - 600 });
  assert.equal((await rt.request('/api/admin/billing/reconcile', { token: stale, data: repair })).body.code, 'RECENT_SIGN_IN_REQUIRED');
  ok(await rt.request('/__fixture__/billing', { data: { flags: { HOSTED_ENABLED: 'false', BILLING_ENABLED: 'false', ENTITLEMENTS_ENABLED: 'false' } } }));
  const repaired = ok(await rt.request('/api/admin/billing/reconcile', { token: alice.token, data: repair }));
  assert.deepEqual(repaired, { reconciled: true, closed: true, checkout_status: 'CREATED' });
  assert.equal(ok(await rt.request('/__fixture__/billing')).creates, 1);
  assert.equal((await privateBilling(rt, alice)).subscription.closed, true);
  ok(await rt.request('/__fixture__/billing', { data: { flags: { HOSTED_ENABLED: 'true' } } }));
  ok(await post(rt, alice, '/api/account/delete'));
  assert.equal((await rt.request('/api/session', { token: alice.token })).body.code, 'ACCOUNT_DELETED');
});
