/** Run the production entrypoint on loopback with this developer's Firebase project. */
import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, '.local/firebase-project');
const args = process.argv.slice(2);
const prepareOnly = args.includes('--prepare-only');
const processing = args.includes('--processing');
const portFlag = args.indexOf('--port');
const port = portFlag < 0 ? 8012 : Number(args[portFlag + 1]);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Choose a local port between 1024 and 65535.');
const origin = `http://localhost:${port}`;
await mkdir(directory, { recursive: true, mode: 0o700 });
await chmod(directory, 0o700);
async function localJson(name, fallback) {
  try { return JSON.parse(await readFile(resolve(directory, name), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT' && fallback !== undefined) return fallback; throw new Error(`Set up .local/firebase-project/${name} first. See docs/FIREBASE_SETUP.md.`); }
}
const supplied = await localJson('web-config.json');
const firebase = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId'].map(key => {
  if (typeof supplied[key] !== 'string' || !supplied[key]) throw new Error(`Firebase web configuration is missing ${key}.`);
  return [key, supplied[key]];
}));
const serviceAccount = await localJson('service-account.json');
if (serviceAccount.type !== 'service_account' || serviceAccount.project_id !== firebase.projectId ||
  typeof serviceAccount.private_key !== 'string' || !serviceAccount.private_key.includes('PRIVATE KEY') ||
  typeof serviceAccount.client_email !== 'string') throw new Error('The server service account must belong to the configured Firebase project.');
const database = supplied.databaseId;
if (typeof database !== 'string' || !/^(?:\(default\)|[a-z][a-z0-9-]{2,61}[a-z0-9])$/.test(database)) throw new Error('Set databaseId in the local web configuration.');
const members = await localJson('members.json', []);
if (!Array.isArray(members) || members.length > 2 || members.some(uid => typeof uid !== 'string' || !uid || uid.length > 128))
  throw new Error('Local UAT accepts an explicit list of at most two Firebase UIDs in members.json.');
const uniqueMembers = [...new Set(members)];
const signingFile = resolve(directory, 'local-secrets.json');
let secrets = await localJson('local-secrets.json', null);
if (!secrets) {
  secrets = { session: randomBytes(32).toString('base64url'), credential: randomBytes(32).toString('base64url') };
  await writeFile(signingFile, JSON.stringify(secrets) + '\n', { mode: 0o600, flag: 'wx' });
}
if (!/^[A-Za-z0-9_-]{43}$/.test(secrets.session) || !/^[A-Za-z0-9_-]{43}$/.test(secrets.credential))
  throw new Error('Invalid local session/encryption keys. Preserve the original keys when restarting.');
await chmod(signingFile, 0o600);
const template = JSON.parse(await readFile(resolve(root, 'wrangler.app.jsonc'), 'utf8'));
const config = {
  ...template, $schema: '../../node_modules/wrangler/config-schema.json', name: 'save2ship-firebase-local',
  main: '../../src/app.ts', assets: { ...template.assets, directory: '../client-assets' },
  vars: { ...template.vars, HOSTED_ENABLED: 'true', FIRESTORE_ENABLED: 'true', FIRESTORE_DATABASE_ID: database,
    FIREBASE_PROJECT_ID: firebase.projectId, FIREBASE_PUBLIC_CONFIG: JSON.stringify(firebase), APP_ORIGIN: origin,
    ADMISSION_OPEN: uniqueMembers.length ? 'true' : 'false', ADMISSION_UIDS: JSON.stringify(uniqueMembers),
    BETA_CAP: String(uniqueMembers.length), OPERATOR_UIDS: '[]', PROCESSING_OPEN: String(processing) },
};
// Wrangler's dotenv parser preserves JSON and escaped PEM newlines inside single quotes.
const dotenv = Object.entries({
  SESSION_SIGNING_KEY: secrets.session,
  CREDENTIAL_KEYS: JSON.stringify({ active: 'v1', keys: { v1: secrets.credential } }),
  FIRESTORE_SERVICE_ACCOUNT: JSON.stringify(serviceAccount),
}).map(([name, value]) => {
  if (/[\r\n']/.test(value)) throw new Error(`Unsupported local secret encoding: ${name}.`);
  return `${name}='${value}'`;
}).join('\n') + '\n';
await writeFile(resolve(directory, '.dev.vars'), dotenv, { mode: 0o600 });
await chmod(resolve(directory, '.dev.vars'), 0o600);
const configFile = resolve(directory, 'wrangler.jsonc');
await writeFile(configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
console.log(`Firebase project ${firebase.projectId}, database ${database}. Local access: ${uniqueMembers.length} admitted account(s).`);
if (processing) console.log('Import is enabled. Retrieval and AI use real user-owned provider accounts only after an explicit request.');
else console.log('Import and paid provider processing are paused. Manual saves and editing remain available.');
if (!prepareOnly) {
  const built = spawnSync(process.execPath, ['scripts/build-client.mjs'], { cwd: root, stdio: 'inherit' });
  if (built.status !== 0) process.exit(built.status ?? 1);
  console.log(`Open ${origin}/`);
  const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--config', configFile,
    '--local', '--ip', '127.0.0.1', '--port', String(port), '--local-protocol', 'http',
    '--persist-to', resolve(directory, 'state'), '--show-interactive-dev-session', 'false', '--log-level', 'warn'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false',
      CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' },
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('exit', code => process.exit(code ?? 0));
}
