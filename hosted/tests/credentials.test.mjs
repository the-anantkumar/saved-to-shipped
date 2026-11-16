import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const bundle = await build({ entryPoints: ['src/credentials/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2023' });
const { parseKeyring, encryptCredential, decryptCredential, rotateCredential } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const access = { uid: 'synthetic-owner', generation: 'synthetic-generation' };
const key1 = Buffer.alloc(32, 1).toString('base64url'), key2 = Buffer.alloc(32, 2).toString('base64url');
const keyring = parseKeyring(JSON.stringify({ active: 'v1', keys: { v1: key1 } }));
const secret = 'synthetic-personal-provider-key';

test('AES-GCM credential records use fresh nonces and retain only ciphertext', async () => {
  const first = await encryptCredential(access, 'apify', secret, keyring);
  const second = await encryptCredential(access, 'apify', secret, keyring);
  assert.deepEqual(Object.keys(first).sort(), ['ciphertext', 'nonce', 'version']);
  assert.notEqual(first.nonce, second.nonce); assert.notEqual(first.ciphertext, second.ciphertext);
  assert.equal(first.version, 'v1'); assert.equal(Buffer.from(first.nonce, 'base64url').length, 12);
  assert.ok(!JSON.stringify(first).includes(secret));
  assert.equal(await decryptCredential(access, 'apify', first, keyring), secret);
});

test('owner, generation, provider, key version and ciphertext tampering fail with redacted errors', async () => {
  const encrypted = await encryptCredential(access, 'apify', secret, keyring);
  const cases = [
    () => decryptCredential({ ...access, uid: 'another-owner' }, 'apify', encrypted, keyring),
    () => decryptCredential({ ...access, generation: 'another-generation' }, 'apify', encrypted, keyring),
    () => decryptCredential(access, 'openai', encrypted, keyring),
    () => decryptCredential(access, 'apify', { ...encrypted, version: 'v2' }, parseKeyring(JSON.stringify({ active: 'v2', keys: { v2: key1 } }))),
    () => decryptCredential(access, 'apify', { ...encrypted, ciphertext: Buffer.alloc(32, 7).toString('base64url') }, keyring),
    () => decryptCredential(access, 'apify', { ...encrypted, nonce: 'invalid' }, keyring),
    () => decryptCredential(access, 'apify', encrypted, parseKeyring(JSON.stringify({ active: 'v1', keys: { v1: key2 } }))),
  ];
  for (const attempt of cases) await assert.rejects(attempt(), error => error.code === 'CREDENTIAL_UNAVAILABLE' && !error.message.includes(secret) && !error.message.includes(key1));
});

test('key rotation authenticates the old record before re-encrypting with the active version', async () => {
  const encrypted = await encryptCredential(access, 'openai', secret, keyring);
  const rotation = parseKeyring(JSON.stringify({ active: 'v2', keys: { v1: key1, v2: key2 } }));
  const rotated = await rotateCredential(access, 'openai', encrypted, rotation);
  assert.equal(rotated.version, 'v2'); assert.notEqual(rotated.nonce, encrypted.nonce);
  assert.equal(await decryptCredential(access, 'openai', rotated, rotation), secret);
  assert.equal(await decryptCredential(access, 'openai', encrypted, rotation), secret);
  await assert.rejects(decryptCredential(access, 'openai', rotated, keyring), /unavailable/);
  const retired = parseKeyring(JSON.stringify({ active: 'v2', keys: { v2: key2 } }));
  assert.equal(await decryptCredential(access, 'openai', rotated, retired), secret);
  await assert.rejects(rotateCredential(access, 'openai', encrypted, retired), /unavailable/);
});

test('missing and invalid deployment keys fail closed; credential validation performs no encryption', async () => {
  for (const value of [undefined, '', '{}', '{invalid', JSON.stringify({ active: 'v1', keys: {} }),
    JSON.stringify({ active: 'v1', keys: { v1: 'abc' } }), JSON.stringify({ active: 'missing', keys: { v1: key1 } }),
    JSON.stringify({ active: 'v1', keys: { v1: key1 + '=' } }), JSON.stringify({ active: 'v1', keys: { v1: key1 }, extra: secret })])
    assert.throws(() => parseKeyring(value), error => error.code === 'CREDENTIAL_UNAVAILABLE' && !error.message.includes(secret));
  for (const value of ['', 'x\nsecret', '🚀'.repeat(600)])
    await assert.rejects(encryptCredential(access, 'apify', value, keyring), error => error.code === 'INVALID_CREDENTIAL' && (!value || !error.message.includes(value)));
});
