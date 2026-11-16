import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readOAuthToken, readOnlyClient, namedType, typeQuery } from './cloud-readonly.mjs';

const DATASETS = ['durableObjectsSqlStorageGroups', 'durableObjectsStorageGroups', 'durableObjectsPeriodicGroups',
  'durableObjectsInvocationsAdaptiveGroups', 'workersInvocationsAdaptive'];
// A small probe needs few minute buckets. Queries requesting larger pages hit
// budget errors; a full page requires narrowing the window, not assuming completeness.
const PAGE_SIZE = 100;

async function inspectSchema(account, request) {
  const discovery = JSON.parse(await readFile('.local/cloud-discovery.json', 'utf8'));
  if (discovery.account !== account) throw new Error('Run account discovery for this account first.');
  const report = { capturedAt: new Date().toISOString(), account, datasets: {}, types: {} };
  // Query the shallow argument types separately to stay within API complexity limits.
  const argumentsResult = await request('/client/v4/graphql', { query: `query { __type(name: "account") {
    fields { name args { name type { kind name ofType { kind name } } } }
  } }` });
  for (const dataset of DATASETS) {
    const field = discovery.accountSchema.data.__type.fields.find(field => field.name === dataset);
    if (!field) continue;
    const args = argumentsResult.data.__type.fields.find(field => field.name === dataset)?.args;
    const type = namedType(field.type);
    const schema = (await request('/client/v4/graphql', typeQuery(type))).data.__type;
    report.datasets[dataset] = { type, args, schema };
    for (const child of schema.fields.filter(field => ['sum', 'max', 'min', 'quantiles', 'dimensions'].includes(field.name))) {
      const childType = namedType(child.type);
      if (!(childType in report.types)) report.types[childType] = (await request('/client/v4/graphql', typeQuery(childType))).data.__type;
    }
    const filterType = namedType(args?.find(argument => argument.name === 'filter')?.type);
    if (filterType) report.types[filterType] = (await request('/client/v4/graphql', {
      query: 'query($name: String!) { __type(name: $name) { name inputFields { name type { kind name ofType { kind name } } } } }',
      variables: { name: filterType },
    })).data.__type;
  }
  report.settings = await request('/client/v4/graphql', {
    query: `query($account: string!) { viewer { accounts(filter: {accountTag: $account}) { settings {
      ${DATASETS.map(name => `${name} { enabled availableFields maxDuration maxPageSize notOlderThan }`).join('\n')}
    } } } }`, variables: { account },
  });
  return report;
}

const MEASUREMENTS = {
  durableObjectsSqlStorageGroups: 'dimensions { datetimeMinute namespaceId } max { storedBytes }',
  durableObjectsPeriodicGroups: 'dimensions { datetimeMinute namespaceId } sum { rowsRead rowsWritten cpuTime activeTime duration }',
  durableObjectsInvocationsAdaptiveGroups: 'dimensions { datetimeMinute namespaceId scriptName status } sum { requests errors } quantiles { cpuTimeP50 cpuTimeP95 }',
  workersInvocationsAdaptive: 'dimensions { datetimeMinute scriptName status } sum { requests errors cpuTimeUs } max { cpuTime } quantiles { cpuTimeP50 cpuTimeP95 }',
};

export function metricQueries(account, since, until) {
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('A verified account ID is required.');
  const start = Date.parse(since), end = Date.parse(until);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end || end - start > 86_400_000) {
    throw new Error('Metrics window must be positive and at most 24 hours.');
  }
  return Object.entries(MEASUREMENTS).map(([dataset, fields]) => [dataset, {
    query: `query($account: string!, $since: Time!, $until: Time!) { viewer { accounts(filter: {accountTag: $account}) {
      ${dataset}(limit: ${PAGE_SIZE}, filter: {datetime_geq: $since, datetime_lt: $until}) { ${fields} }
    } } }`, variables: { account, since: new Date(start).toISOString(), until: new Date(end).toISOString() },
  }]);
}

export async function capture(account, since, until, request) {
  const report = { capturedAt: new Date().toISOString(), account, since, until,
    pageSize: PAGE_SIZE,
    boundary: 'Account-wide reported samples. Empty arrays do not establish zero usage; data can be delayed or sampled. Storage values are time-window maxima, not physical file allocation.',
    units: { rowsRead: 'rows', rowsWritten: 'rows', cpuTime: 'microseconds', cpuTimeUs: 'microseconds',
      cpuTimeP50: 'microseconds', cpuTimeP95: 'microseconds', activeTime: 'microseconds', duration: 'GB-seconds', storedBytes: 'bytes' }, datasets: {} };
  for (const [dataset, query] of metricQueries(account, since, until)) {
    try {
      const data = await request('/client/v4/graphql', query);
      const accounts = data.data?.viewer?.accounts;
      if (!Array.isArray(accounts) || accounts.length !== 1 || !Array.isArray(accounts[0][dataset])) throw new Error('Expected one authorized account dataset.');
      const rows = accounts[0][dataset];
      report.datasets[dataset] = { available: true, possiblyTruncated: rows.length >= PAGE_SIZE, samples: rows };
    } catch (error) { report.datasets[dataset] = { available: false, error: error.message }; }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [mode, account, label, start, end] = process.argv.slice(2);
    if (!['schema', 'capture'].includes(mode) || !/^[a-f0-9]{32}$/.test(account ?? '')) throw new Error('Usage: node scripts/cloud-metrics.mjs schema ACCOUNT_ID | capture ACCOUNT_ID LABEL [SINCE UNTIL]');
    if (mode === 'schema' && process.argv.length !== 4) throw new Error('Schema mode accepts only an account ID.');
    if (mode === 'capture' && (!/^[a-z][a-z0-9-]{0,40}$/.test(label ?? '') || ![5, 7].includes(process.argv.length))) throw new Error('Capture requires a safe label and optionally both UTC window endpoints.');
    const until = end ?? new Date().toISOString();
    const since = start ?? `${until.slice(0, 10)}T00:00:00.000Z`;
    if (mode === 'capture') metricQueries(account, since, until);
    const request = readOnlyClient(await readOAuthToken());
    const report = mode === 'schema' ? await inspectSchema(account, request) : await capture(account, since, until, request);
    const path = mode === 'schema' ? '.local/cloud-metrics-schema.json' : `.local/cloud-metrics-${label}.json`;
    await mkdir('.local', { recursive: true });
    await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(JSON.stringify({ report: path, datasets: Object.fromEntries(Object.entries(report.datasets).map(([key, value]) =>
      [key, { available: value.available !== false, samples: value.samples?.length, possiblyTruncated: value.possiblyTruncated }])) }));
    if (mode === 'capture' && Object.values(report.datasets).some(value => !value.available || value.possiblyTruncated)) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
