import { Fault, KINDS, STATUSES, object, string, type Input } from '../contracts';

export type Item = Input & {
  id: string; platform: string; url: string; saved_at: string; title: string;
  content: string; note: string; kind: string; status: string; author: string;
  metadata: Input; external_id: string; why: string; next_action: string;
  definition_of_done: string; effort_hours: number; tags: string[];
  impact: number; relevance: number; novelty: number;
};
export type Group = { id: string; name: string; description: string; created_at: string };
export const now = () => new Date().toISOString();
export const size = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
export const hasContext = (item: Item) => Boolean((item.content + item.note).trim());
export function check(condition: unknown, code = 'INVALID_INPUT', message = 'The request is invalid.', status = 400): asserts condition {
  if (!condition) throw new Fault(status, code, message);
}
export function finite(value: unknown, name: string, min: number, max: number): number {
  check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max,
    'INVALID_INPUT', `${name} must be between ${min} and ${max}.`);
  return value;
}
export function boundedJson(value: unknown, max = 8192): Input {
  const record = object(value);
  const visit = (part: unknown, depth: number) => {
    check(depth <= 8, 'INVALID_INPUT', 'Nested data is too deep.');
    if (part === null || typeof part === 'string' || typeof part === 'boolean') return;
    if (typeof part === 'number') { check(Number.isFinite(part)); return; }
    check(typeof part === 'object' && part !== null, 'INVALID_INPUT', 'Invalid stored data.');
    for (const [key, child] of Object.entries(part)) {
      check(!['__proto__', 'constructor', 'prototype'].includes(key)); visit(child, depth + 1);
    }
  };
  visit(record, 0); check(size(record) <= max, 'INVALID_INPUT', 'Stored metadata is too large.');
  return structuredClone(record);
}
const encodeQuery = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`).replace(/%20/g, '+');
/** Preserve Python canonical_url semantics rather than URL's path/port rewriting. */
export function canonicalUrl(value: unknown, linkedinOnly = false): string {
  const raw = string(value, 'URL', 4000, false);
  const match = /^(https?):\/\/([^/?#]+)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/i.exec(raw);
  check(match && !match[2]!.includes('@'), 'INVALID_INPUT', 'Use a valid HTTP(S) URL.');
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Fault(400, 'INVALID_INPUT', 'Use a valid HTTP(S) URL.'); }
  check(parsed.hostname && !parsed.username && !parsed.password, 'INVALID_INPUT', 'Use a valid HTTP(S) URL.');
  if (linkedinOnly) check(parsed.hostname === 'linkedin.com' || parsed.hostname.endsWith('.linkedin.com'), 'INVALID_INPUT', 'Use a LinkedIn URL.');
  const ignored = new Set(['trk', 'lipi', 'originalsubdomain', 'midtoken', 'ebp']);
  const query = [...new URLSearchParams(match[4] ?? '')].filter(([key]) => !ignored.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_'))
    .map(([key, val]) => `${encodeQuery(key)}=${encodeQuery(val)}`).join('&');
  return `https://${match[2]!.toLowerCase()}${match[3]!.replace(/\/+$/, '') || '/'}${query ? `?${query}` : ''}`;
}
export async function digest(value: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function importedItem(rawValue: unknown, restore = false): Promise<Item> {
  const raw = object(rawValue);
  const platform = restore ? string(raw.platform ?? 'linkedin', 'Platform', 40, false) : 'linkedin';
  check(/^[a-z][a-z0-9_-]*$/.test(platform));
  const url = canonicalUrl(raw.url, !restore);
  const id = (await digest(platform === 'linkedin' ? url : `${platform}\0${url}`)).slice(0, 12);
  if (restore && raw.id !== undefined) check(raw.id === id, 'INVALID_INPUT', 'Backup source identity does not match its URL.');
  const item: Item = {
    id, platform, url, saved_at: string(raw.saved_at ?? '', 'Saved date', 100),
    title: string(raw.title ?? '', 'Title', 300), content: string(raw.content ?? '', 'Source text', 20_000), note: '',
    author: string(raw.author ?? '', 'Author', 300), external_id: string(raw.external_id ?? '', 'External ID', 300),
    metadata: boundedJson(raw.metadata ?? {}, 4096), kind: 'untriaged', status: 'inbox', why: '',
    impact: 3, relevance: 3, novelty: 3, effort_hours: 0, next_action: '', definition_of_done: '',
    repo_suggestion: '', commit_message: '', confidence: 'unknown', tags: [],
  };
  if (restore) {
    for (const key of ['note', 'why', 'next_action', 'definition_of_done', 'repo_suggestion', 'commit_message', 'outcome_url'])
      if (raw[key] !== undefined) item[key] = string(raw[key], key, 20_000);
    for (const key of ['project_id', 'updated_at', 'classification_method', 'confidence'])
      if (raw[key] !== undefined) item[key] = string(raw[key], key, 100);
    if (raw.kind !== undefined) { check(KINDS.includes(raw.kind as never)); item.kind = raw.kind as string; }
    if (raw.status !== undefined) { check(STATUSES.includes(raw.status as never)); item.status = raw.status as string; }
    for (const key of ['impact', 'relevance', 'novelty'] as const) if (raw[key] !== undefined) item[key] = finite(raw[key], key, 1, 5);
    if (raw.effort_hours !== undefined) item.effort_hours = finite(raw.effort_hours, 'Effort', 0, 2);
    if (raw.tags !== undefined) item.tags = tags(raw.tags);
    if (raw.enrichment !== undefined) item.enrichment = boundedJson(raw.enrichment, 8192);
    if (raw.reading !== undefined) {
      const reading = boundedJson(raw.reading, 1024);
      check(['unread', 'reading', 'read'].includes(String(reading.status)));
      finite(reading.progress, 'Reading progress', 0, 100); check(typeof reading.queued === 'boolean');
      item.reading = reading;
    }
    if (item.outcome_url) item.outcome_url = canonicalUrl(item.outcome_url);
    // V1 backups may contain unfinished legacy tasks. Preserve them for review;
    // new user transitions still enforce full task readiness below.
  }
  return item;
}
export function tags(value: unknown): string[] {
  check(Array.isArray(value) && value.length <= 20, 'INVALID_INPUT', 'Choose at most 20 tags.');
  return value.map(tag => string(tag, 'Tag', 60, false));
}
export function score(item: Item): number {
  const penalty = ({ high: 0, medium: 0.5, low: 1.5, unknown: 2 } as Record<string, number>)[String(item.confidence)] ?? 2;
  return Math.round((2 * item.relevance + 1.5 * item.impact + item.novelty - 0.35 * Math.min(item.effort_hours || 2, 40) - penalty) * 100) / 100;
}
export function readingState(item: Item): Input {
  const saved = item.reading && typeof item.reading === 'object' ? item.reading as Input : {};
  const legacy = ({ doing: 'reading', done: 'read' } as Record<string, string>)[item.status] ?? 'unread';
  const status = ['unread', 'reading', 'read'].includes(String(saved.status ?? legacy)) ? String(saved.status ?? legacy) : 'unread';
  const progress = typeof saved.progress === 'number' && Number.isFinite(saved.progress) ? saved.progress : status === 'read' ? 100 : 0;
  return { ...saved, status, progress: status === 'read' ? 100 : Math.min(100, Math.max(0, progress)), queued: saved.queued === true };
}
export function metadata(item: Item, revision: number): Input {
  const result: Input = {};
  for (const key of ['id', 'platform', 'url', 'saved_at', 'title', 'author', 'kind', 'status', 'project_id', 'effort_hours', 'confidence', 'classification_method', 'tags', 'updated_at'])
    if (item[key] !== undefined) result[key] = item[key];
  for (const key of ['next_action', 'definition_of_done', 'why']) result[key] = String(item[key] ?? '').slice(0, 600);
  const source = item.content.trim() || item.note.trim();
  Object.assign(result, { revision, has_context: hasContext(item), has_content: Boolean(item.content.trim()), has_note: Boolean(item.note.trim()),
    excerpt: source.replace(/\s+/g, ' ').slice(0, 360), reading_minutes: Math.max(1, Math.ceil(source.split(/\s+/).filter(Boolean).length / 200)), score: score(item) });
  if (['learning', 'reference', 'experience'].includes(item.kind)) result.reading = readingState(item);
  if (item.enrichment && typeof item.enrichment === 'object') {
    const src = item.enrichment as Input;
    result.enrichment = Object.fromEntries(['status', 'coverage', 'content_truncated', 'retrieved_at'].filter(key => src[key] !== undefined).map(key => [key, src[key]]));
  }
  return result;
}
export function editItem(item: Item, patch: Input): Item {
  const changed = structuredClone(item);
  for (const key of ['title', 'content', 'note', 'why', 'next_action', 'definition_of_done', 'outcome_url'])
    if (key in patch) changed[key] = string(patch[key], key, key === 'title' ? 300 : 20_000);
  if (changed.outcome_url) changed.outcome_url = canonicalUrl(changed.outcome_url);
  if ('kind' in patch) { check(KINDS.includes(patch.kind as never)); changed.kind = patch.kind as string; }
  if ('status' in patch) { check(STATUSES.includes(patch.status as never)); changed.status = patch.status as string; }
  if ('effort_hours' in patch) changed.effort_hours = finite(patch.effort_hours, 'Effort', 0.25, 2);
  check(changed.kind === 'untriaged' || hasContext(changed), 'CONTEXT_REQUIRED', 'Add source text or a note before organizing this save.');
  if (['ready', 'doing', 'done'].includes(changed.status)) {
    check(hasContext(changed) && changed.kind !== 'untriaged' && changed.title && changed.next_action && changed.definition_of_done,
      'TASK_NOT_READY', 'A task needs context, classification, title, next action and a done condition.');
    finite(changed.effort_hours, 'Effort', 0.25, 2);
  }
  changed.updated_at = now(); return changed;
}
export function editReading(item: Item, patch: Input): Item {
  check(['learning', 'reference', 'experience'].includes(item.kind) && hasContext(item), 'CONTEXT_REQUIRED', 'Reading progress needs a readable learning or experience save.');
  check(['status', 'progress', 'queued'].some(key => key in patch), 'INVALID_INPUT', 'Choose a reading update.');
  const reading = readingState(item);
  if ('status' in patch) {
    check(['unread', 'reading', 'read'].includes(String(patch.status))); reading.status = patch.status;
    if (patch.status === 'unread') { reading.progress = 0; delete reading.started_at; delete reading.completed_at; }
    if (patch.status === 'reading' && !reading.started_at) reading.started_at = now();
    if (patch.status === 'read') Object.assign(reading, { progress: 100, completed_at: now(), queued: false });
  }
  if ('progress' in patch) reading.progress = Math.max(Number(reading.progress), Math.round(finite(patch.progress, 'Reading progress', 0, 100) * 10) / 10);
  if ('queued' in patch) { check(typeof patch.queued === 'boolean'); reading.queued = patch.queued; }
  if (reading.status === 'read') reading.queued = false;
  reading.updated_at = now(); return { ...item, reading };
}
export function classification(item: Item, raw: Input): Item {
  check(hasContext(item), 'CONTEXT_REQUIRED', 'Classification requires source text or notes.');
  check(['project', 'learning', 'experience', 'reference', 'skip'].includes(String(raw.kind)));
  const next = { ...item };
  for (const key of ['kind', 'title', 'why', 'next_action', 'definition_of_done', 'repo_suggestion', 'commit_message', 'confidence'])
    next[key] = string(raw[key] ?? '', key, key === 'title' ? 300 : 2000);
  check(['high', 'medium', 'low'].includes(String(next.confidence)));
  next.effort_hours = finite(raw.effort_hours, 'Effort', 0.25, 2);
  for (const key of ['impact', 'relevance', 'novelty'] as const) next[key] = finite(raw[key], key, 1, 5);
  next.tags = tags(raw.tags); next.updated_at = now(); return next;
}
export function localClassification(item: Item): Input {
  const context = `${item.content} ${item.note}`;
  const kind = /\b(hackathon|attend|event|conference|register)\b/i.test(context) ? 'experience'
    : /\b(build|prototype|implement|automate|create)\b/i.test(context) ? 'project'
    : /\b(learn\w*|tutorial|study|understand\w*|course)\b/i.test(context) ? 'learning' : 'reference';
  return { kind, title: item.title || context.trim().split('\n')[0]!.slice(0, 90),
    why: 'Draft from keywords in your supplied context. Review before starting.',
    next_action: kind === 'experience' ? 'Verify the dates and requirements, then record your decision.' : 'Try one small example and record what changed.',
    definition_of_done: 'A concrete result and a short note are saved.', repo_suggestion: '', commit_message: '',
    confidence: 'low', effort_hours: 1, tags: [], impact: 3, relevance: 3, novelty: 3 };
}
