import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, Log, LogLevel } from 'miniflare';

const SECRET = 'synthetic-local-operator-secret-only-0123456789';
const EXPIRES = new Date(Date.now() + 60 * 60 * 1000).toISOString();
const OBJECT_NAME = 'save2ship-p1-single-run-v1';
const PLAN = ['seed-1', 'seed-2', 'read', 'edit', 'reject', 'delete', 'fts', 'fts-read'];

async function probe({ persist, secret = SECRET, expires = EXPIRES, includeFTS = true, namespace = true } = {}) {
  const mf = new Miniflare({
    workers: [{ config: {
      name: 'save2ship-probe-test', compatibilityDate: '2026-07-30',
      manifest: { mainModule: 'probe.js', modules: {
        'probe.js': { type: 'esm', contents: await readFile('.local/build/probe/index.js', 'utf8') },
      } },
      exports: { ProbeSession: { type: 'durable-object', storage: 'sqlite' } },
      env: {
        PROBE_SECRET: { type: 'text', value: secret },
        PROBE_EXPIRES_AT: { type: 'text', value: expires },
        PROBE_INCLUDE_FTS: { type: 'text', value: String(includeFTS) },
        ...(namespace ? { PROBE_SESSION: { type: 'durable-object', worker: 'save2ship-probe-test', exportName: 'ProbeSession' } } : {}),
      },
    } }],
    host: '127.0.0.1', port: 0, resourcePersistencePath: persist, unsafeInspectDurableObjects: true,
    telemetry: { enabled: false }, enableDevRegistry: false,
    log: new Log(LogLevel.ERROR), cf: false,
  });
  return {
    mf,
    async request(path = '/probe/report', { method = 'GET', token = SECRET, headers = {}, ...options } = {}) {
      const res = await mf.dispatchFetch(`https://probe.invalid${path}`, {
        method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...options,
      });
      return { status: res.status, body: await res.json() };
    },
    step(step) { return this.request(`/probe/step/${step}`, { method: 'POST' }); },
    cleanup() { return this.request('/probe/cleanup', { method: 'POST' }); },
    storage() { return mf.unsafeGetDurableObjectStorage('save2ship-probe-test', 'ProbeSession', { name: OBJECT_NAME }); },
    dispose() { return mf.dispose(); },
  };
}

test('probe rejects unauthorized, payload, selector and expired requests before any namespace access', async t => {
  // No binding exists in this worker. Reaching DO lookup would fail, proving
  // these responses happen before allocation rather than only inside a DO.
  const rt = await probe({ namespace: false }); t.after(() => rt.dispose());
  for (const token of [null, 'wrong', 'x'.repeat(600)]) {
    assert.equal((await rt.request('/probe/report', { token })).status, 401);
  }
  assert.equal((await rt.request('/probe/step/seed-1', { method: 'POST', body: 'x'.repeat(300_000) })).status, 413);
  assert.equal((await rt.request('/probe/step/seed-1?owner=other', { method: 'POST' })).status, 400);
  assert.equal((await rt.request('/probe/report', { headers: { Origin: 'https://untrusted.invalid' } })).status, 400);
  assert.equal((await rt.request('/probe/step/arbitrary', { method: 'POST' })).status, 404);
  assert.equal((await rt.request('/probe/verify/17', { method: 'POST' })).status, 404);
  assert.equal((await rt.request('/probe/cleanup', { method: 'DELETE' })).status, 404);
  const expired = await probe({ namespace: false, expires: '1970-01-01T00:00:00Z' });
  t.after(() => expired.dispose());
  assert.equal((await expired.request()).status, 410);
  const farFuture = await probe({ namespace: false, expires: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() });
  t.after(() => farFuture.dispose());
  assert.equal((await farFuture.request()).status, 503);
  const weak = await probe({ namespace: false, secret: 'short' }); t.after(() => weak.dispose());
  assert.equal((await weak.request('/probe/report', { token: 'short' })).status, 401);
});

