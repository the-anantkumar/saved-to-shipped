import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './src/billing/bindings.ts';
export { FirestoreConflict, FirestoreCommitUncertain } from './src/firestore/client.ts';`, resolveDir: process.cwd() },
bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
const { FirestoreBillingBindings, FirestoreConflict, FirestoreCommitUncertain } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const binding = { subscription_id: 'sub_synthetic123', uid: 'synthetic-owner', generation: 'synthetic-generation',
  plan_id: 'plan_synthetic123', amount: 12300, currency: 'INR', closed: false };

function memoryFirestore() {
  const records = new Map(); let sequence = 0, uncertain = false, writes = 0;
  return { records, get writes() { return writes; }, set uncertain(value) { uncertain = value; },
    async read(path) { return records.has(path) ? structuredClone(records.get(path)) : null; },
    async commit(batch) {
      assert.equal(batch.length, 1);
      const write = batch[0], existing = records.get(write.path), condition = write.currentDocument;
      assert.ok(condition, 'every mutation is conditional');
      if ((condition.exists === false && existing) || (condition.updateTime && condition.updateTime !== existing?.updateTime)) throw new FirestoreConflict();
      writes++; const updateTime = `synthetic-version-${++sequence}`;
      records.set(write.path, { path: write.path, data: structuredClone(write.data), updateTime });
      if (uncertain) { uncertain = false; throw new FirestoreCommitUncertain(); }
      return { commitTime: updateTime, writeResults: [{ updateTime }] };
    },
  };
}

test('binding CAS handles concurrent same-owner creation and lost confirmation without duplicate records', async () => {
  const firestore = memoryFirestore(), bindings = new FirestoreBillingBindings({}, firestore);
  firestore.uncertain = true;
  const results = await Promise.all([bindings.bind(binding), bindings.bind(binding), bindings.bind(binding)]);
  assert.deepEqual(results, [binding, binding, binding]);
  assert.equal(firestore.records.size, 1); assert.equal(firestore.writes, 1);
  assert.deepEqual(await bindings.get(binding.subscription_id), binding);
  assert.deepEqual([...firestore.records.keys()], ['s2sBillingSubscriptions/sub_synthetic123']);
});

test('immutable owner, generation, plan, amount and currency reject conflicting bindings', async () => {
  const firestore = memoryFirestore(), bindings = new FirestoreBillingBindings({}, firestore);
  await bindings.bind(binding);
  for (const change of [{ uid: 'another-owner' }, { generation: 'another-generation' }, { plan_id: 'plan_other123' }, { amount: 99999 }])
    await assert.rejects(bindings.bind({ ...binding, ...change }), { code: 'BILLING_BINDING_CONFLICT' });
  await assert.rejects(bindings.bind({ ...binding, currency: 'USD' }), { code: 'BILLING_BINDING_UNAVAILABLE' });
  await assert.rejects(bindings.close(binding.subscription_id, { uid: 'another-owner', generation: binding.generation }), { code: 'BILLING_BINDING_CONFLICT' });
  assert.equal(firestore.writes, 1); assert.deepEqual(await bindings.get(binding.subscription_id), binding);
});

test('closure survives lost commit confirmation and cannot be reopened by a creation retry', async () => {
  const firestore = memoryFirestore(), bindings = new FirestoreBillingBindings({}, firestore);
  await bindings.bind(binding); firestore.uncertain = true;
  await bindings.close(binding.subscription_id, binding);
  await bindings.close(binding.subscription_id, binding);
  assert.equal((await bindings.get(binding.subscription_id)).closed, true);
  assert.equal((await bindings.bind(binding)).closed, true);
  assert.equal(firestore.writes, 2);
});

test('invalid IDs, missing mapping and corrupt stored terms fail closed', async () => {
  const firestore = memoryFirestore(), bindings = new FirestoreBillingBindings({}, firestore);
  for (const bad of ['sub_a/b', 'https://evil.invalid/', 'sub_../secret', 'sub_x\n'])
    await assert.rejects(bindings.get(bad), { code: 'BILLING_BINDING_UNAVAILABLE' });
  await assert.rejects(bindings.close(binding.subscription_id, binding), { code: 'BILLING_BINDING_UNAVAILABLE' });
  for (const change of [{ schema: 2 }, { uid: '' }, { generation: '' }, { amount: 0 }, { closed: 'false' }, { subscription_id: 'sub_other123' }]) {
    firestore.records.set('s2sBillingSubscriptions/sub_synthetic123', { path: 's2sBillingSubscriptions/sub_synthetic123',
      updateTime: 'synthetic', data: { schema: 1, ...binding, ...change } });
    await assert.rejects(bindings.get(binding.subscription_id), { code: 'BILLING_BINDING_UNAVAILABLE' });
  }
});
