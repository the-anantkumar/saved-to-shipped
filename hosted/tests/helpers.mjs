import { Miniflare, Log, LogLevel } from 'miniflare';
import { performance } from 'node:perf_hooks';
import { readFile } from 'node:fs/promises';

export const limits = Object.freeze({ items: 1000, logicalBytes: 5_000_000, physicalBytes: 8_000_000 });
export async function runtime({ persist } = {}) {
  const mf = new Miniflare({
    workers: [{ config: {
      name: 'save2ship-test', compatibilityDate: '2026-07-30',
      manifest: {
        mainModule: 'harness-worker.js',
        modules: { 'harness-worker.js': { type: 'esm', contents: await readFile('.local/build/tests/harness-worker.js', 'utf8') } },
      },
      exports: { WorkspacePrototype: { type: 'durable-object', storage: 'sqlite' } },
      env: { WORKSPACES: { type: 'durable-object', worker: 'save2ship-test', exportName: 'WorkspacePrototype' } },
    } }],
    host: '127.0.0.1', port: 0, resourcePersistencePath: persist,
    telemetry: { enabled: false }, enableDevRegistry: false,
    log: new Log(LogLevel.ERROR), cf: false,
  });
  return {
    mf,
    async call(name, operation, input = {}) {
      const started = performance.now();
      const response = await mf.dispatchFetch('http://localhost/test', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, operation, ...input }),
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`Harness ${operation}: ${response.status} ${text.slice(0, 500)}`);
      return { result: JSON.parse(text), roundTripMs: performance.now() - started };
    },
    dispose() { return mf.dispose(); },
  };
}

/** Deterministic UTF-8 fixture generation, never reads a user's archive. */
function textWithinBytes(words, bytes) {
  let text = '';
  let used = 0;
  for (let n = 0; used < bytes; n++) {
    const word = `${words[n % words.length]} `;
    const size = Buffer.byteLength(word);
    if (used + size > bytes) { text += 'x'.repeat(bytes - used); break; }
    text += word;
    used += size;
  }
  return text;
}

export function fixture(index, profile = 'typical', revision = 0) {
  const marker = `unique${index}rev${revision}`;
  const highCardinality = profile === 'varied';
  const words = highCardinality
    ? Array.from({ length: 400 }, (_, n) => `term${index}r${revision}v${n}`)
    : [marker, 'distributed', 'systems', 'learning', 'प्रयोग', '整理', 'café', '🚀', 'reliable', 'project', 'notes'];
  const richer = profile !== 'typical';
  return {
    id: `save-${String(index).padStart(5, '0')}`,
    platform: 'linkedin', url: `https://www.linkedin.com/feed/update/urn:li:activity:synthetic${index}${index % 20 === 0 ? `?fixture=${'long-path-'.repeat(40)}` : ''}`,
    title: `Synthetic ${marker}: systems and learning`, author: `Fixture author ${index % 50}`,
    saved_at: new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString(),
    kind: ['project', 'learning', 'experience'][index % 3],
    status: ['backlog', 'active', 'done'][index % 3], group_id: `group-${index % 12}`,
    tags: ['synthetic', `topic-${index % 23}`, 'multibyte'],
    reading_progress: (index % 11) / 10,
    next_action: 'Try a small implementation and record what changed.',
    why: 'A synthetic example for reproducible capacity measurements.',
    content: textWithinBytes(words, richer ? 3072 : 1536),
    note: profile === 'unicode-notes' ? '🚀'.repeat(20_000)
      : textWithinBytes([marker, 'Personal', 'notes', 'नमस्ते', '知識', '📝'], profile === 'long-notes' ? 20_000 : richer ? 512 : 256),
  };
}

export async function insertLibrary(runtime, name, count, profile, overrideLimits, batchSize = 100) {
  const batches = [];
  for (let start = 0; start < count; start += batchSize) {
    const saves = Array.from({ length: Math.min(batchSize, count - start) }, (_, n) => fixture(start + n, profile));
    const measured = await runtime.call(name, 'write', { saves, limits: overrideLimits });
    batches.push(measured);
    if (!measured.result.ok) break;
  }
  return batches;
}
