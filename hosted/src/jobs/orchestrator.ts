import { Fault, type Access, type Input, type Result, type StoredJob, type Ciphertext } from '../contracts';
import { createApify, eligible, retrievalCandidates, missingCandidates, classify, ProviderFailure } from '../providers';
import { parseKeyring, decryptCredential } from '../credentials';

export interface WorkspacePort { invoke(access: Access, operation: string, input?: Input): Promise<Result> }
export interface JobEnv { CREDENTIAL_KEYS?: string }
export function unwrap<T = Input>(result: Result): T {
  if (!result.ok) throw new Fault(result.status, result.code, result.message);
  return result.data as T;
}
const ACTIVE = new Set(['QUEUED', 'STARTING', 'RUNNING', 'APPLYING', 'UNCERTAIN', 'QUOTA_BLOCKED']);
const BLOCKED = new Set(['QUOTA_EXCEEDED', 'PHYSICAL_LIMIT', 'STORAGE_PRESSURE', 'ITEM_STORAGE_LIMIT', 'LOGICAL_LIMIT', 'RESULT_LIMIT', 'GROUP_LIMIT', 'GROUP_STORAGE_LIMIT']);
export function publicJob(job: Input | null): Input {
  if (!job) return { idle: true };
  const fields = ['id', 'kind', 'status', 'created_at', 'updated_at', 'selected_count', 'applied_count', 'classified',
    'missing_count', 'error', 'max_charge', 'changed_ids', 'next_poll_at'];
  return Object.fromEntries(fields.filter(key => job[key] !== undefined).map(key => [key, job[key]]));
}
async function call<T = Input>(workspace: WorkspacePort, access: Access, operation: string, input: Input = {}): Promise<T> {
  return unwrap<T>(await workspace.invoke(access, operation, input));
}
async function key(workspace: WorkspacePort, access: Access, provider: 'apify' | 'openai', env: JobEnv): Promise<string> {
  const value = await call<Ciphertext | null>(workspace, access, 'credential.get', { provider });
  if (!value) throw new Fault(400, 'PROVIDER_KEY_REQUIRED', 'Add your own provider key in Settings.');
  return decryptCredential(access, provider, value, parseKeyring(env.CREDENTIAL_KEYS ?? ''));
}
async function targets(workspace: WorkspacePort, access: Access, ids: string[]): Promise<Input[]> {
  // Removed saves must not block completion for the remaining selected saves.
  const result: Input[] = [];
  for (const id of ids) {
    const response = await workspace.invoke(access, 'detail', { id });
    if (response.ok) result.push(response.data as Input);
    else if (response.code !== 'NOT_FOUND') unwrap(response);
  }
  return result;
}
export async function selectTargets(workspace: WorkspacePort, access: Access, kind: string, limit: number, retry = false, selectedIds?: unknown): Promise<Input[]> {
  if (selectedIds !== undefined) {
    if (!Array.isArray(selectedIds) || selectedIds.length < 1 || selectedIds.length > limit ||
      selectedIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 50) || new Set(selectedIds).size !== selectedIds.length)
      throw new Fault(400, 'INVALID_INPUT', `Choose between one and ${limit} different saves.`);
    const selected = await targets(workspace, access, selectedIds as string[]);
    if (selected.length !== selectedIds.length) throw new Fault(404, 'NOT_FOUND', 'Save not found.');
    const matches = selected.every(item => kind === 'retrieval' ? eligible(item, retry) : item.kind === 'untriaged' && item.status === 'inbox' && Boolean(String(item.content ?? '').trim() || String(item.note ?? '').trim()));
    if (!matches) throw new Fault(409, 'SELECTED_SAVES_CHANGED', 'Some selected saves changed. Review your selection before starting.');
    return selected;
  }
  const ids: string[] = []; let cursor: string | undefined;
  do {
    const page = await call<{ items: Input[]; next_cursor: string | null }>(workspace, access, 'list', { cursor, limit: 50 });
    for (const item of page.items) {
      const matches = kind === 'retrieval'
        ? eligible({ ...item, content: item.has_content ? 'present' : '' }, retry)
        : item.kind === 'untriaged' && item.status === 'inbox' && item.has_context;
      if (matches) ids.push(String(item.id));
      if (ids.length >= limit) break;
    }
    cursor = page.next_cursor ?? undefined;
  } while (cursor && ids.length < limit);
  return targets(workspace, access, ids);
}

