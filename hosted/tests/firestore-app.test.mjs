import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { appRuntime } from './app-helpers.mjs';
import { FirestoreClient } from '../.local/build/src/firestore/client.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
const project = 'demo-save2ship';
const url = n => `https://www.linkedin.com/feed/update/urn:li:activity:90000000000000000${n}`;
const success = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const hash = text => createHash('sha256').update(text).digest('hex');

test('Firestore API persists import and mocked provider completion, preserves annotations, isolates tenants and purges records', { skip: !host }, async t => {
  assert.match(host, /^(localhost|127\.0\.0\.1):\d+$/);
  const run = randomUUID();
  const uids = [`synthetic-api-alice-${run}`, `synthetic-api-bob-${run}`];
  const env = { FIREBASE_PROJECT_ID: project, FIRESTORE_DATABASE_ID: 'save2ship', FIRESTORE_EMULATOR_HOST: host };
  const client = new FirestoreClient(env);
  const rt = await appRuntime({ cap: 500, variables: {
    ...env, FIRESTORE_ENABLED: 'true', ADMISSION_UIDS: JSON.stringify(uids),
    FIREBASE_PUBLIC_CONFIG: JSON.stringify({ projectId: project, apiKey: 'synthetic-public-api-key', authDomain: `${project}.firebaseapp.com`, appId: 'synthetic-app' }),
  } });
  let sequence = 0;
  const write = (member, path, data = {}) => rt.request(path, { ...member, data: { request_id: `api-check-${++sequence}`, ...data } });
  const admitted = [];
  t.after(async () => {
    try {
      // The production deletion path removes this test's records and releases its
      // seats. Keep terminal registry tombstones, as the real application does.
      for (const member of admitted) success(await write(member, '/api/account/delete'));
    } finally { await rt.dispose(); }
  });
  async function member(uid) {
    const token = await rt.token(uid, { aud: project, iss: `https://securetoken.google.com/${project}` });
    const response = success(await rt.request('/api/session', { token }));
    const value = { token, capability: response.workspace_session, membership: response.membership };
    admitted.push(value); return value;
  }
  async function internal(member, operation, input = {}) {
    const access = { uid: member.membership.uid, generation: member.membership.generation };
    const response = await rt.request('/__fixture__/workspace', { data: { access, operation, input } });
    assert.equal(response.body.ok, true, JSON.stringify(response.body)); return response.body.data;
  }
  const alice = await member(uids[0]), bob = await member(uids[1]);
  const workspace = `s2sWorkspaces/${hash(`${alice.membership.uid}\0${alice.membership.generation}`)}`;
  assert.ok(await client.read(workspace), 'admission must persist its authoritative Firestore checkpoint');
  const rows = [1, 2].map(n => ({ url: url(n), saved_at: '2026-11-01' }));
  const imported = success(await write(alice, '/api/import', { import_id: 'synthetic-firestore-import', sequence: 0, rows, filename: 'Saved_Items.csv' }));
  assert.equal(imported.added, 2);
  const list = success(await rt.request('/api/items', alice));
  assert.equal(list.items.length, 2);
  const key = 'synthetic-firestore-provider-key';
  success(await write(alice, '/api/settings', { apify_token: key, openai_key: key, model: 'gpt-4.1-mini', goals: 'Learn SQLite' }));
  assert.equal((await rt.request('/__fixture__/provider')).body.starts, 0, 'saving credentials must not call a paid provider');
  const storedRecords = await client.list(`${workspace}/records`, { pageSize: 100 });
  assert.doesNotMatch(JSON.stringify(storedRecords), new RegExp(key), 'provider credentials must be encrypted in Firestore');
  assert.equal(success(await write(alice, '/api/retrieve/start', { limit: 2, max_charge: .1 })).status, 'QUEUED');
  assert.equal(success(await write(alice, '/api/jobs/poll')).status, 'RUNNING');
  const storedJob = await internal(alice, 'job.get');
  await internal(alice, 'job.update', { id: storedJob.id, expected_job_revision: storedJob.revision, patch: { next_poll_at: 0 } });
  const completed = success(await write(alice, '/api/jobs/poll'));
  assert.equal(completed.status, 'COMPLETED'); assert.equal(completed.applied_count, 2);
  let item = success(await rt.request(`/api/item?id=${list.items[0].id}`, alice));
  assert.match(item.content, /Learn to build/);
  success(await write(alice, '/api/item', { id: item.id, expected_revision: item.revision, note: 'Keep this personal note 学習' }));
  assert.equal(success(await write(alice, '/api/classify-ai')).status, 'QUEUED');
  assert.equal(success(await write(alice, '/api/jobs/poll')).status, 'COMPLETED');
  item = success(await rt.request(`/api/item?id=${item.id}`, alice));
  assert.equal(item.kind, 'learning'); assert.equal(item.note, 'Keep this personal note 学習');
  success(await write(alice, '/api/reading', { id: item.id, expected_revision: item.revision, status: 'read' }));
  // A second import must preserve user edits and reading progress.
  success(await write(alice, '/api/import', { import_id: 'synthetic-firestore-repeat', sequence: 0, rows, filename: 'Saved_Items.csv' }));
  item = success(await rt.request(`/api/item?id=${item.id}`, alice));
  assert.equal(item.note, 'Keep this personal note 学習'); assert.equal(item.reading.status, 'read');
  assert.equal(item.kind, 'learning');
  assert.equal((await rt.request(`/api/item?id=${item.id}`, bob)).status, 404);
  assert.equal((await write(bob, '/api/item', { id: item.id, expected_revision: item.revision, note: 'Forged' })).status, 404);
  assert.equal((await rt.request('/api/state', { token: bob.token, capability: alice.capability })).status, 403);
  assert.deepEqual(success(await rt.request('/api/search?q=personal', bob)).ids, []);
  const exported = success(await rt.request('/api/export?limit=25', alice));
  assert.equal(exported.workspace.version, 1); assert.equal(exported.items.length, 2);
  assert.doesNotMatch(JSON.stringify(exported), /synthetic-firestore-provider-key|ciphertext|syntheticData1/);
  const calls = (await rt.request('/__fixture__/provider')).body;
  assert.equal(calls.starts, 1); assert.equal(calls.classifications, 1);
  success(await write(alice, '/api/account/delete'));
  assert.deepEqual((await client.list(`${workspace}/records`, { pageSize: 100 })).documents, []);
  assert.equal((await client.read(workspace)).data.status, 'deleted');
  assert.equal((await rt.request('/api/session', { token: alice.token })).body.code, 'ACCOUNT_DELETED');
});
