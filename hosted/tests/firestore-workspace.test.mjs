import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Miniflare, Log, LogLevel } from 'miniflare';
import { FirestoreClient } from '../.local/build/src/firestore/client.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const integration = (name, callback) => test(name, { skip: !host }, callback);
const env = { FIREBASE_PROJECT_ID: 'demo-save2ship', FIRESTORE_DATABASE_ID: 'save2ship', FIRESTORE_ENABLED: 'true', FIRESTORE_EMULATOR_HOST: host };
const row = (n, content = 'Synthetic source text') => ({ url: `https://www.linkedin.com/feed/update/urn:li:activity:900000000000${String(n).padStart(5, '0')}`, title: `Synthetic ${n}`, saved_at: '2026-01-02', content });
const pathFor = access => `s2sWorkspaces/${createHash('sha256').update(`${access.uid}\0${access.generation}`).digest('hex')}`;
const recordSize = (path, data) => Buffer.byteLength(path) + Buffer.byteLength(JSON.stringify(data)) + 256;
async function retainIncompatibleState(rt, status = 'deleting', wakeAt) {
  const client = new FirestoreClient(env), path = pathFor(rt.access);
  const records = (await client.list(`${path}/records`, { pageSize: 100 })).documents;
  const checkpoint = await client.read(path), workspace = records.find(record => record.data.table === 'workspace');
  const oldControl = JSON.parse(workspace.data.row);
  const data = JSON.stringify({ version: 1, subscription: { id: 'sub_synthetic_legacy', closed: false } });
  const ledgerRow = { _rowid: 2, id: 'billing', data, bytes: Buffer.byteLength(data) };
  const ledgerPath = `${path}/records/${Buffer.from('settings\0billing').toString('base64url')}`;
  const ledger = { table: 'settings', key: 'billing', row: JSON.stringify(ledgerRow) };
  const control = { ...workspace.data, row: JSON.stringify({ ...oldControl, logical_bytes: oldControl.logical_bytes + ledgerRow.bytes, status }) };
  await client.commit([
    { path: ledgerPath, data: ledger, currentDocument: { exists: false } },
    { path: workspace.path, data: control, currentDocument: { updateTime: workspace.updateTime } },
    { path, data: { ...checkpoint.data, checkpoint: Number(checkpoint.data.checkpoint) + 1, commitId: randomUUID(), status,
      ...(wakeAt === undefined ? {} : { wakeAt }), recordCount: Number(checkpoint.data.recordCount) + 1,
      storedBytes: Number(checkpoint.data.storedBytes) + recordSize(ledgerPath, ledger) + recordSize(workspace.path, control) - recordSize(workspace.path, workspace.data) },
      currentDocument: { updateTime: checkpoint.updateTime } },
  ]);
  return { client, path, authority: await client.read(path), records: await client.list(`${path}/records`, { pageSize: 100 }) };
}
async function cleanup(access) {
  const client = new FirestoreClient(env), path = pathFor(access);
  for (;;) {
    const page = await client.list(`${path}/records`, { pageSize: 100 });
    if (!page.documents.length) break;
    await client.commit(page.documents.map(doc => ({ path: doc.path, delete: true })));
  }
  if (await client.read(path)) await client.commit([{ path, delete: true }]);
}
async function runtime({ access = { uid: `synthetic-firestore-${randomUUID()}`, generation: randomUUID() }, persist, limits = {} } = {}) {
  const vars = { ...env, ...limits };
  const mf = new Miniflare({ workers: [{ config: {
    name: 'firestore-workspace-fixture', compatibilityDate: '2026-07-30',
    manifest: { mainModule: 'firestore.js', modules: { 'firestore.js': { type: 'esm', contents: await readFile('.local/build/tests/firestore-harness.js', 'utf8') } } },
    exports: { Workspace: { type: 'durable-object', storage: 'sqlite' } },
    env: { ...Object.fromEntries(Object.entries(vars).map(([name, value]) => [name, { type: 'text', value: String(value) }])),
      WORKSPACES: { type: 'durable-object', worker: 'firestore-workspace-fixture', exportName: 'Workspace' } },
  } }], host: '127.0.0.1', port: 0, resourcePersistencePath: persist,
    telemetry: { enabled: false }, enableDevRegistry: false, log: new Log(LogLevel.ERROR), cf: false });
  let sequence = 0;
  return { access, mf,
    async invoke(operation, input = {}, owner = access, name = owner.uid) {
      const response = await mf.dispatchFetch('https://synthetic.invalid/', { method: 'POST', body: JSON.stringify({ access: owner, name, operation, input }) });
      assert.equal(response.status, 200); return response.json();
    },
    async call(operation, input = {}, owner = access, name = owner.uid) {
      const result = await this.invoke(operation, input, owner, name);
      assert.equal(result.ok, true, `${operation}: ${JSON.stringify(result)}`); return result.data;
    },
    mutate(operation, input = {}, owner = access, name = owner.uid) { return this.call(operation, { request_id: `request-${++sequence}`, ...input }, owner, name); },
    async fault(mode, count = 1) { await this.call('test.fault', { mode, count }); },
    dispose() { return mf.dispose(); },
  };
}

