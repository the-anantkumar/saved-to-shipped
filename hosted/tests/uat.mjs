// Disposable human UAT. Generated identities and provider mocks stay on loopback.
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startFixture } from './browser-fixture.mjs';

async function seed(fixture) {
  const request = async (path, { token, capability, data } = {}) => {
    const response = await fetch(new URL(path, fixture.url), {
      method: data === undefined ? 'GET' : 'POST',
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(capability ? { 'X-Workspace-Session': capability } : {}),
        ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(data === undefined ? {} : { body: JSON.stringify({ request_id: randomUUID(), ...data }) }),
    });
    const body = await response.json();
    if (!response.ok || body.ok === false) throw new Error(`Synthetic UAT setup failed: ${path}: ${body.code || response.status}`);
    return body;
  };
  const member = async name => {
    const { token } = await request(`/__fixture__/identity?user=${name}`);
    const session = await request('/api/session', { token });
    return { token, capability: session.workspace_session };
  };
  const alice = await member('alice');
  // Reserve both seats so Charlie consistently demonstrates the full-beta screen.
  await member('bob');
  const saves = [
    { n: 101, title: 'Build a tiny SQLite playground', kind: 'project', section: 'Weekend builds',
      content: 'Synthetic project idea: build a small page that compares a SQLite query before and after an index. Keep the example small enough to finish in one sitting.',
      note: 'Try this with a synthetic table of book recommendations.', next_action: 'Create a sample table and compare one query with and without an index.',
      definition_of_done: 'A runnable example and the measured query plans are in the README.', effort_hours: 1, status: 'ready' },
    { n: 102, title: 'How to read an unfamiliar codebase', kind: 'learning', section: 'Engineering habits',
      content: Array.from({ length: 8 }, (_, i) => `Synthetic learning note ${i + 1}: start with one user action and follow its data through the application. Write down boundaries, inputs and observable results. Run a small example before changing the design. Keep a question list and return to it after each experiment.`).join('\n\n'),
      note: 'My next read. Search for quasarneedle to find this note even after reloading.', status: 'inbox' },
    { n: 103, title: 'What a small release taught the team', kind: 'experience', section: 'Lessons from shipping',
      content: 'A synthetic engineering story: a team released one narrow workflow, watched a few people use it and found the confusing transition. They improved the transition before adding more features. The lesson was to observe actual use and make recovery obvious.',
      note: 'Ask someone to complete one task without guidance before calling a feature ready.', status: 'inbox' },
  ];
  for (const save of saves) {
    const { n, section, kind, status, next_action, definition_of_done, effort_hours, ...source } = save;
    const captured = await request('/api/capture', { ...alice, data: {
      ...source, saved_at: '2026-11-07', url: `https://www.linkedin.com/feed/update/urn:li:activity:900000000000000${n}`,
    } });
    await request('/api/item', { ...alice, data: { id: captured.item.id, expected_revision: captured.item.revision,
      kind, status, new_project_name: section, ...(next_action ? { next_action, definition_of_done, effort_hours } : {}) } });
  }
  await request('/api/settings', { ...alice, data: { apify_token: 'synthetic-apify-key', openai_key: 'synthetic-openai-key', goals: 'Finish one small project and choose useful reading deliberately.' } });
}

export async function startUAT() {
  const fixture = await startFixture({ mode: 'uat' });
  try { await seed(fixture); return fixture; }
  catch (error) { await fixture.close(); throw error; }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const fixture = await startUAT();
  console.log(`\nSynthetic save2ship UAT: ${fixture.url}\nAlice: sample workspace. Bob: empty workspace. Charlie: beta full.\nGoogle and provider requests are mocked. Use synthetic data and dummy keys only.\nStop with Ctrl+C; restart this command for a fresh workspace.\n`);
  let closing = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (closing) return; closing = true;
    await fixture.close(); process.exit(0);
  });
}
