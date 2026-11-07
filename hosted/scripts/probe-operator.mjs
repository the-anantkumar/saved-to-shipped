import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { boundedJson, readOAuthToken, readOnlyClient } from './cloud-readonly.mjs';

export const WORKER_NAME = 'save2ship-p1-probe';
const DIRECTORY = '.local/cloud-probe';
const STEPS = ['seed-1', 'seed-2', 'read', 'edit', 'reject', 'delete', 'fts', 'fts-read'];

export function verifiedProbeUrl(subdomain) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(subdomain ?? '')) throw new Error('Invalid account workers.dev subdomain.');
  return `https://${WORKER_NAME}.${subdomain}.workers.dev`;
}

export async function prepare(account, includeFts, directory = DIRECTORY) {
  if (!/^[a-f0-9]{32}$/.test(account)) throw new Error('A verified account ID is required.');
  await mkdir(resolve(directory, '..'), { recursive: true });
  // Never overwrite a previous run's credential or ledger. A second experiment
  // requires a deliberate reviewed lifecycle decision, not an implicit reset.
  await mkdir(directory, { mode: 0o700 });
  const plan = { schema: 1, account, workerName: WORKER_NAME, preparedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), includeFts,
    limits: { syntheticSaves: 50, admittedRequests: 128, verificationClaims: 16 },
    deployment: null, origin: null };
  await writeFile(`${directory}/secrets.json`, JSON.stringify({ PROBE_SECRET: randomBytes(32).toString('base64url') }), { mode: 0o600, flag: 'wx' });
  await writeFile(`${directory}/plan.json`, `${JSON.stringify(plan, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  await writeFile(`${directory}/requests.json`, JSON.stringify({ attempts: [] }), { mode: 0o600, flag: 'wx' });
  return plan;
}

async function atomicJson(path, value) {
  const pending = `${path}.pending`;
  await writeFile(pending, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(pending, path);
}

export async function withOperatorLock(directory, work) {
  const path = `${directory}/operator.lock`;
  const lock = await open(path, 'wx', 0o600);
  try { return await work(); }
  finally { await lock.close(); await unlink(path); }
}

export async function bindAccountOrigin(plan, request) {
  const data = await request(`/client/v4/accounts/${plan.account}/workers/subdomain`);
  const origin = verifiedProbeUrl(data.result?.subdomain);
  if (plan.origin && plan.origin !== origin) throw new Error('Probe origin changed; inspect the deployment before continuing.');
  return { ...plan, origin };
}

export function operationPath(operation) {
  if (operation === 'report') return { method: 'GET', path: '/probe/report' };
  if (operation === 'cleanup') return { method: 'POST', path: '/probe/cleanup' };
  if (STEPS.includes(operation)) return { method: 'POST', path: `/probe/step/${operation}` };
  if (/^verify-(1[0-6]|[1-9])$/.test(operation)) return { method: 'POST', path: `/probe/verify/${operation.slice(7)}` };
  throw new Error('Unknown fixed probe operation.');
}

export async function callProbe(plan, secret, operation, fetcher = fetch) {
  const origin = new URL(plan.origin ?? 'https://invalid.invalid');
  const suffix = '.workers.dev';
  const prefix = `${WORKER_NAME}.`;
  const subdomain = origin.hostname.startsWith(prefix) && origin.hostname.endsWith(suffix)
    ? origin.hostname.slice(prefix.length, -suffix.length) : '';
  if (plan.workerName !== WORKER_NAME || origin.origin !== verifiedProbeUrl(subdomain) || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Probe must use the verified account workers.dev origin.');
  if (typeof secret !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error('Probe credential is unavailable.');
  const { method, path } = operationPath(operation);
  let response;
  try {
    response = await fetcher(`${origin.origin}${path}`, { method, redirect: 'error',
      headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error('Probe response uncertain. Read the report; this command does not retry.'); }
  const body = await boundedJson(response);
  // Return only the synthetic response. Never record request headers or secrets.
  if (JSON.stringify(body).includes(secret)) throw new Error('Probe response unexpectedly included its credential; output suppressed.');
  return { status: response.status, body };
}

async function runOperation(plan, operation) {
  operationPath(operation);
  const statePath = `${DIRECTORY}/requests.json`;
  const state = JSON.parse(await readFile(statePath, 'utf8'));
  const mutates = !['report', 'cleanup'].includes(operation);
  if (mutates && state.attempts.some(attempt => attempt.operation === operation)) throw new Error('Operation already attempted. Inspect the report before any further work.');
  if (operation !== 'cleanup' && state.attempts.length >= 100) throw new Error('Operator request allowance exhausted; cleanup remains available.');
  const secrets = JSON.parse(await readFile(`${DIRECTORY}/secrets.json`, 'utf8'));
  const attempt = { operation, startedAt: new Date().toISOString(), outcome: 'UNCERTAIN' };
  state.attempts.push(attempt);
  await atomicJson(statePath, state);
  const result = await callProbe(plan, secrets.PROBE_SECRET, operation);
  Object.assign(attempt, { finishedAt: new Date().toISOString(), outcome: 'RESPONSE', result });
  await atomicJson(statePath, state);
  console.log(JSON.stringify({ operation, status: result.status, resultFile: statePath,
    code: typeof result.body?.error === 'string' ? result.body.error : undefined }));
  if (result.status !== 200) throw new Error('Probe operation did not succeed; inspect its stored result. No automatic retry occurred.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [command, account, option] = process.argv.slice(2);
    if (command === 'prepare') {
      if (![4, 5].includes(process.argv.length) || (option && option !== '--fts')) throw new Error('Usage: node scripts/probe-operator.mjs prepare ACCOUNT_ID [--fts]');
      const plan = await prepare(account ?? '', option === '--fts');
      console.log(JSON.stringify({ plan: `${DIRECTORY}/plan.json`, expiresAt: plan.expiresAt, limits: plan.limits, includeFts: plan.includeFts }));
    } else {
      if (process.argv.length !== 3) throw new Error('Usage: node scripts/probe-operator.mjs bind | report | FIXED_STEP | verify | cleanup');
      await withOperatorLock(DIRECTORY, async () => {
        const plan = JSON.parse(await readFile(`${DIRECTORY}/plan.json`, 'utf8'));
        if (command === 'bind') {
          const bound = await bindAccountOrigin(plan, readOnlyClient(await readOAuthToken()));
          await atomicJson(`${DIRECTORY}/plan.json`, bound);
          console.log(JSON.stringify({ origin: bound.origin, source: 'Verified account API subdomain; verify the matching Worker deployment separately.' }));
        } else if (command === 'verify') {
          for (let index = 1; index <= 16; index++) await runOperation(plan, `verify-${index}`);
        } else await runOperation(plan, command ?? '');
      });
    }
  } catch (error) {
    if (['EEXIST', 'ENOENT'].includes(error.code)) console.error('Probe preparation already exists or is missing. Inspect the local run directory; do not overwrite a previous run.');
    else console.error(error.message);
    process.exitCode = 1;
  }
}
