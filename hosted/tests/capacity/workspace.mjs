// Final application schema, synthetic data only. No identity/provider/cloud calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { Miniflare, Log, LogLevel } from 'miniflare';

const root = fileURLToPath(new URL('../../', import.meta.url));
const started = performance.now();
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = value => Buffer.byteLength(JSON.stringify(value));
const maxElapsedMs = 180_000, maxPersistenceBytes = 64 * 1024 * 1024;
const buildResult = await build({ absWorkingDir: root, entryPoints: ['tests/workspace-harness.ts'], bundle: true,
  format: 'esm', platform: 'browser', target: 'es2023', external: ['cloudflare:workers'], write: false, metafile: true });
const bundle = buildResult.outputFiles[0].text;
let requestSequence = 0;
const timings = new Map();
function bounded() { assert.ok(performance.now() - started < maxElapsedMs, 'Local capacity run exceeded its three-minute work bound'); }
async function runtime(persist, limits = {}) {
  const mf = new Miniflare({ workers: [{ config: {
    name: 'workspace-capacity-test', compatibilityDate: '2026-07-30',
    manifest: { mainModule: 'workspace.js', modules: { 'workspace.js': { type: 'esm', contents: bundle } } },
    exports: { Workspace: { type: 'durable-object', storage: 'sqlite' }, Authority: { type: 'durable-object', storage: 'sqlite' } },
    env: { WORKSPACES: { type: 'durable-object', worker: 'workspace-capacity-test', exportName: 'Workspace' },
      AUTHORITY: { type: 'durable-object', worker: 'workspace-capacity-test', exportName: 'Authority' },
      ...Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, { type: 'text', value: String(value) }])) },
  } }], host: '127.0.0.1', port: 0, resourcePersistencePath: persist, telemetry: { enabled: false },
  enableDevRegistry: false, log: new Log(LogLevel.ERROR), cf: false });
  return {
    async invoke(access, operation, input = {}) {
      bounded(); const at = performance.now();
      const response = await mf.dispatchFetch('https://harness.invalid/', { method: 'POST',
        body: JSON.stringify({ name: access.uid, access, operation, input }) });
      assert.equal(response.status, 200);
      const result = await response.json(), elapsedMs = performance.now() - at;
      const timing = timings.get(operation) ?? { requests: 0, elapsedMs: 0, maxElapsedMs: 0 };
      timing.requests++; timing.elapsedMs += elapsedMs; timing.maxElapsedMs = Math.max(timing.maxElapsedMs, elapsedMs); timings.set(operation, timing);
      return result;
    },
    async call(access, operation, input = {}) {
      const result = await this.invoke(access, operation, input);
      assert.ok(result.ok, `${operation}: ${JSON.stringify(result)}`); return result.data;
    },
    async provision(access) { await this.call(access, 'authority.reserve'); return this.call(access, 'provision'); },
    async close(access) {
      await this.call(access, 'delete.prepare'); await this.call(access, 'authority.deleting'); return this.call(access, 'close');
    },
    dispose: () => mf.dispose(),
  };
}
const accessFor = name => ({ uid: `synthetic-capacity-${name}`, generation: 'capacity-generation-v1' });
const request = data => ({ request_id: `capacity-write-${++requestSequence}`, ...data });
async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path)); else if (entry.isFile()) files.push(path);
  }
  return files;
}
// Inspect only after workerd exits. These are local quiescent files, not meters.
async function allocation(directory) {
  const files = await filesUnder(directory), sizes = new Map();
  for (const file of files) sizes.set(file, (await stat(file)).size);
  const persistenceBytes = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  assert.ok(persistenceBytes <= maxPersistenceBytes, 'Synthetic persistence exceeded its 64 MiB bound');
  const workspaces = [], nonWorkspaceDatabases = [];
  for (const file of files.filter(path => path.endsWith('.sqlite'))) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      const pageCount = db.prepare('PRAGMA page_count').get().page_count;
      const freePages = db.prepare('PRAGMA freelist_count').get().freelist_count;
      const pageSize = db.prepare('PRAGMA page_size').get().page_size;
      if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'").get()) {
        nonWorkspaceDatabases.push({ tables: db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(row => row.name),
          allocatedBytes: pageCount * pageSize, fileBytes: sizes.get(file), walBytes: sizes.get(`${file}-wal`) ?? 0, shmBytes: sizes.get(`${file}-shm`) ?? 0 });
        continue;
      }
      const control = db.prepare('SELECT uid,status,logical_bytes,item_count FROM workspace WHERE singleton=1').get();
      workspaces.push({ uid: control.uid, status: control.status, logicalBytes: control.logical_bytes, items: control.item_count,
        pageCount, freePages, pageSize, usedBytes: (pageCount - freePages) * pageSize, allocatedBytes: pageCount * pageSize,
        fileBytes: sizes.get(file), walBytes: sizes.get(`${file}-wal`) ?? 0, shmBytes: sizes.get(`${file}-shm`) ?? 0 });
    } finally { db.close(); }
  }
  return { persistenceBytes, workspaces: workspaces.sort((a, b) => a.uid.localeCompare(b.uid)), nonWorkspaceDatabases };
}
function text(seed, length, unicode = false) {
  let value = '', n = 0, characters = 0;
  while (characters < length) {
    const token = hash(`${seed}:${n++}`).slice(0, 10);
    const part = unicode ? `学習🚀${token} 設計${n} ` : `word${token} experiment${n} `;
    value += part; characters += Array.from(part).length;
  }
  return Array.from(value).slice(0, length).join('').trim();
}
const profiles = {
  typical: { contentCharacters: 1700, noteCharacters: 300, unicode: false },
  unicode: { contentCharacters: 2200, noteCharacters: 500, unicode: true },
  richer: { contentCharacters: 3800, noteCharacters: 1400, unicode: false },
  longNotes: { contentCharacters: 1200, noteCharacters: 18_000, unicode: true },
};
const groups = ['project', 'learning', 'experience'].map((kind, n) => ({ id: `00000000000${n + 1}`, name: `Synthetic ${kind}`, description: 'Capacity fixture', created_at: '2026-11-01T00:00:00Z' }));
const workspace = { version: 1, projects: groups, goals: 'Build, learn and reflect with saved ideas.', board_order: [] };
function fixture(n, profile) {
  const { contentCharacters, noteCharacters, unicode } = profiles[profile];
  const url = `https://www.linkedin.com/feed/update/urn:li:activity:90000000000000${String(n).padStart(4, '0')}`;
  const kind = ['project', 'learning', 'experience'][n % 3];
  return { id: hash(url).slice(0, 12), platform: 'linkedin', url, saved_at: '2026-11-01',
    title: `Synthetic ${profile} idea ${n}`, author: 'Synthetic author', content: text(`source-${n}`, contentCharacters, unicode),
    note: text(`note-${n}`, noteCharacters, unicode), kind, status: 'inbox', project_id: groups[n % 3].id,
    why: `Explore synthetic idea ${n}.`, next_action: 'Try a small example.', definition_of_done: 'One example and its notes are saved.',
    effort_hours: 1, confidence: 'medium', tags: [`topic-${n % 17}`, 'synthetic'], impact: 3, relevance: 4, novelty: 3,
    ...(kind === 'project' ? {} : { reading: { status: n % 2 ? 'reading' : 'unread', progress: n % 2 ? 35 : 0, queued: n % 5 === 0 } }),
    metadata: { fixture: true, source_record: n },
  };
}
function chunk(items) {
  const rows = []; let length = 0;
  for (const item of items.slice(0, 25)) {
    const size = bytes(item); if (rows.length && length + size > 220_000) break;
    rows.push(item); length += size;
  }
  return rows;
}
async function exported(rt, access) {
  let cursor, metadata; const items = []; let pages = 0, maxResponseBytes = 0;
  do {
    const page = await rt.call(access, 'export', { cursor, limit: 25 }); pages++;
    maxResponseBytes = Math.max(maxResponseBytes, bytes(page));
    metadata ??= page.workspace; items.push(...page.items); cursor = page.next_cursor;
  } while (cursor);
  assert.ok(items.length <= 1000);
  return { workspace: metadata, items, pages, maxResponseBytes };
}
const stable = backup => ({ workspace: backup.workspace, items: backup.items });
async function expectRollback(rt, access, operation, input, expected) {
  const before = await exported(rt, access), state = await rt.call(access, 'state');
  const result = await rt.invoke(access, operation, request(input));
  assert.equal(result.ok, false); assert.ok(expected.includes(result.code), `Unexpected rejection: ${result.code}`);
  assert.deepEqual(stable(await exported(rt, access)), stable(before));
  const after = await rt.call(access, 'state');
  assert.equal(after.revision, state.revision); assert.equal(after.usage.logicalBytes, state.usage.logicalBytes);
  return { code: result.code, exportUnchanged: true, usageBefore: state.usage, usageAfter: after.usage };
}

