import { importX509, jwtVerify, SignJWT, base64url, decodeJwt, type JWTVerifyGetKey } from 'jose';
import { verifyGoogleToken } from './token';
import { Fault, type Access } from '../contracts';

const CERTIFICATES = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
/** Google documents this certificate endpoint and its Cache-Control max-age. */
export function googleVerifier(fetcher: typeof fetch = fetch) {
  let keys = new Map<string, CryptoKey>(), validUntil = 0, nextRefresh = 0;
  let pending: Promise<void> | undefined;
  const refresh = async () => {
    const response = await fetcher(CERTIFICATES, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Identity keys unavailable');
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Identity keys unavailable');
    const chunks: Uint8Array[] = []; let length = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        length += part.value.length; if (length > 262_144) throw new Error('Identity keys too large');
        chunks.push(part.value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const document = JSON.parse(new TextDecoder().decode(bytes));
    if (!document || typeof document !== 'object' || Array.isArray(document) || Object.keys(document).length > 20) throw new Error('Invalid identity keys');
    const replacement = new Map<string, CryptoKey>();
    for (const [kid, certificate] of Object.entries(document)) {
      if (kid.length > 256 || typeof certificate !== 'string' || certificate.length > 16384) throw new Error('Invalid identity keys');
      replacement.set(kid, await importX509(certificate, 'RS256'));
    }
    if (!replacement.size) throw new Error('No identity keys');
    const maxAge = Number(/max-age=(\d+)/i.exec(response.headers.get('Cache-Control') ?? '')?.[1] ?? 300);
    keys = replacement; validUntil = Date.now() + Math.min(maxAge, 86400) * 1000;
  };
  const getKey: JWTVerifyGetKey = async header => {
    if (typeof header.kid !== 'string' || header.kid.length > 256) throw new Error('Missing key');
    if (Date.now() >= validUntil || !keys.has(header.kid)) {
      if (!pending && Date.now() >= nextRefresh) {
        nextRefresh = Date.now() + 30_000;
        pending = refresh().finally(() => { pending = undefined; });
      }
      if (pending) await pending;
    }
    const key = keys.get(header.kid);
    if (!key || Date.now() >= validUntil) throw new Error('Identity keys unavailable');
    return key;
  };
  return (token: string, project: string) => verifyGoogleToken(token, project, getKey);
}

function sessionKey(value?: string): Uint8Array {
  if (!value || !/^[A-Za-z0-9_-]{43}$/.test(value)) throw new Fault(503, 'NOT_CONFIGURED', 'Sign-in is being configured.');
  const bytes = base64url.decode(value);
  if (bytes.length !== 32) throw new Fault(503, 'NOT_CONFIGURED', 'Sign-in is being configured.');
  return bytes;
}
export async function issueSession(access: Access, key?: string) {
  const expires = Math.floor(Date.now() / 1000) + 900;
  const token = await new SignJWT({ generation: access.generation })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('save2ship')
    .setAudience('save2ship-workspace').setSubject(access.uid).setIssuedAt().setExpirationTime(expires)
    .sign(sessionKey(key));
  return { workspace_session: token, expires_at: expires * 1000 };
}
export async function verifySession(token: string, uid: string, key?: string): Promise<Access> {
  if (!token || token.length > 2048) throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'Please refresh your workspace session.');
  try {
    const { payload } = await jwtVerify(token, sessionKey(key), {
      algorithms: ['HS256'], issuer: 'save2ship', audience: 'save2ship-workspace', requiredClaims: ['sub', 'iat', 'exp', 'generation'],
    });
    if (payload.sub !== uid || typeof payload.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(payload.generation)) throw new Error();
    return { uid, generation: payload.generation };
  } catch (error) {
    if (error instanceof Fault) throw error;
    throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'Please refresh your workspace session.');
  }
}

/** Only call after verifying the ID token signature and claims. */
export function firebaseAccountChecker(fetcher: typeof fetch = fetch) {
  return async (token: string, apiKey: string): Promise<void> => {
    const unavailable = () => new Fault(503, 'IDENTITY_UNAVAILABLE', 'Sign-in is temporarily unavailable.');
    let response: Response;
    try {
      response = await fetcher(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idToken: token }), signal: AbortSignal.timeout(5000),
      });
    } catch { throw unavailable(); }
    if (response.status >= 500 || response.status === 429) throw unavailable();
    if (!response.ok) throw new Fault(401, 'SIGN_IN_EXPIRED', 'Please sign in again.');
    const reader = response.body?.getReader(); if (!reader) throw unavailable();
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const part = await reader.read(); if (part.done) break;
        size += part.value.length; if (size > 65_536) throw unavailable();
        chunks.push(part.value);
      }
    } catch { throw unavailable(); }
    finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let value: { users?: { localId?: string; disabled?: boolean; validSince?: string }[] };
    try { value = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw unavailable(); }
    const account = value?.users?.[0], claims = decodeJwt(token), since = Number(account?.validSince ?? 0);
    if (!account || account.localId !== claims.sub || account.disabled || !Number.isFinite(since) || since > Number(claims.auth_time))
      throw new Fault(401, 'SIGN_IN_EXPIRED', 'Please sign in again.');
  };
}

/** Stable receipts without storing provider-key guesses or reusing encryption nonces. */
export async function credentialRequestFingerprint(input: unknown, key?: string): Promise<string> {
  const signingKey = await crypto.subtle.importKey('raw', sessionKey(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', signingKey, new TextEncoder().encode(`save2ship-settings-v1\n${JSON.stringify(input)}`));
  return base64url.encode(new Uint8Array(signature));
}
