import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('shipping bundle serves static assets and keeps every data and probe route closed', async t => {
  process.env.WRANGLER_SEND_METRICS = 'false';
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  const { createTestHarness } = await import('wrangler');
  const isolatedRoot = await mkdtemp(join(tmpdir(), 'save2ship-public-'));
  const config = JSON.parse(await readFile('wrangler.jsonc', 'utf8'));
  config.main = resolve('.local/build/src/index.js');
  config.assets.directory = resolve('public');
  const server = createTestHarness({ root: isolatedRoot, workers: [{ config }] });
  t.after(async () => { await server.close(); await rm(isolatedRoot, { recursive: true, force: true }); });
  await server.listen();
  const page = await server.fetch('http://localhost/');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /hosted beta is being prepared/);
  const health = await server.fetch('http://localhost/health');
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'prototype', dataApi: 'closed' });
  for (const method of ['GET', 'POST', 'DELETE']) {
    for (const path of ['/api', '/api/workspaces?owner=someone-else', '/api/export', '/api/probe']) {
      const response = await server.fetch(`http://localhost${path}`, { method });
      assert.equal(response.status, 503, `${method} ${path}`);
      assert.deepEqual(await response.json(), { error: 'HOSTED_NOT_READY' });
    }
  }
  for (const path of ['/test', '/probe', '/reset', '/fixtures']) {
    assert.notEqual((await server.fetch(`http://localhost${path}`, { method: 'POST', body: '{"operation":"write"}' })).status, 200);
  }
  assert.equal((await server.fetch('http://localhost/does-not-exist')).status, 404);
});
