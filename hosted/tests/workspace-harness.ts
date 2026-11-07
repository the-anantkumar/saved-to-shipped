// Local synthetic harness only. Never use this as a deployment entrypoint.
import { Workspace } from '../src/storage/workspace';
import type { Access, Input } from '../src/contracts';
export { Workspace };
interface Env { WORKSPACES: DurableObjectNamespace<Workspace> }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const body = await request.json() as { name: string; access: Access; operation: string; input?: Input };
    const stub = env.WORKSPACES.get(env.WORKSPACES.idFromName(body.name));
    return Response.json(await stub.invoke(body.access, body.operation, body.input ?? {}));
  },
} satisfies ExportedHandler<Env>;
