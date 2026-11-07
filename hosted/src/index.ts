import type { WorkspacePrototype } from './workspace';
export { WorkspacePrototype } from './workspace';

interface Env {
  ASSETS: Fetcher;
  WORKSPACES: DurableObjectNamespace<WorkspacePrototype>;
}

// This is deliberately not a hosted data API. Do not allocate objects or accept
// identity from a request until the P3 identity and membership gates exist.
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({ status: 'prototype', dataApi: 'closed' }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'HOSTED_NOT_READY' }, {
        status: 503, headers: { 'Cache-Control': 'no-store' },
      });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
