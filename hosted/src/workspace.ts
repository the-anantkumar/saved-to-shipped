import { DurableObject } from 'cloudflare:workers';

export const PLANNED_LIMITS = Object.freeze({ items: 1_000, logicalBytes: 5_000_000, physicalBytes: 8_000_000 });
export interface Limits { items: number; logicalBytes: number; physicalBytes: number }
export interface PrototypeSave {
  id: string;
  platform: string;
  url: string;
  title: string;
  author: string;
  saved_at: string;
  kind: 'project' | 'learning' | 'experience';
  status: string;
  group_id: string;
  tags: string[];
  reading_progress: number;
  next_action: string;
  why: string;
  content: string;
  note: string;
}
type Meter = { rowsRead: number; rowsWritten: number };
type UsageRow = { item_count: number; logical_bytes: number };
type StoredRow = { row_id: number; logical_bytes: number };
type SqlValue = string | number | null;

export function logicalBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

class QuotaError extends Error {
  constructor(readonly code: string) { super(code); }
}

/**
 * P1 measurement instrument, NOT the P2 API/storage contract.
 * Its RPC methods are reachable only by trusted Worker code. The shipping
 * entrypoint never obtains a stub. Tests have a separate, local-only entrypoint.
 * Fixture-controlled limits allow experiments below the planned budgets.
 */
export class WorkspacePrototype extends DurableObject<unknown> {
  private readonly sql: SqlStorage;
  private meter: Meter = { rowsRead: 0, rowsWritten: 0 };

