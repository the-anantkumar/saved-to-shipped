import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { issueSession, verifySession, firebaseAccountChecker, credentialRequestFingerprint } from '../.local/build/src/auth/session.js';

const access = { uid: 'synthetic-alice', generation: '00000000-0000-4000-8000-000000000001' };
const key = randomBytes(32).toString('base64url');
test('workspace sessions bind owner and generation, expire and reject forged signatures', async () => {
  const issued = await issueSession(access, key);
  assert.deepEqual(await verifySession(issued.workspace_session, access.uid, key), access);
  await assert.rejects(verifySession(issued.workspace_session, 'synthetic-bob', key), { code: 'MEMBERSHIP_REQUIRED' });
  await assert.rejects(verifySession(issued.workspace_session, access.uid, randomBytes(32).toString('base64url')), { code: 'MEMBERSHIP_REQUIRED' });
  const expired = await new SignJWT({ generation: access.generation }).setProtectedHeader({ alg: 'HS256' }).setIssuer('save2ship')
    .setAudience('save2ship-workspace').setSubject(access.uid).setIssuedAt(1).setExpirationTime(2).sign(Buffer.from(key, 'base64url'));
  await assert.rejects(verifySession(expired, access.uid, key), { code: 'MEMBERSHIP_REQUIRED' });
});
test('account renewal checks disablement, deletion and revocation with bounded provider errors', async () => {
  const token = await new SignJWT({ sub: access.uid, auth_time: 100 }).setProtectedHeader({ alg: 'HS256' }).sign(Buffer.from(key, 'base64url'));
  let response = () => Response.json({ users: [{ localId: access.uid, validSince: '100' }] });
  const check = firebaseAccountChecker(async (url, options) => {
    assert.match(String(url), /^https:\/\/identitytoolkit\.googleapis\.com\/v1\/accounts:lookup\?key=/);
    assert.deepEqual(JSON.parse(options.body), { idToken: token });
    return response();
  });
  await check(token, 'synthetic-public-key');
  for (const users of [[], [{ localId: 'different' }], [{ localId: access.uid, disabled: true }], [{ localId: access.uid, validSince: '101' }]]) {
    response = () => Response.json({ users });
    await assert.rejects(check(token, 'synthetic-public-key'), { code: 'SIGN_IN_EXPIRED' });
  }
  for (const status of [429, 500, 503]) {
    response = () => new Response('', { status });
    await assert.rejects(check(token, 'synthetic-public-key'), { code: 'IDENTITY_UNAVAILABLE' });
  }
  response = () => new Response('x'.repeat(65537));
  await assert.rejects(check(token, 'synthetic-public-key'), { code: 'IDENTITY_UNAVAILABLE' });
  response = () => { throw new Error('Synthetic timeout'); };
  await assert.rejects(check(token, 'synthetic-public-key'), { code: 'IDENTITY_UNAVAILABLE' });
});
test('credential receipt fingerprint is stable but binds the secret request and server key', async () => {
  const input = { request_id: 'synthetic', apify_token: 'synthetic-personal-token' };
  const fingerprint = await credentialRequestFingerprint(input, key);
  assert.equal(await credentialRequestFingerprint(input, key), fingerprint);
  assert.notEqual(await credentialRequestFingerprint({ ...input, apify_token: 'changed' }, key), fingerprint);
  assert.notEqual(await credentialRequestFingerprint(input, randomBytes(32).toString('base64url')), fingerprint);
  assert.doesNotMatch(fingerprint, /synthetic/);
});
