import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { Miniflare, Log, LogLevel } from 'miniflare';
export const alice = { uid: 'synthetic-alice', generation: 'generation-one' };
export const bob = { uid: 'synthetic-bob', generation: 'generation-one' };
export const row = (n, content = '') => ({ url: `https://www.linkedin.com/feed/update/urn:li:activity:90000000000000${String(n).padStart(4, '0')}`, saved_at: '2026-01-02', title: `Synthetic ${n}`, content });
export async function workspaceRuntime({ persist, limits = {} } = {}) {
  const mf = new Miniflare({
    workers: [{ config: {
      name: 'workspace-app-test', compatibilityDate: '2026-07-30',
      manifest: { mainModule: 'workspace.js', modules: { 'workspace.js': { type: 'esm', contents: await readFile('.local/build/tests/workspace-harness.js', 'utf8') } } },
      exports: { Workspace: { type: 'durable-object', storage: 'sqlite' } },
      env: { WORKSPACES: { type: 'durable-object', worker: 'workspace-app-test', exportName: 'Workspace' },
        ...Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, { type: 'text', value: String(value) }])) },
    } }], host: '127.0.0.1', port: 0, resourcePersistencePath: persist,
    telemetry: { enabled: false }, enableDevRegistry: false, log: new Log(LogLevel.ERROR), cf: false,
  });
  let request = 0;
  const runtime = {
    mf,
    async invoke(operation, input = {}, access = alice, name = access.uid) {
      const response = await mf.dispatchFetch('https://harness.invalid/', { method: 'POST',
        body: JSON.stringify({ name, access, operation, input }) });
      assert.equal(response.status, 200); return response.json();
    },
    async call(operation, input = {}, access = alice, name = access.uid) {
      const result = await this.invoke(operation, input, access, name);
      assert.equal(result.ok, true, `${operation}: ${JSON.stringify(result)}`); return result.data;
    },
    mutate(operation, input = {}, access = alice, name = access.uid) { return this.call(operation, { request_id: `request-${++request}`, ...input }, access, name); },
    provision(access = alice, name = access.uid) { return this.call('provision', {}, access, name); },
    async capture(n, content = 'Learn an example', access = alice) { return this.mutate('capture', row(n, content), access); },
    dispose() { return mf.dispose(); },
  };
  return runtime;
}
