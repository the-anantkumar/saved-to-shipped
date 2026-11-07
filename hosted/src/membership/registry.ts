import { DurableObject } from 'cloudflare:workers';
import { Fault, failure, integer, string, type Result, type Input, type Membership } from '../contracts';

interface Env { BETA_CAP?: string; ADMISSION_OPEN?: string; ADMISSION_UIDS?: string; PROCESSING_OPEN?: string }
type Row = { uid: string; generation: string; state: Membership['state']; created_at: string; operation: string; lifecycle_epoch: number };
export class Registry extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS members (
      uid TEXT PRIMARY KEY, generation TEXT NOT NULL, state TEXT NOT NULL,
      created_at TEXT NOT NULL, operation TEXT NOT NULL, lifecycle_epoch INTEGER NOT NULL DEFAULT 0)`);
    if (!ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(members)').toArray().some(column => column.name === 'lifecycle_epoch'))
      ctx.storage.sql.exec('ALTER TABLE members ADD COLUMN lifecycle_epoch INTEGER NOT NULL DEFAULT 0');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS member_state ON members(state)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS budget (day TEXT NOT NULL, kind TEXT NOT NULL, spent INTEGER NOT NULL, PRIMARY KEY(day,kind))');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY, uid TEXT NOT NULL, kind TEXT NOT NULL, units INTEGER NOT NULL, day TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS grants_day ON grants(day)');
  }
  private rows<T extends Record<string, SqlStorageValue>>(sql: string, ...values: SqlStorageValue[]): T[] {
    return this.ctx.storage.sql.exec<T>(sql, ...values).toArray();
  }
  async invoke(operation: string, input: Input = {}): Promise<Result> {
    try {
      return this.ctx.storage.transactionSync(() => ({ ok: true as const, data: this.perform(operation, input) }));
    } catch (error) { return failure(error); }
  }
  private perform(operation: string, input: Input): unknown {
    if (operation === 'pending') return this.rows<Row>("SELECT * FROM members WHERE state = 'reserved' ORDER BY created_at LIMIT 50");
    if (operation === 'stats') {
      return { members: this.rows('SELECT state,count(*) AS count FROM members GROUP BY state'),
        budget: this.rows('SELECT * FROM budget WHERE day = ?', new Date().toISOString().slice(0, 10)),
        sqliteUsedBytes: this.ctx.storage.sql.databaseSize };
    }
    const uid = string(input.uid, 'Identity', 128, false);
    const member = this.rows<Row>('SELECT * FROM members WHERE uid = ?', uid)[0];
    if (operation === 'lookup') return member ?? null;
    if (operation === 'reserve') {
      if (member) {
        if (member.state === 'active' || member.state === 'reserved') return member;
        throw new Fault(403, member.state === 'suspended' ? 'MEMBERSHIP_SUSPENDED' : member.state === 'deleting' ? 'ACCOUNT_DELETING' : 'ACCOUNT_DELETED',
          member.state === 'deleting' ? 'Workspace deletion is paused. Retry deletion to finish removing your data.' : 'This workspace is unavailable.');
      }
      const cap = Math.max(0, Math.min(500, Number(this.env.BETA_CAP ?? 0) || 0));
      if (this.env.ADMISSION_OPEN !== 'true' || !cap) throw new Fault(403, 'BETA_FULL', 'New memberships are currently closed.');
      if (this.env.ADMISSION_UIDS !== undefined) {
        let allowed: unknown;
        try { allowed = JSON.parse(this.env.ADMISSION_UIDS); } catch { allowed = []; }
        if (!Array.isArray(allowed) || allowed.length > 500 || !allowed.includes(uid))
          throw new Fault(403, 'BETA_FULL', 'New memberships are currently closed.');
      }
      const occupied = this.rows<{ count: number }>("SELECT count(*) AS count FROM members WHERE state != 'deleted'")[0]!.count;
      if (occupied >= cap) throw new Fault(403, 'BETA_FULL', 'The beta is full. Existing members can still sign in.');
      if (this.rows<{ count: number }>('SELECT count(*) AS count FROM members')[0]!.count >= 10_000)
        throw new Fault(503, 'ADMISSION_PAUSED', 'New memberships are temporarily paused.');
      this.charge('interactive', 128);
      const value = { uid, generation: crypto.randomUUID(), state: 'reserved' as const,
        created_at: new Date().toISOString(), operation: crypto.randomUUID(), lifecycle_epoch: 0 };
      this.rows('INSERT INTO members(uid,generation,state,created_at,operation,lifecycle_epoch) VALUES (?,?,?,?,?,?)', value.uid, value.generation, value.state, value.created_at, value.operation, value.lifecycle_epoch);
      return value;
    }
    if (!member || input.generation !== member.generation) throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'Sign in to a workspace first.');
    if (operation === 'activate') {
      if (!['reserved', 'active'].includes(member.state)) throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'This workspace is unavailable.');
      this.rows("UPDATE members SET state = 'active' WHERE uid = ?", uid); return { ...member, state: 'active' };
    }
    if (operation === 'deleting') {
      if (member.state === 'deleted' || member.state === 'deleting') return member;
      this.rows("UPDATE members SET state = 'deleting' WHERE uid = ?", uid); return { ...member, state: 'deleting' };
    }
    if (operation === 'deleted') {
      if (!['deleting', 'deleted'].includes(member.state)) throw new Fault(409, 'INVALID_TRANSITION', 'Close the workspace before releasing its seat.');
      this.rows("UPDATE members SET state = 'deleted' WHERE uid = ?", uid); return { ...member, state: 'deleted' };
    }
    if (operation === 'suspend' || operation === 'resume') {
      const expected = operation === 'suspend' ? 'active' : 'suspended';
      const state = operation === 'suspend' ? 'suspended' : 'active';
      if (member.state !== expected && member.state !== state) throw new Fault(409, 'INVALID_TRANSITION', 'Membership state changed.');
      const epoch = member.lifecycle_epoch + 1;
      this.rows('UPDATE members SET state = ?, lifecycle_epoch = ? WHERE uid = ?', state, epoch, uid);
      return { ...member, state, lifecycle_epoch: epoch };
    }
    if (operation === 'member') return member;
    if (operation === 'grant' || operation === 'cleanup.grant') {
      const cleanup = operation === 'cleanup.grant';
      if (cleanup ? member.state === 'deleted' : member.state !== 'active') throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'This workspace is unavailable.');
      const kind = cleanup ? 'cleanup' : string(input.kind, 'Budget', 20, false);
      if (!['interactive', 'ingestion', 'completion', ...(cleanup ? ['cleanup'] : [])].includes(kind)) throw new Fault(400, 'INVALID_INPUT', 'Unknown budget.');
      if (['ingestion', 'completion'].includes(kind) && this.env.PROCESSING_OPEN !== 'true') throw new Fault(429, 'PROCESSING_PAUSED', 'Processing is temporarily paused.');
      const units = integer(input.units, 'Work reservation', 1, 20_000);
      const id = string(input.id, 'Request ID', 120, false), day = new Date().toISOString().slice(0, 10);
      const previous = this.rows<{ uid: string; kind: string; units: number; day: string }>('SELECT * FROM grants WHERE id = ?', `${uid}:${id}`)[0];
      if (previous) {
        if (previous.kind !== kind || previous.units !== units || previous.uid !== uid) throw new Fault(409, 'REQUEST_CONFLICT', 'Request ID was already used.');
        // A reservation does not refill on retry, and expires at midnight.
        if (previous.day !== day) throw new Fault(409, 'GRANT_EXPIRED', 'Start a new request after checking the earlier result.');
        // Every execution attempt consumes allowance, even if the workspace's
        // bounded receipt cache has evicted this ID or the earlier write rolled back.
        this.charge(kind, units + 8);
        return { granted: true, replayed: true, units, day };
      }
      this.charge(kind, units + 8);
      this.rows('DELETE FROM grants WHERE day < ?', day);
      this.rows('INSERT INTO grants VALUES (?,?,?,?,?)', `${uid}:${id}`, uid, kind, units, day);
      return { granted: true, replayed: false, units, day };
    }
    throw new Fault(404, 'NOT_FOUND', 'Unknown registry operation.');
  }
  private charge(kind: string, units: number) {
    const day = new Date().toISOString().slice(0, 10);
    const caps: Record<string, number> = { ingestion: 40_000, interactive: 30_000, completion: 20_000, cleanup: 10_000 };
    const current = this.rows<{ spent: number }>('SELECT spent FROM budget WHERE day = ? AND kind = ?', day, kind)[0]?.spent ?? 0;
    if (current + units > caps[kind]!) throw new Fault(429, 'DAILY_BUDGET', 'Today’s shared processing allowance is full. Try again tomorrow.');
    this.rows('DELETE FROM budget WHERE day < ?', day);
    this.rows('INSERT INTO budget VALUES (?,?,?) ON CONFLICT(day,kind) DO UPDATE SET spent = excluded.spent', day, kind, current + units);
  }
  fetch() { return new Response('Not found', { status: 404 }); }
}
