import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FirestoreClient, isFirestoreConflict } from '../.local/build/src/firestore/client.js';
import { FirestoreRegistry } from '../.local/build/src/firestore/registry.js';

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
test('Firestore emulator verifies atomic record commits, conditional provisioning and registry isolation', { skip: !emulator }, async t => {
  // A unique namespace leaves other agents' emulator workspaces undisturbed.
  const prefix = `transportChecks/${randomUUID()}`;
  const client = new FirestoreClient({ FIREBASE_PROJECT_ID: 'demo-save2ship', FIRESTORE_DATABASE_ID: 'save2ship', FIRESTORE_EMULATOR_HOST: emulator });
  const strip = document => document && { ...document, path: document.path.slice(prefix.length + 1) };
  const store = {
    read: async (path, options) => strip(await client.read(`${prefix}/${path}`, options)),
    list: async (collection, options) => {
      const page = await client.list(`${prefix}/${collection}`, options);
      return { ...page, documents: page.documents.map(strip) };
    },
    query: async (collection, options) => (await client.query(`${prefix}/${collection}`, options)).map(strip),
    commit: writes => client.commit(writes.map(write => ({ ...write, path: `${prefix}/${write.path}` }))),
  };
  t.after(async () => {
    for (const collection of ['s2sRegistry', 's2sMembers', 's2sGrants', 's2sWorkspaces', 'records']) {
      let page;
      do {
        page = await store.list(collection, { pageSize: 100 });
        if (page.documents.length) await store.commit(page.documents.map(doc => ({ path: doc.path, delete: true, currentDocument: { updateTime: doc.updateTime } })));
      } while (page.documents.length);
    }
  });
  await store.commit([{ path: 'records/one', data: { content: 'नमस्ते 🧪', revision: 1 }, currentDocument: { exists: false } }]);
  const original = await store.read('records/one');
  assert.deepEqual(original.data, { content: 'नमस्ते 🧪', revision: 1 });
  assert.deepEqual((await store.list('records', { fieldPaths: ['revision'] })).documents[0].data, { revision: 1 });
  await store.commit([{ path: 'records/one', data: { ...original.data, revision: 2 }, currentDocument: { updateTime: original.updateTime } }]);
  await assert.rejects(store.commit([
    { path: 'records/one', data: { revision: 3 }, currentDocument: { updateTime: original.updateTime } },
    { path: 'records/two', data: { mustNeverExist: true }, currentDocument: { exists: false } },
  ]), isFirestoreConflict);
  assert.equal(await store.read('records/two'), null);
  const registry = new FirestoreRegistry({ BETA_CAP: '1', ADMISSION_OPEN: 'true', PROCESSING_OPEN: 'true' }, store);
  const peer = new FirestoreRegistry({ BETA_CAP: '1', ADMISSION_OPEN: 'true', PROCESSING_OPEN: 'true' }, store);
  const results = await Promise.all([registry.invoke('reserve', { uid: 'synthetic-transport-alice' }), peer.invoke('reserve', { uid: 'synthetic-transport-bob' })]);
  assert.equal(results.filter(value => value.ok).length, 1);
  assert.equal(results.find(value => !value.ok).code, 'BETA_FULL');
  const member = results.find(value => value.ok).data;
  const pending = await registry.invoke('pending'); assert.equal(pending.ok, true); assert.equal(pending.data.length, 1);
  const fences = await registry.provisionFences(member);
  assert.equal((await registry.invoke('deleting', member)).ok, true);
  await assert.rejects(store.commit([{ path: 's2sWorkspaces/forbidden', data: { owner: member.uid }, currentDocument: { exists: false } }, ...fences]), isFirestoreConflict);
  assert.equal(await store.read('s2sWorkspaces/forbidden'), null);
  assert.equal((await registry.invoke('deleted', member)).ok, true);
  const other = await registry.invoke('reserve', { uid: member.uid === 'synthetic-transport-alice' ? 'synthetic-transport-bob' : 'synthetic-transport-alice' });
  const active = await registry.invoke('activate', other.data); assert.equal(active.ok, true);
  const input = { ...active.data, id: 'transport-grant', kind: 'interactive', units: 10 };
  assert.equal((await registry.invoke('grant', input)).ok, true);
  assert.equal((await registry.invoke('grant', input)).data.replayed, true);
  assert.equal((await registry.invoke('grant', { ...input, units: 11 })).code, 'REQUEST_CONFLICT');
  const grants = await store.list('s2sGrants');
  await store.commit(grants.documents.map(doc => ({ path: doc.path, data: { ...doc.data, day: '2020-01-01' }, currentDocument: { updateTime: doc.updateTime } })));
  assert.deepEqual(await registry.maintenance(), { deleted: 1, possiblyMore: false });
  assert.equal((await registry.invoke('stats')).data.grants, 0);
});
