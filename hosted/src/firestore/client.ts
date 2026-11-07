import { importPKCS8, SignJWT } from 'jose';
import { Fault, type Input } from '../contracts';

export interface FirestoreEnv {
  FIREBASE_PROJECT_ID?: string;
  FIRESTORE_DATABASE_ID?: string;
  FIRESTORE_SERVICE_ACCOUNT?: string;
  /** Development only: a literal loopback host:port, with no service account. */
  FIRESTORE_EMULATOR_HOST?: string;
}
export interface FirestoreDocument { path: string; data: Input; updateTime: string }
export interface FirestorePrecondition { exists?: boolean; updateTime?: string }
export interface FirestoreWrite {
  path: string; data?: Input; delete?: true; verify?: true;
  currentDocument?: FirestorePrecondition;
}
export interface FirestorePage { documents: FirestoreDocument[]; nextPageToken?: string }
export interface FirestoreCommit { commitTime: string; writeResults: { updateTime?: string }[] }
export interface FirestorePort {
  read(path: string, options?: { readTime?: string }): Promise<FirestoreDocument | null>;
  list(collection: string, options?: { pageSize?: number; pageToken?: string; readTime?: string; fieldPaths?: string[] }): Promise<FirestorePage>;
  commit(writes: FirestoreWrite[]): Promise<FirestoreCommit>;
  query(collection: string, options: {
    field: string; op: 'LESS_THAN' | 'EQUAL'; value: unknown; limit?: number; orderBy?: string;
  }): Promise<FirestoreDocument[]>;
}

export class FirestoreConflict extends Fault {
  constructor() { super(409, 'FIRESTORE_CONFLICT', 'Stored data changed. Please retry this operation.'); }
}
/** A failed response does not prove a commit was rejected. Callers reconcile it. */
export class FirestoreCommitUncertain extends Fault {
  constructor() { super(503, 'FIRESTORE_COMMIT_UNCERTAIN', 'Storage confirmation is unavailable. Check the result before retrying.'); }
}
/** Ports may cross a bundle/RPC boundary where Error prototype identity is lost. */
export function isFirestoreConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as Input).status === 409 && (error as Input).code === 'FIRESTORE_CONFLICT');
}
export function isFirestoreCommitUncertain(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as Input).status === 503 && (error as Input).code === 'FIRESTORE_COMMIT_UNCERTAIN');
}

const OAUTH_URL = 'https://oauth2.googleapis.com/token';
const RESPONSE_LIMIT = 16 * 1024 * 1024;
const COMMIT_LIMIT = 8 * 1024 * 1024;
const encoder = new TextEncoder();
function unavailable() { return new Fault(503, 'STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.'); }
function invalid() { return new Fault(503, 'STORAGE_CONFIGURATION', 'Storage is not configured correctly.'); }
function bytes(value: string) { return encoder.encode(value).byteLength; }
function record(value: unknown): Input {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw unavailable();
  return value as Input;
}
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,9})?Z$/.test(value)) throw unavailable();
  return value;
}
function pathParts(path: string, collection = false): string[] {
  if (typeof path !== 'string' || !path || bytes(path) > 6000) throw invalid();
  const parts = path.split('/');
  if (parts.length > 100 || parts.length % 2 !== (collection ? 1 : 0) || parts.some(part =>
    !part || part === '.' || part === '..' || bytes(part) > 1500 || /^__.*__$/.test(part) || /[\u0000-\u001f\u007f]/.test(part))) throw invalid();
  return parts;
}
function encodeValue(value: unknown, depth = 0): Input {
  if (depth > 20) throw invalid();
  if (value === null) return { nullValue: null };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      if (!Number.isSafeInteger(value)) throw invalid();
      return { integerValue: String(value) };
    }
    return { doubleValue: value };
  }
  if (Array.isArray(value)) {
    if (value.some(Array.isArray)) throw invalid();
    return { arrayValue: { values: value.map(entry => encodeValue(entry, depth + 1)) } };
  }
  if (value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([key, entry]) => {
      if (!key || bytes(key) > 1500 || /^__.*__$/.test(key)) throw invalid();
      return [key, encodeValue(entry, depth + 1)];
    })) } };
  }
  throw invalid();
}
function decodeValue(value: unknown, depth = 0): unknown {
  if (depth > 20) throw unavailable();
  const field = record(value);
  if (Object.keys(field).length !== 1) throw unavailable();
  if ('nullValue' in field) return null;
  if ('booleanValue' in field && typeof field.booleanValue === 'boolean') return field.booleanValue;
  if ('stringValue' in field && typeof field.stringValue === 'string') return field.stringValue;
  if ('integerValue' in field && typeof field.integerValue === 'string' && /^-?\d+$/.test(field.integerValue)) {
    const number = Number(field.integerValue);
    if (Number.isSafeInteger(number)) return number;
  }
  if ('doubleValue' in field && typeof field.doubleValue === 'number' && Number.isFinite(field.doubleValue)) return field.doubleValue;
  if ('arrayValue' in field) {
    const values = record(field.arrayValue).values ?? [];
    if (Array.isArray(values)) return values.map(entry => decodeValue(entry, depth + 1));
  }
  if ('mapValue' in field) {
    const fields = record(field.mapValue).fields ?? {};
    return Object.fromEntries(Object.entries(record(fields)).map(([key, entry]) => [key, decodeValue(entry, depth + 1)]));
  }
  throw unavailable();
}
async function jsonBody(response: Response, limit = RESPONSE_LIMIT): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw unavailable();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const result = await reader.read(); if (result.done) break;
      length += result.value.length; if (length > limit) throw unavailable();
      chunks.push(result.value);
    }
    const output = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(output));
  } catch { throw unavailable(); }
  finally { await reader.cancel().catch(() => {}); }
}

