import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appRuntime } from './app-helpers.mjs';
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const write = (rt, member, path, data) => rt.request(path, { ...member, data: { request_id: randomUUID(), ...data } });
const url = n => `https://www.linkedin.com/feed/update/urn:li:activity:90000000000000000${n}`;

test('preferences remain private and validated; retrieval uses only explicitly selected owned sources', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member(), bob = await rt.member('synthetic-bob');
  ok(await write(rt, alice, '/api/preferences', { weekly_hours: 2.5 }));
  assert.equal(ok(await rt.request('/api/state', alice)).weekly_hours, 2.5);
  assert.equal(ok(await rt.request('/api/state', bob)).weekly_hours, 6);
  for (const value of [0, 169, true, '2']) assert.equal((await write(rt, alice, '/api/preferences', { weekly_hours: value })).status, 400);
  assert.equal((await write(rt, alice, '/api/preferences', { weekly_hours: 1, openai_key: 'unexpected' })).status, 400);
  const items = [];
  for (const n of [1, 2, 3]) items.push(ok(await write(rt, alice, '/api/capture', { url: url(n) })));
  ok(await write(rt, alice, '/api/settings', { apify_token: 'synthetic-key' }));
  ok(await write(rt, bob, '/api/settings', { apify_token: 'synthetic-key' }));
  assert.equal((await write(rt, bob, '/api/retrieve/start', { ids: [items[1].id], limit: 1, max_charge: .1 })).status, 404);
  assert.equal((await write(rt, alice, '/api/retrieve/start', { ids: [items[1].id, items[1].id], limit: 2, max_charge: .1 })).status, 400);
  assert.equal((await write(rt, alice, '/api/retrieve/start', { ids: [], limit: 1, max_charge: .1 })).status, 400);
  ok(await write(rt, alice, '/api/retrieve/start', { ids: [items[2].id, items[0].id], limit: 2, max_charge: .1 }));
  const job = await rt.request('/__fixture__/workspace', { data: { access: { uid: alice.membership.uid, generation: alice.membership.generation }, operation: 'job.get' } });
  assert.equal(job.body.ok, true); assert.deepEqual(job.body.data.selected_ids, [items[2].id, items[0].id]);
  assert.equal(ok(await rt.request('/__fixture__/provider')).starts, 0, 'selection alone does not submit external work');
});

test('AI organization uses ordinary bounded batches without a subscription or monthly credit allowance', async t => {
  const rt = await appRuntime(); t.after(() => rt.dispose());
  const alice = await rt.member();
  const config = ok(await rt.request('/api/config'));
  assert.equal(config.edition, 'free-beta');
  assert.equal('billing_recovery' in config, false);
  assert.equal('entitlements' in ok(await rt.request('/api/state', alice)), false);
  for (const path of ['/api/billing/checkout', '/api/billing/sync', '/api/billing/cancel', '/api/billing/webhook', '/api/admin/billing/reconcile'])
    assert.equal((await rt.request(path, { ...alice, data: {} })).status, 404, path);
  assert.deepEqual(ok(await rt.request('/__fixture__/provider')), { mode: 'success', starts: 0, polls: 0, aborts: 0, classifications: 0 });
  ok(await write(rt, alice, '/api/settings', { openai_key: 'synthetic-key' }));
  for (let n = 1; n <= 21; n++) ok(await write(rt, alice, '/api/capture', { url: `https://www.linkedin.com/posts/synthetic-beta-${n}`, content: 'Learn SQLite with a reproducible experiment.' }));
  assert.equal(ok(await write(rt, alice, '/api/classify-ai', {})).selected_count, 20);
  assert.equal(ok(await write(rt, alice, '/api/jobs/poll', {})).applied_count, 20);
  assert.equal(ok(await write(rt, alice, '/api/classify-ai', {})).selected_count, 1);
  assert.equal(ok(await write(rt, alice, '/api/jobs/poll', {})).applied_count, 1);
  assert.equal((await write(rt, alice, '/api/classify-ai', {})).body.code, 'NOTHING_TO_PROCESS');
  assert.equal(ok(await rt.request('/__fixture__/provider')).classifications, 2);
  assert.equal(ok(await rt.request('/api/items', alice)).items.length, 21);
});
