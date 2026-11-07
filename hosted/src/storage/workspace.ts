import { DurableObject } from 'cloudflare:workers';
import { Fault, LIMITS, failure, integer, object, string, type Access, type Input, type Result, type StorageEnv, type StoredJob } from '../contracts';
import { boundedJson, check, classification, digest, editItem, editReading, hasContext, importedItem, localClassification, metadata, now, readingState, size, type Group, type Item } from './domain';
import { foldName } from './casefold';

type Control = { uid: string; generation: string; status: string; revision: number; library_revision: number; logical_bytes: number; item_count: number; lifecycle_epoch: number };
type ItemRow = { id: string; source: string; revision: number; meta: string; bytes: number; origin_job: string; origin_quality: number; source_revision: number; incarnation: string };
type RecordRow = { id: string; data: string; bytes: number };
type Table = 'groups' | 'settings' | 'imports' | 'jobs' | 'credentials' | 'receipts';
const TABLES: Table[] = ['groups', 'settings', 'imports', 'jobs', 'credentials', 'receipts'];
const READS = new Set(['state', 'list', 'search', 'detail', 'details', 'export', 'import.plan', 'credential.get', 'job.get']);
const TERMINAL = new Set(['COMPLETE', 'COMPLETED', 'DISMISSED', 'CANCELLED', 'DELETED', 'FAILED']);
const USER_MUTATIONS = new Set(['capture', 'item', 'delete', 'move', 'reading', 'project', 'settings', 'classify', 'triage', 'import', 'restore', 'credential.set', 'job.begin']);

