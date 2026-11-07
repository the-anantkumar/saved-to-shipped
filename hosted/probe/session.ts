import { DurableObject } from 'cloudflare:workers';
import { WorkspacePrototype } from '../src/workspace';
import { fixture, fixtureBatch } from './fixtures';
import {
  configuredPlan, expiry, MAX_ADMITTED_REQUESTS, MAX_VERIFICATION_CLAIMS, PROBE_LIMITS,
  type ProbeEnvironment, type ProbeStep,
} from './contract';

type SqlValue = string | number | null;
type Control = {
  id: number; status: string; next_step: number; requests: number; verification_claims: number;
  inflight: string | null; plan: string; expires_at: number;
};
type Outcome = { status: number; body: Record<string, unknown> };
type Meter = { rowsRead: number; rowsWritten: number };

/** One disposable synthetic experiment. This class is not a user workspace API. */
export class ProbeSession extends DurableObject<ProbeEnvironment> {
  private workspace?: WorkspacePrototype;
  private readonly activationId = crypto.randomUUID();
  private readonly guardMeter: Meter = { rowsRead: 0, rowsWritten: 0 };

  constructor(ctx: DurableObjectState, env: ProbeEnvironment) {
    super(ctx, env);
    this.query(`CREATE TABLE IF NOT EXISTS probe_control (
      id INTEGER PRIMARY KEY CHECK(id = 1), status TEXT NOT NULL, next_step INTEGER NOT NULL,
      requests INTEGER NOT NULL, verification_claims INTEGER NOT NULL, inflight TEXT,
      plan TEXT NOT NULL, expires_at INTEGER NOT NULL)`);
    this.query('CREATE TABLE IF NOT EXISTS probe_results (step TEXT PRIMARY KEY, data TEXT NOT NULL)');
    this.query('INSERT OR IGNORE INTO probe_control VALUES (1, ?, 0, 0, 0, NULL, ?, ?)',
      'ACTIVE', configuredPlan(env).join(','), expiry(env) ?? 0);
  }

  private query<T extends Record<string, SqlValue> = Record<string, SqlValue>>(sql: string, ...values: SqlValue[]): T[] {
    const cursor = this.ctx.storage.sql.exec<T>(sql, ...values);
    const rows = cursor.toArray();
    this.guardMeter.rowsRead += cursor.rowsRead;
    this.guardMeter.rowsWritten += cursor.rowsWritten;
    return rows;
  }

  private control(): Control { return this.query<Control>('SELECT * FROM probe_control WHERE id = 1')[0]!; }

  private denied(control: Control): Outcome | undefined {
    if (control.status === 'CLOSED') return { status: 410, body: { error: 'PROBE_CLOSED' } };
    if (control.plan !== configuredPlan(this.env).join(',') || control.expires_at !== expiry(this.env)) {
      return { status: 409, body: { error: 'PROBE_CONFIGURATION_CHANGED' } };
    }
    if (Date.now() >= control.expires_at) return { status: 410, body: { error: 'PROBE_EXPIRED' } };
    if (control.requests >= MAX_ADMITTED_REQUESTS) return { status: 429, body: { error: 'PROBE_REQUEST_LIMIT' } };
  }

  private admit(control: Control): void {
    this.query('UPDATE probe_control SET requests = requests + 1 WHERE id = 1');
    control.requests++;
  }

  private instrumentation() {
    return {
      activationId: this.activationId, guardCursorRows: { ...this.guardMeter },
      note: 'Guard cursor counters are process-local and include control SQL. They are not platform billing counters.',
    };
  }

  report(): string { return JSON.stringify(this.reportResult()); }

