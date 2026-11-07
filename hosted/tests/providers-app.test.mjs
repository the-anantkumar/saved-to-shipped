import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/providers/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
const api = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { createApify, ProviderFailure, postKey, recordKeys, eligible, retrievalCandidates, missingCandidates,
  classificationBatch, classify, validateClassification } = api;
const token = 'synthetic-provider-secret';
const url = id => `https://www.linkedin.com/feed/update/urn:li:activity:${id}`;
const item = (id, fields = {}) => ({ id: `save-${id}`, platform: 'linkedin', url: url(id), title: '', content: '', note: '', kind: 'untriaged', status: 'inbox', ...fields });
const run = { id: 'synthetic-run', status: 'RUNNING', defaultDatasetId: 'synthetic-dataset' };
const provenance = { runId: run.id, retrievedAt: '2026-11-07T00:00:00.000Z' };
const valid = id => ({ id, kind: 'project', title: 'Quote API', why: 'A useful small tool', next_action: 'Write one quote endpoint',
  definition_of_done: 'One API check stores and retrieves a quote', project_name: 'Personal tools', commit_message: 'feat: store quotes',
  repo_suggestion: '', confidence: 'medium', effort_hours: 1, tags: ['api'], impact: 3, relevance: 4, novelty: 3 });
const completion = records => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ items: records }) }] }] });