/** Core document operations preserve the server's atomic transitions and cache fence. */
export class FirestoreClient implements FirestorePort {
  private readonly prefix: string;
  private readonly origin: string;
  private readonly account?: { email: string; privateKey: string; keyId?: string };
  private token?: { value: string; until: number };
  private tokenPending?: Promise<string>;
  constructor(env: FirestoreEnv, private readonly fetcher: typeof fetch = (...args) => fetch(...args)) {
    const project = env.FIREBASE_PROJECT_ID ?? '', database = env.FIRESTORE_DATABASE_ID ?? '';
    if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project) || !/^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/.test(database)) throw invalid();
    this.prefix = `projects/${project}/databases/${database}/documents`;
    if (env.FIRESTORE_EMULATOR_HOST !== undefined) {
      const host = env.FIRESTORE_EMULATOR_HOST;
      if (env.FIRESTORE_SERVICE_ACCOUNT || !/^(?:localhost|127\.0\.0\.1|\[::1\]):[1-9]\d{0,4}$/.test(host) || Number(host.split(':').at(-1)) > 65535) throw invalid();
      this.origin = `http://${host}/v1/`;
    } else {
      this.origin = 'https://firestore.googleapis.com/v1/';
      let key: Input;
      try {
        if (!env.FIRESTORE_SERVICE_ACCOUNT || bytes(env.FIRESTORE_SERVICE_ACCOUNT) > 32768) throw invalid();
        key = record(JSON.parse(env.FIRESTORE_SERVICE_ACCOUNT));
      } catch { throw invalid(); }
      if (key.type !== 'service_account' || key.project_id !== project || typeof key.client_email !== 'string' ||
        !key.client_email.endsWith(`@${project}.iam.gserviceaccount.com`) || !/^[A-Za-z0-9_.@-]+$/.test(key.client_email) ||
        typeof key.private_key !== 'string' || key.private_key.length > 16384 ||
        (key.token_uri !== undefined && key.token_uri !== OAUTH_URL) ||
        (key.private_key_id !== undefined && (typeof key.private_key_id !== 'string' || !/^[a-zA-Z0-9_-]{1,256}$/.test(key.private_key_id)))) throw invalid();
      this.account = { email: key.client_email, privateKey: key.private_key, ...(key.private_key_id ? { keyId: String(key.private_key_id) } : {}) };
    }
  }
  private async accessToken(): Promise<string> {
    if (!this.account) return 'owner';
    if (this.token && Date.now() < this.token.until) return this.token.value;
    if (!this.tokenPending) {
      this.tokenPending = (async () => {
        try {
          const account = this.account!;
          const key = await importPKCS8(account.privateKey, 'RS256');
          const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/datastore' })
            .setProtectedHeader({ alg: 'RS256', typ: 'JWT', ...(account.keyId ? { kid: account.keyId } : {}) })
            .setIssuer(account.email).setAudience(OAUTH_URL).setIssuedAt().setExpirationTime('1h').sign(key);
          const response = await this.fetcher(OAUTH_URL, { method: 'POST', redirect: 'manual',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
            signal: AbortSignal.timeout(10000) });
          if (!response.ok) { await response.body?.cancel().catch(() => {}); throw unavailable(); }
          const data = record(await jsonBody(response, 16384));
          if (typeof data.access_token !== 'string' || !data.access_token || data.access_token.length > 8192 ||
            typeof data.expires_in !== 'number' || data.expires_in < 60 || data.expires_in > 3600) throw unavailable();
          this.token = { value: data.access_token, until: Date.now() + (data.expires_in - 30) * 1000 };
          return this.token.value;
        } catch { throw unavailable(); }
      })().finally(() => { this.tokenPending = undefined; });
    }
    return this.tokenPending;
  }
  private name(path: string): string { pathParts(path); return `${this.prefix}/${path}`; }
  private urlPath(path: string, collection = false): string {
    return `${this.prefix}/${pathParts(path, collection).map(encodeURIComponent).join('/')}`;
  }
  private document(value: unknown): FirestoreDocument {
    const doc = record(value);
    if (typeof doc.name !== 'string' || !doc.name.startsWith(`${this.prefix}/`)) throw unavailable();
    const path = doc.name.slice(this.prefix.length + 1); pathParts(path);
    const data = Object.fromEntries(Object.entries(record(doc.fields ?? {})).map(([key, entry]) => [key, decodeValue(entry)]));
    return { path, data, updateTime: timestamp(doc.updateTime) };
  }
  private async request(path: string, method: 'GET' | 'POST', body?: string, commit = false): Promise<unknown | null> {
    const token = await this.accessToken();
    let response: Response;
    try {
      response = await this.fetcher(`${this.origin}${path}`, { method, redirect: 'manual',
        headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body }), signal: AbortSignal.timeout(10000) });
    } catch { throw commit ? new FirestoreCommitUncertain() : unavailable(); }
    if (response.status === 404 && method === 'GET') { await response.body?.cancel().catch(() => {}); return null; }
    if (!response.ok) {
      let code: unknown;
      try { code = record(record(await jsonBody(response, 16384)).error).status; } catch { /* Never return backend messages. */ }
      if (response.status === 401) this.token = undefined;
      if (commit && ['ABORTED', 'FAILED_PRECONDITION', 'ALREADY_EXISTS'].includes(String(code))) throw new FirestoreConflict();
      if (commit && (response.status >= 500 || response.status === 408)) throw new FirestoreCommitUncertain();
      throw unavailable();
    }
    try { return await jsonBody(response); }
    catch { throw commit ? new FirestoreCommitUncertain() : unavailable(); }
  }
  async read(path: string, options: { readTime?: string } = {}): Promise<FirestoreDocument | null> {
    const suffix = options.readTime ? `?readTime=${encodeURIComponent(timestamp(options.readTime))}` : '';
    const result = await this.request(this.urlPath(path) + suffix, 'GET');
    if (result === null) return null;
    const document = this.document(result);
    if (document.path !== path) throw unavailable();
    return document;
  }
  async list(collection: string, options: { pageSize?: number; pageToken?: string; readTime?: string; fieldPaths?: string[] } = {}): Promise<FirestorePage> {
    const pageSize = options.pageSize ?? 25;
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100 || (options.pageToken !== undefined && options.pageToken.length > 16384)) throw invalid();
    // Enterprise Native listDocuments rejects an explicit orderBy. Its default
    // document-name order and opaque page token provide deterministic paging.
    const query = new URLSearchParams({ pageSize: String(pageSize) });
    if (options.fieldPaths !== undefined) {
      if (!Array.isArray(options.fieldPaths) || !options.fieldPaths.length || options.fieldPaths.length > 20 ||
        options.fieldPaths.some(field => typeof field !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,99}$/.test(field))) throw invalid();
      for (const field of options.fieldPaths) query.append('mask.fieldPaths', field);
    }
    if (options.pageToken) query.set('pageToken', options.pageToken);
    if (options.readTime) query.set('readTime', timestamp(options.readTime));
    const result = record(await this.request(`${this.urlPath(collection, true)}?${query}`, 'GET'));
    const raw = result.documents ?? [];
    if (!Array.isArray(raw) || raw.length > pageSize || (result.nextPageToken !== undefined && (typeof result.nextPageToken !== 'string' || result.nextPageToken.length > 16384))) throw unavailable();
    const documents = raw.map(value => this.document(value));
    if (documents.some(doc => doc.path.slice(0, doc.path.lastIndexOf('/')) !== collection)) throw unavailable();
    return { documents, ...(result.nextPageToken ? { nextPageToken: String(result.nextPageToken) } : {}) };
  }
  async commit(writes: FirestoreWrite[]): Promise<FirestoreCommit> {
    if (!Array.isArray(writes) || writes.length < 1 || writes.length > 500) throw invalid();
    const unique = new Set<string>();
    const wire = writes.map(write => {
      const name = this.name(write.path);
      if (unique.has(name) || Number(write.data !== undefined) + Number(write.delete === true) + Number(write.verify === true) !== 1) throw invalid();
      unique.add(name);
      const current = write.currentDocument;
      if (current && ((current.exists === undefined) === (current.updateTime === undefined) ||
        (current.exists !== undefined && typeof current.exists !== 'boolean'))) throw invalid();
      if (current?.updateTime) timestamp(current.updateTime);
      const operation = write.data !== undefined
        ? { update: { name, fields: record(record(encodeValue(record(write.data))).mapValue).fields } }
        : write.delete ? { delete: name } : { verify: name };
      if (bytes(JSON.stringify(operation)) > 950_000) throw invalid();
      return { ...operation, ...(current ? { currentDocument: current } : {}) };
    });
    const body = JSON.stringify({ writes: wire });
    if (bytes(body) > COMMIT_LIMIT) throw invalid();
    const response = await this.request(`${this.prefix}:commit`, 'POST', body, true);
    try {
      const raw = record(response);
      if (!Array.isArray(raw.writeResults) || raw.writeResults.length !== writes.length) throw unavailable();
      return { commitTime: timestamp(raw.commitTime), writeResults: raw.writeResults.map(value => {
        const row = record(value); return row.updateTime ? { updateTime: timestamp(row.updateTime) } : {};
      }) };
    } catch { throw new FirestoreCommitUncertain(); }
  }
  /** Bounded server maintenance only; application search uses the verified projection. */
  async query(collection: string, options: { field: string; op: 'LESS_THAN' | 'EQUAL'; value: unknown; limit?: number; orderBy?: string }): Promise<FirestoreDocument[]> {
    const parts = pathParts(collection, true), collectionId = parts.pop()!;
    const limit = options.limit ?? 50;
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(options.field) || !['LESS_THAN', 'EQUAL'].includes(options.op) ||
      !Number.isInteger(limit) || limit < 1 || limit > 100 || (options.orderBy && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(options.orderBy))) throw invalid();
    const query = { from: [{ collectionId }], where: { fieldFilter: { field: { fieldPath: options.field }, op: options.op, value: encodeValue(options.value) } },
      ...(options.orderBy ? { orderBy: [{ field: { fieldPath: options.orderBy }, direction: 'ASCENDING' }] } : {}), limit };
    const parent = parts.length ? `${this.prefix}/${parts.map(encodeURIComponent).join('/')}` : this.prefix;
    const result = await this.request(`${parent}:runQuery`, 'POST', JSON.stringify({ structuredQuery: query }));
    if (!Array.isArray(result) || result.length > limit + 1) throw unavailable();
    const documents = result.filter(value => record(value).document !== undefined).map(value => this.document(record(value).document));
    if (documents.some(doc => doc.path.slice(0, doc.path.lastIndexOf('/')) !== collection)) throw unavailable();
    return documents;
  }
}
