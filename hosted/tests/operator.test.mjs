import test from 'node:test';
import assert from 'node:assert/strict';
import { readOAuthToken, readOnlyClient, boundedJson, MAX_RESPONSE_BYTES } from '../scripts/cloud-readonly.mjs';
import { metricQueries, capture } from '../scripts/cloud-metrics.mjs';
import { prepare, operationPath, callProbe, withOperatorLock, WORKER_NAME } from '../scripts/probe-operator.mjs';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('operator auth captures OAuth without leaking child stdout or stderr', async () => {
  const secret = 'synthetic-sensitive-value';
  assert.equal(await readOAuthToken(async (_cmd, args, options) => {
    assert.deepEqual(args.slice(-3), ['auth', 'token', '--json']);
    assert.equal(options.env.WRANGLER_WRITE_LOGS, 'false');
    assert.equal(options.env.CLOUDFLARE_API_TOKEN, undefined);
    return { stdout: JSON.stringify({ type: 'oauth', token: secret }), stderr: '' };
  }), secret);
  for (const run of [
    async () => { throw Object.assign(new Error(secret), { stdout: secret, stderr: secret }); },
    async () => ({ stdout: secret }),
    async () => ({ stdout: JSON.stringify({ type: 'api-token', token: secret }) }),
  ]) await assert.rejects(readOAuthToken(run), error => !String(error).includes(secret));
});

test('read-only operator requests cannot redirect credentials or mutate resources', async () => {
  let calls = 0;
  const request = readOnlyClient('synthetic-token', async (url, options) => {
    calls++;
    assert.match(url, /^https:\/\/api\.cloudflare\.com\/client\/v4\//);
    assert.equal(options.redirect, 'error');
    return Response.json({ success: true, result: [] });
  });
  for (const path of ['https://untrusted.invalid/', '/client/v4/accounts/abc', '/client/v4/accounts/' + 'a'.repeat(32) + '/workers/scripts/probe']) {
    await assert.rejects(request(path), /Unsupported/);
  }
  await assert.rejects(request('/client/v4/graphql', { query: 'mutation { erase }' }), /Unsupported/);
  assert.equal(calls, 0);
  await request('/client/v4/accounts/' + 'a'.repeat(32) + '/entitlements');
  await request('/client/v4/graphql', { query: 'query { __typename }' });
  assert.equal(calls, 2);
});

test('operator responses are bounded and API error text is not exposed', async () => {
  await assert.rejects(boundedJson(new Response('x'.repeat(MAX_RESPONSE_BYTES + 1))), /exceeded/);
  const request = readOnlyClient('synthetic-token', async () => Response.json({
    success: false, errors: [{ code: 9109, message: 'synthetic-sensitive-value' }],
  }, { status: 403 }));
  await assert.rejects(request('/client/v4/accounts/' + 'a'.repeat(32) + '/entitlements'), error =>
    /HTTP 403; codes: 9109/.test(error.message) && !error.message.includes('synthetic-sensitive-value'));
});

test('metric collection bounds its time window and never converts missing data into zero usage', async () => {
  const account = 'a'.repeat(32), since = '2026-11-07T10:00:00Z', until = '2026-11-07T11:00:00Z';
  assert.throws(() => metricQueries(account, until, since), /window/);
  assert.throws(() => metricQueries(account, since, '2026-11-09T10:00:00Z'), /24 hours/);
  const queries = metricQueries(account, since, until);
  assert.equal(queries.length, 4);
  assert.ok(queries.every(([, query]) => query.query.includes('limit: 2000') && query.variables.account === account));
  const report = await capture(account, since, until, async () => ({ data: { viewer: { accounts: [] } } }));
  assert.ok(Object.values(report.datasets).every(dataset => dataset.available === false && !('samples' in dataset)));
  assert.equal(report.units.duration, 'GB-seconds');
  assert.equal(report.units.cpuTime, 'microseconds');
});

test('probe preparation is local, private and cannot overwrite an earlier run', async t => {
  const deployment = JSON.parse(await readFile(new URL('../wrangler.probe.jsonc', import.meta.url), 'utf8'));
  assert.equal(deployment.name, WORKER_NAME, 'operator origin must address the Worker deployed by the reviewed config');
  const root = await mkdtemp(join(tmpdir(), 'save2ship-operator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'run');
  await prepare('a'.repeat(32), false, directory);
  const content = await readFile(join(directory, 'secrets.json'), 'utf8');
  assert.match(JSON.parse(content).PROBE_SECRET, /^[A-Za-z0-9_-]{43}$/);
  if (process.platform !== 'win32') assert.equal((await stat(join(directory, 'secrets.json'))).mode & 0o777, 0o600);
  await assert.rejects(prepare('a'.repeat(32), true, directory), { code: 'EEXIST' });
  assert.equal(await readFile(join(directory, 'secrets.json'), 'utf8'), content);
  await withOperatorLock(directory, async () => {
    await assert.rejects(withOperatorLock(directory, () => assert.fail('Concurrent operator must not start')), { code: 'EEXIST' });
  });
  await withOperatorLock(directory, async () => {});
});

test('probe client constrains destinations and operations and never retries uncertain responses', async () => {
  const secret = 'x'.repeat(43);
  const plan = { workerName: WORKER_NAME, origin: `https://${WORKER_NAME}.synthetic.workers.dev` };
  assert.throws(() => operationPath('reset'), /Unknown/);
  assert.throws(() => operationPath('verify-17'), /Unknown/);
  let calls = 0;
  const fail = async () => { calls++; throw new Error(secret); };
  await assert.rejects(callProbe({ ...plan, origin: 'https://untrusted.invalid' }, secret, 'report', fail));
  assert.equal(calls, 0);
  await assert.rejects(callProbe(plan, secret, 'seed-1', fail), error => /uncertain/.test(error.message) && !error.message.includes(secret));
  assert.equal(calls, 1);
  await assert.rejects(callProbe(plan, secret, 'report', async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(options.body, undefined);
    return Response.json({ reflected: secret });
  }), /suppressed/);
});
