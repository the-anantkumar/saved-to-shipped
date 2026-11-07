import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { appRuntime } from './app-helpers.mjs';

const url = n => `https://www.linkedin.com/feed/update/urn:li:activity:90000000000000000${n}`;
let sequence = 0;
const write = (rt, member, route, data = {}) => rt.request(route, { ...member, data: { request_id: `write-${++sequence}`, ...data } });
const success = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
async function internal(rt, access, operation, input = {}) {
  const response = await rt.request('/__fixture__/workspace', { data: { access, operation, input } });
  assert.equal(response.body.ok, true, JSON.stringify(response.body)); return response.body.data;
}

test('application verifies identity, capability binding, origin and closed configuration before private data', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  assert.equal((await rt.request('/api/config')).body.mode, 'hosted');
  assert.equal((await rt.request('/api/state')).status, 401);
  const alice = await rt.member(), bob = await rt.member('synthetic-bob');
  success(alice.response); success(bob.response);
  const capture = success(await write(rt, alice, '/api/capture', { url: url(1), title: 'Private Alice', content: 'Learn SQLite', note: 'Alice private note' }));
  assert.ok(capture.id);
  assert.equal((await rt.request('/api/state', { token: bob.token, capability: alice.capability })).status, 403);
  assert.equal((await rt.request(`/api/item?id=${capture.id}`, bob)).status, 404);
  assert.equal((await write(rt, bob, '/api/item', { id: capture.id, expected_revision: 1, title: 'Forged' })).status, 404);
  assert.equal((await rt.request('/api/state?workspace=personal', alice)).status, 400);
  assert.equal((await write(rt, alice, '/api/item', { id: capture.id, uid: 'synthetic-bob' })).status, 400);
  assert.equal((await rt.request('/api/state', { ...alice, headers: { Origin: 'https://attacker.invalid' } })).status, 403);
  assert.equal((await rt.request('/api/state', { ...alice, token: await rt.token('synthetic-alice', { aud: 'wrong-project' }) })).status, 401);
  assert.equal((await rt.request('/api/state', { ...alice, token: await rt.token('synthetic-alice', { exp: 1 }) })).status, 401);
  const closed = await appRuntime({ variables: { HOSTED_ENABLED: 'false' } }); t.after(() => closed.dispose());
  assert.equal((await closed.request('/api/state', { token: await closed.token() })).status, 503);
});

test('concurrent final seat allocation, returning members, immediate suspension and retryable deletion', async t => {
  const rt = await appRuntime({ cap: 1 }); t.after(() => rt.dispose());
  const [a, b] = await Promise.all([rt.member(), rt.member('synthetic-bob')]);
  assert.equal([a, b].filter(member => member.response.status === 200).length, 1);
  const admitted = a.response.status === 200 ? a : b;
  const uid = admitted.membership.uid;
  success((await rt.member(uid)).response);
  const item = success(await write(rt, admitted, '/api/capture', { url: url(1), content: 'Learn SQLite' }));
  const operatorToken = await rt.token('synthetic-alice');
  success(await rt.request('/api/admin/suspend', { token: operatorToken, data: { target: uid } }));
  assert.equal((await rt.request(`/api/item?id=${item.id}`, admitted)).status, 403);
  success(await rt.request('/api/admin/resume', { token: operatorToken, data: { target: uid } }));
  success(await rt.request(`/api/item?id=${item.id}`, admitted));
  success(await write(rt, admitted, '/api/account/delete'));
  assert.equal((await rt.request(`/api/item?id=${item.id}`, admitted)).status, 410);
  success(await write(rt, admitted, '/api/account/delete'));
  assert.equal((await rt.member(uid)).response.status, 403);
  success((await rt.member('synthetic-charlie')).response);
});

