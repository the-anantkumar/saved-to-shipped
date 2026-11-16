import { ProviderFailure, providerJson, record, type ProviderFetch } from './http';

export const APIFY_ACTOR = 'data_minds/linkedin-post-scraper';
export const DATASET_PAGE_SIZE = 25;
export const DATASET_RECORD_LIMIT = 5000;
export const RUN_STATUSES = ['READY', 'RUNNING', 'TIMING-OUT', 'ABORTING', 'SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'] as const;
export const TERMINAL_RUN_STATUSES = new Set<string>(['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT']);
export interface ProviderRun { id: string; status: typeof RUN_STATUSES[number]; datasetId?: string }
export interface DatasetPage { records: Record<string, unknown>[]; nextOffset: number | null }

function reference(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value))
    throw new ProviderFailure('INVALID_PROVIDER_REFERENCE', 'The stored provider reference is invalid.');
  return value;
}
function runData(value: unknown, starting: boolean): ProviderRun {
  const row = record(record(value)?.data);
  try {
    if (!row || typeof row.status !== 'string' || !RUN_STATUSES.includes(row.status as ProviderRun['status'])) throw new Error();
    const id = reference(row.id);
    const datasetId = row.defaultDatasetId == null || row.defaultDatasetId === '' ? undefined : reference(row.defaultDatasetId);
    return { id, status: row.status as ProviderRun['status'], ...(datasetId ? { datasetId } : {}) };
  } catch {
    throw new ProviderFailure('PROVIDER_REFERENCE_INVALID', 'Apify returned an invalid run reference or status. Check the console before starting another run.', starting);
  }
}

export function createApify(fetcher: ProviderFetch = fetch) {
  const origin = 'https://api.apify.com/v2';
  return {
    async start(input: { urls: string[]; maxChargeUsd: number }, token: string): Promise<ProviderRun> {
      if (!input || !Array.isArray(input.urls) || !input.urls.length || input.urls.length > 25 ||
          input.urls.some(url => typeof url !== 'string' || url.length > 4000 || !isPostUrl(url)) ||
          typeof input.maxChargeUsd !== 'number' || !Number.isFinite(input.maxChargeUsd) || input.maxChargeUsd < 0.01 || input.maxChargeUsd > 20)
        throw new ProviderFailure('INVALID_RETRIEVAL_INPUT', 'Choose 1 to 25 LinkedIn saves and a maximum provider charge between $0.01 and $20.');
      const urls = [...new Map(input.urls.map(url => [postKey(url), url])).values()];
      const query = new URLSearchParams({ maxTotalChargeUsd: String(input.maxChargeUsd), maxItems: String(urls.length), timeout: '1800', restartOnError: 'false' });
      const data = await providerJson('Apify', `${origin}/actors/${APIFY_ACTOR.replace('/', '~')}/runs?${query}`, token, fetcher, {
        method: 'POST', starting: true, maxBytes: 65_536,
        body: { urls, limitPerSource: 1, discoverMorePosts: false, includeProfileActivity: false,
          deepScrape: true, numComments: 0, numLikes: 0, includeGated: true, saveMedia: false, fetchDocumentDetails: true },
      });
      return runData(data, true);
    },
    async poll(runId: string, token: string): Promise<ProviderRun> {
      const run = runData(await providerJson('Apify', `${origin}/actor-runs/${reference(runId)}`, token, fetcher, { maxBytes: 65_536 }), false);
      if (run.id !== runId) throw new ProviderFailure('PROVIDER_REFERENCE_INVALID', 'Apify returned a different run reference. The original run remains pending.');
      return run;
    },
    async abort(runId: string, token: string): Promise<ProviderRun> {
      const run = runData(await providerJson('Apify', `${origin}/actor-runs/${reference(runId)}/abort`, token, fetcher, { method: 'POST', body: {}, maxBytes: 65_536 }), false);
      if (run.id !== runId) throw new ProviderFailure('PROVIDER_REFERENCE_INVALID', 'Apify returned a different run reference. The original run remains pending.');
      return run;
    },
    async page(datasetId: string, offset: number, token: string): Promise<DatasetPage> {
      if (!Number.isSafeInteger(offset) || offset < 0 || offset > DATASET_RECORD_LIMIT || offset % DATASET_PAGE_SIZE !== 0)
        throw new ProviderFailure('INVALID_DATASET_OFFSET', 'The saved dataset position is invalid.');
      // clean=true may skip empty rows and return short non-final pages. Keep
      // unfiltered row counts so advancing an offset cannot skip provider data.
      const query = new URLSearchParams({ clean: 'false', skipHidden: 'true', skipEmpty: 'false', limit: String(DATASET_PAGE_SIZE), offset: String(offset) });
      const data = await providerJson('Apify', `${origin}/datasets/${reference(datasetId)}/items?${query}`, token, fetcher);
      if (!Array.isArray(data) || data.length > DATASET_PAGE_SIZE || data.some(row => !record(row)))
        throw new ProviderFailure('DATASET_INVALID', 'Apify returned an unexpected dataset. Existing saves were preserved.');
      if (offset + data.length > DATASET_RECORD_LIMIT)
        throw new ProviderFailure('DATASET_LIMIT', 'The provider dataset exceeded the supported size. Existing results and the run reference were preserved.');
      return { records: data as Record<string, unknown>[], nextOffset: data.length < DATASET_PAGE_SIZE ? null : offset + data.length };
    },
  };
}

