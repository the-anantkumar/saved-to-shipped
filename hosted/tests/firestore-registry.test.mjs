import test from 'node:test';
import assert from 'node:assert/strict';
import { FirestoreRegistry } from '../.local/build/src/firestore/registry.js';
import { FirestoreConflict } from '../.local/build/src/firestore/client.js';
import { MemoryFirestore } from './firestore-memory.mjs';

const baseEnv = { BETA_CAP: '2', ADMISSION_OPEN: 'true', PROCESSING_OPEN: 'true' };
function fixture(env = {}) {
  const store = new MemoryFirestore(), registry = new FirestoreRegistry({ ...baseEnv, ...env }, store);
  return { store, registry };
}
async function admitted(registry, uid = 'synthetic-alice') {
  const reservation = await registry.invoke('reserve', { uid }); assert.equal(reservation.ok, true);
  const active = await registry.invoke('activate', reservation.data); assert.equal(active.ok, true);
  return active.data;
}

test('Firestore admission has one last seat and idempotent concurrent reservations', async () => {
  const { store, registry } = fixture({ BETA_CAP: '1' });
  const peer = new FirestoreRegistry({ ...baseEnv, BETA_CAP: '1' }, store);
  const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => (index % 2 ? peer : registry).invoke('reserve', { uid: `synthetic-${index}` })));
  assert.equal(responses.filter(response => response.ok).length, 1);
  assert.ok(responses.filter(response => !response.ok).every(response => response.code === 'BETA_FULL'));
  const winner = responses.find(response => response.ok).data;
  const repeats = await Promise.all(Array.from({ length: 12 }, () => registry.invoke('reserve', { uid: winner.uid })));
  assert.ok(repeats.every(response => response.ok && response.data.generation === winner.generation));
  const stats = await registry.invoke('stats');
  assert.deepEqual(stats.data.members, [{ state: 'reserved', count: 1 }]);
  assert.equal(stats.data.budget.find(row => row.kind === 'interactive').spent, 128);
});

test('Firestore admission closes by allowlist and generation ownership, preserving existing memberships', async () => {
  const { store, registry } = fixture({ ADMISSION_UIDS: '["synthetic-alice"]' });
  assert.equal((await registry.invoke('reserve', { uid: 'synthetic-bob' })).code, 'BETA_FULL');
  const alice = await admitted(registry);
  assert.equal((await registry.invoke('member', { ...alice, generation: 'forged' })).code, 'MEMBERSHIP_REQUIRED');
  assert.equal((await registry.invoke('grant', { ...alice, uid: 'synthetic-bob', kind: 'interactive', id: 'one', units: 10 })).code, 'MEMBERSHIP_REQUIRED');
  const closed = new FirestoreRegistry({ BETA_CAP: '0', ADMISSION_OPEN: 'false', ADMISSION_UIDS: '[]' }, store);
  assert.equal((await closed.invoke('reserve', { uid: alice.uid })).data.generation, alice.generation);
  assert.equal((await closed.invoke('reserve', { uid: 'synthetic-bob' })).code, 'BETA_FULL');
});

