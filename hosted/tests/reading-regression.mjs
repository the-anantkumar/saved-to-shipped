// Focused reader regression. All identities, source text and notes are synthetic.
// Run after build and build:client from hosted/: node tests/reading-regression.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { startUAT } from './uat.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const fixture = await startUAT();
let browser;
const errors = [], requests = [];
const request = async (path, { token, capability, data } = {}) => {
  const response = await fetch(new URL(path, fixture.url), {
    method: data === undefined ? 'GET' : 'POST',
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(capability ? { 'X-Workspace-Session': capability } : {}),
      ...(data === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(data === undefined ? {} : { body: JSON.stringify({ request_id: randomUUID(), ...data }) }),
  });
  const body = await response.json();
  assert.ok(response.ok && body.ok !== false, `Synthetic request failed: ${path}: ${body.code || response.status}`);
  return body;
};
const identity = async name => {
  const { token } = await request(`/__fixture__/identity?user=${name}`);
  const session = await request('/api/session', { token });
  return { token, capability: session.workspace_session };
};

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ path: new URL(request.url()).pathname, method: request.method() }));
  const member = name => page.locator('[data-action="hosted-account"]').filter({ hasText: `Synthetic ${name}` }).waitFor();
  const closeNotes = () => page.getByRole('button', { name: 'Cancel', exact: true }).click();
  const assertNotes = async (note, content) => {
    await page.locator('.reader-actions [data-action="notes"]').click();
    assert.equal(await page.locator('#f-note').inputValue(), note);
    assert.equal(await page.locator('#f-content').inputValue(), content);
    await closeNotes();
  };
  const assertParagraphs = async content => {
    await page.locator('#reading-body').waitFor({ state: 'attached' });
    assert.deepEqual(await page.locator('#reading-body > p').allTextContents(), content.split(/\n\s*\n/));
  };

  await page.goto(fixture.url);
  await member('alice');
  await page.locator('#sidebar [data-view="learning"]').click();
  await page.locator('.reading-row').waitFor();
  const metadata = await page.evaluate(() => state.items.find(item => item.kind === 'learning'));
  assert.equal(Object.hasOwn(metadata, 'content'), false);
  assert.equal(Object.hasOwn(metadata, 'note'), false);
  assert.equal(await page.evaluate(id => hosted.hasDetail(id), metadata.id), false);
  const alice = await identity('alice');
  const detail = await request(`/api/item?id=${encodeURIComponent(metadata.id)}`, alice);
  const original = detail.item || detail;
  assert.equal(original.content.split(/\n\s*\n/).length, 8);

  await page.locator('.reading-row [data-action="reading-queue"]').click();
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.reading?.queued, metadata.id);
  assert.equal(await page.evaluate(id => hosted.hasDetail(id), metadata.id), true);
  await page.locator('.reading-row h2 [data-item]').click();
  await assertParagraphs(original.content);
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.reading?.status === 'reading', metadata.id);
  await assertNotes(original.note, original.content);
  assert.equal(requests.filter(value => value.path === '/api/item' && value.method === 'GET').length, 0,
    'Queueing must synchronize its full response without another browser detail request or reload');
  console.log('PASS Queueing an unopened save renders all source paragraphs and its existing note without reload');

  // Deliberately bypass transport guards to exercise the UI consumer's own
  // superseded/revision checks against full responses containing stale bodies.
  for (const guard of ['superseded', 'revision']) {
    const current = await page.evaluate(async guard => {
      const position = state.items.findIndex(item => item.id === readerId);
      const before = structuredClone(state.items[position]);
      const current = { ...before, content: `Synthetic current ${guard} source.\n\nSecond current paragraph.`,
        note: `Synthetic current ${guard} note.`, revision: before.revision + 1,
        reading: { ...before.reading, status: 'reading', progress: 75 } };
      state.items[position] = current;
      const stale = { ...before, content: 'STALE_SYNTHETIC_SOURCE', note: 'STALE_SYNTHETIC_NOTE',
        revision: guard === 'superseded' ? current.revision + 1 : before.revision,
        reading: { ...before.reading, status: 'reading', progress: 5 } };
      const originalApi = hosted.api;
      hosted.api = (route, ...args) => route === '/api/reading'
        ? Promise.resolve({ item: stale, reading: stale.reading, revision: stale.revision,
          ...(guard === 'superseded' ? { superseded: true } : {}) })
        : originalApi(route, ...args);
      try { await changeReading(current.id, { progress: 5 }); }
      finally { hosted.api = originalApi; }
      render(false);
      return { content: current.content, note: current.note, revision: current.revision };
    }, guard);
    await assertParagraphs(current.content);
    await assertNotes(current.note, current.content);
    assert.equal(await page.evaluate(() => state.items.find(item => item.id === readerId).revision), current.revision);
    assert.equal(await page.evaluate(() => readingState(state.items.find(item => item.id === readerId)).progress), 75);
    console.log(`PASS ${guard} response keeps newer rendered source, notes and reading progress`);
  }

  // Give Bob a save with the same source-derived ID. An epoch guard must stop
  // Alice's delayed full response even when the new account has that item ID.
  const bob = await identity('bob');
  const captured = await request('/api/capture', { ...bob, data: { url: original.url,
    title: 'Bob synthetic reader', content: 'Bob synthetic source.\n\nBob second paragraph.', note: 'Bob synthetic private note.' } });
  const { item: bobItem } = await request('/api/item', { ...bob, data: {
    id: captured.item.id, expected_revision: captured.item.revision, kind: 'learning' } });
  assert.equal(bobItem.id, original.id);
  await page.reload();
  await member('alice');
  await page.evaluate(id => {
    const originalApi = hosted.api;
    let held = false;
    window.__restoreReadingApi = () => { hosted.api = originalApi; };
    hosted.api = (route, ...args) => {
      if (route !== '/api/reading' || held) return originalApi(route, ...args);
      held = true;
      return new Promise(resolve => {
        window.__releaseReadingReply = () => resolve({ item: { id, kind: 'learning', title: 'Alice stale synthetic reader',
          content: 'ALICE_STALE_SYNTHETIC_SOURCE', note: 'ALICE_STALE_SYNTHETIC_NOTE', revision: 10000 },
          reading: { status: 'reading', progress: 99, queued: true }, revision: 10000 });
      });
    };
    window.__pendingReadingReply = changeReading(id, { queued: false });
  }, original.id);
  await page.waitForFunction(() => typeof window.__releaseReadingReply === 'function');
  await page.locator('#uat-person').selectOption('bob');
  await page.locator('#uat-controls').getByRole('button', { name: 'Use account', exact: true }).click();
  await member('bob');
  await page.locator('#sidebar [data-view="learning"]').click();
  await page.locator('.reading-row h2 [data-item]').click();
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.reading?.status === 'reading', bobItem.id);
  await page.evaluate(async () => {
    window.__releaseReadingReply();
    await window.__pendingReadingReply;
    window.__restoreReadingApi();
    render(false);
  });
  await assertParagraphs(bobItem.content);
  await assertNotes(bobItem.note, bobItem.content);
  assert.equal(await page.getByRole('heading', { name: bobItem.title, exact: true }).count(), 1);
  assert.doesNotMatch(await page.locator('body').innerText(), /ALICE_STALE_SYNTHETIC/);
  console.log('PASS Switching accounts discards a delayed full reading response for a matching save ID');
  assert.deepEqual(errors, []);
  assert.equal(requests.some(value => ['/api/retrieve/start', '/api/classify-ai'].includes(value.path)), false);
  console.log('PASS No browser runtime errors or paid-provider submissions');
} finally {
  await browser?.close();
  await fixture.close();
}