integration('Firestore authority preserves annotations, grouping, reading and private exports after cache loss', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision');
  const item = await rt.mutate('capture', { ...row(1), note: 'Synthetic private note' });
  const edited = await rt.mutate('item', { id: item.id, expected_revision: item.revision, kind: 'learning', new_project_name: 'Distributed systems', note: 'Annotations remain separate' });
  await rt.mutate('reading', { id: item.id, expected_revision: edited.item.revision, progress: 45 });
  await rt.mutate('credential.set', { provider: 'apify', record: { version: 'test', nonce: 'synthetic-nonce', ciphertext: 'synthetic-ciphertext' } });
  const before = await rt.call('detail', { id: item.id }), summary = await rt.call('state');
  assert.equal(before.content, 'Synthetic source text'); assert.equal(before.note, 'Annotations remain separate');
  assert.equal(before.reading.progress, 45); assert.equal(before.status, 'inbox');
  assert.ok(summary.usage.firestoreStoredBytes > 0);
  await rt.call('test.wipe');
  assert.deepEqual(await rt.call('detail', { id: item.id }), before);
  await rt.mutate('import', { import_id: 'synthetic-repeat', sequence: 0, rows: [row(1, 'Incoming text must preserve the existing source')] });
  assert.deepEqual(await rt.call('detail', { id: item.id }), before);
  assert.equal((await rt.call('state')).projects[0].name, 'Distributed systems');
  const backup = JSON.stringify(await rt.call('export'));
  assert.ok(!backup.includes('synthetic-ciphertext')); assert.ok(!backup.includes('synthetic-nonce'));
  const foreign = { uid: `synthetic-firestore-${randomUUID()}`, generation: rt.access.generation };
  assert.equal((await rt.invoke('detail', { id: item.id }, foreign)).code, 'NOT_FOUND');
  assert.equal((await rt.invoke('detail', { id: item.id }, { ...rt.access, generation: randomUUID() })).code, 'NOT_FOUND');
});

integration('Firestore failed and conflicted commits never expose speculative notes or quota counters', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const item = await rt.mutate('capture', row(2));
  const initial = await rt.call('detail', { id: item.id }), usage = (await rt.call('state')).usage.logicalBytes;
  for (const mode of ['before', 'conflict']) {
    await rt.fault(mode);
    const result = await rt.invoke('item', { id: item.id, expected_revision: initial.revision, note: 'Must not become authoritative', request_id: mode });
    assert.equal(result.ok, false);
    assert.deepEqual(await rt.call('detail', { id: item.id }), initial);
    assert.equal((await rt.call('state')).usage.logicalBytes, usage);
  }
});

integration('Firestore confirms lost commit responses and persists receipts without applying a mutation twice', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const item = await rt.mutate('capture', row(3));
  const input = { id: item.id, expected_revision: item.revision, note: 'Committed once', request_id: 'lost-response' };
  await rt.fault('after');
  const first = await rt.call('item', input);
  await rt.call('test.wipe');
  const replay = await rt.call('item', input);
  assert.equal(replay.item.revision, first.item.revision);
  assert.equal((await rt.call('detail', { id: item.id })).note, 'Committed once');
});

integration('Firestore pending projections recover after a process restart with an unreadable commit response', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-firestore-'));
  let rt = await runtime({ persist }); const access = rt.access;
  t.after(async () => { await rt.dispose(); await cleanup(access); await rm(persist, { recursive: true, force: true }); });
  await rt.call('provision'); const item = await rt.mutate('capture', row(4));
  const input = { id: item.id, expected_revision: item.revision, note: 'Durable Firestore note', request_id: 'restart-after-commit' };
  await rt.fault('after-unreadable'); assert.equal((await rt.invoke('item', input)).ok, false);
  await rt.dispose(); rt = await runtime({ persist, access });
  assert.equal((await rt.call('detail', { id: item.id })).note, 'Durable Firestore note');
  const replay = await rt.call('item', input); assert.equal(replay.item.revision, item.revision + 1);
});

