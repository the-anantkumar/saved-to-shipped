// Synthetic local entrypoint only. Not imported by the application or any deploy configuration.
import { createLocalJWKSet, importJWK, SignJWT, decodeJwt } from 'jose';
import { makeApp, Registry, Workspace as AppWorkspace, type AppEnv } from '../src/app';
import { verifyGoogleToken } from '../src/auth/token';
import { reconcileJob } from '../src/jobs/orchestrator';
import { Fault, type Access } from '../src/contracts';
export { Registry };

const fixtureRows = [1, 2, 3].map(n => ({ url: `https://www.linkedin.com/feed/update/urn:li:activity:90000000000000000${n}`,
  text: `Learn to build a small SQLite experiment ${n}. Keep a record of the results.`, author: { name: 'Synthetic author' } }));
let providerMode = 'success';
const providerCalls = { starts: 0, polls: 0, aborts: 0, classifications: 0 };
export const fixtureFetch: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.hostname === 'api.apify.com') {
    if (url.pathname.endsWith('/abort')) {
      providerCalls.aborts++;
      if (providerMode === 'invalid-key' && new Headers(init?.headers).get('Authorization') !== 'Bearer synthetic-repaired-key') return new Response('', { status: 401 });
    } else if (url.pathname.endsWith('/runs')) {
      providerCalls.starts++;
      if (providerMode === 'uncertain') throw new Error('Synthetic lost submission response');
    } else if (!url.pathname.includes('/datasets/')) providerCalls.polls++;
    if (url.pathname.includes('/datasets/')) {
      const offset = Number(url.searchParams.get('offset') || 0), limit = Number(url.searchParams.get('limit') || 25);
      return Response.json(fixtureRows.slice(offset, offset + limit));
    }
    return Response.json({ data: { id: 'syntheticRun1', status: url.pathname.endsWith('/runs') || providerMode === 'running' ? 'RUNNING' : 'SUCCEEDED', defaultDatasetId: 'syntheticData1' } });
  }
  if (url.hostname === 'api.openai.com') {
    providerCalls.classifications++;
    const request = JSON.parse(String(init?.body));
    const context = JSON.parse(request.input);
    const items = context.items.map((item: { id: string }, index: number) => ({ id: item.id, kind: 'learning', title: 'A small SQLite experiment',
      why: 'Practice with one reproducible example.', next_action: 'Run the example and take notes.', definition_of_done: 'One example and notes are saved.',
      project_name: providerMode === 'many-groups' ? `Synthetic AI ${index}` : 'SQLite learning', commit_message: 'Add a learning example', repo_suggestion: 'learning-notes',
      confidence: 'medium', effort_hours: 1, tags: ['sqlite'], impact: 3, relevance: 4, novelty: 3 }));
    return Response.json({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ items }) }] }] });
  }
  throw new Error('Fixture outbound network is disabled');
};
export class Workspace extends AppWorkspace {
  async snapshot() {
    return { tables: this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name").toArray().map(row => row.name),
      alarm: await this.ctx.storage.getAlarm(), kvKeys: (await this.ctx.storage.list()).size, sqliteUsedBytes: this.ctx.storage.sql.databaseSize };
  }
  async testAlarm() { await this.alarm(); }
  async legacyClose() {
    for (const table of ['items', 'bodies', 'groups', 'settings', 'imports', 'jobs', 'credentials', 'receipts'])
      this.ctx.storage.sql.exec(`DROP TABLE IF EXISTS ${table}`);
    this.ctx.storage.sql.exec("UPDATE workspace SET status='closed',logical_bytes=0,item_count=0 WHERE singleton=1");
    await this.ctx.storage.deleteAlarm();
  }
  protected override async reconcile(access: Access): Promise<boolean> {
    if ((this.env as { TEST_MANUAL_JOBS?: string }).TEST_MANUAL_JOBS === 'true') return false;
    await reconcileJob(access, this, this.env, fixtureFetch); return true;
  }
}
interface Env extends AppEnv { WORKSPACES: DurableObjectNamespace<Workspace>; TEST_JWKS: string; TEST_PRIVATE_KEY: string; TEST_REVOKED_UIDS?: string }
export default {
  async fetch(request: Request<unknown, IncomingRequestCfProperties>, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__fixture__/provider') {
      if (request.method === 'POST') {
        const data = await request.json() as { mode: string };
        if (!['success', 'running', 'uncertain', 'invalid-key', 'many-groups'].includes(data.mode)) return new Response('Invalid mode', { status: 400 });
        providerMode = data.mode;
      }
      return Response.json({ mode: providerMode, ...providerCalls });
    }
    if (url.pathname === '/__fixture__/identity') {
      const user = url.searchParams.get('user') ?? 'alice';
      if (!['alice', 'bob', 'charlie'].includes(user)) return new Response('Not found', { status: 404 });
      const now = Math.floor(Date.now() / 1000), uid = `synthetic-${user}`;
      const token = await new SignJWT({ firebase: { sign_in_provider: 'google.com' }, auth_time: now - 10 })
        .setSubject(uid).setIssuer(`https://securetoken.google.com/${env.FIREBASE_PROJECT_ID}`).setAudience(env.FIREBASE_PROJECT_ID!)
        .setIssuedAt(now).setExpirationTime(now + 3600).setProtectedHeader({ alg: 'RS256', kid: 'fixture' })
        .sign(await importJWK(JSON.parse(env.TEST_PRIVATE_KEY), 'RS256'));
      return Response.json({ uid, token }, { headers: { 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/__fixture__/registry') {
      const data = await request.json() as { operation: string; input?: Record<string, unknown> };
      const stub = env.REGISTRY.get(env.REGISTRY.idFromName('members-v1'));
      return Response.json(await stub.invoke(data.operation, data.input));
    }
    if (url.pathname === '/__fixture__/workspace') {
      const data = await request.json() as { access: Access; operation: string; input?: Record<string, unknown> };
      const stub = env.WORKSPACES.get(env.WORKSPACES.idFromName(`workspace:${data.access.uid}:${data.access.generation}`));
      if (data.operation === 'test.snapshot') return Response.json({ ok: true, data: await stub.snapshot() });
      if (data.operation === 'test.alarm') { await stub.testAlarm(); return Response.json({ ok: true, data: {} }); }
      if (data.operation === 'test.legacyClose') { await stub.legacyClose(); return Response.json({ ok: true, data: {} }); }
      return Response.json(await stub.invoke(data.access, data.operation, data.input));
    }
    const app = makeApp({
      verifyIdentity: (token, project) => verifyGoogleToken(token, project, createLocalJWKSet(JSON.parse(env.TEST_JWKS))),
      checkAccount: async token => {
        if (JSON.parse(env.TEST_REVOKED_UIDS ?? '[]').includes(decodeJwt(token).sub)) throw new Fault(401, 'SIGN_IN_EXPIRED', 'Please sign in again.');
      }, providerFetch: fixtureFetch,
    });
    return app.fetch!(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
