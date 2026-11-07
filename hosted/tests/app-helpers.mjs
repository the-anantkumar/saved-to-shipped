import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Miniflare, Log, LogLevel } from 'miniflare';

export async function appFixtureConfig({ cap = 2, variables = {}, script } = {}) {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
  const pub = { ...await exportJWK(publicKey), kid: 'fixture' };
  const vars = {
    HOSTED_ENABLED: 'true', ADMISSION_OPEN: 'true', PROCESSING_OPEN: 'true', BETA_CAP: String(cap),
    FIREBASE_PROJECT_ID: 'synthetic-project',
    FIREBASE_PUBLIC_CONFIG: JSON.stringify({ projectId: 'synthetic-project', apiKey: 'synthetic-public-api-key', authDomain: 'synthetic-project.firebaseapp.com', appId: 'synthetic-app' }),
    SESSION_SIGNING_KEY: randomBytes(32).toString('base64url'),
    CREDENTIAL_KEYS: JSON.stringify({ active: 'v1', keys: { v1: randomBytes(32).toString('base64url') } }),
    OPERATOR_UIDS: JSON.stringify(['synthetic-alice']),
    TEST_JWKS: JSON.stringify({ keys: [pub] }), TEST_PRIVATE_KEY: JSON.stringify(await exportJWK(privateKey)), ...variables,
  };
  return { vars, privateKey, config: {
    name: 'app-fixture', compatibilityDate: '2026-07-30',
    manifest: { mainModule: 'app.js', modules: { 'app.js': { type: 'esm', contents: script ?? await readFile('.local/build/tests/app-harness.js', 'utf8') } } },
    exports: { Workspace: { type: 'durable-object', storage: 'sqlite' }, Registry: { type: 'durable-object', storage: 'sqlite' } },
    env: { ...Object.fromEntries(Object.entries(vars).map(([key, value]) => [key, { type: 'text', value }])),
      WORKSPACES: { type: 'durable-object', worker: 'app-fixture', exportName: 'Workspace' },
      REGISTRY: { type: 'durable-object', worker: 'app-fixture', exportName: 'Registry' } },
  } };
}
export async function appRuntime(options = {}) {
  const fixture = await appFixtureConfig({ ...options, variables: { TEST_MANUAL_JOBS: 'true', ...options.variables } });
  const mf = new Miniflare({ workers: [{ config: fixture.config }], host: '127.0.0.1', port: 0,
    telemetry: { enabled: false }, enableDevRegistry: false, log: new Log(LogLevel.ERROR), cf: false,
    resourcePersistencePath: options.persist });
  async function token(uid = 'synthetic-alice', overrides = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ sub: uid, aud: 'synthetic-project', iss: 'https://securetoken.google.com/synthetic-project',
      iat: now, exp: now + 3600, auth_time: now - 10, firebase: { sign_in_provider: 'google.com' }, ...overrides })
      .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(fixture.privateKey);
  }
  return { mf, fixture, token,
    async request(path, { token: bearer, capability, data, headers = {}, method } = {}) {
      const response = await mf.dispatchFetch(`https://workbench.invalid${path}`, {
        method: method ?? (data === undefined ? 'GET' : 'POST'),
        headers: { ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}), ...(capability ? { 'X-Workspace-Session': capability } : {}),
          ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        ...(data === undefined ? {} : { body: JSON.stringify(data) }),
      });
      return { status: response.status, body: await response.json() };
    },
    async member(uid = 'synthetic-alice') {
      const bearer = await token(uid);
      const response = await this.request('/api/session', { token: bearer });
      return { token: bearer, capability: response.body.workspace_session, membership: response.body.membership, response };
    },
    dispose() { return mf.dispose(); },
  };
}
