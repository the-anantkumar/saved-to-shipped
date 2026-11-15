// Synthetic product flow on loopback. No real identity or provider is used.
// From hosted/: build, build:client, then node tests/product-flow.mjs.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startFixture } from './browser-fixture.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const fixture = await startFixture({ mode: 'uat' });
let browser;
const errors = [], requests = [], checks = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
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
const paidRequests = () => requests.filter(value => ['/api/retrieve/start', '/api/classify-ai'].includes(value.path));

try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ path: new URL(request.url()).pathname, method: request.method(),
    ...(request.method() === 'POST' && request.headers()['content-type']?.includes('application/json') ? { data: request.postDataJSON() } : {}) }));
  const member = name => page.locator('[data-action="hosted-account"]').filter({ hasText: `Synthetic ${name}` }).waitFor();
  const nav = name => page.locator(`#sidebar [data-view="${name}"]`).click();
  const openWeek = async () => { await nav('backlog'); await page.locator('[data-view="week"]').click(); };
  const closeModal = () => page.locator('#modal').waitFor({ state: 'hidden' });
  const choose = async name => {
    await page.locator('#uat-person').selectOption(name);
    await page.locator('#uat-controls').getByRole('button', { name: 'Use account', exact: true }).click();
    await member(name);
  };

  await page.goto(fixture.url);
  await member('alice');
  await page.getByRole('heading', { name: 'Start with your saved posts.', exact: true }).waitFor();
  assert.equal(await page.locator('#sidebar [data-view="focus"]').count(), 0);
  await page.locator('[data-action="settings"]').click();
  await page.locator('#f-apify_token').fill('synthetic-apify-key');
  await page.locator('#f-openai_key').fill('synthetic-openai-key');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await closeModal();
  const csv = 'SavedItem,CreatedTime\n' + Array.from({ length: 32 }, (_, index) =>
    `https://www.linkedin.com/feed/update/urn:li:activity:910000000000000${String(index).padStart(3, '0')},${index === 31 ? '2026-2-09' : new Date(Date.UTC(2026, 9, index + 1)).toISOString().slice(0, 10)}`).join('\n');
  await page.locator('#sidebar [data-action="import"]').click();
  await page.locator('#hosted-archive-file').setInputFiles({ name: 'Saved_Items.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.locator('[data-action="hosted-import-review"]').click();
  await page.locator('[data-action="hosted-import-confirm"]').click();
  await closeModal();
  await page.waitForFunction(() => state.items.length === 32);
  await page.goto(`${fixture.url}#focus?project=unrelated&q=missing`); await member('alice');
  await page.getByRole('button', { name: 'Choose from Saves', exact: true }).waitFor();
  assert.equal(await page.locator('[data-focus-kind]').count(), 0, 'Link-only imports should not offer empty continuation cards');
  assert.match(await page.locator('.empty').innerText(), /source text or a personal note/);
  await mkdir('.local/product-flow', { recursive: true });
  await page.locator('#theme-mode').selectOption('dark');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: '.local/product-flow/today-link-only-dark-mobile.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Choose from Saves', exact: true }).click();
  assert.equal(await page.locator('#search').inputValue(), '');
  assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.save-open').count(), 25, 'The first full page of imported saves is visible');
  assert.equal(await page.evaluate(() => projectFilter), '');
  assert.equal(await page.evaluate(() => location.hash), '#inbox');
  await page.setViewportSize({ width: 1440, height: 1000 });
  assert.equal(paidRequests().length, 0);
  passed('First import leads from Today to unfiltered Saves without empty continuation cards or paid work');

  const alice = await identity('alice');
  const imported = (await request('/api/items?limit=50', alice)).items.sort((a, b) => a.saved_at.localeCompare(b.saved_at));
  const fixtures = [
    { title: 'Synthetic learning continuation', kind: 'learning', content: 'Synthetic first source paragraph.\n\nSynthetic second source paragraph.',
      note: 'sharedneedle: synthetic learning takeaway.', new_project_name: 'Learning practices' },
    { title: 'Synthetic active project', kind: 'project', content: 'Synthetic project source.', note: 'sharedneedle: synthetic project question.',
      new_project_name: 'Weekend builds', status: 'doing', next_action: 'Compare two synthetic query plans.', definition_of_done: 'Save both plans.', effort_hours: 0.25 },
    { title: 'Synthetic shipping experience', kind: 'experience', content: 'Synthetic shipping story.', note: 'sharedneedle: synthetic experience note.',
      new_project_name: 'Shipping stories' },
  ];
  const items = [];
  for (const [index, edit] of fixtures.entries()) {
    const result = await request('/api/item', { ...alice, data: { id: imported[index].id, expected_revision: imported[index].revision, ...edit } });
    items.push(result.item);
    if (index === 0) {
      await page.goto(`${fixture.url}#focus`); await page.reload(); await member('alice');
      await page.locator('[data-focus-kind="reading"]').waitFor();
      assert.equal(await page.locator('[data-focus-kind="project"]').count(), 0);
      assert.equal(await page.locator('.focus-grid.single').count(), 1);
      await page.getByRole('button', { name: 'Choose something else from Saves', exact: true }).waitFor();
      await page.locator('#focus-minutes').selectOption('5');
      assert.equal(await page.locator('#focus-minutes').inputValue(), '5');
    }
  }
  const [learning, project, experience] = items;
  await page.reload(); await member('alice');
  await openWeek();
  await page.locator('#hours').fill('2.25');
  await page.locator('#hours').press('Tab');
  await page.waitForFunction(() => state.weekly_hours === 2.25);
  await page.reload(); await member('alice');
  assert.equal(await page.locator('#hours').inputValue(), '2.25');
  assert.match(await page.locator('.week-note').innerText(), /suggest/);
  await choose('bob');
  await openWeek();
  const bobDefault = await page.locator('#hours').inputValue();
  assert.notEqual(bobDefault, '2.25');
  await page.locator('#hours').fill('0.25'); await page.locator('#hours').press('Tab');
  await page.waitForFunction(() => state.weekly_hours === 0.25);
  await page.reload(); await member('bob');
  assert.equal(await page.locator('#hours').inputValue(), '0.25');
  await page.locator('#hours').fill('168'); await page.locator('#hours').press('Tab');
  await page.waitForFunction(() => state.weekly_hours === 168);
  await choose('alice');
  await openWeek();
  assert.equal(await page.locator('#hours').inputValue(), '2.25');
  await choose('bob');
  await openWeek();
  assert.equal(await page.locator('#hours').inputValue(), '168');
  await choose('alice');
  await openWeek();
  passed('Weekly suggestions persist each account’s budget through reload/switch, including 0.25 and 168 hours');

  await nav('learning');
  await page.locator('.heading [data-action="reading-new-topic"]').click();
  await page.locator('#f-name').fill('Empty synthetic learning topic');
  await page.getByRole('button', { name: 'Create topic', exact: true }).click(); await closeModal();
  await page.locator('.reading-topics button').filter({ hasText: 'Empty synthetic learning topic' }).waitFor();
  await page.getByRole('button', { name: 'Find existing saves', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => state.projects.find(group => group.name === 'Empty synthetic learning topic').kind), 'learning');
  await page.reload(); await member('alice');
  await page.locator('.reading-topics button').filter({ hasText: 'Empty synthetic learning topic' }).waitFor();
  await nav('experiences');
  assert.equal(await page.locator('#reading-topic-select option').filter({ hasText: 'Empty synthetic learning topic' }).count(), 0);
  await page.locator('.heading [data-action="reading-new-topic"]').click();
  await page.locator('#f-name').fill('Empty synthetic experience section');
  await page.getByRole('button', { name: 'Create section', exact: true }).click(); await closeModal();
  await page.locator('.reading-topics button').filter({ hasText: 'Empty synthetic experience section' }).waitFor();
  assert.equal(await page.evaluate(() => state.projects.find(group => group.name === 'Empty synthetic experience section').kind), 'experience');
  await nav('backlog');
  assert.equal(await page.locator('#board-project option').filter({ hasText: 'Empty synthetic' }).count(), 0);
  const legacyEmpty = await request('/api/project', { ...alice, data: { name: 'Legacy empty project' } });
  const legacyMixed = await request('/api/project', { ...alice, data: { name: 'Legacy mixed section' } });
  for (const item of [learning, project]) await request('/api/item', { ...alice, data: { id: item.id, expected_revision: item.revision, project_id: legacyMixed.id } });
  await page.reload(); await member('alice');
  assert.equal(await page.locator(`#board-project option[value="${legacyEmpty.id}"]`).count(), 1);
  await nav('learning');
  await page.locator(`.reading-row [data-item="${learning.id}"]`).waitFor();
  await page.locator(`.reading-row [data-action="reading-queue"][data-id="${learning.id}"]`).click();
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.reading?.queued, learning.id);
  await page.locator(`.reading-row [data-item="${learning.id}"]`).click();
  await page.locator('#reading-body').waitFor({ state: 'attached' });
  assert.deepEqual(await page.locator('#reading-body > p').allTextContents(), learning.content.split('\n\n'));
  await page.locator('.reader-actions [data-action="notes"]').click();
  assert.equal(await page.locator('#f-note').inputValue(), learning.note);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.locator('[data-action="reading-organize"]').click();
  assert.equal(await page.locator('#f-project_id').inputValue(), legacyMixed.id);
  assert.equal(await page.locator('#f-project_id option').filter({ hasText: 'Empty synthetic learning topic' }).count(), 1);
  assert.equal(await page.locator('#f-project_id option').filter({ hasText: 'Empty synthetic experience section' }).count(), 0);
  await page.locator('#f-kind').selectOption('experience');
  assert.equal(await page.locator('#f-project_id').inputValue(), legacyMixed.id);
  assert.equal(await page.locator('#f-project_id option').filter({ hasText: 'Empty synthetic experience section' }).count(), 1);
  assert.equal(await page.locator('#f-project_id option').filter({ hasText: 'Empty synthetic learning topic' }).count(), 0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  passed('Empty typed sections survive reload in their own spaces; legacy empty/mixed groups remain usable and queue-reader text/notes stay intact');

  await page.evaluate(async id => { await changeReading(id, { progress: 40 }); }, learning.id);
  await page.goto(fixture.url); await member('alice');
  await page.getByRole('heading', { name: 'One useful thing today.', exact: true }).waitFor();
  await page.locator('[data-focus-kind="reading"]').getByRole('button', { name: 'Continue reading' }).waitFor();
  assert.match(await page.locator('[data-focus-kind="reading"]').innerText(), /You were \d+% through/);
  assert.match(await page.locator('[data-focus-kind="project"]').innerText(), /already have this in progress/);
  assert.match(await page.locator('[data-focus-kind="project"]').innerText(), /Compare two synthetic query plans/);
  await page.locator('#focus-minutes').selectOption('15');
  assert.equal(await page.locator('#focus-minutes').inputValue(), '15');
  await page.locator('#theme-mode').selectOption('dark');
  await mkdir('.local/product-flow', { recursive: true });
  await page.screenshot({ path: '.local/product-flow/today-dark-desktop.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: '.local/product-flow/today-dark-mobile.png', fullPage: true, animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  passed('Today resumes the unfinished read and active project on return, with time choices and dark/mobile layouts');

  await page.goto(`${fixture.url}#inbox?project=${encodeURIComponent(legacyMixed.id)}`); await member('alice');
  await page.locator('#search').fill('sharedneedle');
  await page.waitForFunction(() => document.querySelectorAll('.save-open').length === 2);
  assert.equal(new URLSearchParams((await page.evaluate(() => location.hash)).split('?')[1]).get('project'), legacyMixed.id);
  await page.reload(); await member('alice');
  await page.waitForFunction(() => document.querySelectorAll('.save-open').length === 2);
  await page.locator('.topbar [data-action="global-find"]').click();
  assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#search').fill('sharedneedle');
  await page.waitForFunction(() => document.querySelectorAll('.save-open').length === 3);
  for (const item of [learning, project, experience]) assert.equal(await page.locator(`.save-open[data-item="${item.id}"]`).count(), 1);
  await page.reload(); await member('alice');
  await page.waitForFunction(() => document.querySelectorAll('.save-open').length === 3);
  assert.equal(await page.locator('#search').inputValue(), 'sharedneedle');
  passed('Global Find searches notes across all spaces; global and section-scoped queries survive reload');

  await page.locator('#search').fill('');
  await page.locator('[data-action="retrieve"]').first().click();
  const choices = page.locator('[name="retrieval_id"]');
  assert.equal(await choices.count(), 29);
  const selection = await page.locator('.retrieval-choice').evaluateAll(rows => rows.map(row => ({
    id: row.querySelector('input').value, url: row.querySelector('a').getAttribute('href'), text: row.innerText })));
  const expectedLatest = imported.filter(item => !items.some(readable => readable.id === item.id))
    .sort((a, b) => Date.parse(b.saved_at) - Date.parse(a.saved_at) || a.id.localeCompare(b.id));
  assert.deepEqual(selection.map(value => value.id), expectedLatest.map(value => value.id));
  assert.deepEqual(selection.map(value => value.url), expectedLatest.map(value => value.url));
  assert.ok(selection.every(value => /Saved /.test(value.text)));
  assert.equal(await page.locator('[name="retrieval_id"]:checked').count(), 10);
  await page.locator('#f-limit').selectOption('25');
  assert.equal(await page.locator('[name="retrieval_id"]:checked').count(), 25);
  await choices.nth(25).click();
  assert.equal(await choices.nth(25).isChecked(), false);
  assert.equal(await page.locator('[name="retrieval_id"]:checked').count(), 25);
  for (const id of await page.locator('[name="retrieval_id"]:checked').evaluateAll(inputs => inputs.map(input => input.value))) {
    await page.locator(`[name="retrieval_id"][value="${id}"]`).uncheck();
  }
  await choices.first().check(); await choices.last().check();
  const selectedIds = [selection[0].id, selection.at(-1).id];
  await page.locator('#f-max_charge').fill('0.73');
  await page.getByRole('button', { name: 'Retrieve selected posts', exact: true }).click();
  assert.equal(paidRequests().length, 0);
  assert.equal(await page.locator('#retrieval-charge-approval').evaluate(input => input.validity.valueMissing), true);
  await page.screenshot({ path: '.local/product-flow/retrieval-selection-dark.png', fullPage: true, animations: 'disabled' });
  await page.locator('#retrieval-charge-approval').check();
  const submitted = page.waitForRequest(request => new URL(request.url()).pathname === '/api/retrieve/start');
  await page.getByRole('button', { name: 'Retrieve selected posts', exact: true }).click();
  const payload = (await submitted).postDataJSON();
  assert.deepEqual(payload.ids, selectedIds);
  assert.equal(payload.limit, 2); assert.equal(payload.max_charge, 0.73);
  await closeModal();
  assert.equal(paidRequests().length, 1);
  assert.equal(requests.some(value => value.path === '/api/classify-ai'), false);
  passed('Retrieval previews latest saved dates/original URLs, caps selection at 25 and sends only approved exact IDs/charge cap');

  const betaFixture = await startFixture({ mode: 'uat', variables: { WORKSPACE_ITEM_LIMIT: '2' } });
  try {
    const betaContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const betaPage = await betaContext.newPage();
    const betaRequests = [];
    betaPage.on('pageerror', error => errors.push(error.message));
    betaPage.on('request', request => betaRequests.push(new URL(request.url()).pathname));
    await betaPage.goto(betaFixture.url);
    await betaPage.locator('[data-action="hosted-account"]').filter({ hasText: 'Synthetic alice' }).waitFor();
    assert.match(await betaPage.locator('#sidebar .local-label').innerText(), /Free beta/);
    assert.equal(await betaPage.locator('[data-action="hosted-billing"], [data-billing], .plan-usage').count(), 0);
    assert.equal(await betaPage.evaluate(() => typeof hosted.billingDialog), 'undefined');
    await betaPage.locator('[data-action="hosted-account"]').click();
    assert.match(await betaPage.locator('#modal').innerText(), /No subscription or trial expiry/);
    assert.match(await betaPage.locator('#modal').innerText(), /your own provider accounts/);
    assert.equal(await betaPage.getByRole('button', { name: /checkout|upgrade|renewal|plan and points/i }).count(), 0);
    await betaPage.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const capture = async number => {
      await betaPage.locator('[data-action="capture"]').click();
      await betaPage.locator('#f-url').fill(`https://www.linkedin.com/posts/synthetic-beta-${number}`);
      await betaPage.locator('#f-title').fill(`Synthetic beta save ${number}`);
      await betaPage.locator('#f-content').fill('Keep one small experiment from this synthetic post.');
      await betaPage.getByRole('button', { name: 'Add to inbox', exact: true }).click();
    };
    for (const number of [1, 2]) {
      await capture(number);
      await betaPage.locator('#modal').waitFor({ state: 'hidden' });
    }
    await betaPage.waitForFunction(() => state.items.length === 2);
    assert.match(await betaPage.locator('.usage-label').innerText(), /2 \/ 2 saves/);
    await capture(3);
    await betaPage.locator('#form-error:not(.hidden)').waitFor();
    assert.match(await betaPage.locator('#form-error').innerText(), /limit.*reached|reached.*limit/i);
    assert.equal(await betaPage.locator('#f-title').inputValue(), 'Synthetic beta save 3');
    assert.equal(await betaPage.evaluate(() => state.items.length), 2);
    assert.equal(await betaPage.getByRole('button', { name: /checkout|upgrade|renewal/i }).count(), 0);
    await betaPage.getByRole('button', { name: 'Cancel', exact: true }).click();
    await betaPage.locator('[data-action="hosted-account"]').click();
    assert.match(await betaPage.locator('[aria-label="Workspace usage"]').innerText(), /2 \/ 2 saves/);
    await betaPage.getByRole('button', { name: 'Close dialog', exact: true }).click();
    const download = betaPage.waitForEvent('download');
    await betaPage.locator('.topbar [data-action="export"]').click();
    assert.equal((await download).suggestedFilename(), 'saved-to-shipped.zip');
    await betaPage.reload();
    await betaPage.locator('[data-action="hosted-account"]').filter({ hasText: 'Synthetic alice' }).waitFor();
    await betaPage.waitForFunction(() => state.items.length === 2);
    assert.equal(betaRequests.some(path => /^\/api\/(?:billing|checkout)(?:\/|$)/.test(path)), false);
    assert.equal(betaRequests.some(path => ['/api/retrieve/start', '/api/classify-ai'].includes(path)), false);
    await betaPage.locator('#theme-mode').selectOption('dark');
    await betaPage.setViewportSize({ width: 390, height: 844 });
    assert.equal(await betaPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    await betaPage.screenshot({ path: '.local/product-flow/free-beta-dark-mobile.png', fullPage: true, animations: 'disabled' });
    await betaContext.close();
  } finally { await betaFixture.close(); }
  passed('Free beta has no payment controls or traffic; technical capacity preserves drafts, existing saves and export');

  assert.deepEqual(errors, []);
  await writeFile('.local/product-flow/report.json', JSON.stringify({ synthetic: true, checks, browserErrors: errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, runtimeErrors: errors.length }));
} finally {
  await browser?.close();
  await fixture.close();
}