const report = { generatedAt: new Date().toISOString(), schema: 'app-v1', synthetic: true, complete: false,
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  sourceSHA256: {}, bundleSHA256: hash(bundle),
  boundary: 'Actual application Workspace in local Miniflare/workerd with a separate synthetic provisioning authority. No public Worker/registry, cloud meter, real Google account or paid provider. Elapsed request time is not Worker CPU or billable duration.',
  allocationBoundary: 'SQLite file/allocated/freelist/WAL/SHM sizes after workerd disposal. Transient WAL peaks, remote billing and account-wide capacity are not measured.',
  limits: { items: 1000, logicalBytes: 5_000_000, sqliteUsedBytes: 7_000_000, itemBytes: 131_072 },
  workBounds: { maxElapsedMs, maxPersistenceBytes, maxItemsPerRequest: 25, maxRowsJSONBytes: 220_000 }, profiles, scenarios: [],
};
for (const path of Object.keys(buildResult.metafile.inputs).filter(path => path.startsWith('src/') || path.startsWith('tests/')))
  report.sourceSHA256[path] = hash(await readFile(resolve(root, path)));
const lock = JSON.parse(await readFile(resolve(root, 'package-lock.json'), 'utf8'));
report.environment.packages = Object.fromEntries(['miniflare', 'workerd', 'esbuild'].map(name => [name, lock.packages[`node_modules/${name}`]?.version]));
await mkdir(resolve(root, '.local'), { recursive: true });
async function saveReport() { await writeFile(resolve(root, '.local/workspace-capacity-report.json'), `${JSON.stringify(report, null, 2)}\n`); }

