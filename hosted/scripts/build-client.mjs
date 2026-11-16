import { build } from 'esbuild';
import { mkdir, rm, readFile, writeFile, copyFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const outdir = resolve(root, '.local/client-assets');
// This fixed directory contains generated assets only. Do not carry old bundles into a release.
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
for (const asset of ['app.js', 'onboarding.js', 'reading.js', 'theme.js', 'style.css', 'favicon.svg']) {
  await copyFile(resolve(root, '../saved_to_shipped/web', asset), resolve(outdir, asset));
}
const html = (await readFile(resolve(root, '../saved_to_shipped/web/index.html'), 'utf8'))
  .replace('<script src="/onboarding.js" defer></script>', '<script src="/hosted.js" defer></script>\n    <script src="/onboarding.js" defer></script>')
  .replace('in one local workspace.', 'in your private workspace.');
await writeFile(resolve(outdir, 'index.html'), html);
await build({ entryPoints: { hosted: 'client/bootstrap.mjs', 'import-worker': 'client/import-worker.mjs' },
  absWorkingDir: root, outdir, bundle: true, format: 'iife', platform: 'browser', target: 'es2022', minify: true,
  sourcemap: false, legalComments: 'eof', define: { 'process.env.NODE_ENV': '"production"' } });
console.log('Hosted assets built in .local/client-assets; local assets remain account-free.');