/** Called once only after a durable STARTING record has committed. Never an alarm retry. */
export async function submitJob(access: Access, workspace: WorkspacePort, env: JobEnv, job: StoredJob, selected: Input[], fetcher: typeof fetch = fetch): Promise<void> {
  try {
    const credential = await key(workspace, access, job.kind === 'retrieval' ? 'apify' : 'openai', env);
    // A deletion or suspension after intent creation must win before submission.
    const current = await call<StoredJob | null>(workspace, access, 'job.get', { id: job.id });
    if (!current || current.status !== 'STARTING' || current.revision !== job.revision) return;
    if (job.kind === 'retrieval') {
      const run = await createApify(fetcher).start({ urls: selected.map(item => String(item.url)), maxChargeUsd: Number(job.max_charge) }, credential);
      await call(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision, patch: {
        status: 'RUNNING', run_id: run.id, dataset_id: run.datasetId ?? '', provider_status: run.status,
        next_poll_at: Date.now() + 30_000, lease_until: 0,
      } });
    } else {
      const records = await classify({ items: selected, goals: String(job.goals ?? ''), existingProjects: job.project_names as string[] ?? [] }, credential, String(job.model ?? 'gpt-4.1-mini'), fetcher);
      const candidates = records.map(record => ({ id: record.id, expected_revision: job.selected_revisions[record.id], patch: record }));
      // The validated response is retained first; retrying its application never calls the provider again.
      const persisted = await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
        patch: { status: 'APPLYING', pending_candidates: candidates, next_poll_at: Date.now() + 1000, lease_until: 0 } });
      const claimed = await call<StoredJob>(workspace, access, 'job.claim', { id: persisted.id, lease_id: crypto.randomUUID(), lease_until: Date.now() + 60_000 });
      if (claimed.status !== 'QUOTA_BLOCKED') await applyPending(access, workspace, claimed);
    }
  } catch (error) {
    const latest = await workspace.invoke(access, 'job.get', { id: job.id });
    if (latest.ok && (latest.data as StoredJob | null)?.status === 'APPLYING') {
      const current = latest.data as StoredJob, blocked = error instanceof Fault && BLOCKED.has(error.code);
      await workspace.invoke(access, 'job.update', { id: job.id, expected_job_revision: current.revision, patch: {
        status: blocked ? 'QUOTA_BLOCKED' : 'APPLYING', lease_until: 0, next_poll_at: blocked ? 0 : Date.now() + 300_000,
        error: blocked ? 'The saved result needs more workspace room before it can be applied.' : 'The result is saved. Applying it will retry without another provider request.',
      } });
      return;
    }
    const uncertain = error instanceof ProviderFailure ? error.uncertain : true;
    await workspace.invoke(access, 'job.update', { id: job.id, expected_job_revision: job.revision,
      patch: { status: uncertain ? 'UNCERTAIN' : 'FAILED', error: uncertain
        ? 'The provider may have accepted this request. Check your provider account before dismissing it.'
        : 'The provider rejected this request. Check your key and settings.', next_poll_at: 0, lease_until: 0 } });
  }
}
async function applyPending(access: Access, workspace: WorkspacePort, job: StoredJob): Promise<StoredJob> {
  const candidates = job.pending_candidates as Input[] ?? [];
  return call<StoredJob>(workspace, access, 'job.apply', { id: job.id, expected_job_revision: job.revision,
    candidates, cursor: job.cursor ?? 0, terminal: true });
}

