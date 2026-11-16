import { decodeJwt } from 'jose';
import { Registry as SqlRegistry } from './membership/registry';
import { FirestoreWorkspace, type FirestoreWorkspaceEnv } from './firestore/workspace';
import { FirestoreRegistry, type FirestoreRegistryEnv } from './firestore/registry';
import { FirestoreClient, type FirestoreWrite } from './firestore/client';
import { googleVerifier, issueSession, verifySession, firebaseAccountChecker, credentialRequestFingerprint } from './auth/session';
import { encryptCredential, decryptCredential, parseKeyring, rotateCredential, type Provider } from './credentials';
import { classificationBatch, createApify } from './providers';
import { LIMITS, Fault, failure, object, string, integer, type Access, type Input, type Result, type Membership, type StoredJob, type Ciphertext } from './contracts';
import { publicJob, selectTargets, reconcileJob, stopJob, unwrap, type WorkspacePort } from './jobs/orchestrator';
/** The old SQL mode remains available only for explicit legacy/synthetic configurations. */
export class Registry extends SqlRegistry {
  private readonly firebaseEnv: AppEnv;
  private remote?: FirestoreRegistry;
  constructor(ctx: DurableObjectState, env: AppEnv) { super(ctx, env); this.firebaseEnv = env; }
  override async invoke(operation: string, input: Input = {}): Promise<Result> {
    try {
      if (this.firebaseEnv.FIRESTORE_ENABLED !== 'true') {
        if (await this.ctx.storage.get('firestore-authority')) throw new Fault(503, 'STORAGE_BACKEND_MISMATCH', 'This workspace requires its configured cloud database.');
        return super.invoke(operation, input);
      }
      await this.ctx.storage.put('firestore-authority', true);
      return await (this.remote ??= new FirestoreRegistry(this.firebaseEnv)).invoke(operation, input);
    }
    catch (error) { return failure(error); }
  }
}
/** Only this application class activates external background processing. */
export class Workspace extends FirestoreWorkspace<AppEnv> {
  protected override async authorizeProvision(access: Access): Promise<void> {
    const member = checked<Membership | null>(await registry(this.env).invoke('lookup', { uid: access.uid }));
    if (!member || member.generation !== access.generation || member.state !== 'reserved')
      throw new Fault(403, 'PROVISIONING_DENIED', 'This workspace reservation is no longer available.');
  }
  protected override async reconcile(access: Access): Promise<boolean> {
    await reconcileJob(access, this, this.env); return true;
  }
  protected override async provisionFences(access: Access): Promise<FirestoreWrite[]> {
    return new FirestoreRegistry(this.env, this.firestore()).provisionFences(access);
  }
}
// Separate production namespaces prevent older SQL builds from reading this cache.
export class FirebaseWorkspace extends Workspace {}
export class FirebaseRegistry extends Registry {}

