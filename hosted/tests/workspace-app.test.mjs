import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { alice, bob, row, workspaceRuntime } from './workspace-helpers.mjs';

test('workspace ownership and deletion survive restart without reprovisioning old generations', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-private-workspace-'));
  let rt = await workspaceRuntime({ persist });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  assert.equal((await rt.invoke('state')).code, 'NOT_FOUND');
  await rt.provision(); await rt.provision(bob);
  const a = await rt.capture(1), b = await rt.capture(2, 'Build something', bob);
  assert.equal((await rt.invoke('detail', { id: a.id }, bob)).code, 'NOT_FOUND');
  assert.equal((await rt.invoke('state', {}, bob, alice.uid)).code, 'NOT_FOUND');
  assert.equal((await rt.invoke('state', {}, { ...alice, generation: 'stale' })).code, 'NOT_FOUND');
  await rt.call('suspend'); assert.equal((await rt.invoke('detail', { id: a.id })).code, 'MEMBERSHIP_SUSPENDED');
  await rt.call('resume'); assert.equal((await rt.call('detail', { id: a.id })).content, 'Learn an example');
  await rt.call('close'); assert.equal((await rt.call('close')).replayed, true);
  assert.equal((await rt.invoke('provision')).code, 'WORKSPACE_DELETED');
  await rt.dispose(); rt = await workspaceRuntime({ persist });
  assert.equal((await rt.invoke('state')).code, 'WORKSPACE_DELETED');
  assert.equal((await rt.call('detail', { id: b.id }, bob)).content, 'Build something');
});

test('metadata pages omit bodies, detail hydrates them, stale mutations conflict and exact replay is safe', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const captured = await rt.capture(3, 'Long source text '.repeat(80));
  const page = await rt.call('list', { limit: 1 });
  assert.equal(page.items[0].has_content, true); assert.equal('content' in page.items[0], false); assert.equal('note' in page.items[0], false);
  assert.ok(page.items[0].excerpt.length <= 360); assert.equal(page.items[0].revision, captured.revision);
  const patch = { id: captured.id, expected_revision: captured.revision, note: 'My private annotation', request_id: 'same-edit' };
  const saved = await rt.call('item', patch); assert.ok(saved.revision > captured.revision);
  assert.equal((await rt.call('item', patch)).replayed, true);
  assert.equal((await rt.invoke('item', { ...patch, note: 'Different' })).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await rt.invoke('item', { ...patch, request_id: 'stale' })).code, 'REVISION_CONFLICT');
  assert.equal((await rt.call('detail', { id: captured.id })).note, 'My private annotation');
});

test('last item slot is atomic and failed inline groups or quota writes leave prior state intact', async t => {
  const rt = await workspaceRuntime({ limits: { WORKSPACE_ITEM_LIMIT: 1, WORKSPACE_LOGICAL_LIMIT: 6000 } }); t.after(() => rt.dispose()); await rt.provision();
  const results = await Promise.all([4, 5].map(n => rt.invoke('capture', { ...row(n, 'Learn an example'), request_id: `race-${n}` })));
  assert.equal(results.filter(result => result.ok).length, 1); assert.equal(results.find(result => !result.ok).code, 'ITEM_LIMIT');
  const item = (await rt.call('list')).items[0];
  const before = await rt.call('export');
  const failed = await rt.invoke('item', { id: item.id, expected_revision: item.revision, note: '🚀'.repeat(2000), new_project_name: 'Must roll back', request_id: 'too-large' });
  assert.equal(failed.code, 'LOGICAL_LIMIT'); assert.deepEqual(await rt.call('export'), before);
  const invalid = await rt.invoke('item', { id: item.id, expected_revision: item.revision, status: 'ready', new_project_name: 'No orphan', request_id: 'not-ready' });
  assert.equal(invalid.code, 'TASK_NOT_READY'); assert.equal((await rt.call('state')).projects.length, 0);
});

test('ordinary edits enforce used-page pressure transactionally and preserve exports after failure', async t => {
  const rt = await workspaceRuntime({ limits: { WORKSPACE_USED_LIMIT: 100000 } }); t.after(() => rt.dispose()); await rt.provision();
  const captured = await rt.capture(6, 'Small source'), before = await rt.call('export');
  const result = await rt.invoke('item', { id: captured.id, expected_revision: captured.revision, note: '知'.repeat(19000), request_id: 'storage-pressure' });
  assert.equal(result.code, 'STORAGE_PRESSURE'); assert.deepEqual(await rt.call('export'), before);
});