  private reportResult(): Outcome {
    return this.ctx.storage.transactionSync(() => {
      const control = this.control();
      const denied = this.denied(control);
      if (denied) return denied;
      this.admit(control);
      const results = this.query<{ step: string; data: string }>('SELECT step, data FROM probe_results ORDER BY rowid')
        .map(row => ({ step: row.step, result: JSON.parse(row.data) }));
      return { status: 200, body: {
        plan: control.plan.split(','), nextStep: control.plan.split(',')[control.next_step] ?? null,
        admittedRequests: control.requests, maxAdmittedRequests: MAX_ADMITTED_REQUESTS,
        verificationClaims: control.verification_claims, maxVerificationClaims: MAX_VERIFICATION_CLAIMS,
        inflight: control.inflight, results, sqliteUsedBytes: this.ctx.storage.sql.databaseSize,
        storageMetric: 'Used SQLite pages, including the probe ledger; excludes free pages and WAL.',
        ...this.instrumentation(),
      } };
    });
  }

  async step(step: ProbeStep): Promise<string> { return JSON.stringify(await this.stepResult(step)); }

  private async stepResult(step: ProbeStep): Promise<Outcome> {
    // Persist the attempt before any measurement work. If execution is uncertain,
    // a restart sees inflight and never silently repeats that step.
    const claim = this.ctx.storage.transactionSync((): Outcome | undefined => {
      const control = this.control();
      const denied = this.denied(control);
      if (denied) return denied;
      this.admit(control);
      const saved = this.query<{ data: string }>('SELECT data FROM probe_results WHERE step = ?', step)[0];
      if (saved) return { status: 200, body: { replay: true, result: JSON.parse(saved.data), ...this.instrumentation() } };
      if (control.inflight) return { status: 409, body: { error: 'PROBE_ATTEMPT_UNCERTAIN', step: control.inflight } };
      if (control.plan.split(',')[control.next_step] !== step) {
        return { status: 409, body: { error: 'PROBE_STEP_OUT_OF_ORDER' } };
      }
      this.query('UPDATE probe_control SET inflight = ? WHERE id = 1', step);
    });
    if (claim) return claim;
    await this.ctx.storage.sync();
    try {
      return this.ctx.storage.transactionSync((): Outcome => {
        const control = this.control();
        // Cleanup may win while the durable preclaim is flushing. Do not even
        // construct the adapter until this lifecycle check has passed.
        if (control.status !== 'ACTIVE') return { status: 410, body: { error: 'PROBE_CLOSED' } };
        if (control.inflight !== step) return { status: 409, body: { error: 'PROBE_ATTEMPT_UNCERTAIN' } };
        if (Date.now() >= control.expires_at) return { status: 410, body: { error: 'PROBE_EXPIRED' } };
        const workspace = this.workspace ??= new WorkspacePrototype(this.ctx, this.env);
        const before = workspace.stats();
        const result = this.perform(workspace, step);
        const after = workspace.stats();
        if (after.items > 50 || after.sqliteUsedBytes > PROBE_LIMITS.physicalBytes) throw new Error('Probe bound exceeded');
        const measured = {
          step, result, before, after,
          workspaceCursorDelta: { rowsRead: after.rowsRead - before.rowsRead, rowsWritten: after.rowsWritten - before.rowsWritten },
        };
        this.query('INSERT INTO probe_results (step, data) VALUES (?, ?)', step, JSON.stringify(measured));
        this.query('UPDATE probe_control SET next_step = next_step + 1, inflight = NULL WHERE id = 1');
        if (this.ctx.storage.sql.databaseSize > PROBE_LIMITS.physicalBytes) throw new Error('Probe ledger bound exceeded');
        return { status: 200, body: { replay: false, result: measured,
          sqliteUsedBytesAfterLedger: this.ctx.storage.sql.databaseSize, ...this.instrumentation() } };
      });
    } catch {
      // The preclaim is intentionally retained. No automatic retry after a
      // failed transaction, runtime error or response loss can repeat its work.
      this.workspace = undefined;
      return { status: 409, body: { error: 'PROBE_ATTEMPT_UNCERTAIN', step } };
    }
  }