  constructor(ctx: DurableObjectState, env: unknown) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    // Each statement is consumed individually, so its counters are observable.
    for (const statement of [
      'PRAGMA foreign_keys = ON',
      `CREATE TABLE IF NOT EXISTS items (
        row_id INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, source_key TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL, status TEXT NOT NULL, group_id TEXT NOT NULL,
        saved_at TEXT NOT NULL, metadata TEXT NOT NULL, logical_bytes INTEGER NOT NULL)`,
      `CREATE TABLE IF NOT EXISTS content (
        row_id INTEGER PRIMARY KEY REFERENCES items(row_id) ON DELETE CASCADE,
        title TEXT NOT NULL, body TEXT NOT NULL, note TEXT NOT NULL)`,
      'CREATE INDEX IF NOT EXISTS items_library ON items(kind, saved_at DESC, id)',
      'CREATE INDEX IF NOT EXISTS items_board ON items(group_id, status, saved_at DESC, id)',
      'CREATE TABLE IF NOT EXISTS groups (id TEXT PRIMARY KEY, data TEXT NOT NULL, logical_bytes INTEGER NOT NULL)',
      'CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, data TEXT NOT NULL)',
      'CREATE TABLE IF NOT EXISTS usage (id INTEGER PRIMARY KEY CHECK(id = 1), item_count INTEGER NOT NULL, logical_bytes INTEGER NOT NULL)',
      'INSERT OR IGNORE INTO usage VALUES (1, 0, 0)',
      'CREATE TABLE IF NOT EXISTS schema_versions (version INTEGER PRIMARY KEY)',
      'INSERT OR IGNORE INTO schema_versions VALUES (1)',
    ]) this.query(statement);
  }

  private query<T extends Record<string, SqlValue> = Record<string, SqlValue>>(statement: string, ...bindings: SqlValue[]): T[] {
    const cursor = this.sql.exec<T>(statement, ...bindings);
    const rows = cursor.toArray();
    this.meter.rowsRead += cursor.rowsRead;
    this.meter.rowsWritten += cursor.rowsWritten;
    return rows;
  }

  private hasSearch(): boolean {
    return this.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'search'").length > 0;
  }

  private storedUsage(): UsageRow {
    return this.query<UsageRow>('SELECT item_count, logical_bytes FROM usage WHERE id = 1')[0]!;
  }

  private enforce(limits: Limits): void {
    const usage = this.storedUsage();
    if (usage.item_count > limits.items) throw new QuotaError('ITEM_LIMIT');
    if (usage.logical_bytes > limits.logicalBytes) throw new QuotaError('LOGICAL_LIMIT');
    // databaseSize excludes free pages and WAL. This experiment only enforces
    // used SQLite bytes, not the planned full physical-allocation budget.
    if (this.sql.databaseSize > limits.physicalBytes) throw new QuotaError('PHYSICAL_LIMIT');
  }

  stats() {
    const usage = this.storedUsage();
    return {
      items: usage.item_count, logicalBytes: usage.logical_bytes,
      sqliteUsedBytes: this.sql.databaseSize, search: this.hasSearch(),
      rowsRead: this.meter.rowsRead, rowsWritten: this.meter.rowsWritten,
    };
  }

  allocationCapabilities() {
    return ['PRAGMA page_count', 'PRAGMA freelist_count', 'PRAGMA page_size',
      'SELECT * FROM pragma_page_count', 'SELECT * FROM pragma_freelist_count', 'SELECT * FROM pragma_page_size']
      .map(statement => {
        try { return { statement, supported: true, result: this.query(statement) }; }
        catch { return { statement, supported: false }; }
      });
  }

  /** Completed SQL, including later quota-triggered rollback, remains metered.
   * SQL errors that interrupt cursor consumption need provider-side telemetry.
   */
  writeBatch(saves: PrototypeSave[], limits: Limits = PLANNED_LIMITS) {
    if (saves.length > 100) throw new Error('Prototype batch bound is 100');
    const before = { ...this.meter };
    const beforeSqliteUsedBytes = this.sql.databaseSize;
    let peakSqliteUsedBytes = beforeSqliteUsedBytes;
    let code: string | null = null;
    try {
      this.ctx.storage.transactionSync(() => {
        for (const save of saves) {
          const previous = this.query<StoredRow>('SELECT row_id, logical_bytes FROM items WHERE id = ?', save.id)[0];
          const usage = this.storedUsage();
          const bytes = logicalBytes(save);
          // Cheap preflight rejects count/logical violations before writing.
          if (usage.item_count + (previous ? 0 : 1) > limits.items) throw new QuotaError('ITEM_LIMIT');
          if (usage.logical_bytes + bytes - (previous?.logical_bytes ?? 0) > limits.logicalBytes) throw new QuotaError('LOGICAL_LIMIT');
          const { content, note, ...metadata } = save;
          this.query(`INSERT INTO items (id, source_key, kind, status, group_id, saved_at, metadata, logical_bytes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET source_key=excluded.source_key, kind=excluded.kind,
              status=excluded.status, group_id=excluded.group_id, saved_at=excluded.saved_at,
              metadata=excluded.metadata, logical_bytes=excluded.logical_bytes`,
          save.id, `${save.platform}:${save.url}`, save.kind, save.status, save.group_id, save.saved_at, JSON.stringify(metadata), bytes);
          const row = this.query<StoredRow>('SELECT row_id, logical_bytes FROM items WHERE id = ?', save.id)[0]!;
          this.query(`INSERT INTO content VALUES (?, ?, ?, ?) ON CONFLICT(row_id) DO UPDATE SET
            title=excluded.title, body=excluded.body, note=excluded.note`, row.row_id, save.title, content, note);
          this.query('UPDATE usage SET item_count = item_count + ?, logical_bytes = logical_bytes + ? WHERE id = 1',
            previous ? 0 : 1, bytes - (previous?.logical_bytes ?? 0));
          peakSqliteUsedBytes = Math.max(peakSqliteUsedBytes, this.sql.databaseSize);
          this.enforce(limits);
        }
      });
    } catch (error) {
      if (!(error instanceof QuotaError)) throw error;
      code = error.code;
    }
    const usage = this.stats();
    return { ok: code === null, code, beforeSqliteUsedBytes, peakSqliteUsedBytes, usage,
      attempted: { rowsRead: this.meter.rowsRead - before.rowsRead, rowsWritten: this.meter.rowsWritten - before.rowsWritten } };
  }

  private schemaMutation(action: () => void, limits: Limits) {
    const before = { ...this.meter };
    const beforeSqliteUsedBytes = this.sql.databaseSize;
    let peakSqliteUsedBytes = beforeSqliteUsedBytes;
    let code: string | null = null;
    try {
      this.ctx.storage.transactionSync(() => {
        action();
        peakSqliteUsedBytes = Math.max(peakSqliteUsedBytes, this.sql.databaseSize);
        this.enforce(limits);
      });
    } catch (error) {
      if (!(error instanceof QuotaError)) throw error;
      code = error.code;
    }
    const usage = this.stats();
    return { ok: code === null, code, beforeSqliteUsedBytes, peakSqliteUsedBytes, usage,
      attempted: { rowsRead: this.meter.rowsRead - before.rowsRead, rowsWritten: this.meter.rowsWritten - before.rowsWritten } };
  }

  enableSearch(limits: Limits = PLANNED_LIMITS) {
    return this.schemaMutation(() => {
      if (this.hasSearch()) return;
      // External content avoids keeping a second full copy of source/notes.
      // Keep full detail so phrase queries remain supported in this experiment.
      this.query("CREATE VIRTUAL TABLE search USING fts5(title, body, note, content='content', content_rowid='row_id')");
      this.query(`CREATE TRIGGER content_ai AFTER INSERT ON content BEGIN
        INSERT INTO search(rowid, title, body, note) VALUES (new.row_id, new.title, new.body, new.note); END`);
      this.query(`CREATE TRIGGER content_ad AFTER DELETE ON content BEGIN
        INSERT INTO search(search, rowid, title, body, note) VALUES ('delete', old.row_id, old.title, old.body, old.note); END`);
      this.query(`CREATE TRIGGER content_au AFTER UPDATE ON content BEGIN
        INSERT INTO search(search, rowid, title, body, note) VALUES ('delete', old.row_id, old.title, old.body, old.note);
        INSERT INTO search(rowid, title, body, note) VALUES (new.row_id, new.title, new.body, new.note); END`);
      this.query("INSERT INTO search(search) VALUES ('rebuild')");
    }, limits);
  }

  search(term: string, limit = 25) {
    if (!this.hasSearch()) throw new Error('Search is disabled');
    const before = { ...this.meter };
    const rows = this.query<{ id: string; title: string }>(`SELECT items.id, content.title FROM search
      JOIN items ON items.row_id = search.rowid JOIN content ON content.row_id = search.rowid
      WHERE search MATCH ? ORDER BY rank LIMIT ?`, term, Math.min(Math.max(limit, 1), 50));
    return { rows, rowsRead: this.meter.rowsRead - before.rowsRead, rowsWritten: this.meter.rowsWritten - before.rowsWritten };
  }

  list(kind: string, limit = 25) {
    const before = { ...this.meter };
    const rows = this.query(`SELECT id, saved_at FROM items WHERE kind = ? ORDER BY saved_at DESC, id LIMIT ?`, kind, Math.min(Math.max(limit, 1), 50));
    const rowsRead = this.meter.rowsRead - before.rowsRead;
    const plan = this.query(`EXPLAIN QUERY PLAN SELECT id, saved_at FROM items WHERE kind = ? ORDER BY saved_at DESC, id LIMIT ?`, kind, limit);
    return { rows, rowsRead, plan };
  }

  exportData(): PrototypeSave[] {
    return this.query<{ metadata: string; body: string; note: string }>(`SELECT items.metadata, content.body, content.note
      FROM items JOIN content USING(row_id) ORDER BY items.id`).map(row => ({ ...JSON.parse(row.metadata), content: row.body, note: row.note }));
  }

  deleteBatch(ids: string[], limits: Limits = PLANNED_LIMITS) {
    if (ids.length > 100) throw new Error('Prototype batch bound is 100');
    const before = { ...this.meter };
    const beforeSqliteUsedBytes = this.sql.databaseSize;
    let peakSqliteUsedBytes = beforeSqliteUsedBytes;
    let code: string | null = null;
    try {
      this.ctx.storage.transactionSync(() => {
        for (const id of ids) {
          const row = this.query<StoredRow>('SELECT row_id, logical_bytes FROM items WHERE id = ?', id)[0];
          if (!row) continue;
          this.query('DELETE FROM items WHERE id = ?', id);
          this.query('UPDATE usage SET item_count = item_count - 1, logical_bytes = logical_bytes - ? WHERE id = 1', row.logical_bytes);
          // FTS deletion writes tombstones; deleting content can grow storage.
          peakSqliteUsedBytes = Math.max(peakSqliteUsedBytes, this.sql.databaseSize);
          this.enforce(limits);
        }
      });
    } catch (error) {
      if (!(error instanceof QuotaError)) throw error;
      code = error.code;
    }
    const usage = this.stats();
    return { ok: code === null, code, beforeSqliteUsedBytes, peakSqliteUsedBytes, usage,
      attempted: { rowsRead: this.meter.rowsRead - before.rowsRead, rowsWritten: this.meter.rowsWritten - before.rowsWritten } };
  }

  /** Fixed bounded synthetic overhead; no keys, provider calls or user content. */
  seedOperationalData() {
    this.ctx.storage.transactionSync(() => {
      for (let i = 0; i < 12; i++) {
        const id = `group-${i}`;
        const data = JSON.stringify({ id, title: `Synthetic collection ${i}`, description: 'Learning and project notes '.repeat(5) });
        const previous = this.query<{ logical_bytes: number }>('SELECT logical_bytes FROM groups WHERE id = ?', id)[0];
        this.query('INSERT INTO groups VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data, logical_bytes=excluded.logical_bytes', id, data, new TextEncoder().encode(data).byteLength);
        this.query('UPDATE usage SET logical_bytes = logical_bytes + ? WHERE id = 1', new TextEncoder().encode(data).byteLength - (previous?.logical_bytes ?? 0));
      }
      for (let i = 0; i < 20; i++) this.query('INSERT OR REPLACE INTO jobs VALUES (?, ?)', `job-${i}`,
        JSON.stringify({ state: 'complete', synthetic: true, retainedResultBytes: 0, id: `job-${i}`, checkpoint: 'fixture-only', detail: 'No provider request was made. '.repeat(5) }));
      this.query('INSERT OR REPLACE INTO settings VALUES (?, ?)', 'fixture-operational-reserve', 'x'.repeat(2048));
      this.enforce(PLANNED_LIMITS);
    });
    return this.stats();
  }

  migrate(limits: Limits = PLANNED_LIMITS) {
    return this.schemaMutation(() => {
      this.query('CREATE INDEX IF NOT EXISTS items_status ON items(status, saved_at DESC, id)');
      this.query('INSERT OR IGNORE INTO schema_versions VALUES (2)');
    }, limits);
  }

  // Exposing the class does not expose HTTP to it, even through an internal stub.
  fetch() { return new Response('Prototype RPC only', { status: 503 }); }
}
