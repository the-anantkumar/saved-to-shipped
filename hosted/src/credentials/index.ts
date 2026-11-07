import { Fault, type Access, type Ciphertext } from '../contracts';

export type Provider = 'apify' | 'openai';
export interface Keyring { active: string; keys: Readonly<Record<string, string>> }
const encoder = new TextEncoder();
const VERSION = /^[A-Za-z0-9_-]{1,32}$/;
const MAX_CREDENTIAL_BYTES = 2048;

function invalid(): never { throw new Fault(503, 'CREDENTIAL_UNAVAILABLE', 'Provider credentials are unavailable. Contact the operator.'); }
function bytes(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length > 4096 || value.length % 4 === 1) invalid();
  try {
    const decoded = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
    const result = Uint8Array.from(decoded, character => character.charCodeAt(0));
    if (base64(result) !== value) invalid();
    return result;
  } catch { return invalid(); }
}
function base64(value: Uint8Array): string {
  return btoa(String.fromCharCode(...value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function parseKeyring(value: string | undefined): Keyring {
  try {
    if (!value || value.length > 4096) invalid();
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join(',') !== 'active,keys' ||
        typeof parsed.active !== 'string' || !VERSION.test(parsed.active) || !parsed.keys || typeof parsed.keys !== 'object' || Array.isArray(parsed.keys)) invalid();
    const entries = Object.entries(parsed.keys);
    if (!entries.length || entries.length > 4) invalid();
    const keys: Record<string, string> = Object.create(null);
    for (const [version, encoded] of entries) {
      if (!VERSION.test(version) || typeof encoded !== 'string' || bytes(encoded).byteLength !== 32) invalid();
      keys[version] = encoded;
    }
    if (!Object.hasOwn(keys, parsed.active)) invalid();
    return { active: parsed.active, keys: Object.freeze(keys) };
  } catch { return invalid(); }
}
function aad(access: Access, provider: Provider, version: string): Uint8Array {
  if (!access || typeof access.uid !== 'string' || !access.uid || access.uid.length > 128 ||
      typeof access.generation !== 'string' || !access.generation || access.generation.length > 128 ||
      !['apify', 'openai'].includes(provider) || !VERSION.test(version)) invalid();
  return encoder.encode(JSON.stringify(['save2ship/provider-key/v1', access.uid, access.generation, provider, version]));
}
async function importKey(keyring: Keyring, version: string, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  if (!keyring || !keyring.keys || !Object.hasOwn(keyring.keys, version)) invalid();
  const raw = bytes(keyring.keys[version]!);
  if (raw.byteLength !== 32) invalid();
  try { return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, [usage]); }
  finally { raw.fill(0); }
}

export async function encryptCredential(access: Access, provider: Provider, value: string, keyring: Keyring): Promise<Ciphertext> {
  if (typeof value !== 'string' || !/^[\x21-\x7e]{1,2048}$/.test(value.trim()) || encoder.encode(value.trim()).byteLength > MAX_CREDENTIAL_BYTES)
    throw new Fault(400, 'INVALID_CREDENTIAL', 'Provide a valid personal provider key.');
  try {
    const version = keyring.active;
    const additionalData = aad(access, provider, version);
    const key = await importKey(keyring, version, 'encrypt');
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = encoder.encode(value.trim());
    try {
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData, tagLength: 128 }, key, plaintext);
      return { version, nonce: base64(nonce), ciphertext: base64(new Uint8Array(encrypted)) };
    } finally { plaintext.fill(0); }
  } catch { return invalid(); }
}
export async function decryptCredential(access: Access, provider: Provider, value: Ciphertext, keyring: Keyring): Promise<string> {
  try {
    if (!value || typeof value.version !== 'string' || typeof value.nonce !== 'string' || typeof value.ciphertext !== 'string') invalid();
    const additionalData = aad(access, provider, value.version);
    const nonce = bytes(value.nonce), ciphertext = bytes(value.ciphertext);
    if (nonce.byteLength !== 12 || ciphertext.byteLength < 17 || ciphertext.byteLength > MAX_CREDENTIAL_BYTES + 16) invalid();
    const key = await importKey(keyring, value.version, 'decrypt');
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData, tagLength: 128 }, key, ciphertext));
    try {
      const result = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(raw);
      if (!/^[\x21-\x7e]{1,2048}$/.test(result)) invalid();
      return result;
    } finally { raw.fill(0); }
  } catch { return invalid(); }
}
/** Keep old versions until all records have rotated; never discard on failure. */
export async function rotateCredential(access: Access, provider: Provider, value: Ciphertext, keyring: Keyring): Promise<Ciphertext> {
  const plaintext = await decryptCredential(access, provider, value, keyring);
  return encryptCredential(access, provider, plaintext, keyring);
}
