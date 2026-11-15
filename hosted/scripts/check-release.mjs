// Local release evidence only. This script cannot deploy or contact a provider.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = resolve(root, '..');
const assets = resolve(root, '.local/client-assets');
const serverBundle = resolve(root, '.local/app-dryrun/app.js');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = path => readFile(resolve(root, path));
const configBytes = await read('wrangler.app.jsonc');
const config = JSON.parse(configBytes.toString('utf8'));
assert.equal(config.main, 'src/app.ts', 'The application must use the production entrypoint');
assert.equal(config.workers_dev, false);
assert.equal(config.preview_urls, false);
assert.equal(config.assets.directory, './.local/client-assets');
assert.equal(config.assets.run_worker_first, true, 'All assets need application security headers');
for (const flag of ['HOSTED_ENABLED', 'ADMISSION_OPEN', 'PROCESSING_OPEN']) assert.equal(config.vars[flag], 'false', `${flag} must default closed`);
assert.equal(config.vars.BETA_CAP, '0');
assert.equal(config.vars.ADMISSION_UIDS, '[]');
assert.equal(config.vars.OPERATOR_UIDS, '[]');
assert.equal(config.vars.FIREBASE_PROJECT_ID, '');
assert.equal(config.vars.FIREBASE_PUBLIC_CONFIG, '{}');
assert.ok(!Object.hasOwn(config.vars, 'SESSION_SIGNING_KEY'));
assert.ok(!Object.hasOwn(config.vars, 'CREDENTIAL_KEYS'));
assert.ok(!Object.hasOwn(config.vars, 'FIRESTORE_SERVICE_ACCOUNT'));
assert.equal(config.vars.FIRESTORE_ENABLED, 'true');
assert.equal(config.vars.FIRESTORE_DATABASE_ID, 'save2ship');
assert.equal(config.vars.ENTITLEMENTS_ENABLED, 'true');
assert.equal(config.vars.BILLING_ENABLED, 'false');
assert.equal(config.vars.RAZORPAY_MODE, 'test');
for (const secret of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET']) assert.ok(!Object.hasOwn(config.vars, secret));
assert.deepEqual(config.durable_objects.bindings, [
  { name: 'WORKSPACES', class_name: 'FirebaseWorkspace' }, { name: 'REGISTRY', class_name: 'FirebaseRegistry' },
]);
assert.deepEqual(config.migrations, [
  { tag: 'app-v1', new_sqlite_classes: ['Workspace', 'Registry'] },
  { tag: 'app-firebase-v1', new_sqlite_classes: ['FirebaseWorkspace', 'FirebaseRegistry'] },
]);

const copied = ['app.js', 'onboarding.js', 'reading.js', 'theme.js', 'style.css'];
const expectedAssets = [...copied, 'index.html', 'hosted.js', 'import-worker.js'].sort();
assert.deepEqual((await readdir(assets)).sort(), expectedAssets, 'Unexpected or missing public asset; rebuild into a clean output directory');
for (const name of copied) assert.equal(hash(await readFile(resolve(assets, name))), hash(await readFile(resolve(repository, 'saved_to_shipped/web', name))), `Stale shared asset: ${name}`);
const localHTML = await readFile(resolve(repository, 'saved_to_shipped/web/index.html'), 'utf8');
assert.ok(!localHTML.includes('/hosted.js'), 'Local installation must not load hosted authentication');
const expectedHTML = localHTML.replace('<script src="/onboarding.js" defer></script>', '<script src="/hosted.js" defer></script>\n    <script src="/onboarding.js" defer></script>')
  .replace('in one local workspace.', 'in your private workspace.');
assert.equal(hash(await readFile(resolve(assets, 'index.html'))), hash(expectedHTML), 'Stale hosted HTML');
assert.equal((expectedHTML.match(/src="\/hosted.js"/g) ?? []).length, 1);

const browserBuild = await build({
  entryPoints: { hosted: 'client/bootstrap.mjs', 'import-worker': 'client/import-worker.mjs' },
  absWorkingDir: root, outdir: assets, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  sourcemap: false, legalComments: 'eof', define: { 'process.env.NODE_ENV': '"production"' },
  metafile: true, write: false,
});
const browserInputs = Object.keys(browserBuild.metafile.inputs).sort();
assert.ok(browserInputs.includes('client/bootstrap.mjs'));
assert.ok(browserInputs.some(path => path.includes('@firebase/auth/')));
for (const path of browserInputs) {
  assert.ok(path.startsWith('client/') || path.startsWith('node_modules/'), `Unexpected browser input: ${path}`);
  assert.doesNotMatch(path, /(?:^|\/)(?:tests?|probe)(?:\/|-)|(?:test|uat)-bootstrap|@firebase\/firestore|@grpc\//, `Nonproduction dependency: ${path}`);
}
for (const output of browserBuild.outputFiles) assert.equal(hash(await readFile(output.path)), hash(output.contents), `Stale browser bundle: ${relative(root, output.path)}`);

// Wrangler's emitted source map allows a stale dry run to be rejected without
// reading credentials or trusting a filename-only scan of its output bundle.
const map = JSON.parse(await readFile(`${serverBundle}.map`, 'utf8'));
assert.equal(map.sources.length, map.sourcesContent.length);
const serverInputs = [];
for (let n = 0; n < map.sources.length; n++) {
  // Wrangler records sourceRoot relative to its working directory.
  const source = resolve(map.sourceRoot ? resolve(root, map.sourceRoot) : dirname(serverBundle), map.sources[n]);
  const path = relative(root, source).replaceAll('\\', '/');
  assert.ok(path.startsWith('src/') || path.startsWith('node_modules/'), `Unexpected server input: ${path}`);
  assert.doesNotMatch(path, /(?:^|\/)(?:tests?|probe)(?:\/|-)|harness|fixture/, `Test input in server bundle: ${path}`);
  assert.equal(hash(await readFile(source)), hash(map.sourcesContent[n]), `Stale dry-run source: ${path}`);
  serverInputs.push(path);
}
assert.ok(serverInputs.includes('src/app.ts'));
assert.ok(serverInputs.includes('src/auth/session.ts'));
const worker = await readFile(serverBundle);
assert.ok(!/__fixture__|TEST_PRIVATE_KEY|TEST_JWKS|syntheticRun1/.test(worker.toString('utf8')), 'Synthetic bypass in production Worker');
for (const name of ['hosted.js', 'import-worker.js']) assert.ok(!/__fixture__|__fixtureSignIn|TEST_PRIVATE_KEY/.test(await readFile(resolve(assets, name), 'utf8')), `Synthetic authentication in ${name}`);

const artifacts = [];
for (const name of expectedAssets) {
  const data = await readFile(resolve(assets, name));
  artifacts.push({ path: `client-assets/${name}`, bytes: data.length, sha256: hash(data) });
}
artifacts.push({ path: 'app-dryrun/app.js', bytes: worker.length, sha256: hash(worker) });
const report = {
  kind: 'closed-hosted-release-preparation',
  commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim(),
  dirty: Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repository, encoding: 'utf8' }).trim()),
  node: process.version, schema: 'app-v1', admittedMembers: 0,
  configurationSHA256: hash(configBytes), lockfileSHA256: hash(await read('package-lock.json')),
  checks: ['closed deployment defaults', 'exact public asset inventory', 'fresh browser bundle graph', 'fresh Worker source map', 'fixture exclusion'],
  artifacts, browserInputs, serverInputs: serverInputs.sort(),
  evidenceLimits: ['Local artifacts only', 'No live identity or provider result', 'No deployed physical-storage or cohort capacity claim'],
};
await mkdir(resolve(root, '.local/release-check'), { recursive: true });
await writeFile(resolve(root, '.local/release-check/report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`Release boundary checks passed for ${report.commit}${report.dirty ? ' with working-tree changes' : ''}; ${artifacts.length} artifacts hashed. No deployment performed.`);
