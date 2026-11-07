import { base64url } from 'jose';
import { Workspace as SqlWorkspace, WORKSPACE_READS } from '../storage/workspace';
import { check, digest, size } from '../storage/domain';
import { Fault, failure, object, type Access, type Input, type Result, type StorageEnv, type StoredJob } from '../contracts';
import { FirestoreClient, type FirestoreDocument, type FirestoreEnv, type FirestorePort, type FirestoreWrite } from './client';

const TABLES = ['workspace', 'items', 'bodies', 'groups', 'settings', 'imports', 'jobs', 'credentials', 'receipts'] as const;
type Table = typeof TABLES[number];
type Row = Record<string, string | number | null>;
type ProjectionRecord = { table: Table; key: string; row: Row };
type LocalMeta = { checkpoint: string; pending: string; control: string };
export interface FirestoreWorkspaceEnv extends StorageEnv, FirestoreEnv { FIRESTORE_ENABLED?: string; FIRESTORE_WORKSPACE_LIMIT?: string }
export interface WorkspaceCheckpoint extends Input {
  schema: 1; uid: string; generation: string; checkpoint: number; commitId: string;
  status: string; wakeAt: number | null; recordCount: number; storedBytes: number;
}
const TERMINAL = new Set(['COMPLETE', 'COMPLETED', 'DISMISSED', 'CANCELLED', 'DELETED', 'FAILED']);
const MAX_RECORDS = 2400;
const CONTROL_RESERVE = 2048;
const HYDRATION_PAGE = 10;
const encoder = new TextEncoder();

export async function workspaceDocumentPath(access: Access): Promise<string> {
  return `s2sWorkspaces/${await digest(`${access.uid}\0${access.generation}`)}`;
}
function keyColumn(table: Table): string { return table === 'workspace' ? 'singleton' : 'id'; }
function recordPath(path: string, table: Table, key: string): string {
  return `${path}/records/${base64url.encode(encoder.encode(`${table}\0${key}`))}`;
}
function recordData(record: ProjectionRecord): Input {
  return { table: record.table, key: record.key, row: JSON.stringify(record.row) };
}
/** Conservative document estimate, separate from metered/indexed production capacity. */
function recordBytes(path: string, data: Input): number {
  return encoder.encode(path).byteLength + size(data) + 256;
}
function invalid(): never { throw new Fault(503, 'STORAGE_INCONSISTENT', 'Stored data could not be verified. Please try again later.'); }
function checkpoint(doc: FirestoreDocument, access: Access): WorkspaceCheckpoint {
  const value = doc.data;
  if (value.schema !== 1 || value.uid !== access.uid || value.generation !== access.generation ||
    !Number.isSafeInteger(value.checkpoint) || Number(value.checkpoint) < 1 || typeof value.commitId !== 'string' ||
    !['active', 'suspended', 'deleting', 'deleted'].includes(String(value.status)) ||
    !(value.wakeAt === null || (Number.isSafeInteger(value.wakeAt) && Number(value.wakeAt) > 0)) ||
    !Number.isSafeInteger(value.recordCount) || Number(value.recordCount) < 0 || Number(value.recordCount) > MAX_RECORDS ||
    !Number.isSafeInteger(value.storedBytes) || Number(value.storedBytes) < 0) invalid();
  return value as WorkspaceCheckpoint;
}

/**
 * Firestore is authoritative. SQLite is a fenced, disposable projection of its
 * records so the existing tested domain transitions remain shared. Never switch
 * a Firestore namespace back to SQL mode: a speculative projection is not a DB.
 */
