import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fixture, limits, runtime } from './helpers.mjs';

test('SQLite transactions enforce logical, count and used-page limits without changing exported data', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-p1-'));
  let rt = await runtime({ persist });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  const name = 'atomic-quotas';
  const first = fixture(0);
  assert.equal((await rt.call(name, 'write', { saves: [first] })).result.ok, true);
  await rt.call(name, 'search-enable');
  const before = (await rt.call(name, 'export')).result;
  const usage = (await rt.call(name, 'stats')).result;
  assert.equal(usage.logicalBytes, Buffer.byteLength(JSON.stringify(first)));

  const count = (await rt.call(name, 'write', { saves: [fixture(1)], limits: { ...limits, items: 1 } })).result;
  assert.equal(count.code, 'ITEM_LIMIT');
  assert.equal(count.attempted.rowsWritten, 0);
  const unicode = { ...first, note: '🚀'.repeat(100) };
  const logical = (await rt.call(name, 'write', {
    saves: [unicode], limits: { ...limits, logicalBytes: usage.logicalBytes + 1 },
  })).result;
  assert.equal(logical.code, 'LOGICAL_LIMIT');
  assert.equal(logical.attempted.rowsWritten, 0);

  // A valid early write in the same transaction must be undone when a later
  // write grows used SQLite pages beyond its test budget. Logical bytes fit.
  const physical = (await rt.call(name, 'write', {
    saves: [{ ...first, note: 'first write in transaction' }, { ...fixture(1), content: 'uniqueterm '.repeat(30_000) }],
    limits: { ...limits, physicalBytes: usage.sqliteUsedBytes + 4096 },
  })).result;
  assert.equal(physical.code, 'PHYSICAL_LIMIT');
  assert.ok(physical.peakSqliteUsedBytes > usage.sqliteUsedBytes + 4096);
  assert.ok(physical.attempted.rowsWritten > 0, 'rejected writes still consume work');
  assert.deepEqual((await rt.call(name, 'export')).result, before);
  assert.equal((await rt.call(name, 'search', { term: 'uniqueterm' })).result.rows.length, 0);
  assert.equal((await rt.call(name, 'stats')).result.logicalBytes, usage.logicalBytes);
  assert.ok(physical.usage.sqliteUsedBytes <= usage.sqliteUsedBytes + 4096);
  for (let attempt = 0; attempt < 3; attempt++) {
    const failed = (await rt.call(name, 'write', {
      saves: [{ ...fixture(1), content: 'uniqueterm '.repeat(30_000) }],
      limits: { ...limits, physicalBytes: usage.sqliteUsedBytes + 4096 },
    })).result;
    assert.equal(failed.code, 'PHYSICAL_LIMIT');
    assert.ok(failed.usage.sqliteUsedBytes <= usage.sqliteUsedBytes + 4096);
  }
  await rt.dispose();
  rt = await runtime({ persist });
  assert.deepEqual((await rt.call(name, 'export')).result, before, 'rollback survives a workerd restart');
  assert.ok((await rt.call(name, 'stats')).result.sqliteUsedBytes <= usage.sqliteUsedBytes + 4096);
  assert.equal((await rt.call(name, 'search', { term: 'uniqueterm' })).result.rows.length, 0);
});

