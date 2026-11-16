import { createLocalJWKSet } from 'jose';
import { verifyGoogleToken } from '../src/auth/token';
import { ProbeSession } from './session';
import { BASE_STEPS, FTS_STEPS, expiry, PROBE_OBJECT_NAME, response, type ProbeEnvironment, type ProbeStep } from './contract';
import { SYNTHETIC_NOW, SYNTHETIC_PROJECT, SYNTHETIC_PUBLIC_KEY, SYNTHETIC_TOKEN } from './identity-fixture';
export { ProbeSession } from './session';

interface Env extends ProbeEnvironment { PROBE_SESSION: DurableObjectNamespace<ProbeSession> }
const verificationKey = createLocalJWKSet({ keys: [SYNTHETIC_PUBLIC_KEY] });
const encoder = new TextEncoder();

async function authenticated(request: Request, env: Env): Promise<boolean> {
  const secret = encoder.encode(env.PROBE_SECRET ?? '');
  if (secret.byteLength < 32 || secret.byteLength > 256) return false;
  const header = request.headers.get('Authorization') ?? '';
  if (!header.startsWith('Bearer ') || header.length > 512) return false;
  const [expected, supplied] = await Promise.all([
    crypto.subtle.digest('SHA-256', secret), crypto.subtle.digest('SHA-256', encoder.encode(header.slice(7))),
  ]);
  const a = new Uint8Array(expected), b = new Uint8Array(supplied);
  let difference = 0;
  for (let index = 0; index < a.length; index++) difference |= a[index]! ^ b[index]!;
  return difference === 0;
}

async function bodyIsEmpty(request: Request): Promise<boolean> {
  const length = request.headers.get('Content-Length');
  if (length !== null && length !== '0') return false;
  if (request.body === null) return true;
  // Cloudflare can represent an empty POST as a non-null stream. Read at most
  // one chunk, never buffer a payload, and bound an unterminated empty stream.
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const first = await Promise.race([
      reader.read(),
      new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), 1000); }),
    ]);
    return first?.done === true;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (!(await authenticated(request, env))) return response({ error: 'UNAUTHORIZED' }, 401);
    const url = new URL(request.url);
    if (url.search || request.headers.has('Origin')) return response({ error: 'INVALID_PROBE_REQUEST' }, 400);
    // No request payload is ever accepted, parsed or retained. The operator must
    // send a bodyless request; arbitrary keys, source text and owner IDs cannot
    // enter this experiment, even with the operator secret.
    if (!(await bodyIsEmpty(request))) return response({ error: 'BODY_NOT_ALLOWED' }, 413);
    const cleanup = request.method === 'POST' && url.pathname === '/probe/cleanup';
    const expires = expiry(env);
    if (!cleanup) {
      if (expires === null || expires - Date.now() > 24 * 60 * 60 * 1000) return response({ error: 'PROBE_NOT_CONFIGURED' }, 503);
      if (Date.now() >= expires) return response({ error: 'PROBE_EXPIRED' }, 410);
    }
    const step = request.method === 'POST' && /^\/probe\/step\/([a-z0-9-]+)$/.exec(url.pathname)?.[1];
    const sample = request.method === 'POST' && /^\/probe\/verify\/(1[0-6]|[1-9])$/.exec(url.pathname)?.[1];
    const report = request.method === 'GET' && url.pathname === '/probe/report';
    if (!cleanup && !report && !sample && !(step && [...BASE_STEPS, ...FTS_STEPS].includes(step as ProbeStep))) {
      return response({ error: 'NOT_FOUND' }, 404);
    }
    // Authentication, syntax, expiry and body guards precede any DO lookup.
    const session = env.PROBE_SESSION.get(env.PROBE_SESSION.idFromName(PROBE_OBJECT_NAME));
    try {
      if (cleanup) { const result = JSON.parse(await session.cleanup()); return response(result.body, result.status); }
      if (report) { const result = JSON.parse(await session.report()); return response(result.body, result.status); }
      if (sample) {
        const granted = JSON.parse(await session.claimVerification(Number(sample)));
        if (granted.status !== 200) return response(granted.body, granted.status);
        await verifyGoogleToken(SYNTHETIC_TOKEN, SYNTHETIC_PROJECT, verificationKey, SYNTHETIC_NOW);
        return response({ ...granted.body, verified: true, benchmark: 'Fixed synthetic RS256 fixture and validation clock, not Firebase authentication' });
      }
      const result = JSON.parse(await session.step(step as ProbeStep));
      return response(result.body, result.status);
    } catch {
      return response({ error: 'PROBE_RUNTIME_ERROR', retry: 'Read the report or clean up. Do not resubmit uncertain measurement work.' }, 503);
    }
  },
} satisfies ExportedHandler<Env>;