integration('Firestore missing authority never falls back to a populated local cache', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const item = await rt.mutate('capture', row(5));
  await rt.call('test.remove-authority');
  assert.equal((await rt.invoke('detail', { id: item.id })).code, 'NOT_FOUND');
  assert.equal((await rt.call('test.inspect')).local, undefined);
});

integration('Firestore atomic checkpoint fences reconcile concurrent cache writers', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision');
  const operations = [0, 1].map(index => ({ name: `${rt.access.uid}-${index}`, input: { ...row(10 + index), request_id: `parallel-${index}` } }));
  const outcomes = await Promise.all(operations.map(({ name, input }) => rt.invoke('capture', input, rt.access, name)));
  for (let index = 0; index < outcomes.length; index++) if (!outcomes[index].ok) {
    assert.equal(outcomes[index].code, 'FIRESTORE_CONFLICT');
    await rt.call('capture', operations[index].input, rt.access, operations[index].name);
  }
  assert.equal((await rt.call('list')).items.length, 2);
  assert.equal((await rt.call('state')).usage.items, 2);
});

integration('Firestore recovery alarms only reconcile authoritative jobs and survive cache loss', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const item = await rt.mutate('capture', row(6, ''));
  const job = { id: 'synthetic-job', kind: 'retrieval', status: 'QUEUED', selected_ids: [item.id],
    selected_revisions: { [item.id]: item.revision }, reserved_bytes: 100000, next_poll_at: Date.now() + 1000 };
  await rt.fault('before');
  assert.equal((await rt.invoke('job.begin', { job, request_id: 'speculative-job' })).ok, false);
  await rt.call('test.alarm'); assert.equal((await rt.call('test.inspect')).reconciliations, 0);
  await rt.mutate('job.begin', { job });
  await rt.call('test.wipe'); await rt.call('test.repair');
  assert.ok((await rt.call('test.inspect')).alarm > 0);
  await rt.call('test.lose-access'); await rt.call('test.repair');
  await rt.call('test.alarm');
  assert.equal((await rt.call('job.get')).status, 'UNCERTAIN');
  assert.equal((await rt.call('test.inspect')).reconciliations, 1);
  await rt.call('test.alarm'); assert.equal((await rt.call('test.inspect')).reconciliations, 1);
});

integration('Firestore deletion freeze cannot purge provider credentials before close authorizes cleanup', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const item = await rt.mutate('capture', row(7, ''));
  await rt.mutate('credential.set', { provider: 'apify', record: { version: 'test', nonce: 'synthetic-nonce', ciphertext: 'synthetic-provider-key' } });
  const job = await rt.mutate('job.begin', { job: { id: 'synthetic-running-job', kind: 'retrieval', status: 'STARTING', selected_ids: [item.id], selected_revisions: { [item.id]: item.revision }, reserved_bytes: 100000 } });
  await rt.call('job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'RUNNING', run_id: 'synthetic-paid-run', next_poll_at: Date.now() + 1000 } });
  const freeze = await rt.call('delete.prepare'); assert.equal(freeze.credential.ciphertext, 'synthetic-provider-key');
  const before = await rt.call('test.inspect');
  await rt.call('test.alarm'); await rt.call('test.repair');
  const after = await rt.call('test.inspect');
  assert.equal(after.authority.data.status, 'deleting'); assert.equal(after.authority.data.recordCount, before.authority.data.recordCount);
  assert.equal(after.local.status, 'deleting'); assert.equal(after.reconciliations, 0);
  const repeated = await rt.call('delete.prepare'); assert.equal(repeated.credential.ciphertext, 'synthetic-provider-key');
});

integration('Firestore paginated deletion resumes after interruption and retains a terminal fence', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision');
  for (let sequence = 0; sequence < 5; sequence++) await rt.mutate('import', { import_id: 'synthetic-deletion', sequence, rows: Array.from({ length: 25 }, (_, offset) => row(100 + sequence * 25 + offset)) });
  await rt.call('delete.prepare'); await rt.fault('before', 2);
  assert.equal((await rt.invoke('close')).ok, false);
  const partial = await rt.call('test.inspect');
  assert.equal(partial.authority.data.purging, true); assert.ok(partial.authority.data.recordCount > 0);
  await rt.call('test.wipe'); await rt.call('test.repair');
  const completed = await rt.call('test.inspect');
  assert.equal(completed.authority.data.status, 'deleted'); assert.equal(completed.authority.data.recordCount, 0);
  assert.deepEqual(completed.tables, []); assert.equal(completed.alarm, null);
  assert.equal((await rt.invoke('provision')).code, 'NOT_FOUND');
  assert.equal((await rt.invoke('capture', { ...row(999), request_id: 'late' })).code, 'NOT_FOUND');
  assert.equal((await rt.call('close')).deleted, true);
});