export interface AppEnv extends FirestoreWorkspaceEnv, FirestoreRegistryEnv {
  ASSETS: Fetcher;
  WORKSPACES: DurableObjectNamespace<Workspace>;
  REGISTRY: DurableObjectNamespace<Registry>;
  HOSTED_ENABLED?: string; FIREBASE_PROJECT_ID?: string; FIREBASE_PUBLIC_CONFIG?: string;
  APP_ORIGIN?: string; SESSION_SIGNING_KEY?: string; CREDENTIAL_KEYS?: string;
  OPERATOR_UIDS?: string; PROCESSING_OPEN?: string;
}
interface Dependencies {
  verifyIdentity?: (token: string, project: string) => Promise<{ uid: string }>;
  checkAccount?: (token: string, apiKey: string) => Promise<void>;
  providerFetch?: typeof fetch;
}
const verifyGoogle = googleVerifier();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: {
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
} });
function checked<T = Input>(value: Result): T { return unwrap<T>(value); }
function workspace(env: AppEnv, access: Access): WorkspacePort {
  return env.WORKSPACES.get(env.WORKSPACES.idFromName(`workspace:${access.uid}:${access.generation}`));
}
function registry(env: AppEnv) { return env.REGISTRY.get(env.REGISTRY.idFromName('members-v1')); }
async function body(request: Request): Promise<Input> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) throw new Fault(415, 'INVALID_INPUT', 'Send a JSON request.');
  const reader = request.body?.getReader(); if (!reader) throw new Fault(400, 'INVALID_INPUT', 'Request body is missing.');
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length; if (size > LIMITS.requestBytes) throw new Fault(413, 'REQUEST_TOO_LARGE', 'Split this request into a smaller batch.');
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return object(JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes))); }
  catch (error) { if (error instanceof Fault) throw error; throw new Fault(400, 'INVALID_INPUT', 'Request JSON is invalid.'); }
}
function publicConfig(env: AppEnv) {
  let firebase: Input = {};
  try {
    const configured = object(JSON.parse(env.FIREBASE_PUBLIC_CONFIG ?? '{}'));
    if (configured.projectId === env.FIREBASE_PROJECT_ID) {
      firebase = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId'].filter(key => typeof configured[key] === 'string').map(key => [key, configured[key]]));
    }
  } catch { /* Configuration remains unavailable. */ }
  const storageReady = env.FIRESTORE_ENABLED !== 'true' || Boolean(env.FIRESTORE_DATABASE_ID && (env.FIRESTORE_SERVICE_ACCOUNT || env.FIRESTORE_EMULATOR_HOST));
  const enabled = env.HOSTED_ENABLED === 'true' && storageReady && Boolean(firebase.apiKey && firebase.authDomain && firebase.projectId && env.SESSION_SIGNING_KEY && env.CREDENTIAL_KEYS);
  return { mode: 'hosted', edition: 'free-beta', enabled, firebase, retrieval_limit: 25, item_limit: LIMITS.items, logical_limit: LIMITS.logicalBytes };
}
const checkFirebaseAccount = firebaseAccountChecker();
async function grant(env: AppEnv, access: Access, kind: string, id: string, units: number) {
  return checked(await registry(env).invoke('grant', { ...access, kind, id, units }));
}
async function session(env: AppEnv, uid: string): Promise<Input> {
  const member = checked<Membership>(await registry(env).invoke('reserve', { uid }));
  const access = { uid, generation: member.generation };
  if (member.state === 'reserved') {
    checked(await workspace(env, access).invoke(access, 'provision'));
    checked(await registry(env).invoke('activate', access));
  }
  return { membership: { ...member, state: 'active' }, ...await issueSession(access, env.SESSION_SIGNING_KEY) };
}
function requestId(input: Input): string { return string(input.request_id, 'Request ID', 100, false); }
async function saveSettings(env: AppEnv, access: Access, store: WorkspacePort, input: Input): Promise<unknown> {
  const keyring = parseKeyring(env.CREDENTIAL_KEYS);
  const updates: { provider: Provider; value: Ciphertext | null }[] = [];
  for (const [provider, field] of [['apify', 'apify_token'], ['openai', 'openai_key']] as const) {
    if (input[`clear_${field}`] === true) updates.push({ provider, value: null });
    else if (typeof input[field] === 'string' && input[field].trim()) updates.push({ provider, value: await encryptCredential(access, provider, input[field], keyring) });
    else if (input[field] !== undefined && typeof input[field] !== 'string') throw new Fault(400, 'INVALID_INPUT', 'Provider key must be text.');
  }
  // All plaintext validation/encryption completes before any stored setting changes.
  const settings: Input = { request_id: requestId(input) };
  if (input.goals !== undefined) settings.goals = string(input.goals, 'Goals', 2000);
  if (input.model !== undefined) settings.model = string(input.model, 'Model', 100, false);
  if (input.weekly_hours !== undefined) {
    if (typeof input.weekly_hours !== 'number' || !Number.isFinite(input.weekly_hours) || input.weekly_hours < .25 || input.weekly_hours > 168)
      throw new Fault(400, 'INVALID_INPUT', 'Weekly time budget must be between 0.25 and 168 hours.');
    settings.weekly_hours = input.weekly_hours;
  }
  settings.credential_fingerprint = await credentialRequestFingerprint({ ...input, credential_fingerprint: undefined, credential_updates: undefined }, env.SESSION_SIGNING_KEY);
  settings.credential_updates = updates; // atomic internal bundle; no plaintext enters the object.
  return checked(await store.invoke(access, 'settings', settings));
}
async function start(env: AppEnv, access: Access, store: WorkspacePort, input: Input, kind: 'retrieval' | 'classification', ctx: ExecutionContext, fetcher?: typeof fetch) {
  if (env.PROCESSING_OPEN !== 'true') throw new Fault(429, 'PROCESSING_PAUSED', 'Processing is temporarily paused.');
  const id = requestId(input);
  const limit = kind === 'retrieval' ? integer(input.limit ?? 10, 'Batch size', 1, 25) : integer(input.limit ?? 20, 'Batch size', 1, 20);
  const previous = checked<StoredJob | null>(await store.invoke(access, 'job.get'));
  if (previous?.request_id === id) return publicJob(previous);
  const provider = kind === 'retrieval' ? 'apify' : 'openai';
  if (!checked(await store.invoke(access, 'credential.get', { provider }))) throw new Fault(400, 'PROVIDER_KEY_REQUIRED', 'Add your own provider key in Settings.');
  if (input.retry !== undefined && typeof input.retry !== 'boolean') throw new Fault(400, 'INVALID_INPUT', 'Retry must be true or false.');
  const summary = checked<Input>(await store.invoke(access, 'state'));
  let selected = await selectTargets(store, access, kind, limit, input.retry === true, input.ids);
  if (kind === 'classification') {
    const selectedIds = new Set(classificationBatch(selected).map(item => item.id));
    selected = selected.filter(item => selectedIds.has(item.id));
  }
  if (!selected.length) throw new Fault(400, 'NOTHING_TO_PROCESS', 'No eligible saves need this step.');
  const charge = kind === 'retrieval' ? Number(input.max_charge ?? 1) : 0;
  if (kind === 'retrieval' && (typeof (input.max_charge ?? 1) !== 'number' || !Number.isFinite(charge) || charge < .01 || charge > 20))
    throw new Fault(400, 'INVALID_INPUT', 'Choose a provider charge cap between $0.01 and $20.');
  await grant(env, access, 'ingestion', id, 16 * selected.length + 32);
  await grant(env, access, 'completion', `${id}:completion`, 2000);
  const now = new Date().toISOString();
  const intent = {
    id: crypto.randomUUID(), kind, status: 'QUEUED', revision: 0, request_id: id,
    selected_ids: selected.map(item => String(item.id)), selected_revisions: Object.fromEntries(selected.map(item => [String(item.id), Number(item.revision)])),
    selected_count: selected.length, reserved_bytes: selected.length * 100_000, max_charge: charge,
    created_at: now, updated_at: now, poll_count: 0, cursor: 0, seen_ids: [], applied_count: 0,
    next_poll_at: Date.now() + 1000, goals: String(summary.goals ?? ''),
    project_names: (summary.projects as Input[] ?? []).map(project => String(project.name)),
    model: (summary.settings as Input | undefined)?.model ?? 'gpt-4.1-mini',
  };
  const result = checked<StoredJob>(await store.invoke(access, 'job.begin', { job: intent, request_id: id }));
  // The workspace alarm owns submission. Its durable QUEUED -> STARTING claim
  // survives browser closure and has no waitUntil(30s) response-persistence race.
  return publicJob(result);
}

