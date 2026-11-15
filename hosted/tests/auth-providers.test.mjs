import test from 'node:test';
import assert from 'node:assert/strict';
import { appRuntime } from './app-helpers.mjs';

test('password identities need verified email and signed TOTP proof before allocating the last seat', async t => {
  const rt = await appRuntime({ cap: 1 }); t.after(() => rt.dispose());
  const password = { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' } };
  for (const email_verified of [undefined, false, 'true']) {
    const token = await rt.token('unverified-member', { ...password, email_verified });
    assert.equal((await rt.request('/api/session', { token })).status, 401);
  }
  for (const sign_in_second_factor of [undefined, 'phone', true, ['totp']]) {
    const token = await rt.token('password-only-member', { email_verified: true,
      firebase: { sign_in_provider: 'password', sign_in_second_factor } });
    assert.equal((await rt.request('/api/session', { token })).status, 401);
  }
  const token = await rt.token('verified-member', { ...password, email_verified: true });
  const first = await rt.request('/api/session', { token });
  assert.equal(first.status, 200);
  assert.equal(first.body.membership.uid, 'verified-member');
  const again = await rt.request('/api/session', { token });
  assert.equal(again.status, 200);
  assert.equal(again.body.membership.generation, first.body.membership.generation);
  const google = await rt.token('another-member');
  assert.equal((await rt.request('/api/session', { token: google })).body.code, 'BETA_FULL');
});

test('a prior workspace capability and client MFA flags cannot bypass password TOTP on private routes', async t => {
  const rt = await appRuntime({ cap: 1 }); t.after(() => rt.dispose());
  const uid = 'verified-member';
  const verified = await rt.token(uid, { email_verified: true,
    firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' } });
  const session = await rt.request('/api/session', { token: verified });
  assert.equal(session.status, 200);
  const capability = session.body.workspace_session;
  const passwordOnly = await rt.token(uid, { email_verified: true,
    firebase: { sign_in_provider: 'password' }, mfa_verified: true, sign_in_second_factor: 'totp' });
  for (const [path, data] of [
    ['/api/state', undefined], ['/api/items', undefined], ['/api/export', undefined],
    ['/api/settings', { request_id: 'forged-mfa-settings', apify_token: 'synthetic-only-key', mfa_verified: true }],
    ['/api/retrieve/start', { request_id: 'forged-mfa-retrieve', limit: 1, max_charge: .01, mfa_verified: true }],
    ['/api/account/delete', { mfa_verified: true }],
  ]) {
    const result = await rt.request(path, { token: passwordOnly, capability, data,
      headers: { 'X-MFA-Verified': 'true', 'X-Second-Factor': 'totp' } });
    assert.equal(result.status, 401, path);
    assert.equal(result.body.code, 'SIGN_IN_EXPIRED', path);
  }
  assert.equal((await rt.request('/api/state', { token: verified, capability })).status, 200,
    'rejected password-only deletion must leave the admitted workspace available');
  assert.equal((await rt.request('/__fixture__/provider')).body.starts, 0,
    'rejected provider submission must not initiate work');
});
