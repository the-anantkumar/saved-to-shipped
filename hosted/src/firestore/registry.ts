import { Fault, failure, integer, object, string, type Access, type Input, type Membership, type Result } from '../contracts';
import { FirestoreClient, FirestoreCommitUncertain, isFirestoreCommitUncertain, isFirestoreConflict, type FirestoreDocument, type FirestoreEnv, type FirestorePort, type FirestoreWrite } from './client';

export interface FirestoreRegistryEnv extends FirestoreEnv {
  BETA_CAP?: string; ADMISSION_OPEN?: string; ADMISSION_UIDS?: string; PROCESSING_OPEN?: string;
}
type Member = Membership & { operation: string; lifecycle_epoch: number };
type Control = Input & {
  schema: number; sequence: number; occupied: number; totalMembers: number; grantsCount: number;
  states: Record<Membership['state'], number>; budgetDay: string; budgets: Record<string, number>; lastCommit: string;
};
type Transition = { result: unknown; writes?: FirestoreWrite[]; control?: Control; base?: FirestoreDocument | null };
const CONTROL = 's2sRegistry/control';
const MEMBERS = 's2sMembers';
const GRANTS = 's2sGrants';
const STATES = ['reserved', 'active', 'suspended', 'deleting', 'deleted'] as const;
const CAPS: Record<string, number> = { ingestion: 40_000, interactive: 30_000, completion: 20_000, cleanup: 10_000 };
const MAX_GRANTS = 10_000;
function today() { return new Date().toISOString().slice(0, 10); }
function corrupt(): never { throw new Fault(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'); }
function condition(document: FirestoreDocument | null) { return document ? { updateTime: document.updateTime } : { exists: false }; }
async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function control(document: FirestoreDocument | null): Control {
  if (!document) return { schema: 1, sequence: 0, occupied: 0, totalMembers: 0, grantsCount: 0,
    states: { reserved: 0, active: 0, suspended: 0, deleting: 0, deleted: 0 }, budgetDay: today(), budgets: {}, lastCommit: '' };
  const value = structuredClone(document.data) as Control;
  if (value.schema !== 1 || ['sequence', 'occupied', 'totalMembers', 'grantsCount'].some(key =>
    !Number.isSafeInteger(value[key]) || Number(value[key]) < 0) || !value.states || !value.budgets ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.budgetDay) || typeof value.lastCommit !== 'string' ||
    STATES.some(state => !Number.isSafeInteger(value.states[state]) || value.states[state] < 0) ||
    Object.entries(value.budgets).some(([kind, amount]) => !(kind in CAPS) || !Number.isSafeInteger(amount) || amount < 0) ||
    value.totalMembers !== STATES.reduce((sum, state) => sum + value.states[state], 0) ||
    value.occupied !== value.totalMembers - value.states.deleted || value.totalMembers > 10_000 || value.grantsCount > MAX_GRANTS) corrupt();
  return value;
}
function member(document: FirestoreDocument | null, uid: string): Member | null {
  if (!document) return null;
  const value = structuredClone(document.data) as unknown as Member;
  if (value.uid !== uid || !STATES.includes(value.state) || typeof value.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(value.generation) ||
    typeof value.created_at !== 'string' || typeof value.operation !== 'string' ||
    !Number.isSafeInteger(value.lifecycle_epoch) || value.lifecycle_epoch < 0) corrupt();
  return value;
}
function charge(value: Control, kind: string, units: number) {
  if (value.budgetDay !== today()) { value.budgetDay = today(); value.budgets = {}; }
  const spent = value.budgets[kind] ?? 0;
  if (!(kind in CAPS) || spent + units > CAPS[kind]!)
    throw new Fault(429, 'DAILY_BUDGET', 'Today’s shared processing allowance is full. Try again tomorrow.');
  value.budgets[kind] = spent + units;
}

/** Firestore owns admission, tombstones and budgets. No SQL state is authoritative. */
export class FirestoreRegistry {
  readonly store: FirestorePort;
  constructor(private readonly env: FirestoreRegistryEnv, store?: FirestorePort) { this.store = store ?? new FirestoreClient(env); }
  private async memberPath(uid: string) { return `${MEMBERS}/${await hash(uid)}`; }
  private async readControl(): Promise<FirestoreDocument | null> {
    const base = await this.store.read(CONTROL);
    if (!base) {
      // An absent control may initialize only an empty registry. Losing a counter
      // must not silently reopen admissions or refill budgets around existing data.
      const [members, grants] = await Promise.all([
        this.store.list(MEMBERS, { pageSize: 1, fieldPaths: ['uid'] }),
        this.store.list(GRANTS, { pageSize: 1, fieldPaths: ['day'] }),
      ]);
      if (members.documents.length || grants.documents.length) {
        // A concurrent first reservation may have initialized both atomically.
        const initialized = await this.store.read(CONTROL);
        if (initialized) return initialized;
        corrupt();
      }
    }
    return base;
  }
  async provisionFences(access: Access): Promise<FirestoreWrite[]> {
    const uid = string(access.uid, 'Identity', 128, false), path = await this.memberPath(uid);
    const [base, document] = await Promise.all([this.readControl(), this.store.read(path)]), value = member(document, uid);
    if (!base || !document || !value || value.generation !== access.generation || value.state !== 'reserved')
      throw new Fault(403, 'PROVISIONING_DENIED', 'This workspace reservation is no longer available.');
    return [{ path: CONTROL, verify: true, currentDocument: { updateTime: base.updateTime } },
      { path, verify: true, currentDocument: { updateTime: document.updateTime } }];
  }
  private async transition(prepare: () => Promise<Transition>): Promise<unknown> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const prepared = await prepare();
      if (!prepared.writes?.length) return prepared.result;
      const state = prepared.control!;
      const commitId = crypto.randomUUID(); state.lastCommit = commitId; state.sequence++;
      const writes: FirestoreWrite[] = [{ path: CONTROL, data: state, currentDocument: condition(prepared.base ?? null) }, ...prepared.writes];
      try { await this.store.commit(writes); return prepared.result; }
      catch (error) {
        if (isFirestoreConflict(error)) continue;
        if (isFirestoreCommitUncertain(error)) {
          // No blind retry: an applied commit might already have consumed a seat or allowance.
          const latest = await this.store.read(CONTROL).catch(() => null);
          if (latest?.data.lastCommit === commitId) return prepared.result;
          throw new FirestoreCommitUncertain();
        }
        throw error;
      }
    }
    throw new Fault(503, 'STORAGE_BUSY', 'Storage is busy. Please try again.');
  }
  async invoke(operation: string, input: Input = {}): Promise<Result> {
    try {
      object(input);
      if (operation === 'maintenance') return { ok: true, data: await this.maintenance() };
      if (operation === 'pending') {
        const documents = await this.store.query(MEMBERS, { field: 'state', op: 'EQUAL', value: 'reserved', orderBy: 'created_at', limit: 50 });
        return { ok: true, data: documents.map(document => member(document, string(document.data.uid, 'Identity', 128, false))) };
      }
      if (operation === 'stats') {
        const value = control(await this.readControl());
        return { ok: true, data: {
          members: STATES.filter(state => value.states[state]).map(state => ({ state, count: value.states[state] })),
          budget: value.budgetDay === today() ? Object.entries(value.budgets).map(([kind, spent]) => ({ day: value.budgetDay, kind, spent })) : [],
          grants: value.grantsCount, sqliteUsedBytes: 0, storageMetric: 'Firestore authoritative records; deployed unit and byte measurements remain release gates.',
        } };
      }
      const uid = string(input.uid, 'Identity', 128, false), path = await this.memberPath(uid);
      if (operation === 'lookup') return { ok: true, data: member(await this.store.read(path), uid) };
      const result = await this.transition(async () => {
        const [base, document] = await Promise.all([this.readControl(), this.store.read(path)]);
        const state = control(base), current = member(document, uid);
        if (operation === 'reserve') {
          if (current) {
            if (current.state === 'active' || current.state === 'reserved') return { result: current };
            throw new Fault(403, current.state === 'suspended' ? 'MEMBERSHIP_SUSPENDED' : current.state === 'deleting' ? 'ACCOUNT_DELETING' : 'ACCOUNT_DELETED',
              current.state === 'deleting' ? 'Workspace deletion is paused. Retry deletion to finish removing your data.' : 'This workspace is unavailable.');
          }
          const cap = Math.max(0, Math.min(500, Number(this.env.BETA_CAP ?? 0) || 0));
          if (this.env.ADMISSION_OPEN !== 'true' || !cap) throw new Fault(403, 'BETA_FULL', 'New memberships are currently closed.');
          if (this.env.ADMISSION_UIDS !== undefined) {
            let allowed: unknown; try { allowed = JSON.parse(this.env.ADMISSION_UIDS); } catch { allowed = []; }
            if (!Array.isArray(allowed) || allowed.length > 500 || !allowed.includes(uid)) throw new Fault(403, 'BETA_FULL', 'New memberships are currently closed.');
          }
          if (state.occupied >= cap) throw new Fault(403, 'BETA_FULL', 'The beta is full. Existing members can still sign in.');
          if (state.totalMembers >= 10_000) throw new Fault(503, 'ADMISSION_PAUSED', 'New memberships are temporarily paused.');
          charge(state, 'interactive', 128);
          const value: Member = { uid, generation: crypto.randomUUID(), state: 'reserved', created_at: new Date().toISOString(), operation: crypto.randomUUID(), lifecycle_epoch: 0 };
          state.totalMembers++; state.occupied++; state.states.reserved++;
          return { result: value, control: state, base, writes: [{ path, data: value, currentDocument: { exists: false } }] };
        }
        if (!current || input.generation !== current.generation) throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'Sign in to a workspace first.');
        if (operation === 'member') return { result: current };
        if (['activate', 'deleting', 'deleted', 'suspend', 'resume'].includes(operation)) {
          const next = { ...current };
          if (operation === 'activate') {
            if (!['reserved', 'active'].includes(current.state)) throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'This workspace is unavailable.');
            next.state = 'active';
          } else if (operation === 'deleting') {
            if (current.state === 'deleted' || current.state === 'deleting') return { result: current };
            next.state = 'deleting';
          } else if (operation === 'deleted') {
            if (!['deleting', 'deleted'].includes(current.state)) throw new Fault(409, 'INVALID_TRANSITION', 'Close the workspace before releasing its seat.');
            next.state = 'deleted';
          } else {
            const expected = operation === 'suspend' ? 'active' : 'suspended';
            next.state = operation === 'suspend' ? 'suspended' : 'active';
            if (current.state !== expected && current.state !== next.state) throw new Fault(409, 'INVALID_TRANSITION', 'Membership state changed.');
            next.lifecycle_epoch++;
          }
          if (next.state !== current.state) {
            state.states[current.state]--; state.states[next.state]++;
            if (next.state === 'deleted') state.occupied--;
          }
          return { result: next, base, control: state, writes: [{ path, data: next, currentDocument: condition(document) }] };
        }
        if (operation === 'grant' || operation === 'cleanup.grant') {
          const cleanup = operation === 'cleanup.grant';
          if (!cleanup && current.state !== 'active') throw new Fault(403, 'MEMBERSHIP_REQUIRED', 'This workspace is unavailable.');
          const kind = cleanup ? 'cleanup' : string(input.kind, 'Budget', 20, false);
          if (!['interactive', 'ingestion', 'completion', ...(cleanup ? ['cleanup'] : [])].includes(kind)) throw new Fault(400, 'INVALID_INPUT', 'Unknown budget.');
          if (['ingestion', 'completion'].includes(kind) && this.env.PROCESSING_OPEN !== 'true') throw new Fault(429, 'PROCESSING_PAUSED', 'Processing is temporarily paused.');
          const units = integer(input.units, 'Work reservation', 1, 20_000), id = string(input.id, 'Request ID', 120, false), day = today();
          const grantPath = `${GRANTS}/${await hash(`${uid}\0${id}`)}`, previousDoc = await this.store.read(grantPath);
          const previous = previousDoc?.data;
          if (previous) {
            if (previous.uid !== uid || previous.kind !== kind || previous.units !== units) throw new Fault(409, 'REQUEST_CONFLICT', 'Request ID was already used.');
            if (previous.day !== day) throw new Fault(409, 'GRANT_EXPIRED', 'Start a new request after checking the earlier result.');
          }
          charge(state, kind, units + 8);
          const writes: FirestoreWrite[] = [{ path, verify: true, currentDocument: condition(document) }];
          if (previousDoc) writes.push({ path: grantPath, verify: true, currentDocument: condition(previousDoc) });
          else {
            // Bounded cleanup replaces the old SQL DELETE WHERE day < today.
            // All writers and sweepers share the control fence, so count cannot drift.
            const stale = await this.store.query(GRANTS, { field: 'day', op: 'LESS_THAN', value: day, orderBy: 'day', limit: 20 });
            if (stale.length > state.grantsCount) corrupt();
            for (const row of stale) writes.push({ path: row.path, delete: true, currentDocument: condition(row) });
            state.grantsCount -= stale.length;
            if (state.grantsCount >= MAX_GRANTS) throw new Fault(429, 'DAILY_BUDGET', 'Today’s shared processing allowance is full. Try again tomorrow.');
            state.grantsCount++;
            writes.push({ path: grantPath, data: { uid, kind, units, day }, currentDocument: { exists: false } });
          }
          return { result: { granted: true, replayed: Boolean(previousDoc), units, day }, control: state, base, writes };
        }
        throw new Fault(404, 'NOT_FOUND', 'Unknown registry operation.');
      });
      return { ok: true, data: result };
    } catch (error) { return failure(error); }
  }
  /** One bounded maintenance page. Repeated or concurrent calls remain safe. */
  async maintenance(limit = 100): Promise<{ deleted: number; possiblyMore: boolean }> {
    integer(limit, 'Maintenance page size', 1, 100);
    return await this.transition(async () => {
      const base = await this.readControl(), state = control(base);
      const stale = await this.store.query(GRANTS, { field: 'day', op: 'LESS_THAN', value: today(), orderBy: 'day', limit });
      if (stale.length > state.grantsCount) corrupt();
      const result = { deleted: stale.length, possiblyMore: stale.length === limit };
      if (!stale.length) return { result };
      state.grantsCount -= stale.length;
      return { result, base, control: state, writes: stale.map(row => ({ path: row.path, delete: true, currentDocument: condition(row) })) };
    }) as { deleted: number; possiblyMore: boolean };
  }
}
