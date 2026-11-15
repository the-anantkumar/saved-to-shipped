import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { appRuntime } from './app-helpers.mjs';
const ok = response => { assert.equal(response.status, 200, JSON.stringify(response.body)); return response.body; };
const write = (rt, member, path, data) => rt.request(path, { ...member, data: { request_id: randomUUID(), ...data } });
const url = n => `https://www.linkedin.com/feed/update/urn:li:activity:90000000000000000${n}`;

test('preferences remain private and validated; retrieval uses only explicitly selected owned sources', async t => {
  const rt = await appRuntime({ variables: { ENTITLEMENTS_ENABLED: 'true' } }); t.after(() => rt.dispose());
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

test('AI batches fit the remaining allowance and a zero balance rejects before provider submission', async t => {
  const rt = await appRuntime({ variables: { ENTITLEMENTS_ENABLED: 'true' } }); t.after(() => rt.dispose());
  const alice = await rt.member();
  ok(await write(rt, alice, '/api/settings', { openai_key: 'synthetic-key' }));
  for (let n = 1; n <= 21; n++) ok(await write(rt, alice, '/api/capture', { url: `https://www.linkedin.com/posts/synthetic-credit-${n}`, content: 'Learn SQLite with a reproducible experiment.' }));
  ok(await write(rt, alice, '/api/classify-ai', { limit: 1 }));
  ok(await write(rt, alice, '/api/jobs/poll', {}));
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.points.remaining, 19);
  const second = ok(await write(rt, alice, '/api/classify-ai', {})); assert.equal(second.selected_count, 19);
  ok(await write(rt, alice, '/api/jobs/poll', {}));
  assert.equal(ok(await rt.request('/api/state', alice)).entitlements.points.remaining, 0);
  assert.equal((await write(rt, alice, '/api/classify-ai', {})).body.code, 'AI_POINTS_LIMIT');
  assert.equal(ok(await rt.request('/__fixture__/provider')).classifications, 2);
});
