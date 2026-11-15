import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { workspaceRuntime, row, alice, bob } from './workspace-helpers.mjs';

const ai = { kind: 'learning', title: 'Practice SQLite', why: 'One small example', next_action: 'Run it',
  definition_of_done: 'Record what happened', repo_suggestion: '', commit_message: '', confidence: 'medium',
  effort_hours: 1, impact: 3, relevance: 4, novelty: 3, tags: ['sqlite'] };

test('free beta retains hard growth limits while edits and reading survive a smaller configured cap', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-free-beta-'));
  let rt = await workspaceRuntime({ persist, limits: { WORKSPACE_ITEM_LIMIT: '120' } });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  await rt.provision();
  for (let sequence = 0; sequence < 5; sequence++) await rt.mutate('import', {
    import_id: 'synthetic-free-beta', sequence,
    rows: Array.from({ length: sequence === 4 ? 2 : 25 }, (_, n) => row(sequence * 25 + n, 'A useful saved idea')),
  });
  const before = await rt.call('state'); assert.equal(before.usage.items, 102);
  assert.equal(before.entitlements, undefined);
  await rt.dispose(); rt = await workspaceRuntime({ persist, limits: { WORKSPACE_ITEM_LIMIT: '100' } });
  const list = await rt.call('list', { limit: 1 }); let current = await rt.call('detail', { id: list.items[0].id });
  current = (await rt.mutate('item', { request_id: 'after-cap-reduction-edit', id: current.id, expected_revision: current.revision, kind: 'learning', note: 'Keep my existing annotation' })).item;
  current = (await rt.mutate('reading', { request_id: 'after-cap-reduction-read', id: current.id, expected_revision: current.revision, progress: 35 })).item;
  assert.equal(current.note, 'Keep my existing annotation'); assert.equal(current.reading.progress, 35);
  assert.equal((await rt.invoke('capture', { ...row(103), request_id: 'over-reduced-beta-cap' })).code, 'ITEM_LIMIT');
  assert.equal((await rt.call('state')).usage.items, 102);
  const exported = await rt.call('export', { limit: 50 }); assert.ok(exported.items.length > 0);
  await rt.mutate('delete', { request_id: 'after-cap-reduction-delete', id: current.id, expected_revision: current.revision });
  assert.equal((await rt.call('state')).usage.items, 101);
});

test('free beta AI organization has no monthly point economy and preserves typed sections and time preferences', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const items = [];
  for (let n = 1; n <= 21; n++) items.push((await rt.capture(n)).item);
  for (const [name, kind] of [['Builds', 'project'], ['Reading', 'learning'], ['Experiences', 'experience'], ['Another topic', 'learning']])
    await rt.mutate('project', { name, kind });
  for (const [index, batch] of [items.slice(0, 20), items.slice(20)].entries()) {
    const job = await rt.mutate('job.begin', { job: { id: `beta-organization-${index}`, kind: 'classification', status: 'STARTING',
      selected_ids: batch.map(item => item.id), selected_revisions: Object.fromEntries(batch.map(item => [item.id, item.revision])), reserved_bytes: 100000 } });
    await rt.call('job.apply', { id: job.id, expected_job_revision: job.revision,
      candidates: batch.map(item => ({ id: item.id, patch: ai })), terminal: true });
  }
  assert.equal((await rt.call('list', { limit: 50 })).items.filter(item => item.kind === 'learning').length, 21);
  await rt.mutate('settings', { weekly_hours: 2.5 });
  const backup = await rt.call('export', { limit: 50 });
  assert.equal(backup.workspace.weekly_hours, 2.5); assert.equal(backup.workspace.projects.length, 4);
  assert.deepEqual(new Set(backup.workspace.projects.map(group => group.kind)), new Set(['project', 'learning', 'experience']));
  await rt.provision(bob);
  await rt.mutate('restore', { import_id: 'beta-v1-restore', sequence: 0, workspace: backup.workspace, rows: backup.items }, bob);
  const restored = await rt.call('state', {}, bob);
  assert.equal(restored.weekly_hours, 2.5); assert.equal(restored.projects.length, 4); assert.equal(restored.usage.items, 21);
  assert.equal(restored.entitlements, undefined);
  for (const weekly_hours of [0, 169, '2', null])
    assert.equal((await rt.invoke('settings', { request_id: `invalid-beta-hours-${weekly_hours}`, weekly_hours })).code, 'INVALID_INPUT');
});