/** Bounded alarm/read-side reconciliation. No code path resubmits a paid request. */
export async function reconcileJob(access: Access, workspace: WorkspacePort, env: JobEnv, fetcher: typeof fetch = fetch): Promise<Input> {
  let job = await call<StoredJob | null>(workspace, access, 'job.get');
  if (!job || !ACTIVE.has(job.status)) return publicJob(job);
  if (job.status === 'UNCERTAIN') return publicJob(job);
  if (job.status === 'QUEUED') {
    const selected = await targets(workspace, access, job.selected_ids);
    if (!selected.length) {
      return publicJob(await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
        patch: { status: 'CANCELLED', next_poll_at: 0, error: 'The selected saves were removed.' } }));
    }
    try {
      job = await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision, patch: {
        status: 'STARTING', submission_deadline: Date.now() + 120_000, next_poll_at: Date.now() + 121_000,
        selected_revisions: Object.fromEntries(selected.map(item => [String(item.id), Number(item.revision)])),
      } });
    } catch (error) {
      if (error instanceof Fault && error.status === 409) {
        const current = await call<StoredJob | null>(workspace, access, 'job.get', { id: job.id });
        if (current?.status === 'QUEUED' && current.revision === job.revision) {
          return publicJob(await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
            patch: { status: 'CANCELLED', next_poll_at: 0, error: 'The selected saves changed. Review them before starting a new request.' } }));
        }
        return { ...publicJob(current), busy: true };
      }
      throw error;
    }
    await submitJob(access, workspace, env, job, selected, fetcher);
    return publicJob(await call<StoredJob | null>(workspace, access, 'job.get', { id: job.id }));
  }
  if (job.status === 'STARTING') {
    if (Date.now() > Number(job.submission_deadline ?? Date.parse(job.created_at) + 120_000)) job = await call<StoredJob>(workspace, access, 'job.update', {
      id: job.id, expected_job_revision: job.revision, patch: { status: 'UNCERTAIN', next_poll_at: 0,
        error: 'Submission did not finish reliably. Check the provider account; this request will not be resubmitted.' },
    });
    return publicJob(job);
  }
  if (job.status === 'QUOTA_BLOCKED') return publicJob(job);
  if (Number(job.next_poll_at ?? 0) > Date.now()) return publicJob(job);
  try {
    job = await call<StoredJob>(workspace, access, 'job.claim', { id: job.id, lease_id: crypto.randomUUID(), lease_until: Date.now() + 60_000 });
  } catch (error) {
    if (error instanceof Fault && error.status === 409) return { ...publicJob(job), busy: true };
    throw error;
  }
  if (job.status === 'QUOTA_BLOCKED') return publicJob(job);
  try {
    if (job.kind === 'classification') return publicJob(await applyPending(access, workspace, job));
    const provider = createApify(fetcher), token = await key(workspace, access, 'apify', env);
    if (!job.run_id) throw new Fault(409, 'MISSING_RUN', 'This submission needs reconciliation in your provider account.');
    const polls = Number(job.poll_count ?? 0);
    if (polls >= 12 && job.status !== 'APPLYING') {
      const stopped = await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
        patch: { status: 'QUOTA_BLOCKED', error: 'Automatic checks have paused. Check or stop the known run in your provider account.', next_poll_at: 0, lease_until: 0 } });
      return publicJob(stopped);
    }
    const run = job.status === 'APPLYING' ? null : await provider.poll(String(job.run_id), token);
    if (run && ['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING'].includes(run.status)) {
      return publicJob(await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
        patch: { status: 'RUNNING', poll_count: polls + 1, provider_status: run.status, dataset_id: run.datasetId ?? job.dataset_id ?? '',
          next_poll_at: Date.now() + Math.min(300_000, 30_000 * 2 ** polls), lease_until: 0 } }));
    }
    const dataset = run?.datasetId || String(job.dataset_id ?? '');
    const offset = Number(job.cursor ?? 0);
    if (offset >= 100) throw new Fault(409, 'RESULT_LIMIT', 'The result limit was reached. The known run is retained for inspection.');
    const page = dataset ? await provider.page(dataset, offset, token) : { records: [], nextOffset: null };
    const selected = await targets(workspace, access, job.selected_ids);
    const provenance = { runId: String(job.run_id), retrievedAt: new Date().toISOString() };
    const candidates = retrievalCandidates(page.records, selected, provenance);
    const seen = new Set<string>([...job.seen_ids as string[] ?? [], ...candidates.map(candidate => candidate.id)]);
    const terminal = page.nextOffset === null;
    const all = terminal ? [...candidates, ...missingCandidates(selected, [...seen], provenance)] : candidates;
    // Split by serialized bytes as well as count. An individual normalized item is bounded by the provider module.
    const chunks: Input[][] = []; let chunk: Input[] = [], bytes = 0;
    for (const candidate of all) {
      const size = new TextEncoder().encode(JSON.stringify(candidate)).length;
      if (size > 200_000) throw new Fault(409, 'RESULT_LIMIT', 'A provider result is too large to save safely.');
      if (chunk.length && (chunk.length >= 25 || bytes + size > 220_000)) { chunks.push(chunk); chunk = []; bytes = 0; }
      chunk.push(candidate); bytes += size;
    }
    if (chunk.length || !chunks.length) chunks.push(chunk);
    for (let index = 0; index < chunks.length; index++) {
      const last = index === chunks.length - 1;
      job = await call<StoredJob>(workspace, access, 'job.apply', { id: job.id, expected_job_revision: job.revision,
        candidates: chunks[index], cursor: last ? (page.nextOffset ?? offset + page.records.length) : offset, terminal: last && terminal,
        seen_ids: [...seen], dataset_id: dataset, provider_status: run?.status ?? job.provider_status,
        next_poll_at: last && !terminal ? Date.now() + 30_000 : 0 });
    }
    return publicJob(job);
  } catch (error) {
    const fault = error instanceof Fault;
    const blocked = fault && BLOCKED.has(error.code);
    const next = await workspace.invoke(access, 'job.update', { id: job.id, expected_job_revision: job.revision, patch: {
      status: blocked ? 'QUOTA_BLOCKED' : job.status === 'APPLYING' ? 'APPLYING' : 'RUNNING',
      error: blocked ? 'Processing paused because this workspace needs more room or the result limit was reached.' : 'The known provider run could not be checked. It has not been resubmitted.',
      poll_count: Number(job.poll_count ?? 0) + 1, next_poll_at: blocked ? 0 : Date.now() + 300_000, lease_until: 0,
    } });
    return next.ok ? publicJob(next.data as Input) : publicJob(job);
  }
}

export async function stopJob(access: Access, workspace: WorkspacePort, env: JobEnv, fetcher: typeof fetch = fetch): Promise<Input> {
  const job = await call<StoredJob | null>(workspace, access, 'job.get');
  if (!job || !ACTIVE.has(job.status)) return { idle: true };
  if (job.status === 'STARTING' || job.status === 'UNCERTAIN') throw new Fault(409, 'SUBMISSION_UNCERTAIN', 'Check the provider account before dismissing an uncertain submission.');
  if (job.status === 'QUEUED') return publicJob(await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
    patch: { status: 'CANCELLED', next_poll_at: 0, lease_until: 0 } }));
  if (job.kind === 'retrieval' && job.run_id) {
    await createApify(fetcher).abort(String(job.run_id), await key(workspace, access, 'apify', env));
    return publicJob(await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
      patch: { status: 'RUNNING', next_poll_at: Date.now() + 1000, lease_until: 0 } }));
  }
  return publicJob(await call<StoredJob>(workspace, access, 'job.update', { id: job.id, expected_job_revision: job.revision,
    patch: { status: 'CANCELLED', next_poll_at: 0, lease_until: 0 } }));
}