test('Apify submission has explicit charge and discovery bounds, deduplicates sources and uses no retry', async () => {
  const calls = [];
  const provider = createApify(async (address, options) => { calls.push({ address, options }); return Response.json({ data: run }); });
  assert.deepEqual(await provider.start({ urls: [url(123), url(123), url(456)], maxChargeUsd: 0.5 }, token), {
    id: run.id, status: 'RUNNING', datasetId: run.defaultDatasetId,
  });
  assert.equal(calls.length, 1);
  const request = calls[0]; const address = new URL(request.address); const body = JSON.parse(request.options.body);
  assert.equal(address.origin, 'https://api.apify.com');
  assert.equal(address.pathname, '/v2/actors/data_minds~linkedin-post-scraper/runs');
  assert.equal(address.searchParams.get('maxTotalChargeUsd'), '0.5');
  assert.equal(address.searchParams.get('maxItems'), '2');
  assert.equal(address.searchParams.get('restartOnError'), 'false');
  assert.equal(body.discoverMorePosts, false); assert.equal(body.includeProfileActivity, false); assert.equal(body.saveMedia, false);
  assert.equal(body.numComments, 0); assert.equal(body.numLikes, 0); assert.equal(body.limitPerSource, 1);
  assert.equal(request.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(request.options.redirect, 'error'); assert.ok(request.options.signal instanceof AbortSignal);
  assert.ok(!request.address.includes(token)); assert.ok(!JSON.stringify(body).includes('cookie'));
});

test('invalid retrieval input and references do not contact a provider', async () => {
  let calls = 0; const provider = createApify(async () => { calls++; throw new Error('unexpected'); });
  for (const input of [{ urls: [], maxChargeUsd: 1 }, { urls: [url(1)], maxChargeUsd: NaN }, { urls: [url(1)], maxChargeUsd: 21 },
    { urls: Array.from({ length: 26 }, (_, n) => url(n)), maxChargeUsd: 1 }, { urls: ['https://evil.example/activity:1'], maxChargeUsd: 1 },
    { urls: ['https://user:password@linkedin.com/posts/a'], maxChargeUsd: 1 }]) await assert.rejects(provider.start(input, token), ProviderFailure);
  await assert.rejects(provider.start({ urls: [url(1)], maxChargeUsd: 1 }, ''), /personal provider key/);
  await assert.rejects(provider.poll('bad/run', token), /reference/);
  await assert.rejects(provider.abort('run?token=secret', token), /reference/);
  await assert.rejects(provider.page('dataset', 1, token), /position/);
  assert.equal(calls, 0);
});

test('submission failures are redacted and retain uncertainty without automatic resubmission', async () => {
  const failures = [
    () => { throw new Error(token); },
    () => new Response(token, { status: 500 }),
    () => new Response('{invalid-json'),
    () => Response.json({ data: { id: '../secret', status: 'RUNNING' } }),
    () => Response.json({ data: { ...run, status: 'UNKNOWN' } }),
    () => new Response('x'.repeat(65_537)),
  ];
  for (const fail of failures) {
    let calls = 0; const provider = createApify(async () => { calls++; return fail(); });
    await assert.rejects(provider.start({ urls: [url(1)], maxChargeUsd: 1 }, token), error => error.uncertain === true && !error.message.includes(token));
    assert.equal(calls, 1);
  }
  const denied = createApify(async () => new Response(token, { status: 401 }));
  await assert.rejects(denied.start({ urls: [url(1)], maxChargeUsd: 1 }, token), error => error.uncertain === false && !error.message.includes(token));
  const readFailure = createApify(async () => { throw new Error(token); });
  await assert.rejects(readFailure.poll(run.id, token), error => error.uncertain === false && !error.message.includes(token));
  const wrongRun = createApify(async () => Response.json({ data: { ...run, id: 'different-run' } }));
  await assert.rejects(wrongRun.poll(run.id, token), /different run reference/);
  await assert.rejects(wrongRun.abort(run.id, token), /different run reference/);
});

test('dataset pagination keeps unfiltered offsets, includes empty rows and bounds each response', async () => {
  const requests = [];
  const provider = createApify(async (address) => {
    requests.push(new URL(address));
    return Response.json(requests.length === 1 ? Array.from({ length: 25 }, () => ({})) : [{ url: url(1), text: 'last' }]);
  });
  const first = await provider.page(run.defaultDatasetId, 0, token);
  assert.equal(first.records.length, 25); assert.equal(first.nextOffset, 25);
  const next = await provider.page(run.defaultDatasetId, first.nextOffset, token);
  assert.equal(next.nextOffset, null);
  assert.equal(requests[0].searchParams.get('clean'), 'false');
  assert.equal(requests[0].searchParams.get('skipEmpty'), 'false');
  assert.equal(requests[1].searchParams.get('offset'), '25');
  const over = createApify(async () => Response.json(Array.from({ length: 26 }, () => ({}))));
  await assert.rejects(over.page('dataset', 0, token), /unexpected dataset/);
  const sentinel = createApify(async () => Response.json([{ text: 'too many' }]));
  await assert.rejects(sentinel.page('dataset', 5000, token), /supported size/);
  const done = createApify(async () => Response.json([]));
  assert.equal((await done.page('dataset', 5000, token)).nextOffset, null);
});

test('LinkedIn source keys and eligibility do not authorize foreign or ambiguous records', () => {
  assert.equal(postKey(url(123)), postKey('https://www.linkedin.com/posts/example_activity-123-test'));
  assert.equal(postKey('urn:li:activity:123'), 'activity:123');
  assert.equal(postKey('123'), 'activity:123');
  assert.equal(postKey(true), ''); assert.equal(postKey('https://evil.example/activity:123'), '');
  assert.equal(postKey('https://linkedin.com.evil.example/activity:123'), '');
  assert.equal(postKey('https://user@linkedin.com/posts/activity:123'), '');
  assert.notEqual(postKey('https://linkedin.com/pulse/another?fake=activity:123'), 'activity:123');
  assert.notEqual(postKey('https://linkedin.com/posts/another#activity:123'), 'activity:123');
  assert.deepEqual([...recordKeys({ _source: { inputUrl: url(123) } })], ['activity:123']);
  assert.equal(eligible(item(123)), true);
  assert.equal(eligible(item(123, { content: 'User source' })), false);
  assert.equal(eligible(item(123, { status: 'done' })), false);
  assert.equal(eligible(item(123, { enrichment: { status: 'gated' } })), false);
  assert.equal(eligible(item(123, { enrichment: { status: 'gated' } }), true), true);
  assert.deepEqual(retrievalCandidates([{ url: url(123), activityId: '456', text: 'Ambiguous' }], [item(123), item(456)], provenance), []);
});

test('result matching preserves provenance, chooses useful rows, and does not prematurely mark missing', () => {
  const targets = [item(123, { note: 'Keep my note' }), item(456), { ...item(789), url: 'https://m.linkedin.com/posts/name_activity-123-example' }];
  const candidates = retrievalCandidates([
    { url: url(123), _status: 'gated' },
    { url: url(123), text: 'Build a useful API.', author: { name: 'Synthetic author' }, links: ['javascript:alert(1)', 'https://example.org/guide?utm_source=a'] },
    { url: url(999), text: 'Unrelated' },
  ], targets, provenance);
  assert.deepEqual(candidates.map(c => c.id).sort(), ['save-123', 'save-789']);
  assert.equal(candidates[0].patch.content, 'Build a useful API.');
  assert.equal(candidates[0].patch.enrichment.status, 'extracted');
  assert.equal(candidates[0].patch.enrichment.run_id, run.id);
  assert.deepEqual(candidates[0].patch.enrichment.links, ['https://example.org/guide']);
  assert.ok(!Object.hasOwn(candidates[0].patch, 'note')); assert.equal(targets[0].note, 'Keep my note');
  const final = missingCandidates(targets, candidates.map(c => c.id), provenance);
  assert.deepEqual(final.map(c => c.id), ['save-456']); assert.equal(final[0].patch.enrichment.status, 'missing');
});

test('coverage and codepoint truncation remain explicit; login walls never become source text', () => {
  const rows = [
    { url: url(1), text: 'Sign in to LinkedIn to continue' },
    { url: url(2), text: 'Read the guide', media: { document: { title: 'Guide' } } },
    { url: url(3), text: 'A guide', media: { document: { transcript: 'Synthetic transcript' } } },
    { url: url(4), text: '🚀'.repeat(20_001) },
  ];
  const found = retrievalCandidates(rows, [1, 2, 3, 4].map(n => item(n)), provenance);
  assert.equal(found[0].patch.enrichment.status, 'gated'); assert.equal(found[0].patch.content, undefined);
  assert.equal(found[1].patch.enrichment.status, 'partial');
  assert.equal(found[2].patch.enrichment.coverage, 'post text and supplied document transcript');
  assert.equal(found[2].quality, 5); assert.match(found[2].patch.content, /Synthetic transcript/);
  assert.equal(found[3].patch.enrichment.content_truncated, true); assert.equal([...found[3].patch.content].length, 20_000);
  const links = retrievalCandidates([{ url: url(1), text: 'Text', links: Array.from({ length: 30 }, (_, n) => `https://example.org/${n}/${'x'.repeat(3900)}`) }], [item(1)], provenance)[0];
  assert.equal(links.patch.enrichment.links_truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(links)) < 200_000);
});