test('fixed probe performs at most 50 saves, preserves rollback, caches results across restart and never recreates cleanup data', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-remote-probe-'));
  let rt = await probe({ persist });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  assert.equal((await rt.step('seed-2')).status, 409);
  const simultaneous = await Promise.all([rt.step('seed-1'), rt.step('seed-1')]);
  assert.equal(simultaneous.filter(result => result.status === 200 && result.body.replay === false).length, 1);
  assert.ok(simultaneous.every(result => result.status === 409 || result.status === 200));
  assert.equal((await (await rt.storage()).exec('SELECT count(*) AS count FROM items'))[0].count, 25);
  for (const step of PLAN.slice(1)) {
    const result = await rt.step(step);
    assert.equal(result.status, 200, `${step}: ${JSON.stringify(result.body)}`);
    assert.equal(result.body.replay, false);
    assert.ok(result.body.result.after.items <= 50);
    if (step === 'seed-2') assert.equal(result.body.result.after.items, 50);
    if (step === 'reject') {
      assert.equal(result.body.result.result.code, 'PHYSICAL_LIMIT');
      assert.equal(result.body.result.result.exportUnchanged, true);
    }
  }
  const report = await rt.request();
  assert.equal(report.status, 200);
  assert.equal(report.body.results.length, PLAN.length);
  assert.equal(report.body.nextStep, null);
  assert.equal(report.body.results.at(-1).result.after.items, 49);
  assert.doesNotMatch(JSON.stringify(report.body), /linkedin\.com|Synthetic author|term0r0v0/);
  await rt.dispose();
  rt = await probe({ persist, includeFTS: false });
  const changedConfiguration = await rt.request();
  assert.equal(changedConfiguration.status, 409);
  assert.equal(changedConfiguration.body.error, 'PROBE_CONFIGURATION_CHANGED');
  await rt.dispose();
  rt = await probe({ persist });
  const replay = await rt.step('seed-1');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replay, true);
  assert.deepEqual(replay.body.result, report.body.results[0].result);
  const storage = await rt.storage();
  assert.equal((await storage.exec('SELECT count(*) AS count FROM items'))[0].count, 49);
  const closed = await rt.cleanup();
  assert.equal(closed.status, 200);
  assert.equal(closed.body.closed, true);
  await rt.dispose();
  rt = await probe({ persist });
  assert.equal((await rt.step('seed-1')).status, 410);
  assert.equal((await rt.request()).status, 410);
  assert.equal((await rt.cleanup()).body.replay, true);
  const cleaned = await rt.storage();
  assert.equal((await cleaned.exec("SELECT name FROM sqlite_master WHERE name IN ('items','content','search')")).length, 0);
  assert.equal((await cleaned.exec('SELECT count(*) AS count FROM probe_results'))[0].count, 0);
  assert.equal((await cleaned.exec('SELECT status FROM probe_control'))[0].status, 'CLOSED');
});

test('durable attempt claims stop unknown retries and concurrent cleanup wins over late work', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-probe-uncertain-'));
  let rt = await probe({ persist, includeFTS: false });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  assert.equal((await rt.step('seed-1')).status, 200);
  const storage = await rt.storage();
  // This supported local-only test handle simulates a crash after the durable
  // preclaim. No fault-injection or arbitrary-SQL route ships in the Worker.
  await storage.exec("UPDATE probe_control SET inflight = 'seed-2'");
  await rt.dispose();
  rt = await probe({ persist, includeFTS: false });
  const uncertain = await rt.step('seed-2');
  assert.equal(uncertain.status, 409);
  assert.equal(uncertain.body.error, 'PROBE_ATTEMPT_UNCERTAIN');
  assert.equal((await rt.request()).body.inflight, 'seed-2');
  assert.equal((await (await rt.storage()).exec('SELECT count(*) AS count FROM items'))[0].count, 25);
  assert.equal((await rt.cleanup()).status, 200);

  const race = await probe(); t.after(() => race.dispose());
  assert.equal((await race.step('seed-1')).status, 200);
  const replies = await Promise.all([race.step('seed-2'), race.cleanup()]);
  assert.equal(replies[1].status, 200);
  assert.ok([200, 409, 410].includes(replies[0].status));
  assert.equal((await race.step('seed-2')).status, 410);
  assert.equal((await (await race.storage()).exec("SELECT name FROM sqlite_master WHERE name = 'items'")).length, 0);
});

test('verification samples are fixed and single-use, admitted calls are capped, and cleanup works after expiry', async t => {
  const persist = await mkdtemp(join(tmpdir(), 'save2ship-probe-budget-'));
  let rt = await probe({ persist, includeFTS: false });
  t.after(async () => { await rt.dispose(); await rm(persist, { recursive: true, force: true }); });
  assert.equal((await rt.request('/probe/verify/2', { method: 'POST' })).status, 409);
  for (let sample = 1; sample <= 16; sample++) {
    const result = await rt.request(`/probe/verify/${sample}`, { method: 'POST' });
    assert.equal(result.status, 200);
    assert.equal(result.body.verified, true);
  }
  await rt.dispose();
  rt = await probe({ persist, includeFTS: false });
  const repeated = await rt.request('/probe/verify/1', { method: 'POST' });
  assert.equal(repeated.status, 409);
  assert.equal(repeated.body.error, 'VERIFICATION_ALREADY_CLAIMED');
  let report = await rt.request();
  assert.equal(report.body.verificationClaims, 16);
  while (report.body.admittedRequests < report.body.maxAdmittedRequests) report = await rt.request();
  assert.equal((await rt.request()).status, 429);
  assert.equal((await rt.step('seed-1')).status, 429);
  await rt.dispose();
  rt = await probe({ persist, includeFTS: false, expires: '1970-01-01T00:00:00Z' });
  assert.equal((await rt.request()).status, 410);
  const cleaned = await rt.cleanup();
  assert.equal(cleaned.status, 200);
  assert.equal(cleaned.body.closed, true);
});