function linkedinUrl(value: string): URL | undefined {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password ||
        !(parsed.hostname === 'linkedin.com' || parsed.hostname.endsWith('.linkedin.com'))) return undefined;
    return parsed;
  } catch { return undefined; }
}
export function isPostUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const url = linkedinUrl(value);
  return Boolean(url && ['/feed/update/', '/posts/', '/pulse/'].some(prefix => url.pathname.startsWith(prefix)));
}
const ignored = new Set(['trk', 'lipi', 'originalsubdomain', 'midtoken', 'ebp']);
function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 4000) return undefined;
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined;
    const query = new URLSearchParams();
    url.searchParams.forEach((value, key) => { if (!ignored.has(key.toLowerCase()) && !key.toLowerCase().startsWith('utm_')) query.append(key, value); });
    url.protocol = 'https:'; url.hash = ''; url.pathname = url.pathname.replace(/\/+$/, '') || '/'; url.search = query.toString();
    return url.href;
  } catch { return undefined; }
}

/** This identifies source posts, never workspace owners or saved-item IDs. */
export function postKey(value: unknown): string {
  if (typeof value === 'number') return Number.isSafeInteger(value) && value >= 0 ? `activity:${value}` : '';
  if (typeof value !== 'string' || value.length > 4000) return '';
  const text = value.trim();
  if (/^https?:\/\//i.test(text)) {
    const parsed = linkedinUrl(text);
    if (!parsed) return '';
    // A query/fragment containing another post's ID is not source identity.
    const match = /activity[:-](\d+)/.exec(parsed.pathname);
    return match ? `activity:${match[1]}` : safeUrl(text) ?? '';
  }
  if (/^\d+$/.test(text)) return `activity:${text}`;
  const urn = /^(?:urn:li:)?activity[:-](\d+)$/.exec(text);
  return urn ? `activity:${urn[1]}` : '';
}
export function recordKeys(value: unknown): Set<string> {
  const row = record(value);
  if (!row) return new Set();
  const source = record(row._source);
  const values = [row.url, row.shareUrl, row.activityId, row.urn, row._source, source?.url, source?.inputUrl, source?.sourceUrl];
  return new Set(values.map(postKey).filter(Boolean));
}
export function eligible(item: Record<string, unknown>, retry = false): boolean {
  if (item.platform !== 'linkedin' || !isPostUrl(item.url) || (typeof item.content === 'string' && item.content.trim()) || item.status === 'done' || item.status === 'parked') return false;
  const status = record(item.enrichment)?.status ?? 'new';
  return (retry ? ['error', 'missing', 'gated', 'deleted', 'empty'] : ['new']).includes(String(status));
}

export interface RetrievalProvenance { runId: string; retrievedAt?: string; actor?: string }
export interface RetrievalCandidate extends Record<string, unknown> { id: string; patch: Record<string, unknown>; quality: number }