test('canonical import identity matches Python semantics and repeated imports preserve annotations and reading', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const url = 'HTTP://www.LinkedIn.com:80/a/../posts/x///?utm_source=test&k=hello+world&sym=%2A#ignored';
  const canonical = 'https://www.linkedin.com:80/a/../posts/x?k=hello+world&sym=%2A';
  const first = await rt.mutate('import', { import_id: 'archive-one', sequence: 0, rows: [{ url, saved_at: '2026-01-01', content: 'Learning source' }], filename: 'Saved_Items.csv' });
  assert.equal(first.added, 1);
  const id = createHash('sha256').update(canonical).digest('hex').slice(0, 12);
  let item = await rt.call('detail', { id }); assert.equal(item.url, canonical);
  item = (await rt.mutate('item', { id, expected_revision: item.revision, kind: 'learning', note: 'Keep this note', title: 'My title', new_project_name: 'Knowledge' })).item;
  item = (await rt.mutate('reading', { id, expected_revision: item.revision, status: 'reading', progress: 45, queued: true })).item;
  await rt.mutate('import', { import_id: 'archive-two', sequence: 0, rows: [{ url: canonical, saved_at: '2026-02-02', title: 'Provider title', content: 'Do not overwrite' }] });
  const kept = await rt.call('detail', { id });
  assert.equal(kept.title, 'My title'); assert.equal(kept.note, 'Keep this note'); assert.equal(kept.content, 'Learning source');
  assert.equal(kept.reading.progress, 45); assert.equal(kept.status, 'inbox'); assert.equal(kept.project_id, item.project_id);
  const reset = await rt.mutate('reading', { id, expected_revision: kept.revision, status: 'unread' }); assert.equal(reset.reading.progress, 0);
});

test('chunk replay and ordered import checkpoints do not duplicate records or silently accept changed chunks', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const chunk = { import_id: 'chunks', sequence: 0, request_id: 'chunk-0', rows: [row(7), row(8)] };
  await rt.call('import', chunk); assert.equal((await rt.call('import', chunk)).replayed, true);
  assert.equal((await rt.invoke('import', { ...chunk, rows: [row(9)] })).code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await rt.invoke('import', { import_id: 'chunks', sequence: 2, request_id: 'chunk-2', rows: [row(9)] })).code, 'IMPORT_CONFLICT');
  await rt.call('import', { import_id: 'chunks', sequence: 1, request_id: 'chunk-1', rows: [row(8), row(9)] });
  assert.equal((await rt.call('state')).usage.items, 3);
});

test('v1 export and restore retain source, organization and notes while excluding credentials and private job state', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision(); await rt.provision(bob);
  let item = (await rt.capture(10)).item;
  item = (await rt.mutate('item', { id: item.id, expected_revision: item.revision, kind: 'learning', note: 'Restorable annotation', new_project_name: 'Reading' })).item;
  await rt.mutate('credential.set', { provider: 'apify', record: { version: 'test', nonce: 'synthetic-nonce', ciphertext: 'synthetic-encrypted-value' } });
  const exported = await rt.call('export');
  assert.equal(exported.workspace.version, 1); assert.doesNotMatch(JSON.stringify(exported), /synthetic-encrypted|credentials|nonce/);
  await rt.mutate('restore', { import_id: 'restore', sequence: 0, workspace: exported.workspace, items: exported.items }, bob);
  const restored = await rt.call('detail', { id: item.id }, bob);
  assert.equal(restored.note, item.note); assert.equal(restored.content, item.content); assert.equal(restored.project_id, item.project_id);
  assert.equal((await rt.call('state', {}, bob)).settings.extractor_available, false);
  const first = await rt.call('export', { limit: 1 });
  await rt.capture(11);
  // Cursor integrity is exercised with multiple pages below.
  const paged = await rt.call('export', { limit: 1 }); assert.ok(paged.next_cursor);
  await rt.capture(12);
  assert.equal((await rt.invoke('export', { cursor: paged.next_cursor })).code, 'REVISION_CONFLICT');
});

