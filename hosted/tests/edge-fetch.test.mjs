import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { SignJWT } from 'jose';
import { Miniflare, Log, LogLevel } from 'miniflare';

test('real Worker fetch accepts auth/provider options and never follows credential redirects', async t => {
  const requests = [];
  const server = createServer((request, response) => {
    requests.push(request.url);
    if (request.url === '/redirect') { response.writeHead(302, { Location: '/must-not-follow' }); response.end(); return; }
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(request.url === '/account' ? { users: [{ localId: 'synthetic-user', validSince: '100' }] } : {}));
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const mf = new Miniflare({ workers: [{ config: {
    name: 'edge-fetch-check', compatibilityDate: '2026-07-30',
    manifest: { mainModule: 'worker.js', modules: { 'worker.js': { type: 'esm', contents: await readFile('.local/build/tests/edge-fetch-harness.js', 'utf8') } } },
    env: { TEST_HTTP_ORIGIN: { type: 'text', value: origin } },
  } }], host: '127.0.0.1', port: 0, telemetry: { enabled: false }, enableDevRegistry: false, log: new Log(LogLevel.ERROR), cf: false });
  t.after(() => mf.dispose());
  const token = await new SignJWT({ sub: 'synthetic-user', auth_time: 100 }).setProtectedHeader({ alg: 'HS256', kid: 'fixture' }).sign(new Uint8Array(32));
  const rsaLike = `${Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'fixture' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: 'synthetic-user', aud: 'synthetic-project', iss: 'https://securetoken.google.com/synthetic-project', iat: 1, auth_time: 1, exp: 9_999_999_999 })).toString('base64url')}.AA`;
  const call = async (operation, value = token) => (await mf.dispatchFetch('http://localhost/', { method: 'POST', body: JSON.stringify({ operation, token: value }) })).json();
  assert.equal((await call('certificates', rsaLike)).error, 'No identity keys');
  assert.deepEqual(await call('account'), { ok: true });
  assert.deepEqual(await call('ok'), { ok: true });
  const redirect = await call('redirect');
  assert.equal(redirect.uncertain, true, 'A redirected submission remains uncertain');
  assert.deepEqual(requests, ['/certificates', '/account', '/ok', '/redirect']);
});
