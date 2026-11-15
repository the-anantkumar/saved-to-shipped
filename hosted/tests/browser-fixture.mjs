// Local synthetic preview. It is never included by a deployment configuration.
import { mkdtemp, cp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { appFixtureConfig } from './app-helpers.mjs';

export async function startFixture({ mode = 'automated', variables = {} } = {}) {
  if (!['automated', 'uat'].includes(mode)) throw new Error('Unknown synthetic fixture mode.');
  process.env.WRANGLER_SEND_METRICS = 'false';
  process.env.WRANGLER_WRITE_LOGS = 'false';
  process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV = 'false';
  const { createTestHarness } = await import('wrangler');
  const root = await mkdtemp(join(tmpdir(), 'save2ship-hosted-browser-'));
  await cp(resolve('.local/client-assets'), join(root, 'assets'), { recursive: true });
  await build({ entryPoints: [mode === 'uat' ? 'client/uat-bootstrap.mjs' : 'client/test-bootstrap.mjs'], outfile: join(root, 'assets/hosted.js'),
    bundle: true, platform: 'browser', format: 'iife', target: 'es2022', minify: true });
  const { vars } = await appFixtureConfig({ variables });
  const config = JSON.parse(await readFile('wrangler.app.jsonc', 'utf8'));
  config.name = 'save2ship-browser-fixture';
  config.main = resolve('.local/build/tests/app-harness.js');
  config.assets.directory = join(root, 'assets');
  config.vars = vars;
  const server = createTestHarness({ root, workers: [{ config }] });
  try {
    const { url } = await server.listen();
    return { url: String(url), server, close: async () => { await server.close(); await rm(root, { recursive: true, force: true }); } };
  } catch (error) { await server.close(); await rm(root, { recursive: true, force: true }); throw error; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await startFixture();
  console.log(`Synthetic hosted fixture: ${fixture.url}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { await fixture.close(); process.exit(0); });
}