test('failed and replayed writes still consume shared allowance after receipt eviction', async t => {
  const rt = await appRuntime({ variables: { WORKSPACE_ITEM_LIMIT: '1' } }); t.after(() => rt.dispose());
  const member = await rt.member(); success(member.response);
  const first = success(await write(rt, member, '/api/capture', { url: url(1), content: 'Learn SQLite' }));
  const failing = { url: url(2), content: 'Second save', request_id: 'retry-rejected-write' };
  assert.equal((await write(rt, member, '/api/capture', failing)).status, 409);
  const stats = () => rt.request('/api/admin/stats', { token: member.token });
  const before = success(await stats()).budget.find(row => row.kind === 'interactive').spent;
  assert.equal((await write(rt, member, '/api/capture', failing)).status, 409);
  const after = success(await stats()).budget.find(row => row.kind === 'interactive').spent;
  assert.ok(after > before, 'rollback attempts retain a work charge');
  let current = success(await rt.request(`/api/item?id=${first.id}`, member));
  for (let n = 0; n < 130; n++) {
    success(await write(rt, member, '/api/item', { id: first.id, expected_revision: current.revision, note: `revision ${n}`, request_id: `cycle-${n}` }));
    current = success(await rt.request(`/api/item?id=${first.id}`, member));
  }
  const beforeEvictedReplay = success(await stats()).budget.find(row => row.kind === 'interactive').spent;
  success(await write(rt, member, '/api/item', { id: first.id, expected_revision: current.revision, note: 'new attempt with old ID', request_id: 'cycle-0' }));
  assert.ok(success(await stats()).budget.find(row => row.kind === 'interactive').spent > beforeEvictedReplay);
});

test('full API flow imports, encrypts credentials, retrieves, classifies, preserves annotations and exports v1', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member(); success(alice.response);
  const rows = [1, 2].map(n => ({ url: url(n), saved_at: '2026-11-01' }));
  const imported = success(await write(rt, alice, '/api/import', { import_id: 'fixture-import', sequence: 0, rows, filename: 'Saved_Items.csv' }));
  assert.equal(imported.added, 2);
  const list = success(await rt.request('/api/items', alice));
  assert.equal(list.items.length, 2);
  assert.ok(list.items.every(item => !Object.hasOwn(item, 'content') && !Object.hasOwn(item, 'note')));
  const key = 'synthetic-personal-provider-key';
  success(await write(rt, alice, '/api/settings', { apify_token: key, openai_key: key, model: 'gpt-4.1-mini', goals: 'Learn SQLite' }));
  const summary = success(await rt.request('/api/state', alice));
  assert.doesNotMatch(JSON.stringify(summary), new RegExp(key));
  assert.equal(summary.settings.extractor_available, true);
  let job = success(await write(rt, alice, '/api/retrieve/start', { limit: 2, max_charge: .1 }));
  assert.equal(job.status, 'QUEUED');
  job = success(await write(rt, alice, '/api/jobs/poll'));
  assert.equal(job.status, 'RUNNING');
  const access = { uid: alice.membership.uid, generation: alice.membership.generation };
  const stored = await internal(rt, access, 'job.get');
  await internal(rt, access, 'job.update', { id: stored.id, expected_job_revision: stored.revision, patch: { next_poll_at: 0 } });
  job = success(await write(rt, alice, '/api/jobs/poll'));
  assert.equal(job.status, 'COMPLETED');
  assert.equal(job.applied_count, 2);
  const item = success(await rt.request(`/api/item?id=${list.items[0].id}`, alice));
  assert.match(item.content, /Learn to build/);
  success(await write(rt, alice, '/api/item', { id: item.id, expected_revision: item.revision, note: 'Keep this personal note' }));
  const ai = success(await write(rt, alice, '/api/classify-ai'));
  assert.equal(ai.status, 'QUEUED');
  const classified = success(await write(rt, alice, '/api/jobs/poll'));
  assert.equal(classified.status, 'COMPLETED');
  const learned = success(await rt.request(`/api/item?id=${item.id}`, alice));
  assert.equal(learned.kind, 'learning'); assert.equal(learned.status, 'inbox'); assert.equal(learned.note, 'Keep this personal note');
  success(await write(rt, alice, '/api/reading', { id: learned.id, expected_revision: learned.revision, status: 'read' }));
  const exported = success(await rt.request('/api/export?limit=25', alice));
  assert.equal(exported.workspace.version, 1); assert.equal(exported.items.length, 2);
  assert.doesNotMatch(JSON.stringify(exported), /synthetic-personal-provider-key|ciphertext|syntheticData1/);
  const bob = await rt.member('synthetic-bob'); success(bob.response);
  assert.equal(success(await rt.request('/api/items', bob)).items.length, 0);
  success(await write(rt, bob, '/api/restore', { import_id: 'fixture-restore', sequence: 0, rows: exported.items, workspace: exported.workspace }));
  assert.equal(success(await rt.request('/api/items', bob)).items.length, 2);
  const restored = success(await rt.request(`/api/item?id=${learned.id}`, bob));
  assert.equal(restored.note, 'Keep this personal note'); assert.equal(restored.reading.status, 'read');
});