function normalized(row: Record<string, unknown> | undefined, provenance: RetrievalProvenance): { patch: Record<string, unknown>; quality: number } {
  let status = row ? row._status ?? 'ok' : 'missing';
  if (typeof status !== 'string' || !['ok', 'gated', 'deleted', 'error', 'missing'].includes(status)) status = 'error';
  let body = typeof row?.text === 'string' ? row.text.trim() : '';
  if (/^(sign in to linkedin|join linkedin|log in to linkedin)/i.test(body)) status = 'gated';
  const enrichment: Record<string, unknown> = { status, provider: 'apify', actor: APIFY_ACTOR,
    run_id: reference(provenance.runId), retrieved_at: provenance.retrievedAt ?? new Date().toISOString() };
  const patch: Record<string, unknown> = { enrichment };
  let quality = 0;
  if (status === 'ok') {
    const document = record(record(row?.media)?.document);
    const transcript = typeof document?.transcript === 'string' ? document.transcript.trim() : '';
    if (transcript) body += `${body ? '\n\n' : ''}Document transcript:\n${transcript}`;
    if (!body.trim()) status = 'empty';
    else {
      // Slice by Unicode code point to retain the local Python character cap.
      const characters = [...body];
      enrichment.content_truncated = characters.length > 20_000;
      patch.content = characters.slice(0, 20_000).join('');
      patch.title = typeof row?.title === 'string' && row.title.trim() ? [...row.title.trim()].slice(0, 300).join('') : [...body.split('\n')[0]!].slice(0, 100).join('');
      const author = record(row?.author)?.name ?? row?.author;
      if (typeof author === 'string') patch.author = [...author.trim()].slice(0, 300).join('');
      const links = Array.isArray(row?.links) ? row.links.slice(0, 30) : [];
      const safeLinks: string[] = [];
      let linkBytes = 0;
      for (const link of links) {
        const safe = safeUrl(record(link)?.url ?? link);
        if (!safe) continue;
        const size = new TextEncoder().encode(safe).byteLength;
        if (linkBytes + size > 8000) { enrichment.links_truncated = true; break; }
        safeLinks.push(safe); linkBytes += size;
      }
      if (Array.isArray(row?.links) && row.links.length > 30) enrichment.links_truncated = true;
      enrichment.links = safeLinks;
      enrichment.coverage = transcript ? 'post text and supplied document transcript' : 'post text only';
      status = (document && !transcript) || row?.postType === 'image' || row?.postType === 'video' || enrichment.content_truncated ? 'partial' : 'extracted';
      quality = (status === 'extracted' ? 4 : 2) + (transcript ? 1 : 0);
    }
  }
  enrichment.status = status;
  return { patch, quality };
}

/** Matched candidates only. Storage must merge into current state atomically. */
export function retrievalCandidates(records: unknown[], targets: Record<string, unknown>[], provenance: RetrievalProvenance): RetrievalCandidate[] {
  if (records.length > DATASET_PAGE_SIZE || targets.length > 25) throw new ProviderFailure('INVALID_RESULT_BATCH', 'Use a smaller result batch.');
  const byKey = new Map<string, string[]>();
  for (const item of targets) {
    if (typeof item.id !== 'string') continue;
    const key = postKey(item.url);
    if (!key) continue;
    byKey.set(key, [...(byKey.get(key) ?? []), item.id]);
  }
  const candidates = new Map<string, RetrievalCandidate>();
  for (const value of records) {
    const row = record(value);
    if (!row) continue;
    const matches = [...recordKeys(row)].filter(key => byKey.has(key));
    if (matches.length !== 1) continue;
    const candidate = normalized(row, provenance);
    for (const id of byKey.get(matches[0]!)!) {
      const old = candidates.get(id);
      if (!old || candidate.quality > old.quality) candidates.set(id, { id, ...candidate });
    }
  }
  return [...candidates.values()];
}

/** Call only after exhausting the dataset, not after a page without a match. */
export function missingCandidates(targets: Record<string, unknown>[], seenIds: Iterable<string>, provenance: RetrievalProvenance): RetrievalCandidate[] {
  if (targets.length > 25) throw new ProviderFailure('INVALID_RESULT_BATCH', 'Use a smaller result batch.');
  const seen = new Set(seenIds);
  return targets.filter(item => typeof item.id === 'string' && !seen.has(item.id)).map(item => ({ id: item.id as string, ...normalized(undefined, provenance) }));
}