test('classification chooses context-backed bounded batches and sends exact fields without URLs', async () => {
  const selected = item(1, { title: 'Useful topic', content: 'Build a quote API', note: 'Use a local database', enrichment: { coverage: 'post text only', status: 'partial', content_truncated: true } });
  assert.deepEqual(classificationBatch([item(0, { title: 'Title only' }), selected]).map(i => i.id), [selected.id]);
  assert.equal(classificationBatch([1, 2, 3].map(n => item(n, { content: 'x'.repeat(40_000) }))).length, 2);
  let calls = 0;
  const result = await classify({ items: [selected], goals: 'Learn APIs', existingProjects: ['Personal tools'] }, token, 'chosen-model', async (address, options) => {
    calls++;
    assert.equal(address, 'https://api.openai.com/v1/responses');
    assert.equal(options.redirect, 'error');
    const body = JSON.parse(options.body), input = JSON.parse(body.input);
    assert.equal(body.model, 'chosen-model'); assert.equal(body.store, false); assert.equal(body.max_output_tokens, 12000);
    assert.equal(body.text.format.strict, true); assert.equal(body.text.format.type, 'json_schema');
    assert.ok(!body.input.includes(selected.url)); assert.ok(!body.input.includes(token));
    assert.equal(input.items[0].content_truncated, true); assert.equal(input.items[0].content_status, 'partial');
    assert.deepEqual(input.existing_projects, ['Personal tools']);
    return Response.json(completion([valid(selected.id)]));
  });
  assert.equal(calls, 1); assert.deepEqual(result, [valid(selected.id)]);
});