test('closed preview admission allowlist and revoked privileged identities fail closed', async t => {
  const restricted = await appRuntime({ variables: { ADMISSION_UIDS: JSON.stringify(['synthetic-alice']) } }); t.after(() => restricted.dispose());
  success((await restricted.member()).response);
  assert.equal((await restricted.member('synthetic-bob')).response.body.code, 'BETA_FULL');
  const revoked = await appRuntime({ variables: { TEST_REVOKED_UIDS: JSON.stringify(['synthetic-alice']) } }); t.after(() => revoked.dispose());
  const token = await revoked.token();
  for (const [path, data] of [['/api/session', undefined], ['/api/admin/stats', undefined], ['/api/admin/suspend', { target: 'synthetic-bob' }], ['/api/account/delete', {}]]) {
    const result = await revoked.request(path, { token, data });
    assert.equal(result.status, 401, path); assert.equal(result.body.code, 'SIGN_IN_EXPIRED');
  }
});

test('encrypted settings retries are stable, while changed secrets with the same request conflict', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member();
  const input = { request_id: 'stable-settings', apify_token: 'synthetic-key', goals: 'Keep useful ideas' };
  success(await write(rt, alice, '/api/settings', input));
  success(await write(rt, alice, '/api/settings', input));
  assert.equal((await write(rt, alice, '/api/settings', { ...input, apify_token: 'synthetic-changed-key' })).body.code, 'IDEMPOTENCY_CONFLICT');
});

async function queuedRetrieval(rt, member) {
  const item = success(await write(rt, member, '/api/capture', { url: url(1), title: 'Synthetic selection' }));
  success(await write(rt, member, '/api/settings', { apify_token: 'synthetic-key' }));
  const job = success(await write(rt, member, '/api/retrieve/start', { limit: 1, max_charge: .1 }));
  const access = { uid: member.membership.uid, generation: member.membership.generation };
  return { item, job, access };
}

test('concurrent reconciliation submits once and repeated stop attempts consume allowance', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member(); await queuedRetrieval(rt, alice);
  const responses = await Promise.all([write(rt, alice, '/api/jobs/poll'), write(rt, alice, '/api/jobs/poll')]);
  responses.forEach(success);
  assert.equal((await rt.request('/__fixture__/provider')).body.starts, 1);
  assert.equal((await write(rt, alice, '/api/settings', { clear_apify_token: true })).body.code, 'JOB_ACTIVE');
  const before = success(await rt.request('/api/admin/stats', { token: alice.token })).budget.find(x => x.kind === 'interactive').spent;
  for (let n = 0; n < 3; n++) success(await write(rt, alice, '/api/jobs/stop'));
  const after = success(await rt.request('/api/admin/stats', { token: alice.token })).budget.find(x => x.kind === 'interactive').spent;
  assert.equal(after - before, 3 * 72);
  assert.equal((await rt.request('/__fixture__/provider')).body.starts, 1);
});

test('lost submission response stays uncertain without automatic paid retries', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member(); await queuedRetrieval(rt, alice);
  await rt.request('/__fixture__/provider', { data: { mode: 'uncertain' } });
  for (let n = 0; n < 4; n++) assert.equal(success(await write(rt, alice, '/api/jobs/poll')).status, 'UNCERTAIN');
  assert.equal((await rt.request('/__fixture__/provider')).body.starts, 1);
  assert.equal((await write(rt, alice, '/api/account/delete')).body.code, 'SUBMISSION_UNCERTAIN');
  const dismissed = success(await write(rt, alice, '/api/jobs/dismiss'));
  assert.equal(dismissed.status, 'CANCELLED');
  assert.equal(dismissed.selected_ids, undefined); assert.equal(dismissed.selected_revisions, undefined);
  success(await write(rt, alice, '/api/account/delete'));
});

