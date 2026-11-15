import test from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { runtime } from './helpers.mjs';

export async function signingFixture() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  jwk.kid = 'synthetic-key';
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    sub: 'synthetic-member', aud: 'synthetic-project',
    iss: 'https://securetoken.google.com/synthetic-project',
    iat: now, exp: now + 3600, auth_time: now - 30,
    firebase: { sign_in_provider: 'google.com' },
  };
  return {
    publicKey: jwk,
    token: (overrides, headers = {}) => new SignJWT({ ...claims, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key', ...headers }).sign(privateKey),
    now,
  };
}

test('maintained token verifier accepts Google or verified password with TOTP and rejects invalid claims and signatures', async t => {
  const rt = await runtime(); t.after(() => rt.dispose());
  const signer = await signingFixture();
  async function verify(token, publicKey = signer.publicKey) {
    const response = await rt.mf.dispatchFetch('http://localhost/test', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'verify', token, publicKey, project: 'synthetic-project' }),
    });
    return { status: response.status, body: await response.json() };
  }
  assert.deepEqual(await verify(await signer.token()), { status: 200, body: { uid: 'synthetic-member' } });
  assert.deepEqual(await verify(await signer.token({ firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' }, email_verified: true })),
    { status: 200, body: { uid: 'synthetic-member' } });
  for (const overrides of [
    { aud: 'another-project' }, { aud: ['synthetic-project', 'another-project'] },
    { iss: 'https://attacker.invalid' },
    { exp: signer.now - 1 }, { exp: undefined }, { iat: undefined },
    { auth_time: undefined }, { iat: signer.now + 3600 },
    { auth_time: signer.now + 3600 }, { auth_time: -1 },
    { sub: '' }, { sub: 'x'.repeat(129) },
    { firebase: { sign_in_provider: 'password' } },
    { firebase: { sign_in_provider: 'password' }, email_verified: true },
    { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'phone' }, email_verified: true },
    { firebase: { sign_in_provider: 'password', sign_in_second_factor: ['totp'] }, email_verified: true },
    { firebase: { sign_in_provider: 'password', sign_in_second_factor: true }, email_verified: true },
    { firebase: { sign_in_provider: 'password' }, email_verified: true, sign_in_second_factor: 'totp' },
    { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' }, email_verified: false },
    { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' }, email_verified: 'true' },
    { firebase: { sign_in_provider: 'password' }, email_verified: false },
    { firebase: { sign_in_provider: 'password' }, email_verified: 'true' },
    { firebase: { sign_in_provider: 'anonymous' }, email_verified: true },
    { firebase: { sign_in_provider: 'custom' }, email_verified: true },
    { firebase: { sign_in_provider: 'github.com' }, email_verified: true },
    { firebase: { sign_in_provider: ['google.com'] } }, { firebase: undefined },
  ]) assert.equal((await verify(await signer.token(overrides))).status, 401, JSON.stringify(overrides));
  const another = await signingFixture();
  assert.equal((await verify(await signer.token({}, { kid: undefined }))).status, 401, 'missing key ID');
  assert.equal((await verify(await signer.token({}, { kid: 'untrusted' }))).status, 401, 'unknown key ID');
  assert.equal((await verify(await another.token())).status, 401, 'forged signature');
  const token = await signer.token();
  const [, payload] = token.split('.');
  assert.equal((await verify(`${Buffer.from('{"alg":"none"}').toString('base64url')}.${payload}.`)).status, 401);
  assert.equal((await verify('x'.repeat(16_385))).status, 401);
});