export class FirestoreWorkspace<Env extends FirestoreWorkspaceEnv = FirestoreWorkspaceEnv> extends SqlWorkspace<Env> {
  private tail: Promise<unknown> = Promise.resolve();
  private client?: FirestorePort;
  private current?: FirestoreDocument;
  private operationId = '';
  private path = '';
  protected firestore(): FirestorePort { return this.client ??= new FirestoreClient(this.env); }
  protected enabled(): boolean { return this.env.FIRESTORE_ENABLED === 'true'; }
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.tail.then(work, work);
    this.tail = next.catch(() => {}); return next;
  }
  protected override schema(): void {
    super.schema();
    if (!this.enabled()) return;
    this.sql('CREATE TABLE IF NOT EXISTS projection_meta (singleton INTEGER PRIMARY KEY CHECK(singleton=1),checkpoint TEXT NOT NULL,pending TEXT NOT NULL,control TEXT NOT NULL)');
    this.sql('CREATE TABLE IF NOT EXISTS projection_changes (table_name TEXT NOT NULL,id TEXT NOT NULL,PRIMARY KEY(table_name,id))');
    this.sql('CREATE TABLE IF NOT EXISTS projection_sizes (table_name TEXT NOT NULL,id TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(table_name,id))');
    for (const table of TABLES) {
      const key = keyColumn(table);
      for (const operation of ['INSERT', 'UPDATE', 'DELETE']) {
        const source = operation === 'DELETE' ? 'OLD' : 'NEW';
        this.sql(`CREATE TRIGGER IF NOT EXISTS projection_${table}_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN
          INSERT INTO projection_changes(table_name,id) VALUES('${table}',CAST(${source}.${key} AS TEXT)) ON CONFLICT(table_name,id) DO NOTHING; END`);
      }
    }
  }
  protected override beforeMutation(): void {
    if (!this.enabled()) return;
    this.sql("INSERT INTO projection_meta VALUES(1,'',?,'') ON CONFLICT(singleton) DO UPDATE SET pending=excluded.pending", this.operationId);
  }
  /** Root supplies a member-document version fence along with the fresh lookup. */
  protected async provisionFences(_access: Access): Promise<FirestoreWrite[]> { return []; }
  protected override async provision(access: Access): Promise<Result> {
    if (!this.enabled() || this.control()) return super.provision(access);
    // No blockConcurrencyWhile across remote I/O. invoke's queue owns isolation.
    await this.authorizeProvision(access);
    return this.initializeWorkspace(access);
  }
  protected override async schedule(): Promise<void> {
    if (!this.enabled()) await super.schedule();
    // In Firestore mode, scheduling is allowed only after authority confirms.
  }
  protected override usage() {
    const usage = super.usage();
    if (!this.enabled()) return usage;
    return { ...usage, firestoreStoredBytes: Number(this.current?.data.storedBytes ?? 0),
      storageMetric: 'Firestore document estimate plus a disposable SQLite cache. Metered storage and capacity remain release gates.' };
  }
  private localMeta(): LocalMeta | undefined {
    const exists = this.sql("SELECT name FROM sqlite_master WHERE type='table' AND name='projection_meta'").length;
    return exists ? this.sql<LocalMeta>('SELECT checkpoint,pending,control FROM projection_meta WHERE singleton=1')[0] : undefined;
  }
  private assertLegacyNamespace(): void {
    if (this.sql("SELECT name FROM sqlite_master WHERE type='table' AND name='projection_meta'").length)
      throw new Fault(503, 'STORAGE_BACKEND_MISMATCH', 'This workspace requires its Firestore backend.');
  }
  private resetMemory(): void { this.hasWorkspace = undefined; this.schemaReady = false; this.current = undefined; }
  private async rememberAccess(access: Access): Promise<void> {
    const previous = await this.ctx.storage.get<Access>('firestore-access');
    if (previous?.uid !== access.uid || previous.generation !== access.generation) await this.ctx.storage.put('firestore-access', access);
  }
  private async clearProjection(): Promise<void> {
    await this.ctx.storage.deleteAlarm(); await this.ctx.storage.deleteAll(); this.resetMemory();
  }
  private parseRecord(doc: FirestoreDocument): ProjectionRecord {
    const { table, key, row } = doc.data;
    if (!TABLES.includes(table as Table) || typeof key !== 'string' || key.length > 500 || typeof row !== 'string' || size(doc.data) > 700_000) invalid();
    if (doc.path !== recordPath(this.path, table as Table, key)) invalid();
    let parsed: Input;
    try { parsed = object(JSON.parse(row)); } catch { invalid(); }
    if (!Number.isSafeInteger(parsed._rowid) || Number(parsed._rowid) < 1 || String(parsed[keyColumn(table as Table)]) !== key ||
      Object.entries(parsed).some(([name, value]) => !/^[a-z_]+$/.test(name) || !(value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))))) invalid();
    return { table: table as Table, key, row: parsed as Row };
  }
  private install(doc: FirestoreDocument, records: ProjectionRecord[]): void {
    this.ctx.storage.transactionSync(() => {
      this.schema();
      for (const table of TABLES) this.sql(`DELETE FROM ${table}`);
      this.sql('DELETE FROM projection_sizes');
      const tableColumns = new Map(TABLES.map(table => [table, new Set(this.sql<{ name: string }>(`PRAGMA table_info(${table})`).map(column => column.name))]));
      for (const record of records.sort((a, b) => Number(a.row._rowid) - Number(b.row._rowid))) {
        const allowed = tableColumns.get(record.table)!;
        const columns = Object.keys(record.row).filter(column => column !== '_rowid');
        if (columns.length !== allowed.size || columns.some(column => !allowed.has(column))) invalid();
        const names = ['rowid', ...columns], values = [record.row._rowid!, ...columns.map(column => record.row[column]!)];
        this.sql(`INSERT INTO ${record.table}(${names.join(',')}) VALUES(${names.map(() => '?').join(',')})`, ...values);
        this.sql('INSERT INTO projection_sizes VALUES(?,?,?)', record.table, record.key, recordBytes(recordPath(this.path, record.table, record.key), recordData(record)));
      }
      const own = this.control();
      if (!own || own.uid !== doc.data.uid || own.generation !== doc.data.generation || own.status !== doc.data.status) invalid();
      this.sql('DELETE FROM projection_changes');
      this.sql("INSERT INTO projection_meta VALUES(1,?,'',?) ON CONFLICT(singleton) DO UPDATE SET checkpoint=excluded.checkpoint,pending='',control=excluded.control", doc.updateTime, JSON.stringify(doc.data));
    });
    this.current = doc;
  }
  private async synchronize(access: Access): Promise<FirestoreDocument | null> {
    this.path = await workspaceDocumentPath(access);
    let doc = await this.firestore().read(this.path);
    if (!doc) {
      // A local cache must never bootstrap authority or resurrect a deleted DB.
      if (this.control() || this.localMeta()) await this.clearProjection();
      this.current = undefined; return null;
    }
    let authority = checkpoint(doc, access);
    if (authority.status === 'deleted') {
      if (this.control() || this.localMeta()) await this.clearProjection();
      this.current = doc; return doc;
    }
    await this.rememberAccess(access);
    if (authority.purging === true) { this.current = doc; return doc; }
    const meta = this.localMeta(), own = this.control();
    if (meta?.checkpoint === doc.updateTime && !meta.pending && own?.uid === access.uid && own.generation === access.generation) {
      this.current = doc; return doc;
    }
    // Core document listing is used to reconstruct a consistent local projection,
    // not to query/filter the user's library. Enterprise pipelines are unnecessary.
    for (let attempt = 0; attempt < 2; attempt++) {
      const records: ProjectionRecord[] = []; let pageToken: string | undefined; let pages = 0;
      do {
        if (++pages > Math.ceil(MAX_RECORDS / HYDRATION_PAGE) + 1) invalid();
        // Nested JSON text can expand on the REST wire. Ten maximum-size job
        // records remain below the client's bounded response allocation.
        const page = await this.firestore().list(`${this.path}/records`, { pageSize: HYDRATION_PAGE, ...(pageToken ? { pageToken } : {}) });
        records.push(...page.documents.map(record => this.parseRecord(record)));
        if (records.length > MAX_RECORDS) invalid();
        pageToken = page.nextPageToken;
      } while (pageToken);
      const after = await this.firestore().read(this.path);
      if (!after) invalid();
      authority = checkpoint(after, access);
      if (after.updateTime === doc.updateTime) {
        if (authority.status === 'deleted' || records.length !== authority.recordCount ||
          records.filter(record => record.table === 'workspace').length !== 1) invalid();
        const bytes = records.reduce((total, record) => total + recordBytes(recordPath(this.path, record.table, record.key), recordData(record)), CONTROL_RESERVE);
        if (bytes !== authority.storedBytes) invalid();
        this.install(after, records);
        await this.rememberAccess(access);
        return after;
      }
      doc = after;
      if (authority.status === 'deleted') { await this.clearProjection(); this.current = after; return after; }
    }
    throw new Fault(409, 'FIRESTORE_CONFLICT', 'Your workspace changed while loading. Please refresh it.');
  }
  private changes(): { writes: FirestoreWrite[]; sizes: { table: Table; key: string; bytes: number }[]; count: number; bytes: number } {
    const writes: FirestoreWrite[] = [], sizes: { table: Table; key: string; bytes: number }[] = [];
    let count = 0, bytes = 0;
    for (const change of this.sql<{ table_name: Table; id: string }>('SELECT table_name,id FROM projection_changes ORDER BY table_name,id')) {
      const table = change.table_name, key = change.id;
      if (!TABLES.includes(table)) invalid();
      const path = recordPath(this.path, table, key);
      const row = this.sql<Row>(`SELECT rowid AS _rowid,* FROM ${table} WHERE ${keyColumn(table)}=?`, key)[0];
      const prior = this.sql<{ bytes: number }>('SELECT bytes FROM projection_sizes WHERE table_name=? AND id=?', table, key)[0];
      if (row) {
        const data = recordData({ table, key, row }), stored = recordBytes(path, data);
        writes.push({ path, data }); sizes.push({ table, key, bytes: stored });
        bytes += stored - (prior?.bytes ?? 0); if (!prior) count++;
      } else if (prior) {
        writes.push({ path, delete: true }); sizes.push({ table, key, bytes: 0 }); bytes -= prior.bytes; count--;
      }
    }
    return { writes, sizes, count, bytes };
  }
  private wakeAt(): number | null {
    if (this.control()?.status !== 'active') return null;
    const jobs = this.sql<{ data: string }>('SELECT data FROM jobs ORDER BY rowid DESC').map(row => JSON.parse(row.data) as StoredJob);
    const job = jobs.find(job => !TERMINAL.has(job.status) && !job.applied_at);
    if (!job || !['QUEUED', 'STARTING', 'RUNNING', 'APPLYING'].includes(job.status)) return null;
    const due = job.status === 'STARTING' ? Number(job.submission_deadline ?? Date.parse(job.created_at) + 120_000) + 1000 : Number(job.next_poll_at ?? 0);
    return Number.isSafeInteger(due) && due > 0 ? Math.max(due, Number(job.lease_until ?? 0)) : null;
  }
  private async applyWake(doc: FirestoreDocument | undefined): Promise<void> {
    const wake = doc?.data.status === 'active' ? Number(doc.data.wakeAt ?? 0) : 0;
    if (Number.isSafeInteger(wake) && wake > 0) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, wake));
    else await this.ctx.storage.deleteAlarm();
  }
  private clean(doc: FirestoreDocument, sizes: { table: Table; key: string; bytes: number }[]): void {
    this.ctx.storage.transactionSync(() => {
      for (const row of sizes) {
        if (row.bytes) this.sql('INSERT INTO projection_sizes VALUES(?,?,?) ON CONFLICT(table_name,id) DO UPDATE SET bytes=excluded.bytes', row.table, row.key, row.bytes);
        else this.sql('DELETE FROM projection_sizes WHERE table_name=? AND id=?', row.table, row.key);
      }
      this.sql('DELETE FROM projection_changes');
      this.sql("INSERT INTO projection_meta VALUES(1,?,'',?) ON CONFLICT(singleton) DO UPDATE SET checkpoint=excluded.checkpoint,pending='',control=excluded.control", doc.updateTime, JSON.stringify(doc.data));
    });
    this.current = doc;
  }
  private async persist(access: Access, original: FirestoreDocument | null, provision: boolean): Promise<void> {
    const changes = this.changes();
    if (!changes.writes.length) {
      this.sql("UPDATE projection_meta SET pending='' WHERE singleton=1");
      await this.applyWake(original ?? undefined); return;
    }
    const own = this.control()!;
    const data: WorkspaceCheckpoint = { schema: 1, uid: access.uid, generation: access.generation,
      checkpoint: Number(original?.data.checkpoint ?? 0) + 1, commitId: this.operationId, status: own.status,
      wakeAt: this.wakeAt(), recordCount: Number(original?.data.recordCount ?? 0) + changes.count,
      storedBytes: Number(original?.data.storedBytes ?? CONTROL_RESERVE) + changes.bytes };
    const configured = this.env.FIRESTORE_WORKSPACE_LIMIT;
    const limit = configured && /^\d+$/.test(configured) ? Math.min(8_000_000, Number(configured)) : 8_000_000;
    check(data.storedBytes <= limit, 'STORAGE_PRESSURE', 'Your workspace needs storage headroom before another change.', 409);
    const fences = provision && !original ? await this.provisionFences(access) : [];
    const writes: FirestoreWrite[] = [{ path: this.path, data,
      currentDocument: original ? { updateTime: original.updateTime } : { exists: false } }, ...changes.writes, ...fences];
    check(writes.length <= 500 && size(writes) < 7_000_000, 'REQUEST_TOO_LARGE', 'Split this change into a smaller batch.', 413);
    await this.ctx.storage.put('firestore-access', access);
    // Durable recovery is armed before Firestore can accept a new wake intent.
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    let confirmed: FirestoreDocument;
    try {
      const result = await this.firestore().commit(writes);
      const updateTime = result.writeResults[0]?.updateTime;
      if (!updateTime) invalid();
      confirmed = { path: this.path, data, updateTime };
    } catch (error) {
      // A timeout may have committed. Only the unique authoritative commit ID can
      // turn this invocation into success; local SQL surviving proves nothing.
      const observed = await this.firestore().read(this.path).catch(() => null);
      if (!observed || checkpoint(observed, access).commitId !== this.operationId) throw error;
      confirmed = observed;
    }
    this.clean(confirmed, changes.sizes);
    await this.applyWake(confirmed);
  }
  private async purge(access: Access, doc: FirestoreDocument): Promise<Result> {
    let authority = checkpoint(doc, access);
    check(['deleting', 'deleted'].includes(authority.status), 'INVALID_TRANSITION', 'Freeze this workspace before deleting it.', 409);
    if (authority.status === 'deleted') { await this.clearProjection(); return { ok: true, data: { deleted: true } }; }
    await this.ctx.storage.put('firestore-access', access);
    await this.ctx.storage.setAlarm(Date.now() + 1000);
    // A frozen generation cannot accept new writes. Restartable batches avoid
    // Firestore's commit limit; the terminal tombstone is written last.
    for (let batch = 0; batch < 25; batch++) {
      // Cleanup needs names, not source text or encrypted credentials. A field
      // mask keeps even a page of maximum-size job records bounded and cheap.
      const page = await this.firestore().list(`${this.path}/records`, { pageSize: 100, fieldPaths: ['table'] });
      const terminal = page.documents.length === 0;
      const data: WorkspaceCheckpoint = { ...authority, checkpoint: authority.checkpoint + 1, commitId: crypto.randomUUID(),
        status: terminal ? 'deleted' : 'deleting', purging: !terminal, wakeAt: terminal ? null : Date.now() + 1000,
        recordCount: terminal ? 0 : Math.max(0, authority.recordCount - page.documents.length),
        storedBytes: terminal ? 0 : authority.storedBytes };
      const writes: FirestoreWrite[] = [{ path: this.path, data, currentDocument: { updateTime: doc.updateTime } }, ...page.documents.map(record => ({ path: record.path, delete: true as const }))];
      try {
        const committed = await this.firestore().commit(writes);
        const updateTime = committed.writeResults[0]?.updateTime;
        if (!updateTime) invalid();
        doc = { path: this.path, data, updateTime };
      } catch (error) {
        const observed = await this.firestore().read(this.path).catch(() => null);
        if (!observed || checkpoint(observed, access).commitId !== data.commitId) throw error;
        doc = observed;
      }
      authority = checkpoint(doc, access); this.current = doc;
      if (terminal) { await this.clearProjection(); return { ok: true, data: { deleted: true } }; }
    }
    throw new Fault(503, 'DELETION_PENDING', 'Workspace deletion is still in progress. Retry to finish removing it.');
  }
  override async invoke(access: Access, operation: string, input: Input = {}): Promise<Result> {
    if (!this.enabled()) {
      try { this.assertLegacyNamespace(); return await super.invoke(access, operation, input); }
      catch (error) { return failure(error); }
    }
    return this.serialized(async () => {
      try {
        check(typeof access?.uid === 'string' && access.uid.length > 0 && access.uid.length <= 128 && typeof access.generation === 'string' && access.generation.length > 0 && access.generation.length <= 100);
        object(input); check(size(input) <= 262_144, 'REQUEST_TOO_LARGE', 'Use a smaller request.', 413);
        const authority = await this.synchronize(access);
        if (operation === 'close') {
          check(authority, 'NOT_FOUND', 'Workspace not found.', 404);
          return await this.purge(access, authority);
        }
        if (authority?.data.status === 'deleted') throw new Fault(404, 'NOT_FOUND', 'Workspace not found.');
        if (authority?.data.purging === true) throw new Fault(409, 'ACCOUNT_DELETING', 'Workspace deletion is in progress.');
        if (!authority && operation !== 'provision') throw new Fault(404, 'NOT_FOUND', 'Workspace not found.');
        this.operationId = crypto.randomUUID();
        const result = await super.invoke(access, operation, input);
        if (!result.ok) return result;
        if (!WORKSPACE_READS.has(operation)) await this.persist(access, authority, operation === 'provision');
        return result;
      } catch (error) { return failure(error); }
    });
  }
  /** Trusted cron repair can rebuild scheduler state after local cache loss. */
  async repair(access: Access): Promise<void> {
    if (!this.enabled()) return;
    await this.serialized(async () => {
      const doc = await this.synchronize(access);
      if (doc?.data.status === 'deleting' && doc.data.purging === true) await this.purge(access, doc);
      else await this.applyWake(doc ?? undefined);
    });
  }
  override async alarm(): Promise<void> {
    if (!this.enabled()) { this.assertLegacyNamespace(); return super.alarm(); }
    const access = await this.ctx.storage.get<Access>('firestore-access');
    if (!access) return;
    const active = await this.serialized(async () => {
      const doc = await this.synchronize(access);
      if (doc?.data.status === 'deleting' && doc.data.purging === true) { await this.purge(access, doc); return false; }
      await this.applyWake(doc ?? undefined);
      return doc?.data.status === 'active' && Number(doc.data.wakeAt ?? 0) > 0;
    });
    // Reconciliation invokes storage operations itself. Holding the queue while
    // running it would deadlock and could turn a paid submission into a retry.
    if (active) await this.reconcile(access);
    await this.repair(access);
  }
}
