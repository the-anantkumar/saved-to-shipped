// Synthetic integration harness only. This entrypoint must never be deployed.
import { FirestoreWorkspace, workspaceDocumentPath, type FirestoreWorkspaceEnv } from '../src/firestore/workspace';
import { FirestoreCommitUncertain, type FirestorePort } from '../src/firestore/client';
import { Fault, type Access, type Input, type StoredJob, type Result } from '../src/contracts';
interface Env extends FirestoreWorkspaceEnv { WORKSPACES: DurableObjectNamespace<Workspace> }
export class Workspace extends FirestoreWorkspace<Env> {
  private wrapped?: FirestorePort;
  private mode = '';
  private countdown = 0;
  private blockReads = 0;
  private requestBudget = Infinity;
  private requests = 0;
  private checkpointChanged = false;
  private changeCheckpoint = false;
  private countRequest(): void {
    if (++this.requests > this.requestBudget) throw new Fault(503, 'SYNTHETIC_SUBREQUEST_LIMIT', 'Synthetic subrequest limit exceeded');
  }
  override async invoke(access: Access, operation: string, input: Input = {}): Promise<Result> {
    this.requests = 1; // Reserve an OAuth exchange even when the emulator skips it.
    this.checkpointChanged = false;
    return super.invoke(access, operation, input);
  }
  protected override firestore(): FirestorePort {
    if (this.wrapped) return this.wrapped;
    const client = super.firestore();
    this.wrapped = {
      read: async (...args) => { this.countRequest(); if (this.blockReads-- > 0) throw new Fault(503, 'SYNTHETIC_READ_FAILURE', 'Synthetic read failure'); return client.read(...args); },
      list: async (...args) => {
        this.countRequest();
        const page = await client.list(...args);
        if (this.changeCheckpoint && !this.checkpointChanged) {
          this.checkpointChanged = true;
          const path = args[0].slice(0, -'/records'.length), current = await client.read(path);
          if (!current) throw new Error('Synthetic checkpoint change requires existing state');
          await client.commit([{ path, data: { ...current.data, checkpoint: Number(current.data.checkpoint) + 1, commitId: crypto.randomUUID() }, currentDocument: { updateTime: current.updateTime } }]);
        }
        return page;
      },
      query: (...args) => { this.countRequest(); return client.query(...args); },
      commit: async writes => {
        this.countRequest();
        if (this.countdown > 0 && --this.countdown === 0) {
          const mode = this.mode; this.mode = '';
          if (mode === 'before') throw new FirestoreCommitUncertain();
          if (mode === 'after' || mode === 'after-unreadable') {
            await client.commit(writes);
            if (mode === 'after-unreadable') this.blockReads = 1;
            throw new FirestoreCommitUncertain();
          }
          if (mode === 'conflict') {
            const current = await client.read(writes[0]!.path);
            if (!current) throw new Error('Synthetic conflict requires existing state');
            await client.commit([{ path: current.path, data: { ...current.data, checkpoint: Number(current.data.checkpoint) + 1, commitId: crypto.randomUUID() }, currentDocument: { updateTime: current.updateTime } }]);
          }
        }
        return client.commit(writes);
      },
    };
    return this.wrapped;
  }
  protected override async authorizeProvision(access: Access): Promise<void> {
    if (!access.uid.startsWith('synthetic-firestore-')) throw new Fault(403, 'PROVISIONING_DENIED', 'Synthetic identities only.');
  }
  // Firestore callbacks are driven explicitly by each test.
  override async alarm(): Promise<void> {}
  async driveAlarm(due = false): Promise<void> {
    if (due) await this.ctx.storage.setAlarm(Date.now() - 1);
    await super.alarm();
  }
  protected override async reconcile(access: Access): Promise<boolean> {
    const result = await this.invoke(access, 'job.get');
    if (!result.ok || !result.data) return false;
    const job = result.data as StoredJob;
    await this.ctx.storage.put('synthetic-reconciliations', Number(await this.ctx.storage.get('synthetic-reconciliations') ?? 0) + 1);
    const updated = await this.invoke(access, 'job.update', { id: job.id, expected_job_revision: job.revision, patch: { status: 'UNCERTAIN', next_poll_at: 0 } });
    if (!updated.ok) throw new Error(updated.code);
    return true;
  }
  async fault(mode: string, count = 1) { this.mode = mode; this.countdown = count; }
  async budget(limit: number, changeCheckpoint: boolean) { this.requestBudget = limit; this.changeCheckpoint = changeCheckpoint; }
  async requestCount() { return this.requests; }
  async inspect(access: Access) {
    const path = await workspaceDocumentPath(access), client = super.firestore();
    return { authority: await client.read(path), local: this.control(), alarm: await this.ctx.storage.getAlarm(),
      reconciliations: await this.ctx.storage.get('synthetic-reconciliations') ?? 0,
      tables: this.sql<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_cf_%'").map(row => row.name) };
  }
  async wipeCache() { await this.ctx.storage.deleteAll(); this.hasWorkspace = undefined; this.schemaReady = false; }
  async loseSchedulerIdentity() { await this.ctx.storage.delete('firestore-access'); }
  async removeAuthority(access: Access) {
    const client = super.firestore(), path = await workspaceDocumentPath(access), current = await client.read(path);
    if (current) await client.commit([{ path, delete: true, currentDocument: { updateTime: current.updateTime } }]);
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { access, name, operation, input = {} } = await request.json() as { access: Access; name: string; operation: string; input: Input };
    const store = env.WORKSPACES.get(env.WORKSPACES.idFromName(name));
    if (operation === 'test.fault') { await store.fault(String(input.mode), Number(input.count ?? 1)); return Response.json({ ok: true, data: {} }); }
    if (operation === 'test.budget') { await store.budget(Number(input.limit), input.changeCheckpoint === true); return Response.json({ ok: true, data: {} }); }
    if (operation === 'test.requests') return Response.json({ ok: true, data: await store.requestCount() });
    if (operation === 'test.inspect') return Response.json({ ok: true, data: await store.inspect(access) });
    if (operation === 'test.wipe') { await store.wipeCache(); return Response.json({ ok: true, data: {} }); }
    if (operation === 'test.lose-access') { await store.loseSchedulerIdentity(); return Response.json({ ok: true, data: {} }); }
    if (operation === 'test.remove-authority') { await store.removeAuthority(access); return Response.json({ ok: true, data: {} }); }
    if (operation === 'test.alarm') { await store.driveAlarm(input.due === true); return Response.json({ ok: true, data: {} }); }
    if (operation === 'test.repair') return Response.json({ ok: true, data: { repaired: await store.repair(access) } });
    return Response.json(await store.invoke(access, operation, input));
  },
} satisfies ExportedHandler<Env>;