/** Production storage contract; separate from the preserved P1 measurement class. */
export class Workspace<Env extends StorageEnv = StorageEnv> extends DurableObject<Env> {
  private reservationCredit = 0;
  private schemaReady = false;
  private hasWorkspace: boolean | undefined;
  // Construction and absent-object reads must never allocate schema or alarms.
  private schema() {
    this.sql(`CREATE TABLE IF NOT EXISTS workspace (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), uid TEXT NOT NULL, generation TEXT NOT NULL,
      status TEXT NOT NULL, revision INTEGER NOT NULL, library_revision INTEGER NOT NULL DEFAULT 0,
      logical_bytes INTEGER NOT NULL, item_count INTEGER NOT NULL, lifecycle_epoch INTEGER NOT NULL DEFAULT 0)`);
    this.hasWorkspace = true;
    const columns = this.sql<{ name: string }>('PRAGMA table_info(workspace)');
    if (!columns.some(column => column.name === 'lifecycle_epoch'))
      this.sql('ALTER TABLE workspace ADD COLUMN lifecycle_epoch INTEGER NOT NULL DEFAULT 0');
    if (!columns.some(column => column.name === 'library_revision')) {
      this.sql('ALTER TABLE workspace ADD COLUMN library_revision INTEGER NOT NULL DEFAULT 0');
      this.sql('UPDATE workspace SET library_revision=revision WHERE singleton=1');
    }
    this.sql(`CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY, source TEXT UNIQUE NOT NULL, revision INTEGER NOT NULL,
      kind TEXT NOT NULL, status TEXT NOT NULL, group_id TEXT NOT NULL, saved_at TEXT NOT NULL,
      has_context INTEGER NOT NULL,
      meta TEXT NOT NULL, bytes INTEGER NOT NULL, origin_job TEXT NOT NULL DEFAULT '', origin_quality INTEGER NOT NULL DEFAULT 0,
      source_revision INTEGER NOT NULL DEFAULT 0, incarnation TEXT NOT NULL)`);
    this.sql('CREATE INDEX IF NOT EXISTS items_library ON items(kind,group_id,status,id)');
    this.sql('CREATE INDEX IF NOT EXISTS items_classify ON items(kind,status,has_context,id)');
    this.sql('CREATE TABLE IF NOT EXISTS bodies (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    for (const table of TABLES) this.sql(`CREATE TABLE IF NOT EXISTS ${table} (id TEXT PRIMARY KEY, data TEXT NOT NULL, bytes INTEGER NOT NULL)`);
    this.schemaReady = true;
  }
  private sql<T = Record<string, unknown>>(query: string, ...bindings: (string | number | null)[]): T[] {
    return this.ctx.storage.sql.exec(query, ...bindings).toArray() as T[];
  }
  private control() {
    this.hasWorkspace ??= this.sql("SELECT name FROM sqlite_master WHERE type='table' AND name='workspace'").length > 0;
    return this.hasWorkspace ? this.sql<Control>('SELECT * FROM workspace WHERE singleton=1')[0] : undefined;
  }
  /** The application must verify a fresh, matching Registry reservation. */
  protected async authorizeProvision(_access: Access): Promise<void> {
    throw new Fault(403, 'PROVISIONING_DENIED', 'Workspace provisioning is not authorized.');
  }
  private async provision(access: Access): Promise<Result> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const existing = this.control();
        if (existing) {
          this.owned(access);
          return { ok: true, data: { provisioned: true, revision: existing.revision, library_revision: existing.library_revision ?? existing.revision } };
        }
        // No await between fresh authority and the synchronous owner/schema commit.
        await this.authorizeProvision(access);
        return this.ctx.storage.transactionSync(() => {
          this.schema();
          this.sql('INSERT INTO workspace(singleton,uid,generation,status,revision,library_revision,logical_bytes,item_count) VALUES(1,?,?,?,0,0,0,0)', access.uid, access.generation, 'active');
          this.put('settings', 'workspace', this.settings()); this.guard();
          return { ok: true, data: { provisioned: true, revision: 0, library_revision: 0 } };
        });
      } catch (error) { this.hasWorkspace = undefined; this.schemaReady = false; return failure(error); }
    });
  }
  private async close(access: Access): Promise<Result> {
    return this.ctx.blockConcurrencyWhile(async () => {
      try {
        const current = this.control();
        check(current && current.uid === access.uid && current.generation === access.generation, 'NOT_FOUND', 'Workspace not found.', 404);
        check(['deleting', 'closed'].includes(current.status), 'INVALID_TRANSITION', 'Freeze this workspace before deleting it.', 409);
        await this.ctx.storage.deleteAlarm();
        // deleteAll is atomic and deallocates SQL, KV and internal object metadata.
        // A SQL tombstone would retain allocation; Registry owns the terminal state.
        await this.ctx.storage.deleteAll();
        this.hasWorkspace = false; this.schemaReady = false; this.reservationCredit = 0;
        return { ok: true, data: { deleted: true } };
      } catch (error) { this.hasWorkspace = undefined; this.schemaReady = false; return failure(error); }
    });
  }
  private owned(access: Access, allowSuspended = false): Control {
    const control = this.control();
    if (!control || control.uid !== access.uid || control.generation !== access.generation)
      throw new Fault(404, 'NOT_FOUND', 'Workspace not found.');
    if (control.status === 'closed') throw new Fault(410, 'WORKSPACE_DELETED', 'This workspace was deleted.');
    if (control.status !== 'active' && !allowSuspended) throw new Fault(403, 'MEMBERSHIP_SUSPENDED', 'This workspace is suspended.');
    return control;
  }
  private limits() {
    const limit = (value: string | undefined, max: number) => value && /^\d+$/.test(value) ? Math.min(max, Math.max(1, Number(value))) : max;
    return { items: limit(this.env.WORKSPACE_ITEM_LIMIT, LIMITS.items), logicalBytes: limit(this.env.WORKSPACE_LOGICAL_LIMIT, LIMITS.logicalBytes), itemBytes: LIMITS.itemBytes,
      sqliteUsedBytes: limit(this.env.WORKSPACE_USED_LIMIT, LIMITS.sqliteUsedBytes) };
  }
  private usage() {
    const control = this.control()!;
    return { items: control.item_count, logicalBytes: control.logical_bytes, reservedBytes: this.reserved(), sqliteUsedBytes: this.ctx.storage.sql.databaseSize,
      limits: this.limits(), storageMetric: 'Used SQLite pages; physical allocation and production capacity remain release gates.' };
  }
  private reserved(): number { return this.records<StoredJob>('jobs').reduce((sum, job) => sum + (this.active(job) ? Number(job.reserved_bytes ?? 0) : 0), 0); }
  private adjust(bytes: number, items = 0) {
    const control = this.control()!, limits = this.limits();
    check(control.item_count + items <= limits.items, 'ITEM_LIMIT', 'Your saved-item limit is reached.', 409);
    check(control.logical_bytes + bytes + this.reserved() - this.reservationCredit <= limits.logicalBytes, 'LOGICAL_LIMIT', 'Your workspace storage limit is reached.', 409);
    this.sql('UPDATE workspace SET logical_bytes=logical_bytes+?, item_count=item_count+? WHERE singleton=1', bytes, items);
  }
  private guard() {
    check(this.control()!.logical_bytes + this.reserved() <= this.limits().logicalBytes, 'LOGICAL_LIMIT', 'Your workspace storage limit is reached.', 409);
    check(this.ctx.storage.sql.databaseSize <= this.limits().sqliteUsedBytes,
      'STORAGE_PRESSURE', 'This workspace needs storage headroom before another change.', 409);
  }
  private record<T = Input>(table: Table, id: string): T | undefined {
    const row = this.sql<RecordRow>(`SELECT * FROM ${table} WHERE id=?`, id)[0];
    return row ? JSON.parse(row.data) as T : undefined;
  }
  private records<T = Input>(table: Table): T[] { return this.sql<RecordRow>(`SELECT * FROM ${table} ORDER BY rowid DESC`).map(row => JSON.parse(row.data) as T); }
  private put(table: Table, id: string, data: unknown, max = 32_768) {
    const json = JSON.stringify(data), bytes = new TextEncoder().encode(json).byteLength;
    check(bytes <= max, 'INVALID_INPUT', 'The stored operation is too large.');
    const previous = this.sql<RecordRow>(`SELECT * FROM ${table} WHERE id=?`, id)[0];
    if (table === 'groups') {
      const total = this.sql<{ bytes: number }>('SELECT COALESCE(SUM(bytes),0) AS bytes FROM groups')[0]!.bytes;
      check(total + bytes - (previous?.bytes ?? 0) <= 65_536, 'GROUP_STORAGE_LIMIT', 'Section descriptions need to fit within 64 KiB in total.', 409);
    }
    this.adjust(bytes - (previous?.bytes ?? 0));
    this.sql(`INSERT INTO ${table}(id,data,bytes) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data,bytes=excluded.bytes`, id, json, bytes);
  }
  private remove(table: Table, id: string) {
    const row = this.sql<RecordRow>(`SELECT * FROM ${table} WHERE id=?`, id)[0];
    if (row) { this.adjust(-row.bytes); this.sql(`DELETE FROM ${table} WHERE id=?`, id); }
  }
  private prune(table: Table, count: number) {
    const stale = this.sql<{ id: string }>(`SELECT id FROM ${table} ORDER BY rowid DESC LIMIT -1 OFFSET ?`, count);
    for (const row of stale) this.remove(table, row.id);
  }
  private row(id: string) { return this.sql<ItemRow>('SELECT * FROM items WHERE id=?', id)[0]; }
  private cacheRevision(row: Pick<ItemRow, 'incarnation' | 'revision'>): string {
    return `${row.incarnation}:${row.revision}`;
  }
  private get(id: unknown): { item: Item; row: ItemRow } {
    const ident = string(id, 'Item ID', 50, false), row = this.row(ident);
    if (!row) throw new Fault(404, 'NOT_FOUND', 'Save not found.');
    return { item: JSON.parse(this.sql<{ body: string }>('SELECT body FROM bodies WHERE id=?', ident)[0]!.body), row };
  }
  private detail(id: unknown): Input {
    const { item, row } = this.get(id);
    return { ...item, ...metadata(item, row.revision), cache_revision: this.cacheRevision(row), content: item.content, note: item.note,
      why: item.why, next_action: item.next_action, definition_of_done: item.definition_of_done,
      ...(item.enrichment ? { enrichment: item.enrichment } : {}) };
  }
  private save(item: Item, origin?: { job: string; quality: number }, manualContentEdit = false) {
    const previous = this.row(item.id), revision = previous ? previous.revision + 1 : this.control()!.revision + 1;
    const body = JSON.stringify(item), bytes = new TextEncoder().encode(body).byteLength;
    check(bytes <= LIMITS.itemBytes, 'ITEM_STORAGE_LIMIT', 'One save must fit within 128 KiB, including its source text and notes.', 409);
    this.adjust(bytes - (previous?.bytes ?? 0), previous ? 0 : 1);
    const oldContent = previous ? this.get(item.id).item.content : '';
    const sourceRevision = (previous?.source_revision ?? 0) + ((manualContentEdit || (!origin && item.content !== oldContent)) ? 1 : 0);
    this.sql(`INSERT INTO items(id,source,revision,kind,status,group_id,saved_at,has_context,meta,bytes,origin_job,origin_quality,source_revision,incarnation)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,kind=excluded.kind,status=excluded.status,has_context=excluded.has_context,
      group_id=excluded.group_id,saved_at=excluded.saved_at,meta=excluded.meta,bytes=excluded.bytes,origin_job=excluded.origin_job,origin_quality=excluded.origin_quality,source_revision=excluded.source_revision`,
    item.id, `${item.platform}\0${item.url}`, revision, item.kind, item.status, String(item.project_id ?? ''), item.saved_at, Number(hasContext(item)),
    JSON.stringify(metadata(item, revision)), bytes, origin?.job ?? '', origin?.quality ?? 0, sourceRevision, previous?.incarnation ?? crypto.randomUUID());
    this.sql('INSERT INTO bodies(id,body) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body', item.id, body);
    this.sql('UPDATE workspace SET library_revision=library_revision+1 WHERE singleton=1');
  }
  private expect(row: ItemRow, input: Input) {
    check(input.expected_revision === row.revision, 'REVISION_CONFLICT', 'This save changed. Reload it before saving your edit.', 409);
  }
  private settings(): Input { return this.record('settings', 'workspace') ?? { goals: '', model: 'gpt-4.1-mini', board_order: [] }; }
  private group(name: unknown, description: unknown = ''): Group {
    const clean = string(name, 'Section name', 100, false), groups = this.records<Group>('groups');
    const existing = groups.find(group => foldName(group.name) === foldName(clean));
    if (existing) return existing;
    check(groups.length < LIMITS.groups, 'GROUP_LIMIT', 'Your section limit is reached.', 409);
    const group = { id: crypto.randomUUID().replaceAll('-', '').slice(0, 12), name: clean,
      description: string(description, 'Description', 2000), created_at: now() };
    this.put('groups', group.id, group); return group;
  }
  private assignment(item: Item, input: Input) {
    if ('new_project_name' in input) {
      check(!('project_id' in input), 'INVALID_INPUT', 'Choose an existing section or create one.');
      item.project_id = this.group(input.new_project_name).id;
    } else if ('project_id' in input) {
      const id = string(input.project_id, 'Section ID', 50);
      check(!id || this.record('groups', id), 'NOT_FOUND', 'Section not found.', 404); item.project_id = id;
    }
    return item;
  }
  private summary() {
    const settings = this.settings();
    const publicSettings = { extractor_available: Boolean(this.record('credentials', 'apify')),
      ai_available: Boolean(this.record('credentials', 'openai')), model: settings.model, actor: 'data_minds/linkedin-post-scraper' };
    return { version: 1, revision: this.control()!.revision, library_revision: this.control()!.library_revision, items: [], projects: this.records('groups').reverse(), imports: this.records('imports').map(record => this.importSummary(record)),
      goals: settings.goals ?? '', board_order: settings.board_order ?? [], settings: publicSettings,
      ai: { available: publicSettings.ai_available, model: settings.model },
      retrieval_jobs: this.records<StoredJob>('jobs').map(job => this.publicJob(job)),
      jobs: this.records<StoredJob>('jobs').map(job => this.publicJob(job)), usage: this.usage() };
  }
  private publicJob(job: StoredJob) {
    return Object.fromEntries(['id', 'kind', 'status', 'revision', 'created_at', 'updated_at', 'selected_count', 'applied_count', 'classified',
      'missing_count', 'error', 'max_charge', 'changed_ids', 'next_poll_at']
      .filter(key => job[key] !== undefined).map(key => [key, job[key]]));
  }
  private importSummary(record: Input) {
    return Object.fromEntries(['filename', 'rows', 'added', 'duplicates', 'total', 'at'].filter(key => record[key] !== undefined).map(key => [key, record[key]]));
  }
  private page(input: Input, exporting: boolean) {
    const limit = input.limit === undefined ? LIMITS.page : integer(input.limit, 'Page size', 1, LIMITS.page);
    let after = ''; const { revision, library_revision } = this.control()!;
    const snapshotRevision = exporting ? revision : library_revision;
    if (input.cursor) {
      try {
        const cursor = JSON.parse(atob(string(input.cursor, 'Cursor', 300, false)));
        check(cursor.revision === snapshotRevision && cursor.exporting === exporting, 'REVISION_CONFLICT', 'The workspace changed. Restart this list or export.', 409);
        after = string(cursor.after, 'Cursor', 50);
      } catch (error) { if (error instanceof Fault) throw error; throw new Fault(400, 'INVALID_INPUT', 'Invalid cursor.'); }
    }
    const rows = this.sql<ItemRow>('SELECT * FROM items WHERE id>? ORDER BY id LIMIT ?', after, limit + 1);
    const visible: ItemRow[] = [], items: unknown[] = []; let responseBytes = 0;
    for (const row of rows.slice(0, limit)) {
      const item = exporting ? this.get(row.id).item : { ...JSON.parse(row.meta), cache_revision: this.cacheRevision(row) }, bytes = size(item);
      if (items.length && responseBytes + bytes > 131_072) break;
      visible.push(row); items.push(item); responseBytes += bytes;
    }
    const next = rows.length > visible.length ? btoa(JSON.stringify({ revision: snapshotRevision, exporting, after: visible.at(-1)!.id })) : null;
    const settings = this.settings();
    return { items, next_cursor: next, revision, library_revision,
      ...(exporting && !input.cursor ? { workspace: { version: 1, projects: this.records('groups').reverse(), imports: this.records('imports').map(record => this.importSummary(record)), goals: settings.goals ?? '', board_order: settings.board_order ?? [] } } : {}) };
  }
  private changed(id: string): Input {
    const item = this.detail(id);
    return { id, item, revision: item.revision, workspace_revision: this.control()!.revision, library_revision: this.control()!.library_revision, reading: item.reading };
  }
  private receiptResult(saved: Input): Input {
    const result: Input = { ...object(saved.result ?? {}), replayed: true, workspace_revision: this.control()!.revision, library_revision: this.control()!.library_revision };
    if (result._job === true && typeof result.job_id === 'string') return { ...this.job(result.job_id), replayed: true, workspace_revision: result.workspace_revision, library_revision: result.library_revision };
    if (typeof result.project_id === 'string') result.project = this.record('groups', result.project_id);
    if (typeof result.id === 'string' && this.row(result.id)) Object.assign(result, this.changed(result.id));
    if (typeof result.job_id === 'string') result.job = this.record('jobs', result.job_id);
    return result;
  }
  private receiptProjection(result: Input): Input {
    if (['retrieval', 'classification'].includes(String(result.kind)) && Array.isArray(result.selected_ids)) return { _job: true, job_id: result.id };
    const compact = { ...result };
    delete compact.item; delete compact.items; delete compact.projects; delete compact.reading;
    if (compact.project) { compact.project_id = (compact.project as Input).id; delete compact.project; }
    if (compact.job) { compact.job_id = (compact.job as Input).id; delete compact.job; }
    return compact;
  }

  async invoke(access: Access, operation: string, input: Input = {}): Promise<Result> {
    try {
      check(typeof access?.uid === 'string' && access.uid.length > 0 && access.uid.length <= 128 && typeof access.generation === 'string' && access.generation.length <= 100);
      object(input); check(size(input) <= LIMITS.requestBytes, 'REQUEST_TOO_LARGE', 'Use a smaller request.', 413);
      if (operation === 'provision') return await this.provision(access);
      if (operation === 'close') return await this.close(access);
      const prepared: Item[] = [];
      if (['capture', 'import', 'import.plan', 'restore'].includes(operation)) {
        const rows = operation === 'capture' ? [input] : input.rows ?? input.items ?? [];
        check(Array.isArray(rows) && rows.length <= LIMITS.batch, 'INVALID_INPUT', 'Use at most 25 saves per request.');
        for (const row of rows) prepared.push(await importedItem(row, operation === 'restore'));
        if (operation === 'capture') prepared[0]!.note = string(input.note ?? '', 'Note', 20_000);
        for (const item of prepared) check(size(item) <= LIMITS.itemBytes, 'ITEM_STORAGE_LIMIT', 'One save must fit within 128 KiB, including its source text and notes.', 409);
      }
      const receiptInput = operation === 'settings' && typeof input.credential_fingerprint === 'string'
        ? { ...input, credential_updates: undefined } : input;
      const fingerprint = USER_MUTATIONS.has(operation) ? await digest(JSON.stringify({ operation, input: receiptInput })) : '';
      const outcome = this.ctx.storage.transactionSync((): Result => {
        this.reservationCredit = 0;
        this.owned(access, ['suspend', 'resume', 'delete.prepare', 'delete.key'].includes(operation));
        if (!this.schemaReady) this.schema();
        if (operation === 'delete.key') {
          check(this.control()!.status === 'deleting', 'INVALID_TRANSITION', 'Deletion has not started.', 409);
          const active = this.records<StoredJob>('jobs').find(job => this.active(job));
          check(active?.kind === 'retrieval' && active.run_id, 'INVALID_TRANSITION', 'No provider key is needed for this deletion.', 409);
          this.setCredential('apify', input.value); this.guard();
          return { ok: true, data: { repaired: true } };
        }
        if (operation === 'delete.prepare') {
          const job = this.records<StoredJob>('jobs').find(job => this.active(job)) ?? null;
          check(!job || !['STARTING', 'UNCERTAIN'].includes(job.status), 'SUBMISSION_UNCERTAIN', 'Check and dismiss the uncertain provider request before deleting this workspace.', 409);
          const credential = job?.kind === 'retrieval' ? this.record('credentials', 'apify') ?? null : null;
          check(!job?.run_id || credential, 'PROVIDER_KEY_REQUIRED', 'Restore the provider key before deleting this workspace.', 409);
          if (this.control()!.status !== 'deleting') this.sql("UPDATE workspace SET status='deleting',revision=revision+1 WHERE singleton=1");
          const records = TABLES.reduce((count, table) => count + this.sql<{ n: number }>(`SELECT count(*) AS n FROM ${table}`)[0]!.n, 0);
          return { ok: true, data: { job, credential, cleanup_units: 8 * this.control()!.item_count + 4 * records + 64 } };
        }
        if (operation === 'suspend' || operation === 'resume') {
          check(this.control()!.status !== 'deleting', 'ACCOUNT_DELETING', 'Workspace deletion is in progress.', 409);
          const current = this.control()!, epoch = input.lifecycle_epoch === undefined ? current.lifecycle_epoch + 1 : integer(input.lifecycle_epoch, 'Lifecycle version', 1, Number.MAX_SAFE_INTEGER);
          check(epoch >= current.lifecycle_epoch, 'LIFECYCLE_CONFLICT', 'A newer membership change already took effect.', 409);
          if (epoch > current.lifecycle_epoch) this.sql('UPDATE workspace SET status=?,revision=revision+1,lifecycle_epoch=? WHERE singleton=1', operation === 'suspend' ? 'suspended' : 'active', epoch);
          else check(current.status === (operation === 'suspend' ? 'suspended' : 'active'), 'LIFECYCLE_CONFLICT', 'Membership state changed.', 409);
          return { ok: true, data: { status: operation === 'suspend' ? 'suspended' : 'active' } };
        }
        if (READS.has(operation)) return { ok: true, data: this.read(operation, input, prepared) };
        let requestId = '';
        if (USER_MUTATIONS.has(operation)) {
          requestId = string(input.request_id, 'Request ID', 100, false);
          const receipt = this.record('receipts', requestId);
          if (receipt) {
            check(receipt.hash === fingerprint, 'IDEMPOTENCY_CONFLICT', 'This request ID was used for different data.', 409);
            return { ok: true, data: this.receiptResult(receipt) };
          }
        }
        const result = this.mutate(operation, input, prepared);
        this.sql('UPDATE workspace SET revision=revision+1 WHERE singleton=1');
        result.workspace_revision = this.control()!.revision;
        result.library_revision = this.control()!.library_revision;
        if (requestId) {
          this.put('receipts', requestId, { hash: fingerprint, result: this.receiptProjection(result), at: now() }, 8192);
          this.prune('receipts', LIMITS.receipts);
        }
        this.guard();
        return { ok: true, data: result };
      });
      if (outcome.ok && !READS.has(operation)) await this.schedule();
      return outcome;
    } catch (error) { this.hasWorkspace = undefined; this.schemaReady = false; return failure(error); }
  }
  private read(operation: string, input: Input, prepared: Item[]): unknown {
    if (operation === 'state') return this.summary();
    if (operation === 'list' || operation === 'export') return this.page(input, operation === 'export');
    if (operation === 'search') {
      const query = string(input.query ?? '', 'Search query', 200).toLowerCase();
      if (!query) return { ids: this.sql<{ id: string }>('SELECT id FROM items ORDER BY id LIMIT ?', LIMITS.items).map(row => row.id), library_revision: this.control()!.library_revision };
      const groups = new Map(this.records<Group>('groups').map(group => [group.id, group.name]));
      // Logical workspace and item-count limits bound this scan. Return IDs only;
      // source text and notes stay private and never enter a persisted search index.
      const ids = this.sql<{ id: string; body: string }>('SELECT id,body FROM bodies ORDER BY id LIMIT ?', LIMITS.items)
        .filter(row => {
          const item = JSON.parse(row.body) as Item;
          return [item.title, item.author, item.content, item.note, ...(item.tags ?? []), groups.get(String(item.project_id ?? '')) ?? '']
            .some(value => String(value ?? '').toLowerCase().includes(query));
        }).map(row => row.id);
      return { ids, library_revision: this.control()!.library_revision };
    }
    if (operation === 'detail') return this.detail(input.id);
    if (operation === 'details') {
      check(Array.isArray(input.ids) && input.ids.length <= LIMITS.batch);
      return input.ids.map(id => this.detail(id));
    }
    if (operation === 'credential.get') return this.record('credentials', this.provider(input.provider)) ?? null;
    if (operation === 'job.get') {
      if (input.id) return this.job(input.id);
      const jobs = this.records<StoredJob>('jobs'); return jobs.find(job => this.active(job)) ?? jobs[0] ?? null;
    }
    const unique = new Map(prepared.map(item => [item.id, item])), added = [...unique.values()].filter(item => !this.row(item.id));
    const usage = this.usage();
    return { rows: prepared.length, added: added.length, duplicates: prepared.length - added.length,
      estimated_logical_bytes: added.reduce((sum, item) => sum + size(item), 0),
      remaining_items: Math.max(0, usage.limits.items - usage.items), remaining_logical_bytes: Math.max(0, usage.limits.logicalBytes - usage.logicalBytes - usage.reservedBytes), usage };
  }
  private mutate(operation: string, input: Input, prepared: Item[]): Input {
    if (operation === 'capture') {
      const item = prepared[0]!; check(!this.row(item.id), 'ALREADY_SAVED', 'This link is already saved.', 409);
      this.save(item); return this.changed(item.id);
    }
    if (operation === 'item' || operation === 'move' || operation === 'reading') {
      const { item, row } = this.get(input.id); this.expect(row, input);
      let next = operation === 'reading' ? editReading(item, input) : editItem(item, operation === 'move' ? { status: input.status } : input);
      if (operation === 'item') next = this.assignment(next, input);
      if (operation === 'move') this.move(next, input.before_id);
      const origin = 'content' in input ? undefined : { job: row.origin_job, quality: row.origin_quality };
      this.save(next, origin, operation === 'item' && 'content' in input); return this.changed(next.id);
    }
    if (operation === 'delete') {
      const { item, row } = this.get(input.id); this.expect(row, input);
      this.sql('DELETE FROM bodies WHERE id=?', item.id); this.sql('DELETE FROM items WHERE id=?', item.id); this.adjust(-row.bytes, -1);
      this.sql('UPDATE workspace SET library_revision=library_revision+1 WHERE singleton=1');
      const settings = this.settings(); settings.board_order = (settings.board_order as string[]).filter(id => id !== item.id); this.put('settings', 'workspace', settings);
      return { id: item.id, deleted: true };
    }
    if (operation === 'project') {
      const name = string(input.name, 'Section name', 100, false);
      let group: Group;
      if (input.id) {
        const current = this.record<Group>('groups', string(input.id, 'Section ID', 50, false));
        check(current, 'NOT_FOUND', 'Section not found.', 404);
        check(!this.records<Group>('groups').some(other => other.id !== current.id && foldName(other.name) === foldName(name)),
          'GROUP_CONFLICT', 'A section with this name already exists.', 409);
        group = { ...current, name, description: string(input.description ?? '', 'Description', 2000) };
      } else group = { ...this.group(name), description: string(input.description ?? '', 'Description', 2000) };
      this.put('groups', group.id, group); return { id: group.id, project: group };
    }
    if (operation === 'settings') {
      const settings = this.settings();
      if ('goals' in input) settings.goals = string(input.goals, 'Goals', 2000);
      if ('model' in input) settings.model = string(input.model, 'Model', 100, false);
      if (input.credential_updates !== undefined) {
        check(Array.isArray(input.credential_updates) && input.credential_updates.length <= 2);
        const seen = new Set<string>();
        for (const value of input.credential_updates) {
          const update = object(value), provider = this.provider(update.provider);
          check(!seen.has(provider)); seen.add(provider); this.setCredential(provider, update.value);
        }
      }
      this.put('settings', 'workspace', settings); return { ok: true };
    }
    if (operation === 'import' || operation === 'restore') return this.importItems(input, prepared, operation === 'restore');
    if (operation === 'classify' || operation === 'triage') return this.classify(input, operation === 'classify');
    if (operation === 'credential.set') {
      const provider = this.provider(input.provider);
      this.setCredential(provider, input.record);
      return { ok: true };
    }
    if (operation.startsWith('job.')) return this.jobs(operation, input);
    throw new Fault(404, 'NOT_FOUND', 'Operation not found.');
  }
  private move(item: Item, beforeValue: unknown) {
    const before = beforeValue == null ? '' : string(beforeValue, 'Destination', 50);
    const settings = this.settings(), metas = this.sql<{ id: string; status: string; meta: string }>('SELECT id,status,meta FROM items ORDER BY id');
    const existing = Array.isArray(settings.board_order) ? settings.board_order as string[] : [];
    const positions = new Map(existing.map((id, index) => [id, index]));
    metas.sort((a, b) => (positions.get(a.id) ?? Infinity) - (positions.get(b.id) ?? Infinity) || Number(JSON.parse(b.meta).score) - Number(JSON.parse(a.meta).score));
    const order = metas.map(row => row.id).filter(id => id !== item.id);
    let index = order.length;
    if (before) {
      const anchor = metas.find(row => row.id === before);
      check(anchor && before !== item.id && anchor.status === item.status, 'REVISION_CONFLICT', 'The destination changed. Reload the board.', 409);
      index = order.indexOf(before);
    } else {
      const lane = new Set(metas.filter(row => row.id !== item.id && row.status === item.status).map(row => row.id));
      for (let i = order.length - 1; i >= 0; i--) if (lane.has(order[i]!)) { index = i + 1; break; }
    }
    order.splice(index, 0, item.id); settings.board_order = order; this.put('settings', 'workspace', settings);
  }
  private importItems(input: Input, prepared: Item[], restore: boolean): Input {
    const id = string(input.import_id, 'Import ID', 100, false), sequence = integer(input.sequence, 'Import sequence', 0, 10_000);
    let record = this.record('imports', id);
    if (!record) { check(sequence === 0, 'IMPORT_CONFLICT', 'Start a new import from the first chunk.', 409); record = { id, next_sequence: 0, rows: 0, added: 0, filename: string(input.filename ?? 'Saved Items', 'Filename', 200), at: now(), mode: restore ? 'restore' : 'import' }; }
    check(record.mode === (restore ? 'restore' : 'import') && record.next_sequence === sequence, 'IMPORT_CONFLICT', 'This import chunk is out of order.', 409);
    if (restore && input.workspace !== undefined) {
      check(sequence === 0, 'INVALID_INPUT', 'Backup metadata belongs on the first chunk.');
      const workspace = object(input.workspace); check(workspace.version === 1, 'INVALID_INPUT', 'Use a version-1 backup.');
      if (workspace.projects !== undefined) {
        check(Array.isArray(workspace.projects) && workspace.projects.length <= LIMITS.groups);
        for (const raw of workspace.projects) {
          const group = object(raw), groupId = string(group.id, 'Section ID', 50, false);
          const clean = { id: groupId, name: string(group.name, 'Section name', 100, false), description: string(group.description ?? '', 'Description', 2000), created_at: string(group.created_at ?? now(), 'Date', 100) };
          const existing = this.record<Group>('groups', groupId);
          const sameName = this.records<Group>('groups').find(group => foldName(group.name) === foldName(clean.name));
          check(!sameName || sameName.id === groupId, 'GROUP_CONFLICT', 'A restored section conflicts with an existing name.', 409);
          if (!existing) this.put('groups', groupId, clean);
        }
        check(this.records('groups').length <= LIMITS.groups, 'GROUP_LIMIT', 'Your section limit is reached.', 409);
      }
      const settings = this.settings();
      if (!settings.goals && workspace.goals) settings.goals = string(workspace.goals, 'Goals', 2000);
      if (Array.isArray(workspace.board_order) && !(settings.board_order as unknown[])?.length) {
        check(workspace.board_order.length <= LIMITS.items); settings.board_order = workspace.board_order.map(id => string(id, 'Board item', 50));
      }
      this.put('settings', 'workspace', settings);
    }
    let added = 0;
    for (const incoming of prepared) {
      if (incoming.project_id) check(this.record('groups', String(incoming.project_id)), 'NOT_FOUND', 'The backup references an absent section.', 404);
      const current = this.row(incoming.id);
      if (!current) { this.save(incoming); added++; }
      else if (!restore) {
        const item = this.get(incoming.id).item, sourceBefore = item.content; let changed = false;
        for (const key of ['saved_at', 'title', 'content', 'author', 'external_id'] as const) if (!item[key] && incoming[key]) { item[key] = incoming[key]; changed = true; }
        if (!Object.keys(item.metadata).length && Object.keys(incoming.metadata).length) { item.metadata = incoming.metadata; changed = true; }
        if (changed) this.save(item, item.content === sourceBefore ? { job: current.origin_job, quality: current.origin_quality } : undefined);
      }
    }
    record.next_sequence = sequence + 1; record.rows = Number(record.rows) + prepared.length; record.added = Number(record.added) + added;
    record.duplicates = Number(record.rows) - Number(record.added); record.total = this.control()!.item_count; record.at = now();
    this.put('imports', id, record); this.prune('imports', LIMITS.imports);
    return { ...this.importSummary(record), sequence, next_sequence: sequence + 1, added, rows: prepared.length, duplicates: prepared.length - added, total: this.control()!.item_count };
  }
  private classify(input: Input, local: boolean): Input {
    let records: Input[];
    if (local) {
      records = this.sql<{ id: string }>("SELECT id FROM items WHERE kind='untriaged' AND status='inbox' AND has_context=1 ORDER BY id LIMIT ?", LIMITS.batch)
        .map(row => this.get(row.id))
        .map(({ item, row }) => ({ ...localClassification(item), id: item.id, expected_revision: row.revision }));
    } else { check(Array.isArray(input.items) && input.items.length <= LIMITS.batch); records = input.items.map(object); }
    const seen = new Set<string>(), changed: Input[] = [];
    for (const record of records) {
      const { item, row } = this.get(record.id); check(!seen.has(item.id)); seen.add(item.id);
      if (!local) this.expect(row, record);
      const next = classification(item, record); next.classification_method = local ? 'local rules' : 'Manual classification';
      if (record.project_name) next.project_id = this.group(record.project_name).id;
      this.save(next, { job: row.origin_job, quality: row.origin_quality });
      changed.push({ ...metadata(next, row.revision + 1), cache_revision: this.cacheRevision({ incarnation: row.incarnation, revision: row.revision + 1 }) });
    }
    return { classified: records.length, items: changed, projects: this.records('groups').reverse() };
  }
  private provider(value: unknown) { const provider = string(value, 'Provider', 20, false); check(['apify', 'openai'].includes(provider)); return provider; }
  private setCredential(provider: string, raw: unknown) {
    check(raw !== null || !this.records<StoredJob>('jobs').some(job => this.active(job) && (job.kind === 'retrieval' ? 'apify' : 'openai') === provider),
      'JOB_ACTIVE', 'Finish or reconcile the current job before clearing its provider key.', 409);
    if (raw === null) this.remove('credentials', provider);
    else {
      const value = object(raw);
      this.put('credentials', provider, { version: string(value.version, 'Key version', 100, false), nonce: string(value.nonce, 'Nonce', 100, false),
        ciphertext: string(value.ciphertext, 'Encrypted credential', 8192, false) }, 10_000);
    }
  }
  private job(id: unknown): StoredJob {
    const job = this.record<StoredJob>('jobs', string(id, 'Job ID', 100, false));
    if (!job) throw new Fault(404, 'NOT_FOUND', 'Job not found.'); return job;
  }
  private active(job: StoredJob) { return !TERMINAL.has(job.status) && !job.applied_at; }
  private jobs(operation: string, input: Input): Input {
    if (operation === 'job.begin') {
      const raw = boundedJson(input.job, 65_536), id = string(raw.id, 'Job ID', 100, false);
      const previous = this.record<StoredJob>('jobs', id);
      if (previous) return { ...previous, replayed: true };
      check(!this.records<StoredJob>('jobs').some(job => this.active(job)), 'JOB_ACTIVE', 'Finish or reconcile the current job first.', 409);
      check(['retrieval', 'classification'].includes(String(raw.kind)) && ['QUEUED', 'STARTING'].includes(String(raw.status)));
      check(Array.isArray(raw.selected_ids) && raw.selected_ids.length > 0 && raw.selected_ids.length <= LIMITS.batch);
      const selected = raw.selected_ids.map(id => string(id, 'Selected save', 50, false)); check(new Set(selected).size === selected.length);
      const revisions = object(raw.selected_revisions);
      for (const id of selected) { const current = this.get(id); check(revisions[id] === current.row.revision, 'REVISION_CONFLICT', 'A selected save changed.', 409); }
      const reserved = integer(raw.reserved_bytes, 'Completion reservation', 1, LIMITS.logicalBytes);
      const at = now();
      const job: StoredJob = { ...raw, id, kind: raw.kind as StoredJob['kind'], status: String(raw.status), revision: 1,
        selected_ids: selected, selected_revisions: revisions as Record<string, number>, selected_source_revisions: Object.fromEntries(selected.map(id => [id, this.row(id)!.source_revision])),
        selected_incarnations: Object.fromEntries(selected.map(id => [id, this.row(id)!.incarnation])),
        reserved_bytes: reserved, created_at: at, updated_at: at };
      this.put('jobs', id, job, 65_536); this.prune('jobs', LIMITS.jobs);
      return job;
    }
    const job = this.job(input.id), originalJobBytes = size(job), originalReserved = Number(job.reserved_bytes ?? 0);
    if (operation === 'job.claim') {
      check(this.active(job), 'JOB_FINISHED', 'This job has finished.', 409);
      const leaseId = string(input.lease_id, 'Lease ID', 100, false), until = Number(input.lease_until);
      check(Number.isFinite(until) && until > Date.now() && until <= Date.now() + 120_000);
      check(!job.lease_until || Number(job.lease_until) <= Date.now() || job.lease_id === leaseId, 'JOB_BUSY', 'This job is already being checked.', 409);
      if (job.lease_id === leaseId && Number(job.lease_until) > Date.now()) return { ...job, replayed: true };
      const claims = integer(job.reconciliation_count ?? 0, 'Reconciliation count', 0, 24);
      // The API reserves 2,000 write units; 128 are held for intent/control.
      // Charge the worst case before each attempt, including rolled-back writes.
      const remaining = integer(job.completion_units_remaining ?? 1872, 'Remaining work', 0, 1872);
      const cost = 16 * job.selected_ids.length + 48;
      if (claims >= 24 || remaining < cost) {
        job.status = 'QUOTA_BLOCKED'; job.next_poll_at = 0; job.lease_until = 0;
        job.error = 'Automatic processing reached its reserved work limit. Resume explicitly when capacity is available.';
      } else { job.lease_id = leaseId; job.lease_until = until; job.reconciliation_count = claims + 1; job.completion_units_remaining = remaining - cost; }
    } else {
      check(input.expected_job_revision === job.revision, 'REVISION_CONFLICT', 'The job changed. Read its current state.', 409);
      check(this.active(job), 'JOB_FINISHED', 'This job has finished.', 409);
      if (operation === 'job.update') {
        const patch = boundedJson(input.patch, 230_000);
        if (patch.pending_candidates !== undefined) {
          check(job.kind === 'classification' && Array.isArray(patch.pending_candidates) && patch.pending_candidates.length <= LIMITS.batch && size(patch.pending_candidates) <= 200_000,
            'INVALID_INPUT', 'The classification result is too large.');
          const seen = new Set<string>();
          for (const raw of patch.pending_candidates) {
            const candidate = object(raw), id = string(candidate.id, 'Candidate ID', 50, false);
            check(job.selected_ids.includes(id) && !seen.has(id)); seen.add(id); object(candidate.patch);
          }
        }
        const other = { ...patch }; delete other.pending_candidates;
        check(size(other) <= 32_768, 'INVALID_INPUT', 'Job metadata is too large.');
        for (const key of ['id', 'kind', 'selected_ids', 'selected_source_revisions', 'selected_incarnations', 'created_at', 'revision', 'reserved_bytes']) check(!(key in patch), 'INVALID_INPUT', 'Immutable job identity.');
        if (patch.status === 'STARTING') check(['QUEUED', 'STARTING'].includes(job.status), 'JOB_UNCERTAIN', 'A submitted job cannot restart.', 409);
        if (patch.status === 'QUEUED') check(job.status === 'QUEUED', 'JOB_UNCERTAIN', 'A submitted job cannot restart.', 409);
        if (patch.status !== undefined) check(['QUEUED', 'STARTING', 'RUNNING', 'APPLYING', 'UNCERTAIN', 'QUOTA_BLOCKED', ...TERMINAL].includes(String(patch.status)));
        if (patch.reconciliation_count !== undefined) check(job.status === 'QUOTA_BLOCKED' && patch.reconciliation_count === 0, 'INVALID_INPUT', 'Only an explicit resume can reset work limits.');
        if (patch.completion_units_remaining !== undefined) check(job.status === 'QUOTA_BLOCKED' && patch.completion_units_remaining === 1872, 'INVALID_INPUT', 'Only an explicit funded resume can reset work limits.');
        if (patch.selected_revisions !== undefined) {
          check(job.status === 'QUEUED' && patch.status === 'STARTING', 'INVALID_INPUT', 'Submission snapshots are immutable after start.');
          const revisions = object(patch.selected_revisions);
          for (const [id, revision] of Object.entries(revisions)) {
            const row = this.row(id);
            check(job.selected_ids.includes(id) && row && row.revision === revision && object(job.selected_incarnations)[id] === row.incarnation,
              'REVISION_CONFLICT', 'A selected save changed before submission.', 409);
          }
          check(Object.keys(revisions).length > 0);
          job.selected_source_revisions = Object.fromEntries(Object.keys(revisions).map(id => [id, this.row(id)!.source_revision]));
        }
        Object.assign(job, patch);
      } else if (operation === 'job.apply') {
        check(Array.isArray(input.candidates) && input.candidates.length <= LIMITS.batch);
        const selected = new Set(job.selected_ids); let applied = 0, skipped = 0;
        const changedIds = new Set<string>((job.changed_ids as string[] | undefined) ?? []);
        const logicalBefore = this.control()!.logical_bytes;
        this.reservationCredit = Number(job.reserved_bytes ?? 0);
        for (const value of input.candidates) {
          const candidate = object(value), id = string(candidate.id, 'Candidate ID', 50, false);
          check(selected.has(id), 'NOT_FOUND', 'Save not found.', 404);
          if (!this.row(id) || object(job.selected_incarnations ?? {})[id] !== this.row(id)!.incarnation) { skipped++; continue; }
          const { item, row } = this.get(id), patch = object(candidate.patch); let next: Item;
          if (job.kind === 'classification') {
            if (row.revision !== job.selected_revisions[id] || (candidate.expected_revision !== undefined && candidate.expected_revision !== row.revision)) { skipped++; continue; }
            next = classification(item, patch); next.classification_method = 'OpenAI';
            if (patch.project_name) next.project_id = this.group(patch.project_name).id;
            this.save(next, { job: row.origin_job, quality: row.origin_quality });
          } else {
            const quality = typeof candidate.quality === 'number' && Number.isFinite(candidate.quality) ? Math.max(0, Math.min(1_000_000, candidate.quality)) : String(patch.content ?? '').length;
            const sameJobUpgrade = row.origin_job === job.id && quality > row.origin_quality;
            const selectedSourceRevision = object(job.selected_source_revisions ?? {})[id];
            if (selectedSourceRevision !== row.source_revision) { skipped++; continue; }
            if (item.content && !sameJobUpgrade) { skipped++; continue; }
            next = { ...item };
            if (patch.content !== undefined) next.content = string(patch.content, 'Retrieved text', 20_000);
            if (!next.title && patch.title) next.title = string(patch.title, 'Title', 300);
            if (!next.author && patch.author) next.author = string(patch.author, 'Author', 300);
            if (patch.enrichment !== undefined) next.enrichment = boundedJson(patch.enrichment, 8192);
            this.save(next, { job: job.id, quality });
          }
          applied++;
          changedIds.add(id);
        }
        if (input.cursor !== undefined) job.cursor = integer(input.cursor, 'Result cursor', 0, 100_000);
        job.recovered = Number(job.recovered ?? 0) + applied; job.skipped = Number(job.skipped ?? 0) + skipped;
        job.changed_ids = [...changedIds]; job.applied_count = changedIds.size;
        if (job.kind === 'classification') job.classified = changedIds.size;
        if (input.terminal === true) { job.applied_at = now(); job.status = 'COMPLETED'; delete job.pending_candidates; }
        else job.status = 'APPLYING';
        if (input.seen_ids !== undefined) {
          check(Array.isArray(input.seen_ids) && input.seen_ids.length <= LIMITS.batch);
          job.seen_ids = input.seen_ids.map(id => { const value = string(id, 'Seen save', 50, false); check(selected.has(value)); return value; });
        }
        for (const key of ['dataset_id', 'provider_status']) if (input[key] !== undefined) job[key] = string(input[key], key, 128);
        if (input.next_poll_at !== undefined) job.next_poll_at = integer(input.next_poll_at, 'Next check', 0, Number.MAX_SAFE_INTEGER);
        job.reserved_bytes = this.active(job) ? Math.max(0, Number(job.reserved_bytes ?? 0) - Math.max(0, this.control()!.logical_bytes - logicalBefore)) : 0;
        if (input.patch !== undefined) {
          const patch = boundedJson(input.patch, 8192);
          for (const key of ['matched_ids', 'received', 'error', 'provider_status']) if (key in patch) job[key] = patch[key];
        }
        delete job.lease_id; delete job.lease_until;
      } else throw new Fault(404, 'NOT_FOUND', 'Job operation not found.');
    }
    if (!this.active(job)) job.reserved_bytes = 0;
    job.revision++; job.updated_at = now();
    if (this.active(job)) job.reserved_bytes = Math.max(0, Number(job.reserved_bytes ?? 0) - Math.max(0, size(job) - originalJobBytes));
    this.reservationCredit = originalReserved;
    this.put('jobs', job.id, job, 230_000); this.reservationCredit = 0; return job;
  }
  private async schedule(): Promise<void> {
    const control = this.control();
    if (!control) return;
    if (control.status !== 'active') { await this.ctx.storage.deleteAlarm(); return; }
    const job = this.records<StoredJob>('jobs').find(job => this.active(job));
    if (!job || !['QUEUED', 'STARTING', 'RUNNING', 'APPLYING'].includes(job.status)) { await this.ctx.storage.deleteAlarm(); return; }
    const due = job.status === 'STARTING' ? Number(job.submission_deadline ?? Date.parse(job.created_at) + 120_000) + 1000 : Number(job.next_poll_at ?? 0);
    if (!Number.isFinite(due) || due <= 0) { await this.ctx.storage.deleteAlarm(); return; }
    await this.ctx.storage.setAlarm(Math.max(Date.now() + 1000, due, Number(job.lease_until ?? 0)));
  }
  async alarm(): Promise<void> {
    const control = this.control();
    if (!control || control.status !== 'active') return;
    if (await this.reconcile({ uid: control.uid, generation: control.generation })) await this.schedule();
    else if (this.control()) await this.ctx.storage.deleteAlarm();
  }
  /** P5 application subclass supplies reconciliation. Base storage never calls a provider. */
  protected async reconcile(_access: Access): Promise<boolean> { return false; }
  fetch() { return new Response('Workspace RPC only', { status: 404 }); }
}