for (const [target, profile] of [[500, 'typical'], [1000, 'typical'], [1000, 'unicode'], [1000, 'richer'], [1000, 'longNotes']]) {
  const directory = await mkdtemp(join(tmpdir(), 'save2ship-final-capacity-'));
  const access = accessFor(`${profile}-${target}`), recovered = accessFor(`${profile}-${target}-restored`);
  let rt = await runtime(directory);
  const scenario = { target, profile, complete: false, seed: 'Version-1 restore represents a retained library with source text, notes, sections and reading progress.', snapshots: [], rejectedChunks: [], changes: [] };
  report.scenarios.push(scenario);
  async function checkpoint(stage) {
    const usage = (await rt.call(access, 'state')).usage;
    await rt.dispose(); const disk = await allocation(directory);
    const source = disk.workspaces.find(row => row.uid === access.uid);
    assert.ok(source);
    scenario.snapshots.push({ stage, usage, disk, usedMetricMatchesQuiescentPages: source.usedBytes === usage.sqliteUsedBytes });
    await saveReport();
    rt = await runtime(directory);
  }
  try {
    await rt.provision(access);
    let accepted = 0, sequence = 0, single = false;
    const rows = Array.from({ length: target }, (_, n) => fixture(n, profile));
    while (accepted < rows.length) {
      const batch = single ? rows.slice(accepted, accepted + 1) : chunk(rows.slice(accepted));
      const before = await rt.call(access, 'state');
      const result = await rt.invoke(access, 'restore', request({ import_id: 'seed', sequence, rows: batch, ...(sequence === 0 ? { workspace } : {}) }));
      if (result.ok) { accepted += batch.length; sequence++; continue; }
      const after = await rt.call(access, 'state');
      assert.equal(after.revision, before.revision); assert.equal(after.usage.logicalBytes, before.usage.logicalBytes); assert.equal(after.usage.items, before.usage.items);
      assert.ok(['LOGICAL_LIMIT', 'STORAGE_PRESSURE', 'ITEM_LIMIT'].includes(result.code), JSON.stringify(result));
      scenario.rejectedChunks.push({ items: batch.length, code: result.code, acceptedBefore: accepted, revisionAndUsageUnchanged: true });
      if (single) break; single = true;
    }
    scenario.acceptedItems = accepted;
    const initial = await exported(rt, access);
    assert.equal(initial.items.length, accepted);
    for (const item of initial.items) {
      const original = rows.find(row => row.id === item.id);
      assert.equal(item.note, original.note); assert.equal(item.content, original.content); assert.equal(item.project_id, original.project_id);
    }
    scenario.initialExport = { pages: initial.pages, maxResponseBytes: initial.maxResponseBytes, contentAndAnnotationsVerified: true };
    await checkpoint('initial-library');

    const first = await rt.call(access, 'detail', { id: initial.items[0].id });
    scenario.reservationRollback = await expectRollback(rt, access, 'job.begin', { job: {
      id: 'over-capacity-job', kind: 'retrieval', status: 'QUEUED', selected_ids: [first.id],
      selected_revisions: { [first.id]: first.revision }, reserved_bytes: 5_000_000,
    } }, ['LOGICAL_LIMIT']);
    await checkpoint('after-rejected-reservation');

    const selected = initial.items.slice(0, Math.min(100, accepted));
    for (const [stage, noteLength] of [['grow', 2400], ['shrink', 100], ['regrow', 900]]) {
      let changed = 0, rejection = null;
      for (const item of selected) {
        const current = await rt.call(access, 'detail', { id: item.id });
        const result = await rt.invoke(access, 'item', request({ id: item.id, expected_revision: current.revision, note: text(`${stage}-${item.id}`, noteLength, profile === 'unicode') }));
        if (!result.ok) { assert.ok(['LOGICAL_LIMIT', 'STORAGE_PRESSURE'].includes(result.code)); rejection = result.code; break; }
        changed++;
      }
      scenario.changes.push({ stage, attempted: selected.length, changed, rejection });
      await checkpoint(`after-${stage}`);
    }
    const beforeDeletion = await exported(rt, access);
    const deleteRows = beforeDeletion.items.slice(0, Math.min(100, accepted));
    for (const item of deleteRows) {
      const current = await rt.call(access, 'detail', { id: item.id });
      await rt.call(access, 'delete', request({ id: item.id, expected_revision: current.revision }));
    }
    scenario.deletedItems = deleteRows.length; await checkpoint('after-item-deletion');
    let offset = 0, restoreSequence = 0; single = false;
    scenario.reinsertion = { attemptedItems: deleteRows.length, insertedItems: 0, rejections: [] };
    while (offset < deleteRows.length) {
      const batch = single ? deleteRows.slice(offset, offset + 1) : chunk(deleteRows.slice(offset));
      const before = await rt.call(access, 'state');
      const result = await rt.invoke(access, 'restore', request({ import_id: 'reinsert', sequence: restoreSequence, rows: batch }));
      if (result.ok) { offset += batch.length; restoreSequence++; scenario.reinsertion.insertedItems = offset; continue; }
      assert.ok(['LOGICAL_LIMIT', 'STORAGE_PRESSURE', 'ITEM_LIMIT'].includes(result.code), JSON.stringify(result));
      const after = await rt.call(access, 'state');
      assert.equal(after.revision, before.revision); assert.equal(after.usage.logicalBytes, before.usage.logicalBytes); assert.equal(after.usage.items, before.usage.items);
      scenario.reinsertion.rejections.push({ items: batch.length, code: result.code, insertedBefore: offset, revisionAndUsageUnchanged: true });
      if (single) break; single = true;
    }
    await checkpoint('after-reinsertion');
    // Restore the complete pre-deletion backup, even if reinsertion into the
    // churned original was capacity-limited. Never drop unaccepted rows silently.
    const backup = beforeDeletion; await rt.provision(recovered);
    offset = 0; restoreSequence = 0;
    scenario.recovery = { attemptedItems: backup.items.length, restoredItems: 0, complete: false, rejections: [] };
    single = false;
    while (offset < backup.items.length) {
      const batch = single ? backup.items.slice(offset, offset + 1) : chunk(backup.items.slice(offset));
      const before = await rt.call(recovered, 'state');
      const result = await rt.invoke(recovered, 'restore', request({ import_id: 'recover', sequence: restoreSequence, rows: batch, ...(restoreSequence === 0 ? { workspace: backup.workspace } : {}) }));
      if (result.ok) { offset += batch.length; restoreSequence++; scenario.recovery.restoredItems = offset; continue; }
      assert.ok(['LOGICAL_LIMIT', 'STORAGE_PRESSURE', 'ITEM_LIMIT'].includes(result.code), JSON.stringify(result));
      const after = await rt.call(recovered, 'state');
      assert.equal(after.revision, before.revision); assert.equal(after.usage.logicalBytes, before.usage.logicalBytes); assert.equal(after.usage.items, before.usage.items);
      scenario.recovery.rejections.push({ items: batch.length, code: result.code, restoredBefore: offset, revisionAndUsageUnchanged: true });
      if (single) break; single = true;
    }
    const recoveredBackup = await exported(rt, recovered);
    assert.deepEqual(recoveredBackup.items, backup.items.slice(0, offset));
    assert.deepEqual(recoveredBackup.workspace.projects, backup.workspace.projects);
    assert.equal(recoveredBackup.workspace.goals, backup.workspace.goals);
    Object.assign(scenario.recovery, { complete: offset === backup.items.length, acceptedSourceAndAnnotationsEqual: true, groupsAndGoalsEqual: true, sourceExportSHA256: hash(JSON.stringify(backup.items)) });
    await checkpoint('after-restore-into-new-workspace');
    await rt.close(access); await rt.close(recovered);
    scenario.purged = [];
    for (const owner of [access, recovered]) {
      const snapshot = await rt.call(owner, 'test.snapshot');
      assert.deepEqual(snapshot.tables, []); assert.equal(snapshot.kvKeys, 0); assert.equal(snapshot.alarm, null);
      scenario.purged.push({ uid: owner.uid, ...snapshot });
    }
    await rt.dispose();
    scenario.closedAllocation = await allocation(directory);
    assert.equal(scenario.closedAllocation.workspaces.length, 0, 'Workspace schemas are purged, not retained as closed tombstones');
    rt = await runtime(directory);
    for (const [index, owner] of [access, recovered].entries()) {
      for (let attempt = 0; attempt < 3; attempt++) {
        assert.equal((await rt.invoke(owner, 'state')).code, 'NOT_FOUND');
        assert.equal((await rt.invoke(owner, 'provision')).code, 'PROVISIONING_DENIED');
        await rt.call(owner, 'test.alarm');
        const snapshot = await rt.call(owner, 'test.snapshot');
        assert.deepEqual({ uid: owner.uid, ...snapshot }, scenario.purged[index]);
      }
    }
    await rt.dispose();
    scenario.postPurgeReadsAllocation = await allocation(directory);
    assert.equal(scenario.postPurgeReadsAllocation.workspaces.length, 0);
    assert.equal(scenario.postPurgeReadsAllocation.persistenceBytes, scenario.closedAllocation.persistenceBytes);
    assert.deepEqual(scenario.postPurgeReadsAllocation.nonWorkspaceDatabases.map(row => JSON.stringify(row)).sort(),
      scenario.closedAllocation.nonWorkspaceDatabases.map(row => JSON.stringify(row)).sort());
    scenario.lateRequestsRecreatedStorage = false;
    scenario.complete = true; await saveReport();
    console.log(`${profile} target=${target}: accepted=${accepted}, initial logical=${scenario.snapshots[0].usage.logicalBytes}, used=${scenario.snapshots[0].usage.sqliteUsedBytes}; recovered=${scenario.recovery.restoredItems}/${scenario.recovery.attemptedItems}`);
  } finally { await rt.dispose(); await rm(directory, { recursive: true, force: true }); }
}

