import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.ts', 'tests/harness-worker.ts', 'probe/index.ts'],
  outdir: '.local/build', outbase: '.', bundle: true, format: 'esm',
  platform: 'browser', target: 'es2023', external: ['cloudflare:workers'],
});
