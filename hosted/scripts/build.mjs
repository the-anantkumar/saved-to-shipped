import { build } from 'esbuild';
import { existsSync } from 'node:fs';
await build({
  entryPoints: ['src/index.ts', 'tests/harness-worker.ts', 'probe/index.ts',
    'src/app.ts', 'tests/workspace-harness.ts', 'tests/app-harness.ts',
    'src/providers/index.ts', 'src/credentials/index.ts', 'src/auth/session.ts', 'src/jobs/orchestrator.ts', 'src/billing/policy.ts',
    'src/billing/service.ts', 'src/billing/bindings.ts', 'src/billing/razorpay.ts',
    'src/firestore/client.ts', 'src/firestore/registry.ts', 'tests/firestore-harness.ts', 'tests/edge-fetch-harness.ts'].filter(path => existsSync(path)),
  outdir: '.local/build', outbase: '.', bundle: true, format: 'esm',
  platform: 'browser', target: 'es2023', external: ['cloudflare:workers'],
});
