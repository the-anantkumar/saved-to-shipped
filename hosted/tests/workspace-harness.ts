// Local synthetic harness only. Never use this as a deployment entrypoint.
import { DurableObject } from 'cloudflare:workers';
import { Workspace as StorageWorkspace } from '../src/storage/workspace';
import { Fault, type Access, type Input, type StorageEnv } from '../src/contracts';
interface Env extends StorageEnv {
  WORKSPACES: DurableObjectNamespace<Workspace>;
  AUTHORITY: DurableObjectNamespace<Authority>;
}
// Synthetic authority persists independently across restarts. Production uses
// Registry and has no test bypass flag.
export class Authority extends DurableObject {
  async state(access: Access, operation: string) {
    return this.ctx.storage.transaction(async storage => {
      const key = `${access.uid}:${access.generation}`;
      let state = await storage.get<string>(key);
      if (operation === 'reserve' && !state) { state = 'reserved'; await storage.put(key, state); }
      if (operation === 'deleting') { state = 'deleting'; await storage.put(key, state); }
      return state ?? null;
    });
  }
}
export class Workspace extends StorageWorkspace<Env> {
  protected override async authorizeProvision(access: Access) {
    const authority = this.env.AUTHORITY.get(this.env.AUTHORITY.idFromName('synthetic-authority'));
    if (await authority.state(access, 'lookup') !== 'reserved')
      throw new Fault(403, 'PROVISIONING_DENIED', 'No trusted synthetic reservation.');
  }
  async snapshot() {
    return { tables: this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%' ORDER BY name").toArray().map(row => row.name),
      alarm: await this.ctx.storage.getAlarm(), kvKeys: (await this.ctx.storage.list()).size, sqliteUsedBytes: this.ctx.storage.sql.databaseSize };
  }
  async testAlarm() { await this.alarm(); }
  legacySchema() { this.ctx.storage.sql.exec('ALTER TABLE workspace DROP COLUMN library_revision'); }
  itemRevision(id: string, revision: number) {
    const row = this.ctx.storage.sql.exec<{ meta: string }>('SELECT meta FROM items WHERE id=?', id).one();
    const meta = JSON.parse(row.meta); meta.revision = revision;
    this.ctx.storage.sql.exec('UPDATE items SET revision=?,meta=? WHERE id=?', revision, JSON.stringify(meta), id);
  }
  async legacyClosed(access: Access) {
    this.ctx.storage.sql.exec(`CREATE TABLE workspace (singleton INTEGER PRIMARY KEY, uid TEXT NOT NULL, generation TEXT NOT NULL,
      status TEXT NOT NULL, revision INTEGER NOT NULL, logical_bytes INTEGER NOT NULL, item_count INTEGER NOT NULL)`);
    this.ctx.storage.sql.exec("INSERT INTO workspace VALUES(1,?,?,'closed',7,0,0)", access.uid, access.generation);
    await this.ctx.storage.put('legacy-internal-metadata', 'synthetic');
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const body = await request.json() as { name: string; access: Access; operation: string; input?: Input };
    if (body.operation.startsWith('authority.')) {
      const authority = env.AUTHORITY.get(env.AUTHORITY.idFromName('synthetic-authority'));
      return Response.json({ ok: true, data: await authority.state(body.access, body.operation.slice(10)) });
    }
    const stub = env.WORKSPACES.get(env.WORKSPACES.idFromName(body.name));
    if (body.operation === 'test.snapshot') return Response.json({ ok: true, data: await stub.snapshot() });
    if (body.operation === 'test.legacyClosed') { await stub.legacyClosed(body.access); return Response.json({ ok: true, data: {} }); }
    if (body.operation === 'test.legacySchema') { await stub.legacySchema(); return Response.json({ ok: true, data: {} }); }
    if (body.operation === 'test.itemRevision') { await stub.itemRevision(String(body.input?.id), Number(body.input?.revision)); return Response.json({ ok: true, data: {} }); }
    if (body.operation === 'test.alarm') { await stub.testAlarm(); return Response.json({ ok: true, data: {} }); }
    return Response.json(await stub.invoke(body.access, body.operation, body.input ?? {}));
  },
} satisfies ExportedHandler<Env>;