test('recreated selections cancel queued work instead of creating an unbounded alarm loop', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member(), { item } = await queuedRetrieval(rt, alice);
  const original = success(await rt.request(`/api/item?id=${item.id}`, alice));
  success(await write(rt, alice, '/api/delete', { id: original.id, expected_revision: original.revision }));
  success(await write(rt, alice, '/api/capture', { url: url(1), title: 'New incarnation' }));
  const cancelled = success(await write(rt, alice, '/api/jobs/poll'));
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal((await rt.request('/__fixture__/provider')).body.starts, 0);
  assert.equal(success(await write(rt, alice, '/api/jobs/poll')).status, 'CANCELLED');
});

test('deletion freezes jobs and writes, then repairs an invalid provider key without reviving the workspace', async t => {
  const rt = await appRuntime({ cap: 1 }); t.after(() => rt.dispose());
  const alice = await rt.member(), { access } = await queuedRetrieval(rt, alice);
  success(await write(rt, alice, '/api/jobs/poll'));
  await rt.request('/__fixture__/provider', { data: { mode: 'invalid-key' } });
  const paused = await write(rt, alice, '/api/account/delete');
  assert.equal(paused.status, 409); assert.equal(paused.body.code, 'ACCOUNT_DELETING');
  assert.equal((await rt.member()).response.body.code, 'ACCOUNT_DELETING');
  assert.equal((await rt.request('/api/state', alice)).status, 403);
  assert.equal((await write(rt, alice, '/api/capture', { url: url(2) })).status, 403);
  assert.equal((await write(rt, alice, '/api/retrieve/start', { limit: 1, max_charge: .1 })).status, 403);
  const statsBefore = success(await rt.request('/api/admin/stats', { token: alice.token })).budget.find(x => x.kind === 'cleanup').spent;
  const badRepair = await write(rt, alice, '/api/account/delete', { apify_token: 'synthetic-still-invalid' });
  assert.equal(badRepair.body.code, 'ACCOUNT_DELETING');
  const statsAfter = success(await rt.request('/api/admin/stats', { token: alice.token })).budget.find(x => x.kind === 'cleanup').spent;
  assert.ok(statsAfter > statsBefore, 'paused deletion attempts consume cleanup headroom');
  success(await write(rt, alice, '/api/account/delete', { apify_token: 'synthetic-repaired-key' }));
  const deleted = await rt.request('/__fixture__/workspace', { data: { access, operation: 'job.get' } });
  assert.equal(deleted.body.code, 'WORKSPACE_DELETED');
  success((await rt.member('synthetic-bob')).response);
  assert.equal((await rt.request('/__fixture__/provider')).body.starts, 1);
});

test('monotonic lifecycle changes reject reordered suspension and deletion from suspended state works', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const bob = await rt.member('synthetic-bob'), access = { uid: bob.membership.uid, generation: bob.membership.generation };
  const registry = async operation => {
    const result = await rt.request('/__fixture__/registry', { data: { operation, input: access } });
    assert.equal(result.body.ok, true); return result.body.data;
  };
  const suspended = await registry('suspend'), resumed = await registry('resume');
  await internal(rt, access, 'resume', { lifecycle_epoch: resumed.lifecycle_epoch });
  const stale = await rt.request('/__fixture__/workspace', { data: { access, operation: 'suspend', input: { lifecycle_epoch: suspended.lifecycle_epoch } } });
  assert.equal(stale.body.code, 'LIFECYCLE_CONFLICT');
  success(await rt.request('/api/state', bob));
  const suspendedAgain = await registry('suspend');
  await internal(rt, access, 'suspend', { lifecycle_epoch: suspendedAgain.lifecycle_epoch });
  assert.equal((await rt.request('/api/state', bob)).status, 403);
  success(await write(rt, bob, '/api/account/delete'));
});