test('classification validates whole result batches and treats charged unusable responses as uncertain', async () => {
  const selected = item(1, { content: 'Learn an API' });
  for (const rows of [[], [valid('invented')], [valid(selected.id), valid(selected.id)], [{ ...valid(selected.id), tags: 'api' }],
    [{ ...valid(selected.id), effort_hours: Infinity }], [{ ...valid(selected.id), next_action: '' }],
    [{ ...valid(selected.id), impact: 8 }], [{ ...valid(selected.id), commit_message: 'feat: one\u2014two' }],
    [{ ...valid(selected.id), extra: token }]]) {
    assert.throws(() => validateClassification({ items: rows }, [selected.id]), error => error.uncertain && !error.message.includes(token));
  }
  for (const response of [{ status: 'incomplete', output: [] }, { status: 'completed', output: [{ type: 'message', content: [{ type: 'refusal', refusal: token }] }] },
    { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: token }] }] }]) {
    let calls = 0;
    await assert.rejects(classify({ items: [selected] }, token, 'chosen-model', async () => { calls++; return Response.json(response); }), error => error.uncertain && !error.message.includes(token));
    assert.equal(calls, 1);
  }
  const large = Array.from({ length: 10 }, (_, n) => ({ ...valid(`save-${n}`), why: '🚀'.repeat(2000), next_action: '🚀'.repeat(2000), definition_of_done: '🚀'.repeat(2000) }));
  assert.throws(() => validateClassification({ items: large }, large.map(row => row.id)), error => error.uncertain === true);
});

test('classification input limits count Unicode code points and block oversized input before fetch', async () => {
  const selected = item(1, { content: 'Build a quote API' });
  for (const [name, limit, makeInput, suppliedValue] of [
    ['goals', 2000, value => ({ items: [selected], goals: value }), input => input.goals],
    ['title', 300, value => ({ items: [{ ...selected, title: value }] }), input => input.items[0].title],
    ['section', 100, value => ({ items: [selected], existingProjects: [value] }), input => input.existing_projects[0]],
  ]) {
    let calls = 0;
    const atLimit = '🚀'.repeat(limit);
    const fetcher = async (_address, options) => {
      calls++;
      assert.equal(suppliedValue(JSON.parse(JSON.parse(options.body).input)), atLimit, name);
      return Response.json(completion([valid(selected.id)]));
    };
    await classify(makeInput(atLimit), token, 'chosen-model', fetcher);
    assert.equal(calls, 1, `${name}: code-point limit must reach the mocked provider`);
    await assert.rejects(classify(makeInput(`${atLimit}🚀`), token, 'chosen-model', fetcher),
      error => error.code === 'INVALID_CLASSIFICATION_INPUT' && error.uncertain === false);
    assert.equal(calls, 1, `${name}: one extra code point must not make another provider request`);
  }
});

test('classification preflight and credential absence never start paid work', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw new Error('unexpected'); };
  for (const values of [[], [item(1)], [item(1, { content: 'x'.repeat(100_001) })], [item(1, { content: 'x' }), item(1, { content: 'x' })]])
    await assert.rejects(classify({ items: values }, token, 'chosen-model', fetcher), error => error.uncertain === false);
  await assert.rejects(classify({ items: [item(1, { content: 'context' })] }, '', 'chosen-model', fetcher), error => error.uncertain === false);
  assert.equal(calls, 0);
});