async function begin(rt, item, kind = 'retrieval', extra = {}) {
  return rt.mutate('job.begin', { job: { id: `job-${item.id}-${kind}`, kind, status: 'STARTING', selected_ids: [item.id], selected_revisions: { [item.id]: item.revision }, reserved_bytes: 100000, ...extra } });
}
test('job intent, reservation, leases and terminal transitions are atomic and prevent blind submission replay', async t => {
  const rt = await workspaceRuntime({ limits: { WORKSPACE_LOGICAL_LIMIT: 110000 } }); t.after(() => rt.dispose()); await rt.provision();
  const item = (await rt.capture(13, '')).item;
  const job = await begin(rt, item); assert.equal(job.status, 'STARTING'); assert.equal((await rt.call('state')).usage.reservedBytes, 100000);
  assert.equal((await rt.invoke('item', { id: item.id, expected_revision: item.revision, note: 'n'.repeat(15000), request_id: 'reserved-room' })).code, 'LOGICAL_LIMIT');
  const replay = await begin(rt, item); assert.equal(replay.replayed, true);
  let claimed = await rt.call('job.claim', { id: job.id, lease_id: 'lease-one', lease_until: Date.now() + 60000 });
  assert.equal((await rt.invoke('job.claim', { id: job.id, lease_id: 'lease-two', lease_until: Date.now() + 60000 })).code, 'JOB_BUSY');
  const terminal = await rt.call('job.apply', { id: job.id, expected_job_revision: claimed.revision, candidates: [{ id: item.id, patch: { content: 'source '.repeat(2000), enrichment: { status: 'extracted' } }, quality: 4 }], cursor: 1, terminal: true });
  assert.equal(terminal.status, 'COMPLETED'); assert.equal((await rt.call('state')).usage.reservedBytes, 0);
  assert.equal((await rt.invoke('job.update', { id: job.id, expected_job_revision: terminal.revision, patch: { status: 'STARTING' } })).code, 'JOB_FINISHED');
});

test('late provider pages preserve notes and source edits, permit better same-job text, and never recreate deleted saves', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  let item = (await rt.capture(14, '')).item, job = await begin(rt, item);
  job = await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates: [{ id: item.id, patch: { content: 'Partial text', enrichment: { status: 'partial' } }, quality: 2 }], cursor: 1 });
  item = await rt.call('detail', { id: item.id });
  await rt.mutate('item', { id: item.id, expected_revision: item.revision, note: 'My note survives' });
  await rt.mutate('import', { import_id: 'metadata-only', sequence: 0, rows: [{ ...row(14), author: 'Imported author' }] });
  job = await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates: [{ id: item.id, patch: { content: 'Full document transcript', enrichment: { status: 'extracted' } }, quality: 5 }], cursor: 2 });
  item = await rt.call('detail', { id: item.id }); assert.equal(item.content, 'Full document transcript'); assert.equal(item.note, 'My note survives'); assert.equal(item.author, 'Imported author');
  await rt.mutate('item', { id: item.id, expected_revision: item.revision, content: '' });
  job = await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates: [{ id: item.id, patch: { content: 'Must not restore user-cleared text' }, quality: 6 }], cursor: 3 });
  item = await rt.call('detail', { id: item.id }); assert.equal(item.content, '');
  await rt.mutate('delete', { id: item.id, expected_revision: item.revision });
  await rt.capture(14, 'New save after deletion');
  await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates: [{ id: item.id, patch: { content: 'Old job content' }, quality: 8 }], cursor: 4, terminal: true });
  assert.equal((await rt.call('detail', { id: item.id })).content, 'New save after deletion');
});

test('classification skips stale revisions and deletion blocks all late job or credential writes', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  let item = (await rt.capture(15, 'Build a useful local tool')).item;
  const job = await begin(rt, item, 'classification');
  await rt.mutate('item', { id: item.id, expected_revision: item.revision, note: 'New direction while AI runs' });
  const result = await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates: [{ id: item.id, patch: { kind: 'project' } }], terminal: true, cursor: 1 });
  assert.equal(result.skipped, 1); assert.equal((await rt.call('detail', { id: item.id })).kind, 'untriaged');
  await rt.call('close');
  assert.equal((await rt.invoke('job.update', { id: job.id, expected_job_revision: result.revision, patch: { status: 'RUNNING' } })).code, 'WORKSPACE_DELETED');
  assert.equal((await rt.invoke('credential.set', { request_id: 'late-key', provider: 'apify', record: null })).code, 'WORKSPACE_DELETED');
});

test('settings bundle is atomic and Unicode case-folded section names reuse existing IDs', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const first = await rt.mutate('project', { name: 'Straße' });
  const reused = await rt.mutate('project', { name: 'STRASSE' }); assert.equal(reused.id, first.id);
  const value = { version: 'v1', nonce: 'syntheticnonce', ciphertext: 'syntheticcipher' };
  await rt.mutate('settings', { goals: 'Old goals', credential_updates: [{ provider: 'apify', value }] });
  const failure = await rt.invoke('settings', { request_id: 'invalid-bundle', goals: 'Must roll back', credential_updates: [
    { provider: 'apify', value: null }, { provider: 'openai', value: { ...value, nonce: '' } },
  ] });
  assert.equal(failure.ok, false); assert.equal((await rt.call('state')).goals, 'Old goals');
  assert.deepEqual(await rt.call('credential.get', { provider: 'apify' }), value);
  assert.equal(await rt.call('credential.get', { provider: 'openai' }), null);
  const largeGroup = { name: '🚀'.repeat(100), description: '🚀'.repeat(2000), request_id: 'unicode-group' };
  const created = await rt.call('project', largeGroup);
  const replayed = await rt.call('project', largeGroup);
  assert.equal(replayed.id, created.id); assert.equal(replayed.project.description, largeGroup.description);
});

