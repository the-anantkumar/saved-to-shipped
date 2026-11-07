import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fixture, insertLibrary, limits, runtime } from '../helpers.mjs';

async function filesUnder(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

// Called only after workerd has closed its isolated synthetic persistence root.
async function inspectAllocation(directory) {
  const files = await filesUnder(directory);
  const databases = [];
  for (const path of files.filter(file => file.endsWith('.sqlite'))) {
    const database = new DatabaseSync(path, { readOnly: true });
    try {
      if (!database.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='items'").get()) continue;
      const pageCount = database.prepare('PRAGMA page_count').get().page_count;
      const freePages = database.prepare('PRAGMA freelist_count').get().freelist_count;
      const pageSize = database.prepare('PRAGMA page_size').get().page_size;
      databases.push({
        pageCount, freePages, pageSize,
        usedBytes: (pageCount - freePages) * pageSize,
        allocatedBytes: pageCount * pageSize,
        fileBytes: (await stat(path)).size,
        walBytes: files.includes(`${path}-wal`) ? (await stat(`${path}-wal`)).size : 0,
        shmBytes: files.includes(`${path}-shm`) ? (await stat(`${path}-shm`)).size : 0,
      });
    } finally { database.close(); }
  }
  assert.equal(databases.length, 1, 'each isolated experiment has exactly one workspace database');
  return databases[0];
}

export async function measureAllocation() {
  const results = [];
  for (const indexed of [false, true]) {
    const directory = await mkdtemp(join(tmpdir(), 'save2ship-allocation-'));
    let rt = await runtime({ persist: directory });
    const name = 'allocation';
    const result = { indexed, snapshots: [] };
    async function checkpoint(stage) {
      const usage = (await rt.call(name, 'stats')).result;
      await rt.dispose();
      const allocation = await inspectAllocation(directory);
      assert.equal(allocation.usedBytes, usage.sqliteUsedBytes);
      result.snapshots.push({ stage, usage, allocation });
      rt = await runtime({ persist: directory });
    }
    try {
      result.capabilities = (await rt.call(name, 'allocation-capabilities')).result;
      assert.ok((await insertLibrary(rt, name, 1000, 'varied')).every(batch => batch.result.ok));
      if (indexed) assert.equal((await rt.call(name, 'search-enable')).result.ok, true);
      await checkpoint('initial');
      const initialExport = (await rt.call(name, 'export')).result;
      const initialStats = (await rt.call(name, 'stats')).result;
      result.rejectedWrite = (await rt.call(name, 'write', {
        saves: [{ ...fixture(0, 'varied'), content: 'rollback '.repeat(20_000) }],
        limits: { ...limits, logicalBytes: 10_000_000, physicalBytes: initialStats.sqliteUsedBytes },
      })).result;
      assert.equal(result.rejectedWrite.code, 'PHYSICAL_LIMIT');
      assert.deepEqual((await rt.call(name, 'export')).result, initialExport);
      await checkpoint('after-rejected-write');
      result.deletion = (await rt.call(name, 'delete', {
        ids: Array.from({ length: 100 }, (_, n) => fixture(n).id),
      })).result;
      assert.equal(result.deletion.ok, true);
      await checkpoint('after-delete');
      if (!indexed) {
        // Provisional no-FTS alternative: repeated updates stay below a 7 MB
        // used-page ceiling. Allocation is still measured independently.
        for (let revision = 1; revision <= 5; revision++) {
          for (let start = 100; start < 1000; start += 25) {
            const saves = Array.from({ length: 25 }, (_, n) => fixture(start + n, 'varied', revision));
            assert.equal((await rt.call(name, 'write', {
              saves, limits: { ...limits, physicalBytes: 7_000_000 },
            })).result.ok, true);
          }
        }
        await checkpoint('after-4500-edits-without-fts');
      }
      results.push(result);
    } finally {
      await rt.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  }
  return {
    boundary: 'Quiescent local SQLite files after workerd disposal. Remote billed storage, transient WAL growth and platform metadata are not measured.',
    results,
  };
}
