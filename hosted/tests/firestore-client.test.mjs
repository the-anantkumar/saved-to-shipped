import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportPKCS8, jwtVerify } from 'jose';
import { FirestoreClient, isFirestoreConflict, isFirestoreCommitUncertain } from '../.local/build/src/firestore/client.js';

const env = { FIREBASE_PROJECT_ID: 'demo-save2ship', FIRESTORE_DATABASE_ID: 'save2ship', FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085' };
const prefix = 'projects/demo-save2ship/databases/save2ship/documents';
const time = '2026-11-07T12:00:00.000001Z';
function doc(path, fields = {}) { return { name: `${prefix}/${path}`, fields, updateTime: time }; }
function successfulCommit(body) { return Response.json({ commitTime: time, writeResults: body.writes.map(write => write.update ? { updateTime: time } : {}) }); }

test('Firestore client encodes typed records and uses atomic updateTime and exists preconditions', async () => {
  let wire, calls = 0;
  const client = new FirestoreClient(env, async (url, options) => {
    calls++; assert.equal(options.redirect, 'manual'); assert.equal(options.headers.Authorization, 'Bearer owner');
    if (options.method === 'POST') {
      assert.equal(url, `http://127.0.0.1:8085/v1/${prefix}:commit`);
      wire = JSON.parse(options.body); return successfulCommit(wire);
    }
    return Response.json({ ...wire.writes[0].update, updateTime: time });
  });
  const data = { uid: 'synthetic-alice', count: 2, progress: 0.4, active: true, missing: null, nested: { list: ['a', 1, { ok: false }] } };
  const response = await client.commit([{ path: 's2sTest/alice', data, currentDocument: { exists: false } },
    { path: 's2sTest/control', verify: true, currentDocument: { updateTime: time } }]);
  assert.equal(response.commitTime, time);
  assert.deepEqual(wire.writes[0].currentDocument, { exists: false });
  assert.deepEqual(wire.writes[1], { verify: `${prefix}/s2sTest/control`, currentDocument: { updateTime: time } });
  assert.deepEqual((await client.read('s2sTest/alice')).data, data);
  assert.equal(calls, 2);
});

test('Firestore client rejects unsafe destinations and paths before sending credentials', async () => {
  let calls = 0; const fetcher = async () => { calls++; throw new Error('should not fetch'); };
  for (const host of ['untrusted.invalid:8085', 'localhost.evil:8085', 'http://localhost:8085', '127.0.0.2:8085', 'localhost:65536', 'localhost:0'])
    assert.throws(() => new FirestoreClient({ ...env, FIRESTORE_EMULATOR_HOST: host }, fetcher));
  assert.throws(() => new FirestoreClient({ ...env, FIRESTORE_SERVICE_ACCOUNT: '{}' }, fetcher));
  const client = new FirestoreClient(env, fetcher);
  for (const path of ['https://evil.invalid/a', '../secret', 's2sTest/../private/alice', 's2sTest//alice', 's2sTest/__secret__', 's2sTest/alice\n', '/s2sTest/alice'])
    await assert.rejects(client.read(path));
  await assert.rejects(client.commit([{ path: 's2sTest/alice', data: {} }, { path: 's2sTest/alice', delete: true }]));
  await assert.rejects(client.commit([{ path: 's2sTest/alice', data: {}, currentDocument: { exists: true, updateTime: time } }]));
  await assert.rejects(client.commit([{ path: 's2sTest/alice', data: { value: NaN } }]));
  await assert.rejects(client.commit([{ path: 's2sTest/alice', data: { value: undefined } }]));
  assert.equal(calls, 0);
});

test('Firestore client constrains pagination and validates returned document ownership', async () => {
  let calls = 0;
  const client = new FirestoreClient(env, async (url, options) => {
    calls++; assert.equal(options.method, 'GET');
    const value = new URL(url);
    assert.equal(value.searchParams.get('pageSize'), '2'); assert.equal(value.searchParams.get('pageToken'), 'continuation+/=');
    assert.equal(value.searchParams.has('orderBy'), false, 'Enterprise Native list uses its supported default order');
    assert.equal(value.searchParams.get('readTime'), time);
    assert.deepEqual(value.searchParams.getAll('mask.fieldPaths'), ['table', 'uid']);
    return Response.json({ documents: [doc('s2sTest/alice')], nextPageToken: 'next' });
  });
  const page = await client.list('s2sTest', { pageSize: 2, pageToken: 'continuation+/=', readTime: time, fieldPaths: ['table', 'uid'] });
  assert.equal(page.nextPageToken, 'next'); assert.equal(page.documents.length, 1);
  await assert.rejects(client.list('s2sTest', { pageSize: 101 }));
  await assert.rejects(client.list('s2sTest', { fieldPaths: ['bad.field'] }));
  assert.equal(calls, 1);
  const foreign = new FirestoreClient(env, async () => Response.json(doc('s2sOther/bob')));
  await assert.rejects(foreign.read('s2sTest/alice'), { code: 'STORAGE_UNAVAILABLE' });
  const foreignPage = new FirestoreClient(env, async () => Response.json({ documents: [doc('s2sOther/bob')] }));
  await assert.rejects(foreignPage.list('s2sTest'), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(await new FirestoreClient(env, async () => new Response('', { status: 404 })).read('s2sTest/missing'), null);
});

test('Firestore client never retries an uncertain commit and suppresses server error content', async () => {
  let calls = 0; const secret = 'synthetic-sensitive-value';
  const client = new FirestoreClient(env, async () => { calls++; throw new Error(secret); });
  await assert.rejects(client.commit([{ path: 's2sTest/alice', data: {} }]), error => isFirestoreCommitUncertain(error) && !String(error).includes(secret));
  assert.equal(calls, 1);
  const conflict = new FirestoreClient(env, async () => Response.json({ error: { status: 'FAILED_PRECONDITION', message: secret } }, { status: 400 }));
  await assert.rejects(conflict.commit([{ path: 's2sTest/alice', data: {}, currentDocument: { exists: false } }]), error => isFirestoreConflict(error) && !String(error).includes(secret));
  const forbidden = new FirestoreClient(env, async () => Response.json({ error: { status: 'PERMISSION_DENIED', message: secret } }, { status: 403 }));
  await assert.rejects(forbidden.read('s2sTest/alice'), error => error.code === 'STORAGE_UNAVAILABLE' && !String(error).includes(secret));
  const malformed = new FirestoreClient(env, async () => Response.json({ unexpected: secret }));
  await assert.rejects(malformed.commit([{ path: 's2sTest/alice', data: {} }]), isFirestoreCommitUncertain);
  let redirects = 0;
  const redirecting = new FirestoreClient(env, async (_url, options) => {
    redirects++; assert.equal(options.redirect, 'manual', 'Cloudflare Workers supports manual, not error');
    return new Response('', { status: 307, headers: { Location: 'https://untrusted.invalid/collect' } });
  });
  await assert.rejects(redirecting.commit([{ path: 's2sTest/alice', data: {} }]), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(redirects, 1, 'a redirect is neither followed nor retried');
});

test('Firestore requests reject operation and byte excess before network access', async () => {
  let calls = 0;
  const client = new FirestoreClient(env, async () => { calls++; return Response.json({}); });
  await assert.rejects(client.commit(Array.from({ length: 501 }, (_, index) => ({ path: `s2sTest/${index}`, data: {} }))));
  await assert.rejects(client.commit([{ path: 's2sTest/large', data: { value: 'x'.repeat(950_000) } }]));
  await assert.rejects(client.commit(Array.from({ length: 10 }, (_, index) => ({ path: `s2sTest/${index}`, data: { value: 'x'.repeat(900_000) } }))));
  assert.equal(calls, 0);
  const excessiveResponse = new FirestoreClient(env, async () => new Response('x'.repeat(16 * 1024 * 1024 + 1)));
  await assert.rejects(excessiveResponse.read('s2sTest/large'), { code: 'STORAGE_UNAVAILABLE' });
});

test('Firestore full hydration pages retain escaped rows within the response byte limit', async () => {
  const collection = `s2sWorkspaces/${'a'.repeat(64)}/records`;
  const escaped = '"\\\n\u0000🙂'.repeat(3200);
  const documents = Array.from({ length: 100 }, (_, index) => {
    const key = `synthetic-${index}`, path = `${collection}/${Buffer.from(`bodies\0${key}`).toString('base64url')}`;
    const data = { table: 'bodies', key, row: JSON.stringify({ _rowid: index + 1, id: key, text: escaped }) };
    return { path, data, wire: doc(path, Object.fromEntries(Object.entries(data).map(([name, value]) => [name, { stringValue: value }]))) };
  });
  const storedBytes = 2048 + documents.reduce((total, entry) => total + Buffer.byteLength(entry.path) + Buffer.byteLength(JSON.stringify(entry.data)) + 256, 0);
  assert.ok(storedBytes > 6_000_000 && storedBytes < 8_000_000, 'exercise a nearly full workspace of escaped row JSON');
  const wire = JSON.stringify({ documents: documents.map(entry => entry.wire) }, null, 2);
  assert.ok(Buffer.byteLength(wire) < 16 * 1024 * 1024);
  const client = new FirestoreClient(env, async url => {
    assert.equal(new URL(url).searchParams.get('pageSize'), '100');
    return new Response(wire, { headers: { 'Content-Type': 'application/json' } });
  });
  const page = await client.list(collection, { pageSize: 100 });
  assert.equal(page.documents.length, 100);
  assert.deepEqual(page.documents.map(entry => entry.data), documents.map(entry => entry.data));
});

test('Firestore service account exchange is scoped, fixed-origin and cached without secret error messages', async () => {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const account = { type: 'service_account', project_id: env.FIREBASE_PROJECT_ID,
    client_email: `save2ship-server@${env.FIREBASE_PROJECT_ID}.iam.gserviceaccount.com`, private_key_id: 'synthetickey',
    private_key: await exportPKCS8(privateKey), token_uri: 'https://oauth2.googleapis.com/token' };
  const productionEnv = { FIREBASE_PROJECT_ID: env.FIREBASE_PROJECT_ID, FIRESTORE_DATABASE_ID: env.FIRESTORE_DATABASE_ID,
    FIRESTORE_SERVICE_ACCOUNT: JSON.stringify(account) };
  let exchanges = 0, requests = 0;
  const client = new FirestoreClient(productionEnv, async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url === account.token_uri) {
      exchanges++;
      const body = new URLSearchParams(options.body);
      assert.equal(body.get('grant_type'), 'urn:ietf:params:oauth:grant-type:jwt-bearer');
      const { payload } = await jwtVerify(body.get('assertion'), publicKey, { issuer: account.client_email, audience: account.token_uri, algorithms: ['RS256'] });
      assert.equal(payload.scope, 'https://www.googleapis.com/auth/datastore');
      assert.ok(payload.exp - payload.iat <= 3600);
      return Response.json({ access_token: 'synthetic-access-token', expires_in: 3600 });
    }
    requests++; assert.equal(options.headers.Authorization, 'Bearer synthetic-access-token');
    assert.match(url, /^https:\/\/firestore\.googleapis\.com\/v1\//);
    return Response.json(doc('s2sTest/alice'));
  });
  await Promise.all([client.read('s2sTest/alice'), client.read('s2sTest/alice')]);
  assert.equal(exchanges, 1); assert.equal(requests, 2);
  assert.throws(() => new FirestoreClient({ ...productionEnv, FIRESTORE_SERVICE_ACCOUNT: JSON.stringify({ ...account, token_uri: 'https://untrusted.invalid' }) }));
  assert.throws(() => new FirestoreClient({ ...productionEnv, FIRESTORE_SERVICE_ACCOUNT: JSON.stringify({ ...account, project_id: 'another-project' }) }));
  const failed = new FirestoreClient(productionEnv, async () => { throw new Error(account.private_key); });
  await assert.rejects(failed.read('s2sTest/alice'), error => error.code === 'STORAGE_UNAVAILABLE' && !String(error).includes('PRIVATE KEY'));
  let redirectCalls = 0;
  const redirected = new FirestoreClient(productionEnv, async (_url, options) => {
    redirectCalls++; assert.equal(options.redirect, 'manual');
    return new Response('', { status: 307, headers: { Location: 'https://untrusted.invalid/oauth' } });
  });
  await assert.rejects(redirected.read('s2sTest/alice'), { code: 'STORAGE_UNAVAILABLE' });
  assert.equal(redirectCalls, 1);
});

test('Firestore maintenance query stays scoped and bounded', async () => {
  let query;
  const client = new FirestoreClient(env, async (url, options) => {
    assert.equal(url, `http://127.0.0.1:8085/v1/${prefix}:runQuery`);
    query = JSON.parse(options.body).structuredQuery;
    return Response.json([{ document: doc('s2sGrants/one', { day: { stringValue: '2020-01-01' } }) }, { readTime: time }]);
  });
  const result = await client.query('s2sGrants', { field: 'day', op: 'LESS_THAN', value: '2026-11-07', orderBy: 'day', limit: 20 });
  assert.equal(result.length, 1); assert.equal(query.limit, 20);
  assert.deepEqual(query.from, [{ collectionId: 's2sGrants' }]);
  assert.deepEqual(query.where.fieldFilter.value, { stringValue: '2026-11-07' });
  await assert.rejects(client.query('s2sGrants', { field: 'day', op: 'LESS_THAN', value: '2026-11-07', limit: 101 }));
});