export async function repairFirestoreWakeups(env: AppEnv): Promise<{ repaired: number; failed: number; quarantined: number }> {
  if (env.HOSTED_ENABLED !== 'true' || env.FIRESTORE_ENABLED !== 'true') return { repaired: 0, failed: 0, quarantined: 0 };
  const store = new FirestoreClient(env);
  // This bounded index scan recovers durable wake intents even if a DO cache/alarm was lost.
  const due = await store.query('s2sWorkspaces', { field: 'wakeAt', op: 'LESS_THAN', value: Date.now(), orderBy: 'wakeAt', limit: 20 });
  let repaired = 0, failed = 0, quarantined = 0;
  for (const document of due) {
    const data = document.data;
    if (!(data.status === 'active' || (data.status === 'deleting' && data.purging === true)) || typeof data.wakeAt !== 'number' || data.wakeAt <= 0 ||
      typeof data.uid !== 'string' || !data.uid || data.uid.length > 128 ||
      typeof data.generation !== 'string' || !/^[a-f0-9-]{36}$/.test(data.generation)) continue;
    const access = { uid: data.uid, generation: data.generation };
    try {
      const compatible = await env.WORKSPACES.get(env.WORKSPACES.idFromName(`workspace:${access.uid}:${access.generation}`)).repair(access);
      if (compatible === false) quarantined++;
      else repaired++;
    } catch { failed++; }
  }
  checked(await registry(env).invoke('maintenance'));
  return { repaired, failed, quarantined };
}
export function makeApp(dependencies: Dependencies = {}): ExportedHandler<AppEnv> {
  return { async scheduled(_event, env): Promise<void> { await repairFirestoreWakeups(env); }, async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/') && url.pathname !== '/api') {
      if (url.pathname === '/health') return json({ status: 'development', mode: 'hosted', enabled: publicConfig(env).enabled });
      if (!['GET', 'HEAD'].includes(request.method)) return json({ error: 'Not found' }, 404);
      const response = await env.ASSETS.fetch(request), secured = new Response(response.body, response);
      secured.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.googleusercontent.com; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src https://*.firebaseapp.com https://accounts.google.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
      secured.headers.set('Referrer-Policy', 'no-referrer'); secured.headers.set('X-Content-Type-Options', 'nosniff');
      secured.headers.set('Cross-Origin-Opener-Policy', 'same-origin-allow-popups'); return secured;
    }
    try {
      const origin = env.APP_ORIGIN || url.origin;
      if (url.origin !== origin || (request.headers.has('Origin') && request.headers.get('Origin') !== origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site')
        throw new Fault(403, 'ORIGIN_REJECTED', 'Open the workbench directly to continue.');
      for (const field of ['uid', 'owner', 'workspace', 'generation']) if (url.searchParams.has(field)) throw new Fault(400, 'INVALID_INPUT', 'Workspace selectors are not accepted.');
      if (url.pathname === '/api/config' && request.method === 'GET') return json(publicConfig(env));
      const config = publicConfig(env);
      if (!config.enabled) throw new Fault(503, 'HOSTED_NOT_READY', 'The hosted beta is being configured.');

      if (!['GET', 'POST'].includes(request.method)) throw new Fault(405, 'METHOD_NOT_ALLOWED', 'This method is not supported.');
      const authorization = request.headers.get('Authorization') ?? '';
      if (!authorization.startsWith('Bearer ') || authorization.length > 16_400) throw new Fault(401, 'SIGN_IN_REQUIRED', 'Sign in to open your workspace.');
      const token = authorization.slice(7); let uid: string;
      try { uid = (await (dependencies.verifyIdentity ?? verifyGoogle)(token, env.FIREBASE_PROJECT_ID!)).uid; }
      catch { throw new Fault(401, 'SIGN_IN_EXPIRED', 'Please sign in again.'); }
      if (url.pathname === '/api/session' && request.method === 'GET') {
        await (dependencies.checkAccount ?? checkFirebaseAccount)(token, String(config.firebase.apiKey));
        return json(await session(env, uid));
      }
      const input = request.method === 'POST' ? await body(request) : {};
      for (const field of ['uid', 'owner', 'workspace', 'generation']) {
        if (field === 'workspace' && url.pathname === '/api/restore') continue; // bounded backup metadata, never an owner selector
        if (field in input) throw new Fault(400, 'INVALID_INPUT', 'Workspace selectors are not accepted.');
      }
      if (url.pathname.startsWith('/api/admin/')) {
        await (dependencies.checkAccount ?? checkFirebaseAccount)(token, String(config.firebase.apiKey));
        return json(await admin(env, uid, url.pathname, input, request.method));
      }
      if (url.pathname === '/api/account/delete' && request.method === 'POST') {
        await (dependencies.checkAccount ?? checkFirebaseAccount)(token, String(config.firebase.apiKey));
        if (Math.floor(Date.now() / 1000) - Number(decodeJwt(token).auth_time) > 300) throw new Fault(401, 'RECENT_SIGN_IN_REQUIRED', 'Sign in again before deleting this account.');
        return json(await deleteAccount(env, uid, input, dependencies));
      }
      const access = await verifySession(request.headers.get('X-Workspace-Session') ?? '', uid, env.SESSION_SIGNING_KEY);
      const store = workspace(env, access);
      if (request.method === 'GET') {
        if (url.pathname === '/api/state') return json(checked(await store.invoke(access, 'state')));
        if (url.pathname === '/api/search') return json(checked(await store.invoke(access, 'search', { query: string(url.searchParams.get('q') ?? '', 'Search query', 200) })));
        if (url.pathname === '/api/items' || url.pathname === '/api/export') {
          const limit = url.searchParams.has('limit') ? integer(Number(url.searchParams.get('limit')), 'Page size', 1, LIMITS.page) : LIMITS.page;
          return json(checked(await store.invoke(access, url.pathname === '/api/items' ? 'list' : 'export', { cursor: url.searchParams.get('cursor') || undefined, limit })));
        }
        if (url.pathname === '/api/item') return json(checked(await store.invoke(access, 'detail', { id: url.searchParams.get('id') ?? '' })));
        if (url.pathname === '/api/prompt') {
          const selected = await selectTargets(store, access, 'classification', 20);
          return json({ prompt: 'Classify these saved ideas using only their supplied text and notes. Return JSON items preserving each id and expected_revision. Include kind, title, why, next_action, definition_of_done, project_name, effort_hours, confidence, tags, impact, relevance, novelty, repo_suggestion and commit_message. Leave task status unchanged.\n' + JSON.stringify(selected.map(({ id, revision, title, content, note }) => ({ id, expected_revision: revision, title, content, note }))) });
        }
        throw new Fault(404, 'NOT_FOUND', 'Not found.');
      }
      if (url.pathname === '/api/retrieve/start') return json(await start(env, access, store, input, 'retrieval', ctx, dependencies.providerFetch));
      if (url.pathname === '/api/classify-ai') return json(await start(env, access, store, input, 'classification', ctx, dependencies.providerFetch));
      if (url.pathname === '/api/retrieve/poll' || url.pathname === '/api/jobs/poll') return json(await reconcileJob(access, store, env, dependencies.providerFetch));
      if (url.pathname === '/api/retrieve/stop' || url.pathname === '/api/jobs/stop') {
        await grant(env, access, 'interactive', requestId(input), 64);
        return json(await stopJob(access, store, env, dependencies.providerFetch));
      }
      if (url.pathname === '/api/retrieve/dismiss' || url.pathname === '/api/jobs/dismiss') {
        const job = checked<StoredJob | null>(await store.invoke(access, 'job.get'));
        if (!job || job.status !== 'UNCERTAIN') throw new Fault(409, 'INVALID_TRANSITION', 'Only an uncertain submission can be dismissed after checking the provider.');
        await grant(env, access, 'interactive', requestId(input), 64);
        return json(publicJob(checked(await store.invoke(access, 'job.update', { id: job.id, expected_job_revision: job.revision,
          patch: { status: 'CANCELLED', next_poll_at: 0, lease_until: 0 } }))));
      }
      if (url.pathname === '/api/jobs/resume') {
        const job = checked<StoredJob | null>(await store.invoke(access, 'job.get'));
        if (!job || job.status !== 'QUOTA_BLOCKED') throw new Fault(409, 'INVALID_TRANSITION', 'This job is not paused.');
        await grant(env, access, 'completion', requestId(input), 2000);
        return json(publicJob(checked(await store.invoke(access, 'job.update', { id: job.id, expected_job_revision: job.revision,
          patch: { status: job.kind === 'classification' ? 'APPLYING' : 'RUNNING', poll_count: 0, reconciliation_count: 0, completion_units_remaining: 1872, next_poll_at: Date.now() + 1000, lease_until: 0 } }))));
      }
      if (url.pathname === '/api/import/plan') return json(checked(await store.invoke(access, 'import.plan', input)));
      if (url.pathname === '/api/preferences' && Object.keys(input).some(key => !['request_id', 'weekly_hours'].includes(key)))
        throw new Fault(400, 'INVALID_INPUT', 'Choose a supported preference.');
      const operation = ({ '/api/preferences': 'settings', '/api/capture': 'capture', '/api/item': 'item', '/api/delete': 'delete', '/api/move': 'move', '/api/reading': 'reading',
        '/api/project': 'project', '/api/settings': 'settings', '/api/classify': 'classify', '/api/triage': 'triage', '/api/import': 'import', '/api/restore': 'restore' } as Record<string, string>)[url.pathname];
      if (!operation) throw new Fault(404, 'NOT_FOUND', 'Not found.');
      const count = Array.isArray(input.rows) ? input.rows.length : Array.isArray(input.items) ? input.items.length : operation === 'classify' ? 25 : 1;
      if (count > 25) throw new Fault(413, 'BATCH_TOO_LARGE', 'Use batches of at most 25 saves.');
      const groupCount = operation === 'restore' && input.workspace && typeof input.workspace === 'object'
        && Array.isArray((input.workspace as Input).projects) ? ((input.workspace as Input).projects as unknown[]).length : 0;
      if (groupCount > 100) throw new Fault(413, 'BATCH_TOO_LARGE', 'A workspace supports at most 100 sections.');
      await grant(env, access, operation === 'import' || operation === 'restore' ? 'ingestion' : 'interactive', requestId(input), 16 * Math.max(1, count + groupCount) + 32);
      return json(operation === 'settings' ? await saveSettings(env, access, store, input) : checked(await store.invoke(access, operation, input)));
    } catch (error) {
      const result = failure(error);
      if (result.ok) throw new Error('Unexpected error result');
      return json({ error: result.message, code: result.code }, result.status);
    }
  } };
}