  private perform(workspace: WorkspacePrototype, step: ProbeStep): Record<string, unknown> {
    if (step === 'seed-1' || step === 'seed-2') {
      const result = workspace.writeBatch(fixtureBatch(step === 'seed-1' ? 0 : 25), PROBE_LIMITS);
      if (!result.ok) throw new Error('Fixed fixture did not fit');
      return result;
    }
    if (step === 'read') {
      const page = workspace.list('learning', 25);
      return { returnedItems: page.rows.length, rowsRead: page.rowsRead, queryPlan: page.plan };
    }
    if (step === 'edit') {
      const result = workspace.writeBatch([fixture(0, 1)], PROBE_LIMITS);
      if (!result.ok) throw new Error('Fixed edit did not fit');
      return result;
    }
    if (step === 'reject') {
      const previous = JSON.stringify(workspace.exportData());
      const used = workspace.stats().sqliteUsedBytes;
      const result = workspace.writeBatch([{ ...fixture(0, 1), note: '🚀'.repeat(16_384) }],
        { ...PROBE_LIMITS, physicalBytes: used + 4096 });
      const exportUnchanged = JSON.stringify(workspace.exportData()) === previous;
      if (result.code !== 'PHYSICAL_LIMIT' || !exportUnchanged) throw new Error('Rollback assertion failed');
      return { ...result, exportUnchanged };
    }
    if (step === 'delete') {
      const result = workspace.deleteBatch([fixture(49).id], PROBE_LIMITS);
      if (!result.ok) throw new Error('Fixed deletion failed');
      return result;
    }
    if (step === 'fts') {
      const result = workspace.enableSearch(PROBE_LIMITS);
      if (!result.ok) throw new Error('Fixed index did not fit');
      return result;
    }
    const result = workspace.search('term1r0v1', 25);
    return { returnedItems: result.rows.length, rowsRead: result.rowsRead, rowsWritten: result.rowsWritten };
  }

  async claimVerification(sample: number): Promise<string> { return JSON.stringify(await this.verificationResult(sample)); }

  private async verificationResult(sample: number): Promise<Outcome> {
    const result = this.ctx.storage.transactionSync((): Outcome => {
      const control = this.control();
      const denied = this.denied(control);
      if (denied) return denied;
      this.admit(control);
      if (!Number.isInteger(sample) || sample < 1 || sample > MAX_VERIFICATION_CLAIMS) {
        return { status: 400, body: { error: 'INVALID_SAMPLE' } };
      }
      if (sample <= control.verification_claims) return { status: 409, body: { error: 'VERIFICATION_ALREADY_CLAIMED' } };
      if (sample !== control.verification_claims + 1) return { status: 409, body: { error: 'VERIFICATION_OUT_OF_ORDER' } };
      this.query('UPDATE probe_control SET verification_claims = verification_claims + 1 WHERE id = 1');
      return { status: 200, body: { sample, granted: true, ...this.instrumentation() } };
    });
    await this.ctx.storage.sync();
    if (result.status === 200 && this.control().status === 'CLOSED') return { status: 410, body: { error: 'PROBE_CLOSED' } };
    return result;
  }

  cleanup(): string { return JSON.stringify(this.cleanupResult()); }

  private cleanupResult(): Outcome {
    return this.ctx.storage.transactionSync(() => {
      const control = this.control();
      if (control.status === 'CLOSED') return { status: 200, body: { closed: true, replay: true, sqliteUsedBytes: this.ctx.storage.sql.databaseSize } };
      // Delete only this class's known synthetic tables. Retain a small durable
      // tombstone, never deleteAll followed by a non-atomic tombstone write.
      for (const trigger of ['content_ai', 'content_ad', 'content_au']) this.query(`DROP TRIGGER IF EXISTS ${trigger}`);
      this.query('DROP TABLE IF EXISTS search');
      for (const table of ['content', 'items', 'groups', 'jobs', 'settings', 'usage', 'schema_versions']) {
        this.query(`DROP TABLE IF EXISTS ${table}`);
      }
      this.query('DELETE FROM probe_results');
      this.query("UPDATE probe_control SET status = 'CLOSED', inflight = NULL WHERE id = 1");
      this.workspace = undefined;
      return { status: 200, body: { closed: true, replay: false, sqliteUsedBytes: this.ctx.storage.sql.databaseSize,
        cleanupNote: 'A durable tombstone and ledger schema remain. This does not claim zero allocated or billed storage.',
        ...this.instrumentation(),
      } };
    });
  }

  fetch() { return new Response('Probe RPC only', { status: 404 }); }
}
