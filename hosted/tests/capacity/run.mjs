import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { fixture, insertLibrary, limits, runtime } from '../helpers.mjs';
import { measureAllocation } from './allocation.mjs';

const rt = await runtime();
const report = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch },
  boundary: 'Local Miniflare/workerd only. Round trips are elapsed time, not deployed Worker CPU or billable object duration.',
  storageMetric: 'sqliteUsedBytes is sql.databaseSize: used pages excluding freelist pages. The prototype physicalBytes input limits only this metric. Offline allocation is measured separately, not enforced by this prototype.',
  limits, scenarios: [],
};
// Snapshots include the diagnostic stats reads around each operation. This is a
// conservative local instrument, not Cloudflare's account-wide billing ledger.
async function measure(name, operation, input = {}) {
  const before = (await rt.call(name, 'stats')).result;
  let result;
  let error;
  const started = performance.now();
  try {
    result = (await rt.call(name, operation, input)).result;
    if (result.ok === false) error = result.code;
  }
  catch (caught) {
    if (!String(caught).includes('PHYSICAL_LIMIT')) throw caught;
    error = 'PHYSICAL_LIMIT';
  }
  const roundTripMs = performance.now() - started;
  const after = (await rt.call(name, 'stats')).result;
  return { result, error, before, after, cost: {
    rowsRead: after.rowsRead - before.rowsRead,
    rowsWritten: after.rowsWritten - before.rowsWritten,
    sqliteUsedDeltaBytes: after.sqliteUsedBytes - before.sqliteUsedBytes,
    roundTripMs,
  } };
}
try {
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  report.environment.packages = Object.fromEntries(['wrangler', 'miniflare', 'workerd', 'jose'].map(name => [name, lock.packages[`node_modules/${name}`]?.version]));
  for (const [count, profile] of [[500, 'typical'], [1000, 'typical'], [1000, 'richer'], [1000, 'varied']]) {
    const name = `capacity-${profile}-${count}`;
    const initial = (await rt.call(name, 'stats')).result;
    const operationalSeed = await measure(name, 'operations');
    const batches = await insertLibrary(rt, name, count, profile);
    assert.ok(batches.every(batch => batch.result.ok), `${name}: base library did not fit`);
    const withoutSearch = (await rt.call(name, 'stats')).result;
    const searchBuild = await measure(name, 'search-enable');
    const searchAvailable = !searchBuild.error;
    const withSearch = (await rt.call(name, 'stats')).result;
    const scenario = {
      count, profile, initial, withoutSearch, withSearch, searchAvailable,
      operationalSeed: operationalSeed.cost, searchBuild: { ...searchBuild.cost, error: searchBuild.error ?? null },
      insertion: {
        batches: batches.length,
        rowsRead: batches.reduce((sum, batch) => sum + batch.result.attempted.rowsRead, 0),
        rowsWritten: batches.reduce((sum, batch) => sum + batch.result.attempted.rowsWritten, 0),
        roundTripMs: batches.reduce((sum, batch) => sum + batch.roundTripMs, 0),
        maxBatchRowsWritten: Math.max(...batches.map(batch => batch.result.attempted.rowsWritten)),
      },
    };
    const page = (await rt.call(name, 'list', { kind: 'learning', limit: 25 })).result;
    assert.equal(page.rows.length, 25);
    assert.ok(page.rowsRead <= 26);
    scenario.page = { rowsRead: page.rowsRead, plan: page.plan };
    if (searchAvailable) {
      scenario.search = (await rt.call(name, 'search', { term: 'learning', limit: 25 })).result;
      scenario.search = { resultCount: scenario.search.rows.length, rowsRead: scenario.search.rowsRead, rowsWritten: scenario.search.rowsWritten };
    }
    const exported = (await rt.call(name, 'export')).result;
    scenario.edits = [];
    for (let revision = 1; revision <= 3; revision++) {
      const measured = await measure(name, 'write', { saves: Array.from({ length: 100 }, (_, n) => fixture(n, profile, revision)) });
      const update = measured.result;
      scenario.edits.push({ ...measured.cost, accepted: update.ok, code: update.code });
      if (!update.ok) { scenario.editRejected = update; break; }
    }
    scenario.afterEdits = (await rt.call(name, 'stats')).result;
    const deletion = await measure(name, 'delete', { ids: exported.slice(0, 100).map(save => save.id) });
    scenario.deletion = { ...deletion.cost, accepted: deletion.result.ok, code: deletion.result.code,
      peakSqliteUsedBytes: deletion.result.peakSqliteUsedBytes };
    scenario.afterDeletion = (await rt.call(name, 'stats')).result;
    const reinsertion = await measure(name, 'write', { saves: exported.slice(0, 100) });
    const reinsert = reinsertion.result;
    scenario.reinsertion = { ...reinsertion.cost, accepted: reinsert.ok, code: reinsert.code };
    if (!reinsert.ok) scenario.reinsertRejected = reinsert;
    scenario.afterReinsert = (await rt.call(name, 'stats')).result;
    const migration = await measure(name, 'migrate');
    scenario.migration = { ...migration.cost, error: migration.error ?? null };
    scenario.afterMigration = migration.after;
    report.scenarios.push(scenario);
  }

  report.incrementalSearch = [];
  for (const profile of ['typical', 'richer', 'varied', 'long-notes']) {
    const name = `incremental-${profile}`;
    const initial = (await rt.call(name, 'stats')).result;
    const searchBuild = await measure(name, 'search-enable');
    const operationalSeed = await measure(name, 'operations');
    const batches = await insertLibrary(rt, name, 1000, profile);
    report.incrementalSearch.push({
      profile, initial, searchBuild: searchBuild.cost, operationalSeed: operationalSeed.cost,
      attemptedItems: batches.length * 100,
      acceptedItems: (await rt.call(name, 'stats')).result.items,
      usage: (await rt.call(name, 'stats')).result,
      rowsRead: batches.reduce((sum, batch) => sum + batch.result.attempted.rowsRead, 0),
      rowsWritten: batches.reduce((sum, batch) => sum + batch.result.attempted.rowsWritten, 0),
      maxBatchRowsWritten: Math.max(...batches.map(batch => batch.result.attempted.rowsWritten)),
      roundTripMs: batches.reduce((sum, batch) => sum + batch.roundTripMs, 0),
      rejection: batches.find(batch => !batch.result.ok)?.result ?? null,
    });
  }

  // A separate long-note control shows how the logical budget limits counts
  // even when full-text indexing is not the limiting resource.
  const longNotesName = 'long-notes-without-search';
  const longNotesBatches = await insertLibrary(rt, longNotesName, 1000, 'long-notes');
  const longNotesRejected = longNotesBatches.find(batch => !batch.result.ok)?.result;
  assert.equal(longNotesRejected?.code, 'LOGICAL_LIMIT');
  report.longNotes = {
    noteUtf8Bytes: 20_000, usage: (await rt.call(longNotesName, 'stats')).result,
    attemptedItems: longNotesBatches.length * 100, rejection: longNotesRejected,
  };
  const unicodeName = 'maximum-unicode-notes';
  const unicodeBatches = await insertLibrary(rt, unicodeName, 1000, 'unicode-notes', undefined, 10);
  const unicodeRejected = unicodeBatches.find(batch => !batch.result.ok)?.result;
  assert.equal(unicodeRejected?.code, 'LOGICAL_LIMIT');
  report.unicodeNotes = {
    noteCodePoints: 20_000, noteUtf16Units: 40_000, noteUtf8Bytes: 80_000,
    batchSize: 10, usage: (await rt.call(unicodeName, 'stats')).result,
    attemptedItems: unicodeBatches.length * 10, rejection: unicodeRejected,
    note: 'The Python local note limit counts Unicode code points; this fixture fills that cap with four-byte characters.',
  };

  // Used-page rejection with a deliberately small test budget demonstrates
  // atomic rollback without needing to consume the platform's whole allowance.
  const name = 'rollback';
  await rt.call(name, 'search-enable');
  await rt.call(name, 'write', { saves: [fixture(0)] });
  const before = (await rt.call(name, 'export')).result;
  const beforeStats = (await rt.call(name, 'stats')).result;
  const rejection = (await rt.call(name, 'write', {
    saves: [{ ...fixture(0), note: 'First write is also rolled back.' }, { ...fixture(1, 'varied'), content: 'costly '.repeat(100_000) }],
    limits: { ...limits, physicalBytes: beforeStats.sqliteUsedBytes + 4096 },
  })).result;
  assert.equal(rejection.code, 'PHYSICAL_LIMIT');
  const after = (await rt.call(name, 'export')).result;
  assert.deepEqual(after, before);
  report.rollback = { ...rejection, exportUnchanged: true, afterStats: (await rt.call(name, 'stats')).result };
  report.allocation = await measureAllocation();

  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'synthetic';
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ sub: 'synthetic-member', auth_time: now - 30, firebase: { sign_in_provider: 'google.com' } })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic' }).setIssuer('https://securetoken.google.com/synthetic-project')
    .setAudience('synthetic-project').setIssuedAt(now).setExpirationTime(now + 3600).sign(privateKey);
  const timings = [];
  for (let n = 0; n < 51; n++) {
    const started = performance.now();
    await rt.call('', 'verify', { token, publicKey: jwk, project: 'synthetic-project' });
    timings.push(performance.now() - started);
  }
  const warm = timings.slice(1).sort((a, b) => a - b);
  report.tokenVerification = {
    samples: warm.length, coldRoundTripMs: timings[0], medianWarmRoundTripMs: warm[Math.floor(warm.length / 2)],
    p95WarmRoundTripMs: warm[Math.ceil(warm.length * 0.95) - 1],
    note: 'Synthetic RS256 key cached in test isolate. Includes local HTTP overhead. Remote CPU, Google key fetch/cache rotation and revocation are not measured.',
  };
  await mkdir('.local', { recursive: true });
  await writeFile('.local/capacity-report.json', `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { await rt.dispose(); }