test('queued submission snapshots validate current revisions and reconciliation stops at its persisted work cap', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  let item = (await rt.capture(16, '')).item;
  let job = await begin(rt, item, 'retrieval', { status: 'QUEUED' });
  item = (await rt.mutate('item', { id: item.id, expected_revision: item.revision, note: 'Changed before submission' })).item;
  const stale = await rt.invoke('job.update', { id: job.id, expected_job_revision: job.revision,
    patch: { status: 'STARTING', selected_revisions: job.selected_revisions } });
  assert.equal(stale.code, 'REVISION_CONFLICT');
  job = await rt.call('job.update', { id: job.id, expected_job_revision: job.revision,
    patch: { status: 'STARTING', selected_revisions: { [item.id]: item.revision }, submission_deadline: Date.now() + 120000 } });
  job = await rt.call('job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'RUNNING' } });
  for (let n = 0; n < 24; n++) {
    job = await rt.call('job.claim', { id: job.id, lease_id: `lease-${n}`, lease_until: Date.now() + 60000 });
    job = await rt.call('job.update', { id: job.id, expected_job_revision: job.revision, patch: { lease_until: 0 } });
  }
  job = await rt.call('job.claim', { id: job.id, lease_id: 'blocked', lease_until: Date.now() + 60000 });
  assert.equal(job.status, 'QUOTA_BLOCKED'); assert.equal(job.reconciliation_count, 24); assert.equal(job.next_poll_at, 0);
  assert.equal((await rt.call('job.get')).status, 'QUOTA_BLOCKED');
  assert.equal((await rt.invoke('job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'STARTING' } })).code, 'JOB_UNCERTAIN');
});

test('large validated classification batches persist using reserved space and release it after atomic application', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const items = [];
  for (let n = 20; n < 40; n++) items.push((await rt.capture(n, 'Learn a synthetic concept')).item);
  let job = await rt.mutate('job.begin', { job: { id: 'large-classification', kind: 'classification', status: 'STARTING',
    selected_ids: items.map(item => item.id), selected_revisions: Object.fromEntries(items.map(item => [item.id, item.revision])), reserved_bytes: 2000000 } });
  const candidates = items.map(item => ({ id: item.id, expected_revision: item.revision, patch: {
    kind: 'learning', title: item.title, why: 'why '.repeat(500), next_action: 'next '.repeat(400), definition_of_done: 'done '.repeat(400),
    repo_suggestion: '', commit_message: '', confidence: 'high', effort_hours: 1, tags: ['synthetic'], impact: 3, relevance: 3, novelty: 3,
  } }));
  assert.ok(Buffer.byteLength(JSON.stringify(candidates)) > 65536);
  job = await rt.call('job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'APPLYING', pending_candidates: candidates } });
  assert.ok((await rt.call('state')).usage.reservedBytes < 2000000);
  job = await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision, candidates, terminal: true, cursor: 20 });
  assert.equal(job.classified, 20); assert.equal(job.pending_candidates, undefined);
  assert.equal((await rt.call('state')).usage.reservedBytes, 0);
  assert.equal((await rt.call('detail', { id: items[0].id })).kind, 'learning');
});

test('per-save byte bound prevents incremental edits from producing an unrestorable backup', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision(); await rt.provision(bob);
  let item = (await rt.capture(50, '🚀'.repeat(19000))).item;
  item = (await rt.mutate('item', { id: item.id, expected_revision: item.revision, note: '知'.repeat(15000) })).item;
  const before = await rt.call('export');
  const failure = await rt.invoke('item', { id: item.id, expected_revision: item.revision, why: '知'.repeat(10000), request_id: 'incremental-bound' });
  assert.equal(failure.code, 'ITEM_STORAGE_LIMIT'); assert.deepEqual(await rt.call('export'), before);
  assert.ok(Buffer.byteLength(JSON.stringify(before.items[0])) <= 131072);
  await rt.mutate('restore', { import_id: 'large-restore', sequence: 0, workspace: before.workspace, items: before.items }, bob);
  assert.equal((await rt.call('detail', { id: item.id }, bob)).note, item.note);
});