// A small actual-schema control forces used-page rollback independently of the
// default logical limit; accepted data must survive its restart and export.
{
  const directory = await mkdtemp(join(tmpdir(), 'save2ship-final-pressure-'));
  const access = accessFor('used-pressure'); let rt = await runtime(directory, { WORKSPACE_USED_LIMIT: 100_000 });
  try {
    await rt.provision(access);
    const result = await rt.call(access, 'capture', request({ url: fixture(9999, 'typical').url, title: 'Quota control', content: 'Small synthetic source' }));
    const before = await exported(rt, access);
    report.usedPageRollback = await expectRollback(rt, access, 'item', { id: result.id, expected_revision: result.revision, note: '知'.repeat(19_000) }, ['STORAGE_PRESSURE']);
    await rt.dispose(); report.usedPageRollback.disk = await allocation(directory);
    rt = await runtime(directory, { WORKSPACE_USED_LIMIT: 100_000 });
    assert.deepEqual(stable(await exported(rt, access)), stable(before));
    report.usedPageRollback.restartExportUnchanged = true;
  } finally { await rt.dispose(); await rm(directory, { recursive: true, force: true }); }
}
report.elapsedMs = performance.now() - started;
report.localRoundTrips = Object.fromEntries(timings);
report.complete = true; await saveReport();
console.log(`Final-schema report: .local/workspace-capacity-report.json (${Math.round(report.elapsedMs)} ms). No deployed capacity claim.`);
