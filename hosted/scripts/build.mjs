import { build } from 'esbuild';
import { existsSync } from 'node:fs';
await build({
  entryPoints: ['src/index.ts', 'tests/harness-worker.ts', 'probe/index.ts',
    'src/app.ts', 'tests/workspace-harness.ts', 'tests/app-harness.ts',
    'src/providers/index.ts', 'src/credentials/index.ts'].filter(path => existsSync(path)),
  outdir: '.local/build', outbase: '.', bundle: true, format: 'esm',
  platform: 'browser', target: 'es2023', external: ['cloudflare:workers'],
});