integration('Firestore document storage pressure rolls back domain writes and counters', async t => {
  const rt = await runtime({ limits: { FIRESTORE_WORKSPACE_LIMIT: '12000' } });
  t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const before = await rt.call('state');
  const failed = await rt.invoke('capture', { ...row(8, 'x'.repeat(15000)), request_id: 'storage-pressure' });
  assert.equal(failed.code, 'STORAGE_PRESSURE');
  assert.equal((await rt.call('state')).usage.items, 0);
  assert.equal((await rt.call('state')).usage.logicalBytes, before.usage.logicalBytes);
});

integration('Firestore namespaces reject a configuration downgrade to SQLite authority', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-firestore-mode-'));
  let rt = await runtime({ persist }); const access = rt.access;
  t.after(async () => { await rt.dispose(); await cleanup(access); await rm(persist, { recursive: true, force: true }); });
  await rt.call('provision'); const saved = await rt.mutate('capture', row(9));
  await rt.fault('before');
  assert.equal((await rt.invoke('item', { id: saved.id, expected_revision: saved.revision, note: 'Speculative note must stay hidden', request_id: 'pending-downgrade' })).ok, false);
  await rt.dispose(); rt = await runtime({ persist, access, limits: { FIRESTORE_ENABLED: 'false' } });
  assert.equal((await rt.invoke('detail', { id: saved.id })).code, 'STORAGE_BACKEND_MISMATCH');
  assert.equal((await rt.invoke('capture', { ...row(10), request_id: 'forbidden-downgrade' })).code, 'STORAGE_BACKEND_MISMATCH');
});

integration('Firestore free beta refuses incompatible retained private state after cache loss without purging it', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const saved = await rt.mutate('capture', row(11));
  const { client, path, authority, records } = await retainIncompatibleState(rt);
  await rt.call('test.wipe');
  for (const operation of ['state', 'delete.prepare', 'close'])
    assert.equal((await rt.invoke(operation)).code, 'WORKSPACE_BUILD_MISMATCH', operation);
  assert.equal((await rt.invoke('detail', { id: saved.id })).code, 'WORKSPACE_BUILD_MISMATCH');
  assert.deepEqual(await client.read(path), authority);
  assert.deepEqual(await client.list(`${path}/records`, { pageSize: 100 }), records);
});

integration('Firestore incompatible active workspace quarantines due alarms and explicit repairs without changing remote state', async t => {
  const rt = await runtime(); t.after(async () => { await rt.dispose(); await cleanup(rt.access); });
  await rt.call('provision'); const saved = await rt.mutate('capture', row(12, ''));
  await rt.mutate('job.begin', { job: { id: 'old-active-job', kind: 'retrieval', status: 'QUEUED',
    selected_ids: [saved.id], selected_revisions: { [saved.id]: saved.revision }, reserved_bytes: 10000,
    next_poll_at: Date.now() + 3600000 } });
  const retained = await retainIncompatibleState(rt, 'active', Date.now() - 1);
  await rt.call('test.alarm', { due: true });
  let inspected = await rt.call('test.inspect');
  assert.equal(inspected.alarm, null); assert.equal(inspected.reconciliations, 0);
  assert.deepEqual(inspected.authority, retained.authority);
  assert.deepEqual(await rt.call('test.repair'), { repaired: false });
  inspected = await rt.call('test.inspect');
  assert.equal(inspected.alarm, null); assert.equal(inspected.reconciliations, 0);
  await rt.call('test.wipe');
  assert.deepEqual(await rt.call('test.repair'), { repaired: false });
  inspected = await rt.call('test.inspect');
  assert.equal(inspected.alarm, null); assert.equal(inspected.reconciliations, 0);
  assert.equal((await rt.invoke('state')).code, 'WORKSPACE_BUILD_MISMATCH');
  assert.deepEqual(await retained.client.read(retained.path), retained.authority);
  assert.deepEqual(await retained.client.list(`${retained.path}/records`, { pageSize: 100 }), retained.records);
});