test('free beta section hard cap is atomic across restore and still allows existing section edits', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const projects = Array.from({ length: 99 }, (_, n) => ({ id: `synthetic-section-${n}`, name: `Synthetic ${n}`, kind: 'learning' }));
  await rt.mutate('restore', { import_id: 'beta-sections', sequence: 0, rows: [], workspace: { version: 1, projects } });
  const failed = await rt.invoke('restore', { request_id: 'over-beta-sections', import_id: 'beta-sections-over', sequence: 0,
    rows: [row(1)], workspace: { version: 1, projects: [
      { id: 'new-section-one', name: 'Must roll back' }, { id: 'new-section-two', name: 'Over cap' },
    ] } });
  assert.equal(failed.code, 'GROUP_LIMIT');
  let state = await rt.call('state'); assert.equal(state.projects.length, 99); assert.equal(state.usage.items, 0);
  assert.equal(state.projects.some(group => group.id === 'new-section-one'), false);
  await rt.mutate('project', { name: 'Last supported section', kind: 'experience' });
  assert.equal((await rt.invoke('project', { request_id: 'section-over-cap', name: 'Another section' })).code, 'GROUP_LIMIT');
  await rt.mutate('project', { id: projects[0].id, name: 'Edited at the section cap', kind: 'learning' });
  state = await rt.call('state'); assert.equal(state.projects.length, 100);
  assert.ok(state.projects.some(group => group.name === 'Edited at the section cap'));
});

test('free beta refuses incompatible private state across restart and cannot purge it', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-beta-build-fence-'));
  let rt = await workspaceRuntime({ persist });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  await rt.provision(); const item = (await rt.capture(1, 'Retain this synthetic source')).item;
  const backup = await rt.call('export');
  await rt.call('test.legacyFeatureState', { deleting: true });
  const snapshot = await rt.call('test.snapshot');
  for (const operation of ['state', 'export', 'delete.prepare', 'close'])
    assert.equal((await rt.invoke(operation)).code, 'WORKSPACE_BUILD_MISMATCH', operation);
  assert.equal((await rt.invoke('state', {}, bob, alice.uid)).code, 'NOT_FOUND', 'compatibility state is not disclosed to another owner');
  assert.deepEqual(await rt.call('test.snapshot'), snapshot);
  await rt.dispose(); rt = await workspaceRuntime({ persist });
  assert.equal((await rt.invoke('detail', { id: item.id })).code, 'WORKSPACE_BUILD_MISMATCH');
  assert.equal((await rt.invoke('close')).code, 'WORKSPACE_BUILD_MISMATCH');
  assert.deepEqual(await rt.call('test.snapshot'), snapshot);
  await rt.provision(bob);
  await rt.mutate('restore', { import_id: 'compatible-v1-backup', sequence: 0, workspace: backup.workspace, rows: backup.items }, bob);
  assert.equal((await rt.call('detail', { id: item.id }, bob)).content, 'Retain this synthetic source');
});

test('active incompatible SQL workspace clears its due alarm without retrying or reconciling provider work', async t => {
  const rt = await workspaceRuntime(); t.after(() => rt.dispose()); await rt.provision();
  const saved = (await rt.capture(1, '')).item;
  await rt.mutate('job.begin', { job: { id: 'old-build-job', kind: 'retrieval', status: 'QUEUED',
    selected_ids: [saved.id], selected_revisions: { [saved.id]: saved.revision }, reserved_bytes: 10000,
    next_poll_at: Date.now() + 3600000 } });
  await rt.call('test.legacyFeatureState');
  await rt.call('test.alarm', { due: true });
  assert.equal((await rt.call('test.snapshot')).alarm, null);
  assert.equal(await rt.call('test.reconciliations'), 0);
  assert.equal((await rt.invoke('state')).code, 'WORKSPACE_BUILD_MISMATCH');
  await rt.call('test.alarm', { due: true });
  assert.equal((await rt.call('test.snapshot')).alarm, null);
  assert.equal(await rt.call('test.reconciliations'), 0);
});