test('Firestore missing registry authority cannot reset membership counts or budgets', async () => {
  const { registry, store } = fixture({ BETA_CAP: '1' });
  const alice = await admitted(registry);
  store.documents.delete('s2sRegistry/control');
  assert.equal((await registry.invoke('reserve', { uid: 'synthetic-bob' })).code, 'STORAGE_UNAVAILABLE');
  assert.equal((await registry.invoke('grant', { ...alice, kind: 'interactive', id: 'missing-authority', units: 1 })).code, 'STORAGE_UNAVAILABLE');
  await assert.rejects(registry.provisionFences(alice), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(await store.read('s2sRegistry/control'), null);
});

test('Firestore provisioning fence cannot allocate after reservation deletion begins', async () => {
  const { registry, store } = fixture();
  const reservation = await registry.invoke('reserve', { uid: 'synthetic-alice' });
  const fences = await registry.provisionFences(reservation.data);
  assert.equal((await registry.invoke('deleting', reservation.data)).ok, true);
  await assert.rejects(store.commit([{ path: 's2sWorkspaces/synthetic', data: { uid: 'synthetic-alice' }, currentDocument: { exists: false } }, ...fences]), FirestoreConflict);
  assert.equal(await store.read('s2sWorkspaces/synthetic'), null);
  await assert.rejects(registry.provisionFences(reservation.data), { code: 'PROVISIONING_DENIED' });
});

test('Firestore lifecycle epochs survive retry and seats release once after terminal transition', async () => {
  const { registry } = fixture({ BETA_CAP: '1' });
  const alice = await admitted(registry);
  assert.equal((await registry.invoke('deleted', alice)).code, 'INVALID_TRANSITION');
  const suspended = await registry.invoke('suspend', alice);
  assert.equal(suspended.data.lifecycle_epoch, 1);
  assert.equal((await registry.invoke('suspend', alice)).data.lifecycle_epoch, 2);
  assert.equal((await registry.invoke('reserve', { uid: alice.uid })).code, 'MEMBERSHIP_SUSPENDED');
  assert.equal((await registry.invoke('resume', alice)).data.lifecycle_epoch, 3);
  await registry.invoke('deleting', alice);
  assert.equal((await registry.invoke('reserve', { uid: 'synthetic-bob' })).code, 'BETA_FULL');
  await Promise.all([registry.invoke('deleted', alice), registry.invoke('deleted', alice)]);
  assert.equal((await registry.invoke('reserve', { uid: alice.uid })).code, 'ACCOUNT_DELETED');
  assert.equal((await registry.invoke('reserve', { uid: 'synthetic-bob' })).ok, true);
  const stats = await registry.invoke('stats');
  assert.deepEqual(stats.data.members, [{ state: 'reserved', count: 1 }, { state: 'deleted', count: 1 }]);
});

test('Firestore grants charge each execution, enforce budgets and preserve request conflicts', async () => {
  const { registry } = fixture(); const alice = await admitted(registry);
  const input = { ...alice, kind: 'interactive', id: 'read-one', units: 10 };
  assert.equal((await registry.invoke('grant', input)).data.replayed, false);
  assert.equal((await registry.invoke('grant', input)).data.replayed, true);
  assert.equal((await registry.invoke('grant', { ...input, units: 11 })).code, 'REQUEST_CONFLICT');
  assert.equal((await registry.invoke('grant', { ...input, kind: 'ingestion' })).code, 'REQUEST_CONFLICT');
  const stats = await registry.invoke('stats');
  assert.equal(stats.data.grants, 1);
  assert.equal(stats.data.budget.find(row => row.kind === 'interactive').spent, 164);
  assert.equal((await registry.invoke('grant', { ...input, id: 'large-one', units: 20_000 })).ok, true);
  assert.equal((await registry.invoke('grant', { ...input, id: 'large-two', units: 20_000 })).code, 'DAILY_BUDGET');
  await registry.invoke('suspend', alice);
  assert.equal((await registry.invoke('grant', input)).code, 'MEMBERSHIP_REQUIRED');
  assert.equal((await registry.invoke('cleanup.grant', { ...alice, id: 'cleanup', units: 100 })).ok, true);
});

test('Firestore concurrent grants cannot exceed daily budget across registry instances', async () => {
  const { registry, store } = fixture(); const alice = await admitted(registry);
  const peer = new FirestoreRegistry(baseEnv, store);
  const results = await Promise.all([registry, peer].map((instance, index) => instance.invoke('grant', { ...alice, kind: 'interactive', id: `large-${index}`, units: 20_000 })));
  assert.equal(results.filter(value => value.ok).length, 1);
  assert.equal(results.find(value => !value.ok).code, 'DAILY_BUDGET');
});

test('Firestore ambiguous commit is reconciled without repeating seat or budget mutation', async () => {
  const { registry, store } = fixture();
  store.loseNextCommitResponse = true;
  const alice = await admitted(registry);
  store.loseNextCommitResponse = true;
  const grant = await registry.invoke('grant', { ...alice, kind: 'interactive', id: 'lost-response', units: 10 });
  assert.equal(grant.ok, true);
  assert.equal((await registry.invoke('stats')).data.budget.find(row => row.kind === 'interactive').spent, 146);
  store.failNextCommitBeforeApply = true;
  assert.equal((await registry.invoke('grant', { ...alice, kind: 'interactive', id: 'not-applied', units: 10 })).code, 'FIRESTORE_COMMIT_UNCERTAIN');
  assert.equal((await registry.invoke('stats')).data.budget.find(row => row.kind === 'interactive').spent, 146);
});

test('Firestore grant expiration and concurrent bounded cleanup preserve exact count', async () => {
  const { registry, store } = fixture(); const alice = await admitted(registry);
  for (let index = 0; index < 23; index++) assert.equal((await registry.invoke('grant', { ...alice, kind: 'interactive', id: `old-${index}`, units: 1 })).ok, true);
  for (const document of store.documents.values()) if (document.path.startsWith('s2sGrants/')) document.data.day = '2020-01-01';
  assert.equal((await registry.invoke('grant', { ...alice, kind: 'interactive', id: 'old-0', units: 1 })).code, 'GRANT_EXPIRED');
  const peer = new FirestoreRegistry(baseEnv, store);
  const results = await Promise.all([registry.maintenance(10), peer.maintenance(10)]);
  assert.equal(results.reduce((sum, value) => sum + value.deleted, 0), 20);
  assert.equal((await registry.invoke('stats')).data.grants, 3);
  const newGrant = await registry.invoke('grant', { ...alice, kind: 'interactive', id: 'fresh', units: 1 });
  assert.equal(newGrant.ok, true);
  assert.equal((await registry.invoke('stats')).data.grants, 1);
  assert.equal([...store.documents.keys()].filter(path => path.startsWith('s2sGrants/')).length, 1);
});