test('resuming a running provider with an existing dataset still checks terminal status before finalizing', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member(), { access } = await queuedRetrieval(rt, alice);
  await rt.request('/__fixture__/provider', { data: { mode: 'running' } });
  success(await write(rt, alice, '/api/jobs/poll'));
  let job = await internal(rt, access, 'job.get'); assert.ok(job.dataset_id);
  await internal(rt, access, 'job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'QUOTA_BLOCKED', next_poll_at: 0 } });
  assert.equal(success(await write(rt, alice, '/api/jobs/resume')).status, 'RUNNING');
  job = await internal(rt, access, 'job.get');
  await internal(rt, access, 'job.update', { id: job.id, expected_job_revision: job.revision, patch: { next_poll_at: 0 } });
  assert.equal(success(await write(rt, alice, '/api/jobs/poll')).status, 'RUNNING');
  const calls = (await rt.request('/__fixture__/provider')).body;
  assert.equal(calls.starts, 1); assert.equal(calls.polls, 1);
});

test('AI group quota failure rolls back earlier items and pauses the retained result without another paid request', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member(), access = { uid: alice.membership.uid, generation: alice.membership.generation };
  for (let n = 0; n < 81; n++) success(await write(rt, alice, '/api/project', { name: `Existing section ${n}` }));
  success(await write(rt, alice, '/api/import', { import_id: 'group-quota-fixture', sequence: 0, rows: Array.from({ length: 20 }, (_, n) => ({ url: url(n), content: 'Learn from this synthetic example.' })) }));
  success(await write(rt, alice, '/api/settings', { openai_key: 'synthetic-key' }));
  await rt.request('/__fixture__/provider', { data: { mode: 'many-groups' } });
  success(await write(rt, alice, '/api/classify-ai'));
  assert.equal(success(await write(rt, alice, '/api/jobs/poll')).status, 'QUOTA_BLOCKED');
  const state = success(await rt.request('/api/state', alice)); assert.equal(state.projects.length, 81);
  assert.ok(success(await rt.request('/api/items', alice)).items.every(item => item.kind === 'untriaged'));
  const stored = await internal(rt, access, 'job.get');
  assert.equal(stored.pending_candidates.length, 20); assert.equal(stored.reconciliation_count, 1);
  assert.ok(stored.completion_units_remaining < 1872);
  for (let n = 0; n < 3; n++) assert.equal(success(await write(rt, alice, '/api/jobs/poll')).status, 'QUOTA_BLOCKED');
  assert.equal((await rt.request('/__fixture__/provider')).body.classifications, 1);
  success(await write(rt, alice, '/api/jobs/stop'));
  assert.equal(success(await rt.request('/api/state', alice)).usage.reservedBytes, 0);
});

test('persisted queued work completes through a durable alarm after runtime restart without browser polling', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-job-restart-'));
  const variables = { TEST_MANUAL_JOBS: 'false', CREDENTIAL_KEYS: JSON.stringify({ active: 'v1', keys: { v1: randomBytes(32).toString('base64url') } }) };
  let rt = await appRuntime({ persist, variables });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  let alice = await rt.member();
  success(await write(rt, alice, '/api/capture', { url: url(1), content: 'Learn from one small SQLite experiment.' }));
  success(await write(rt, alice, '/api/settings', { openai_key: 'synthetic-key' }));
  success(await write(rt, alice, '/api/classify-ai'));
  const access = { uid: alice.membership.uid, generation: alice.membership.generation }, job = await internal(rt, access, 'job.get');
  await internal(rt, access, 'job.update', { id: job.id, expected_job_revision: job.revision, patch: { next_poll_at: Date.now() + 2500 } });
  await rt.dispose();
  rt = await appRuntime({ persist, variables }); alice = await rt.member();
  let state;
  const deadline = Date.now() + 8000;
  do {
    state = success(await rt.request('/api/state', alice));
    if (state.jobs[0]?.status === 'COMPLETED') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(state.jobs[0]?.status, 'COMPLETED');
  assert.equal(success(await rt.request('/api/items', alice)).items[0].kind, 'learning');
  assert.equal((await rt.request('/__fixture__/provider')).body.classifications, 1);
});
