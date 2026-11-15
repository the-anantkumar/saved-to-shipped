import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workspaceRuntime } from './workspace-helpers.mjs';

const intent = { intent_id: 'synthetic_checkout_0001', plan_id: 'plan_synthetic123', amount: 12300, currency: 'INR' };
const reconciled = { intent_id: intent.intent_id, plan_id: intent.plan_id, subscription_id: 'sub_synthetic123', checkout_url: null };

test('narrow reconciliation requires retained intent and cannot replace IDs or mutate original sale terms', async t => {
  const rt = await workspaceRuntime({ limits: { ENTITLEMENTS_ENABLED: 'true' } }); t.after(() => rt.dispose()); await rt.provision();
  assert.equal((await rt.invoke('checkout.reconcile', reconciled)).code, 'BILLING_CONFLICT');
  await rt.call('checkout.begin', intent); await rt.call('checkout.uncertain', { intent_id: intent.intent_id });
  for (const invalid of [{ ...reconciled, intent_id: 'other-intent' }, { ...reconciled, plan_id: 'plan_other123' },
    { ...reconciled, subscription_id: 'sub_bad/path' }, { ...reconciled, amount: 1 }, { ...reconciled, currency: 'USD' }])
    assert.equal((await rt.invoke('checkout.reconcile', invalid)).code, 'BILLING_CONFLICT');
  await rt.call('checkout.reconcile', reconciled);
  const state = await rt.call('billing.get');
  assert.equal(state.checkout.status, 'CREATED'); assert.equal(state.checkout.checkout_url, undefined);
  assert.equal(state.subscription.id, reconciled.subscription_id); assert.equal(state.subscription.amount, intent.amount);
  assert.equal((await rt.call('state')).entitlements.plan, 'free');
  assert.equal((await rt.invoke('checkout.reconcile', { ...reconciled, subscription_id: 'sub_other123' })).code, 'BILLING_CONFLICT');
  assert.equal((await rt.call('checkout.begin', { ...intent, intent_id: 'new-checkout-intent' })).submit, false);
});

test('terminal null-URL reconciliation works after restart while frozen and flagoff, then real purge succeeds', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-billing-reconciliation-'));
  let rt = await workspaceRuntime({ persist, limits: { ENTITLEMENTS_ENABLED: 'true' } });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); }); await rt.provision();
  await rt.call('checkout.begin', intent); await rt.call('checkout.uncertain', { intent_id: intent.intent_id });
  await rt.call('delete.prepare');
  assert.equal((await rt.invoke('close')).code, 'BILLING_UNCERTAIN');
  await rt.dispose(); rt = await workspaceRuntime({ persist, limits: { ENTITLEMENTS_ENABLED: 'false' } });
  assert.equal((await rt.call('billing.get')).workspace_status, 'deleting');
  assert.equal((await rt.invoke('checkout.begin', { ...intent, intent_id: 'blocked-new-intent' })).ok, false);
  await rt.call('checkout.reconcile', reconciled);
  assert.equal((await rt.call('billing.get')).subscription.closed, false);
  assert.equal((await rt.invoke('close')).code, 'BILLING_ACTIVE');
  await rt.call('billing.closed', { subscription_id: reconciled.subscription_id });
  await rt.close(); assert.equal((await rt.invoke('billing.get')).code, 'NOT_FOUND');
});
