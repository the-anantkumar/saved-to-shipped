// Run from hosted/: npm run capacity:fts-commit
// Reproduce the known P1 quota gap, not an accepted production invariant.
// The altered cap exists only in memory; no deployment or source mutation occurs.
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { Miniflare, Log, LogLevel } from 'miniflare';

const secret = 'synthetic-review-operator-secret-0123456789';
const runs = [];
for (const cap of [1_000_000, 360_000]) {
  const built = await build({
    entryPoints: ['probe/index.ts'], bundle: true, write: false,
    format: 'esm', platform: 'browser', target: 'es2023', external: ['cloudflare:workers'],
    plugins: [{ name: 'synthetic-commit-size-cap', setup(builder) {
      builder.onLoad({ filter: /probe\/contract\.ts$/ }, async args => {
        const original = await readFile(args.path, 'utf8');
        assert.ok(original.includes('physicalBytes: 1_000_000'));
        return { loader: 'ts', contents: original.replace('physicalBytes: 1_000_000', `physicalBytes: ${cap}`) };
      });
    } }],
  });
  const mf = new Miniflare({
    workers: [{ config: {
      name: 'probe-review', compatibilityDate: '2026-07-30',
      manifest: { mainModule: 'probe.js', modules: {
        'probe.js': { type: 'esm', contents: built.outputFiles[0].text },
      } },
      exports: { ProbeSession: { type: 'durable-object', storage: 'sqlite' } },
      env: {
        PROBE_SECRET: { type: 'text', value: secret },
        PROBE_EXPIRES_AT: { type: 'text', value: new Date(Date.now() + 3_600_000).toISOString() },
        PROBE_INCLUDE_FTS: { type: 'text', value: 'true' },
        PROBE_SESSION: { type: 'durable-object', worker: 'probe-review', exportName: 'ProbeSession' },
      },
    } }],
    host: '127.0.0.1', port: 0, telemetry: { enabled: false }, enableDevRegistry: false,
    log: new Log(LogLevel.ERROR), cf: false,
  });
  async function call(path, method = 'POST') {
    const result = await mf.dispatchFetch(`https://probe.invalid${path}`, {
      method, headers: { Authorization: `Bearer ${secret}` },
    });
    return { status: result.status, body: await result.json() };
  }
  try {
    const measures = [];
    for (const step of ['seed-1', 'seed-2', 'read', 'edit', 'reject', 'delete', 'fts']) {
      const result = await call(`/probe/step/${step}`);
      assert.equal(result.status, 200, `${step}: ${JSON.stringify(result.body)}`);
      const committed = await call('/probe/report', 'GET');
      assert.equal(committed.status, 200);
      measures.push({
        step, status: result.status,
        usedBefore: result.body.result.before.sqliteUsedBytes,
        usedBeforeCommit: result.body.sqliteUsedBytesAfterLedger,
        usedNextRequest: committed.body.sqliteUsedBytes,
        logical: result.body.result.after.logicalBytes,
      });
    }
    const fts = measures.at(-1);
    assert.ok(fts.usedNextRequest > fts.usedBeforeCommit);
    if (cap === 360_000) {
      assert.ok(fts.usedBeforeCommit <= cap);
      assert.ok(fts.usedNextRequest > cap);
    }
    runs.push({ cap, measures });
  } finally { await mf.dispose(); }
}
console.log(JSON.stringify({ node: process.version, platform: process.platform, arch: process.arch, runs }, null, 2));