test('FTS, indexed pages, revisions, deletion, migration and separate objects remain consistent', async t => {
  const rt = await runtime(); t.after(() => rt.dispose());
  const name = 'search-edits';
  await rt.call(name, 'search-enable');
  const saves = Array.from({ length: 90 }, (_, n) => fixture(n));
  assert.equal((await rt.call(name, 'write', { saves })).result.ok, true);
  const list = (await rt.call(name, 'list', { kind: 'learning', limit: 10 })).result;
  assert.equal(list.rows.length, 10);
  assert.ok(list.rowsRead <= 11, 'page read should be bounded by the index');
  assert.match(JSON.stringify(list.plan), /items_library/);
  assert.equal((await rt.call(name, 'search', { term: 'unique0rev0' })).result.rows[0].id, saves[0].id);
  assert.ok((await rt.call(name, 'search', { term: '"distributed systems"' })).result.rows.length > 0);
  const edited = fixture(0, 'typical', 1);
  assert.equal((await rt.call(name, 'write', { saves: [edited] })).result.ok, true);
  assert.equal((await rt.call(name, 'search', { term: 'unique0rev0' })).result.rows.length, 0);
  assert.equal((await rt.call(name, 'search', { term: 'unique0rev1' })).result.rows.length, 1);
  await rt.call(name, 'delete', { ids: [edited.id, edited.id] });
  assert.equal((await rt.call(name, 'search', { term: 'unique0rev1' })).result.rows.length, 0);
  const after = (await rt.call(name, 'export')).result;
  assert.equal(after.length, 89);
  assert.equal((await rt.call(name, 'stats')).result.logicalBytes,
    after.reduce((sum, item) => sum + Buffer.byteLength(JSON.stringify(item)), 0));
  await rt.call(name, 'migrate');
  await rt.call(name, 'migrate');
  assert.deepEqual((await rt.call(name, 'export')).result, after);
  assert.deepEqual((await rt.call('separate-object', 'export')).result, []);
});

test('concurrent requests cannot race the final item allocation', async t => {
  const rt = await runtime(); t.after(() => rt.dispose());
  const replies = await Promise.all([0, 1].map(index => rt.call('last-item', 'write', {
    saves: [fixture(index)], limits: { ...limits, items: 1 },
  })));
  assert.equal(replies.filter(reply => reply.result.ok).length, 1);
  assert.equal((await rt.call('last-item', 'export')).result.length, 1);
});

test('schema rollback recovers after the pinned workerd FTS error and preserves deletion and migration atomicity', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-schema-'));
  let rt = await runtime({ persist });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  const name = 'schema-rollback';
  const saves = Array.from({ length: 20 }, (_, n) => fixture(n, 'varied'));
  assert.equal((await rt.call(name, 'write', { saves })).result.ok, true);
  const before = (await rt.call(name, 'export')).result;
  const baseline = (await rt.call(name, 'stats')).result;
  const noGrowth = { ...limits, physicalBytes: baseline.sqliteUsedBytes };
  // The pinned runtime reports an internal error when a populated FTS schema
  // creation is rolled back. Do not hide that limitation behind a success code.
  await assert.rejects(rt.call(name, 'search-enable', { limits: noGrowth }), /internal error/);
  await rt.dispose();
  rt = await runtime({ persist });
  assert.equal((await rt.call(name, 'stats')).result.search, false);
  assert.equal((await rt.call(name, 'stats')).result.logicalBytes, baseline.logicalBytes);
  assert.deepEqual((await rt.call(name, 'export')).result, before);
  assert.equal((await rt.call(name, 'migrate', { limits: noGrowth })).result.code, 'PHYSICAL_LIMIT');
  assert.equal((await rt.call(name, 'stats')).result.sqliteUsedBytes, baseline.sqliteUsedBytes);
  await rt.call(name, 'search-enable');
  const installed = (await rt.call(name, 'stats')).result;
  // A deliberately constrained internal test budget forces the deletion check.
  // This is not a claim that production should lower limits under existing data.
  const rejected = (await rt.call(name, 'delete', {
    ids: [saves[0].id], limits: { ...limits, physicalBytes: 1 },
  })).result;
  assert.equal(rejected.code, 'PHYSICAL_LIMIT');
  assert.ok(rejected.attempted.rowsWritten > 0);
  assert.equal(rejected.usage.sqliteUsedBytes, installed.sqliteUsedBytes);
  assert.deepEqual((await rt.call(name, 'export')).result, before);
  assert.equal((await rt.call(name, 'search', { term: 'term0r0v0' })).result.rows.length, 1);
  assert.equal((await rt.call(name, 'delete', { ids: [saves[0].id] })).result.ok, true);
  await rt.call(name, 'migrate');
  const migrated = (await rt.call(name, 'stats')).result;
  await rt.call(name, 'migrate');
  assert.equal((await rt.call(name, 'stats')).result.sqliteUsedBytes, migrated.sqliteUsedBytes);
});
