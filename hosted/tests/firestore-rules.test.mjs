import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { FirestoreClient } from '../.local/build/src/firestore/client.js';

const host = process.env.FIRESTORE_EMULATOR_HOST;
test('Firestore rules deny direct reads, lists and writes for anonymous users and signed-in owners', { skip: !host }, async t => {
  assert.match(host, /^(localhost|127\.0\.0\.1):\d+$/);
  const env = { FIREBASE_PROJECT_ID: 'demo-save2ship', FIRESTORE_DATABASE_ID: 'save2ship', FIRESTORE_EMULATOR_HOST: host };
  const client = new FirestoreClient(env), id = randomUUID(), path = `rulesChecks/${id}`;
  await client.commit([{ path, data: { uid: 'synthetic-owner', privateNote: 'Synthetic rules fixture' }, currentDocument: { exists: false } }]);
  t.after(() => client.commit([{ path, delete: true }]));
  const base = `http://${host}/v1/projects/demo-save2ship/databases/save2ship/documents`;
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  // Emulator-only unsigned ID tokens. Never usable against production Firebase.
  const token = uid => `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sub: uid, user_id: uid, aud: 'demo-save2ship',
    iss: 'https://securetoken.google.com/demo-save2ship', iat: now, exp: now + 3600, auth_time: now,
    email_verified: true, firebase: { sign_in_provider: 'password', identities: {} } })}.`;
  for (const uid of [null, 'synthetic-owner', 'synthetic-other']) {
    const headers = { 'Content-Type': 'application/json', ...(uid ? { Authorization: `Bearer ${token(uid)}` } : {}) };
    for (const [suffix, method, body] of [[path, 'GET'], ['rulesChecks', 'GET'], [path, 'PATCH', { fields: { privateNote: { stringValue: 'forged' } } }]]) {
      const response = await fetch(`${base}/${suffix}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
      await response.body?.cancel();
      assert.equal(response.status, 403, `${uid ?? 'anonymous'} ${method} must be denied`);
    }
  }
  assert.equal((await client.read(path)).data.privateNote, 'Synthetic rules fixture');
});
