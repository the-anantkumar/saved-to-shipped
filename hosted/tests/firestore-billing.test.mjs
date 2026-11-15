import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { appRuntime } from './app-helpers.mjs';
import { FirestoreClient } from '../.local/build/src/firestore/client.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-save2ship', database = 'save2ship';
const webhookSecret = 'synthetic-firestore-billing-webhook-secret';
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const hash = value => createHash('sha256').update(value).digest('hex');
const owner = member => ({ uid: member.membership.uid, generation: member.membership.generation });

test('Firestore billing survives empty DO cache with Pro and 199 points, persists owner mapping, and closes before purge', { skip: !host }, async t => {
  // Every real transport in this test points to the loopback emulator. Identity,
  // checkout, invoice payment and AI responses all come from synthetic fixtures.
  assert.match(host, /^(?:localhost|127\.0\.0\.1):[1-9]\d{0,4}$/);
  assert.ok(Number(host.split(':').at(-1)) <= 65535);
  const run = randomUUID(), uid = `synthetic-firestore-billing-${run}`;
  const merchantSeed = Number.parseInt(run.replaceAll('-', '').slice(0, 12), 16);
  const firestoreEnv = { FIREBASE_PROJECT_ID: project, FIRESTORE_DATABASE_ID: database, FIRESTORE_EMULATOR_HOST: host };
  const client = new FirestoreClient(firestoreEnv);
  const variables = {
    ...firestoreEnv, FIRESTORE_ENABLED: 'true', TEST_REAL_BILLING_BINDINGS: 'true', ADMISSION_UIDS: JSON.stringify([uid]),
    FIREBASE_PUBLIC_CONFIG: JSON.stringify({ projectId: project, apiKey: 'synthetic-public-api-key', authDomain: `${project}.firebaseapp.com`, appId: 'synthetic-app' }),
    SESSION_SIGNING_KEY: randomBytes(32).toString('base64url'),
    CREDENTIAL_KEYS: JSON.stringify({ active: 'v1', keys: { v1: randomBytes(32).toString('base64url') } }),
    ENTITLEMENTS_ENABLED: 'true', BILLING_ENABLED: 'true', RAZORPAY_MODE: 'test',
    RAZORPAY_KEY_ID: 'rzp_test_fixture', RAZORPAY_KEY_SECRET: 'synthetic-only-merchant-key', RAZORPAY_PLAN_ID: 'plan_fixture',
    RAZORPAY_AMOUNT_PAISE: '19900', RAZORPAY_TOTAL_COUNT: '12', RAZORPAY_WEBHOOK_SECRET: webhookSecret,
  };
  let rt = await appRuntime({ cap: 500, variables }), member, deleted = false, merchantSnapshot;
  let sequence = 0;
  const post = (path, data = {}, identity = member) => rt.request(path, { ...identity, data: { request_id: `firestore-billing-${++sequence}`, ...data } });
  const plainPost = (path, data = {}, identity = member) => rt.request(path, { ...identity, data });
  const merchant = data => rt.request('/__fixture__/billing', data === undefined ? {} : { data });
  async function admit() {
    // appRuntime.member uses the default synthetic project; this fixture signs
    // the actual demo audience/issuer explicitly, as the Firestore API test does.
    const token = await rt.token(uid, { aud: project, iss: `https://securetoken.google.com/${project}` });
    const admitted = ok(await rt.request('/api/session', { token }));
    member = { token, capability: admitted.workspace_session, membership: admitted.membership };
    return member;
  }
  async function internal(operation) {
    const response = ok(await rt.request('/__fixture__/workspace', { data: { access: owner(member), operation } }));
    assert.equal(response.ok, true, JSON.stringify(response)); return response.data;
  }
  async function paidWebhook(paid) {
    const data = { event: 'invoice.paid', payload: { invoice: { entity: { id: paid.invoice_id, subscription_id: paid.subscription_id } } } };
    const signature = createHmac('sha256', webhookSecret).update(JSON.stringify(data)).digest('hex');
    return rt.request('/api/billing/webhook', { data, headers: { 'X-Razorpay-Signature': signature } });
  }
  t.after(async () => {
    try {
      if (member && !deleted) {
        // Use the same production cleanup boundary after a failed assertion;
        // never clear global emulator collections used by parallel test runs.
        const current = ok(await merchant());
        if (!current.subscriptions.length && merchantSnapshot) ok(await merchant({ restore: merchantSnapshot }));
        const token = await rt.token(uid, { aud: project, iss: `https://securetoken.google.com/${project}` });
        ok(await plainPost('/api/account/delete', {}, { token }));
      }
    } finally { await rt.dispose(); }
  });

  ok(await merchant({ restore: { subscriptions: [], invoices: [], creates: merchantSeed, cancels: 0 } }));
  await admit();
  const originalAccess = owner(member), workspacePath = `s2sWorkspaces/${hash(`${uid}\0${originalAccess.generation}`)}`;
  assert.equal(ok(await rt.request('/api/state', member)).entitlements.plan, 'free');
  const checkout = ok(await plainPost('/api/billing/checkout', { intent_id: randomUUID() }));
  assert.match(checkout.checkout_url, /^https:\/\/rzp\.io\/rzp\/fixture\d+$/);
  const billing = await internal('billing.get'), subscriptionId = billing.subscription.id;
  const mappingPath = `s2sBillingSubscriptions/${subscriptionId}`, mapping = await client.read(mappingPath);
  assert.deepEqual(mapping.data, { schema: 1, subscription_id: subscriptionId, uid, generation: originalAccess.generation,
    plan_id: 'plan_fixture', amount: 19900, currency: 'INR', closed: false }, 'production binding must be authoritative in Firestore');
  assert.equal(ok(await rt.request('/api/state', member)).entitlements.plan, 'free', 'a returned checkout URL is not payment proof');

  const paid = ok(await merchant({ charge: true, subscription_id: subscriptionId }));
  ok(await paidWebhook(paid));
  const paidState = ok(await rt.request('/api/state', member)).entitlements;
  assert.equal(paidState.plan, 'pro'); assert.equal(paidState.points.remaining, 200);
  ok(await post('/api/capture', { url: 'https://www.linkedin.com/feed/update/urn:li:activity:900000000000000001',
    content: 'Learn SQLite with one small synthetic experiment.', note: 'Synthetic Firestore billing note.' }));
  const providerKey = 'synthetic-firestore-billing-provider-key';
  ok(await post('/api/settings', { openai_key: providerKey }));
  assert.equal(ok(await rt.request('/__fixture__/provider')).classifications, 0, 'saving a key does not start provider work');
  assert.equal(ok(await post('/api/classify-ai', { limit: 1 })).status, 'QUEUED');
  assert.equal(ok(await rt.request('/api/state', member)).entitlements.points.reserved, 1);
  assert.equal(ok(await post('/api/jobs/poll')).status, 'COMPLETED');
  assert.equal(ok(await rt.request('/api/state', member)).entitlements.points.remaining, 199);
  const records = (await client.list(`${workspacePath}/records`, { pageSize: 100 })).documents;
  const storedBilling = records.find(record => record.data.table === 'settings' && record.data.key === 'billing');
  assert.ok(storedBilling); const storedLedger = JSON.parse(JSON.parse(storedBilling.data.row).data);
  assert.equal(storedLedger.paid_periods[0].used, 1); assert.equal(storedLedger.subscription.id, subscriptionId);
  assert.doesNotMatch(JSON.stringify(records), new RegExp(providerKey), 'Firestore credentials retain ciphertext, not the provider key');
  merchantSnapshot = ok(await merchant());
  assert.equal(merchantSnapshot.creates, merchantSeed + 1); assert.equal(merchantSnapshot.invoices.length, 1);

  await rt.dispose(); rt = await appRuntime({ cap: 500, variables });
  const empty = await internal('test.snapshot');
  assert.deepEqual(empty.tables, []); assert.equal(empty.kvKeys, 0); assert.equal(empty.alarm, null);
  assert.deepEqual(ok(await merchant({ restore: merchantSnapshot })), merchantSnapshot, 'fixture restart preserves original opaque notes, invoices and mutation counts');
  await admit(); assert.deepEqual(owner(member), originalAccess, 'restart must retain the original verified membership generation');
  const restored = ok(await rt.request('/api/state', member)).entitlements;
  assert.equal(restored.plan, 'pro'); assert.equal(restored.points.remaining, 199); assert.equal(restored.points.used, 1); assert.equal(restored.points.reserved, 0);
  assert.ok((await internal('test.snapshot')).tables.includes('projection_meta'), 'state must hydrate the disposable projection from Firestore');
  assert.deepEqual((await client.read(mappingPath)).data, mapping.data);
  assert.equal((await client.read(mappingPath)).updateTime, mapping.updateTime, 'reload cannot replace the immutable authoritative binding');
  ok(await plainPost('/api/billing/sync'));
  assert.equal(ok(await rt.request('/api/state', member)).entitlements.points.remaining, 199, 'invoice reconciliation after cache loss cannot refill points');
  assert.equal(ok(await merchant()).creates, merchantSeed + 1, 'reloading authoritative state never creates another merchant subscription');

  ok(await plainPost('/api/billing/cancel', {}, { token: member.token }));
  const cancelled = ok(await rt.request('/api/state', member)).entitlements;
  assert.equal(cancelled.plan, 'pro'); assert.equal(cancelled.points.remaining, 199); assert.equal(cancelled.subscription.cancel_at_end, true);
  ok(await plainPost('/api/account/delete')); deleted = true;
  assert.deepEqual((await client.list(`${workspacePath}/records`, { pageSize: 100 })).documents, []);
  const purged = await client.read(workspacePath), tombstone = await client.read(mappingPath);
  assert.equal(purged.data.status, 'deleted'); assert.equal(purged.data.recordCount, 0);
  assert.deepEqual(tombstone.data, { ...mapping.data, closed: true });
  const removedCache = await internal('test.snapshot');
  assert.deepEqual(removedCache.tables, []); assert.equal(removedCache.kvKeys, 0); assert.equal(removedCache.alarm, null);
  const merchantAfterDelete = ok(await merchant());
  assert.equal(merchantAfterDelete.subscriptions[0].status, 'cancelled'); assert.equal(merchantAfterDelete.cancels, 2);
  assert.equal(ok(await paidWebhook(paid)).ignored, true, 'closed Firestore binding must reject late signed payment before workspace access');
  assert.deepEqual((await client.read(workspacePath)), purged); assert.deepEqual((await client.read(mappingPath)), tombstone);
  assert.deepEqual((await client.list(`${workspacePath}/records`, { pageSize: 100 })).documents, []);
  assert.deepEqual(ok(await merchant()), merchantAfterDelete, 'late signed payment cannot call or mutate the mocked merchant');
  assert.equal((await rt.request('/api/session', { token: member.token })).body.code, 'ACCOUNT_DELETED');
});
