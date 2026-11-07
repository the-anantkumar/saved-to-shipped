// LOCAL TEST ENTRYPOINT ONLY. This file is not referenced by wrangler.jsonc.
import { createLocalJWKSet, type JWK, type JWTVerifyGetKey } from 'jose';
import { verifyGoogleToken } from '../src/auth/token';
import { WorkspacePrototype, type PrototypeSave, type Limits } from '../src/workspace';
export { WorkspacePrototype } from '../src/workspace';

interface Env { WORKSPACES: DurableObjectNamespace<WorkspacePrototype> }
const keys = new Map<string, JWTVerifyGetKey>();

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const input = await request.json() as {
      name: string; operation: string; saves: PrototypeSave[]; ids: string[];
      limits?: Limits; term: string; kind: string; limit?: number;
      token: string; publicKey: JWK; project: string;
    };
    if (input.operation === 'verify') {
      try {
        const serialized = JSON.stringify(input.publicKey);
        let key = keys.get(serialized);
        if (!key) {
          key = createLocalJWKSet({ keys: [input.publicKey] });
          keys.set(serialized, key);
        }
        return Response.json(await verifyGoogleToken(input.token, input.project, key));
      } catch { return Response.json({ error: 'INVALID_IDENTITY' }, { status: 401 }); }
    }
    const object = env.WORKSPACES.get(env.WORKSPACES.idFromName(input.name));
    try { switch (input.operation) {
      case 'stats': return Response.json(await object.stats());
      case 'allocation-capabilities': return Response.json(await object.allocationCapabilities());
      case 'write': return Response.json(await object.writeBatch(input.saves, input.limits));
      case 'search-enable': return Response.json(await object.enableSearch(input.limits));
      case 'search': return Response.json(await object.search(input.term, input.limit));
      case 'list': return Response.json(await object.list(input.kind, input.limit));
      case 'export': return Response.json(await object.exportData());
      case 'delete': return Response.json(await object.deleteBatch(input.ids, input.limits));
      case 'operations': return Response.json(await object.seedOperationalData());
      case 'migrate': return Response.json(await object.migrate(input.limits));
      default: return Response.json({ error: 'UNKNOWN_TEST_OPERATION' }, { status: 400 });
    } } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : 'TEST_FAILURE' }, { status: 500 });
    }
  },
} satisfies ExportedHandler<Env>;