async function deleteAccount(env: AppEnv, uid: string, input: Input, dependencies: Dependencies = {}): Promise<Input> {
  const member = checked<Membership | null>(await registry(env).invoke('lookup', { uid }));
  if (!member) return { deleted: true };
  const access = { uid, generation: member.generation }, store = workspace(env, access);
  const finishPurged = async (missing: Result): Promise<Input> => {
    // An active/reserved workspace disappearing is an error, never seat release.
    const current = checked<Membership | null>(await registry(env).invoke('lookup', { uid }));
    if (current?.generation !== access.generation || !['deleting', 'deleted'].includes(current.state)) checked(missing);
    checked(await registry(env).invoke('deleted', access));
    return { deleted: true };
  };
  checked(await registry(env).invoke('cleanup.grant', { ...access, id: `delete-attempt:${crypto.randomUUID()}`, units: 64 }));
  if (member.state === 'deleted') {
    // Old versions retained a closed SQL tombstone. Reclaim it on an authorized,
    // budgeted deletion retry; an already-empty object remains strictly read-only.
    const closed = await store.invoke(access, 'close');
    if (!closed.ok && closed.code !== 'NOT_FOUND') checked(closed);
    return { deleted: true };
  }
  if (input.apify_token !== undefined) {
    if (member.state !== 'deleting') throw new Fault(409, 'INVALID_TRANSITION', 'Only a paused deletion accepts a replacement key here.');
    const encrypted = await encryptCredential(access, 'apify', string(input.apify_token, 'Provider key', 2048, false), parseKeyring(env.CREDENTIAL_KEYS));
    const repaired = await store.invoke(access, 'delete.key', { value: encrypted });
    if (!repaired.ok && repaired.code === 'NOT_FOUND') return finishPurged(repaired);
    checked(repaired);
  }
  // The workspace-local freeze is atomic with QUEUED -> STARTING and all edits.
  // A retry retains the known run/key until abort succeeds and cleanup commits.
  const prepared = await store.invoke(access, 'delete.prepare');
  if (!prepared.ok && prepared.code === 'NOT_FOUND') {
    // Only a matching deletion in Registry can explain already-purged storage.
    return finishPurged(prepared);
  }
  if (!prepared.ok && prepared.code !== 'WORKSPACE_DELETED') checked(prepared);
  if (prepared.ok) {
    const pending = prepared.data as { job: StoredJob | null; credential: Ciphertext | null; cleanup_units: number };
    checked(await registry(env).invoke('deleting', access));
    if (pending.job?.kind === 'retrieval' && pending.job.run_id) {
      if (!pending.credential) throw new Fault(409, 'ACCOUNT_DELETING', 'Supply a working Apify key to finish stopping the known run and deleting this workspace.');
      try {
        const token = await decryptCredential(access, 'apify', pending.credential, parseKeyring(env.CREDENTIAL_KEYS));
        await createApify(dependencies.providerFetch).abort(String(pending.job.run_id), token);
      } catch {
        throw new Fault(409, 'ACCOUNT_DELETING', 'Deletion is paused because the known provider run could not be stopped. Retry, or supply a working Apify key for the same provider account.');
      }
    }
    checked(await registry(env).invoke('cleanup.grant', { ...access, id: `delete-close:${crypto.randomUUID()}`, units: pending.cleanup_units }));
  } else checked(await registry(env).invoke('deleting', access));
  // Registry freezes provisioning before purge and retains the terminal generation.
  const closed = await store.invoke(access, 'close');
  if (!closed.ok && closed.code !== 'NOT_FOUND') checked(closed);
  checked(await registry(env).invoke('deleted', access));
  return { deleted: true };
}
async function admin(env: AppEnv, uid: string, path: string, input: Input, method: string): Promise<unknown> {
  let operators: string[] = [];
  try { operators = JSON.parse(env.OPERATOR_UIDS ?? '[]'); } catch { /* Deny by default. */ }
  if (!Array.isArray(operators) || !operators.includes(uid)) throw new Fault(404, 'NOT_FOUND', 'Not found.');
  if (path === '/api/admin/stats' && method === 'GET') return checked(await registry(env).invoke('stats'));
  if (path === '/api/admin/reconcile' && method === 'POST') {
    const pending = checked<Membership[]>(await registry(env).invoke('pending'));
    let activated = 0;
    for (const member of pending) {
      const access = { uid: member.uid, generation: member.generation };
      if ((await workspace(env, access).invoke(access, 'provision')).ok) { checked(await registry(env).invoke('activate', access)); activated++; }
    }
    return { activated };
  }
  if ((path === '/api/admin/suspend' || path === '/api/admin/resume') && method === 'POST') {
    const member = checked<Membership | null>(await registry(env).invoke('lookup', { uid: string(input.target, 'Member', 128, false) }));
    if (!member) throw new Fault(404, 'NOT_FOUND', 'Not found.');
    const access = { uid: member.uid, generation: member.generation }, operation = path.endsWith('suspend') ? 'suspend' : 'resume';
    const changed = checked<Membership>(await registry(env).invoke(operation, access));
    checked(await workspace(env, access).invoke(access, operation, { lifecycle_epoch: changed.lifecycle_epoch }));
    return changed;
  }
  throw new Fault(404, 'NOT_FOUND', 'Not found.');
}
export default makeApp();
