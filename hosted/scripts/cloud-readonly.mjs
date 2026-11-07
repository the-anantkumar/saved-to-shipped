import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { devNull } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
export const API_ORIGIN = 'https://api.cloudflare.com';
export const MAX_RESPONSE_BYTES = 2_000_000;

// Capture the credential in memory only. Never print a child-process exception:
// execFile errors can carry the child's stdout, including an access token.
export async function readOAuthToken(run = execute) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^(CLOUDFLARE_|CF_|WRANGLER_)/.test(key) || ['NODE_OPTIONS', 'NODE_PATH'].includes(key)) delete env[key];
  Object.assign(env, { WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG: 'error', CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' });
  try {
    const { stdout } = await run(process.execPath, [wranglerBin, '--env-file', devNull, '--profile', 'default', 'auth', 'token', '--json'],
      { cwd: fileURLToPath(new URL('..', import.meta.url)), env, timeout: 30_000, maxBuffer: 64_000 });
    const auth = JSON.parse(stdout);
    if (auth.type !== 'oauth' || typeof auth.token !== 'string' || !auth.token || auth.token.length > 16_384) throw new Error();
    return auth.token;
  } catch { throw new Error('Cloudflare OAuth unavailable; complete the scoped Wrangler login locally.'); }
}

export async function boundedJson(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Cloudflare returned an empty response.');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Cloudflare response exceeded the inspection limit.');
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('Cloudflare returned invalid JSON.'); }
}

export function readOnlyClient(token, fetcher = fetch) {
  return async function request(path, query) {
    const allowed = /^\/client\/v4\/accounts\/[a-f0-9]{32}\/(entitlements|workers\/scripts|workers\/subdomain|workers\/durable_objects\/namespaces)$/.test(path);
    const graphql = path === '/client/v4/graphql' && query && typeof query.query === 'string' && /^\s*(query\b|\{)/.test(query.query);
    if ((!allowed || query) && !graphql) throw new Error('Unsupported read-only Cloudflare request.');
    let response;
    try {
      response = await fetcher(`${API_ORIGIN}${path}`, {
        method: graphql ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(20_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        ...(graphql ? { body: JSON.stringify(query) } : {}),
      });
    } catch { throw new Error('Cloudflare inspection request failed; no response details were logged.'); }
    const data = await boundedJson(response);
    if (!response.ok || data.success === false || data.errors?.length) {
      const codes = (data.errors ?? []).map(error => String(error.code ?? error.extensions?.code ?? 'unknown').replace(/[^\w-]/g, '').slice(0, 40));
      throw new Error(`Cloudflare inspection rejected (HTTP ${response.status}; codes: ${codes.join(',') || 'unknown'}).`);
    }
    return data;
  };
}

const typeRef = 'kind name ofType { kind name ofType { kind name ofType { kind name } } }';
export const typeQuery = name => ({ query: `query($name: String!) { __type(name: $name) { name kind fields { name description type { ${typeRef} } } } }`, variables: { name } });
export function namedType(type) {
  while (type && !type.name) type = type.ofType;
  return type?.name;
}

export async function discover(account, request) {
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('A verified Cloudflare account ID is required.');
  const report = { capturedAt: new Date().toISOString(), account, boundary: 'Read-only API discovery. Entitlements do not by themselves prove current plan or unused allowance.' };
  const entries = [
    ['entitlements', `/client/v4/accounts/${account}/entitlements`],
    ['workers', `/client/v4/accounts/${account}/workers/scripts`],
    ['namespaces', `/client/v4/accounts/${account}/workers/durable_objects/namespaces`],
    ['subdomain', `/client/v4/accounts/${account}/workers/subdomain`],
  ];
  for (const [key, path] of entries) {
    try { report[key] = await request(path); }
    catch (error) { report[key] = { available: false, error: error.message }; }
  }
  const root = await request('/client/v4/graphql', { query: `query { __schema { queryType { fields { name type { ${typeRef} } } } } }` }).catch(error => { throw new Error(`GraphQL root discovery: ${error.message}`); });
  const viewerName = namedType(root.data?.__schema?.queryType?.fields?.find(field => field.name === 'viewer')?.type);
  if (!viewerName) throw new Error('GraphQL viewer schema is unavailable.');
  const viewer = await request('/client/v4/graphql', typeQuery(viewerName)).catch(error => { throw new Error(`GraphQL viewer discovery: ${error.message}`); });
  const accountName = namedType(viewer.data?.__type?.fields?.find(field => field.name === 'accounts')?.type);
  if (!accountName) throw new Error('GraphQL account schema is unavailable.');
  report.accountSchema = await request('/client/v4/graphql', typeQuery(accountName)).catch(error => { throw new Error(`GraphQL account discovery: ${error.message}`); });
  try {
    report.settings = await request('/client/v4/graphql', {
      query: `query($account: string!) { viewer { accounts(filter: {accountTag: $account}) { settings {
        durableObjectsStorageGroups { enabled availableFields maxDuration maxPageSize notOlderThan }
        durableObjectsPeriodicGroups { enabled availableFields maxDuration maxPageSize notOlderThan }
        durableObjectsInvocationsAdaptiveGroups { enabled availableFields maxDuration maxPageSize notOlderThan }
      } } } }`, variables: { account },
    });
  } catch (error) { report.settings = { available: false, error: error.message }; }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 3) throw new Error('Usage: node scripts/cloud-readonly.mjs ACCOUNT_ID');
    const token = await readOAuthToken();
    const report = await discover(process.argv[2], readOnlyClient(token));
    await mkdir('.local', { recursive: true });
    await writeFile('.local/cloud-discovery.json', `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ report: '.local/cloud-discovery.json', capturedAt: report.capturedAt,
      resources: Object.fromEntries(['entitlements', 'workers', 'namespaces', 'subdomain'].map(key => [key, { available: report[key].available !== false, count: Array.isArray(report[key].result) ? report[key].result.length : undefined }])),
      schemaAvailable: Boolean(report.accountSchema.data?.__type),
    }));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
