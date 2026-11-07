import test from 'node:test';
import assert from 'node:assert/strict';
import { appRuntime } from './app-helpers.mjs';

test('unverified password identities cannot allocate the last seat; verified password identities can return', async t => {
  const rt = await appRuntime({ cap: 1 }); t.after(() => rt.dispose());
  const password = { firebase: { sign_in_provider: 'password' } };
  for (const email_verified of [undefined, false, 'true']) {
    const token = await rt.token('unverified-member', { ...password, email_verified });
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
