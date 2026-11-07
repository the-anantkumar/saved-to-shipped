// Synthetic signed-identity browser checks. Never uses Google or paid providers.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { syntheticZIP } from '../client/archive.mjs';
import { startFixture } from './browser-fixture.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const fixture = process.env.SAVE2SHIP_E2E_URL ? null : await startFixture();
const url = process.env.SAVE2SHIP_E2E_URL || fixture.url;
const evidence = resolve('.local/e2e');
await mkdir(evidence, { recursive: true });
let browser, page, second;
const errors = [], checks = [], requests = [], networkFailures = [];
function passed(name) { checks.push(name); console.log(`PASS ${name}`); }
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  page.on('requestfailed', request => networkFailures.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) requests.push({ path: new URL(request.url()).pathname, method: request.method() }); });
  const action = name => page.locator(`[data-action="${name}"]`).first();
  const closeModal = () => page.locator('#modal').waitFor({ state: 'hidden' });
  const memberReady = async (target, name) => target.locator('[data-action="hosted-account"]').filter({ hasText: `Synthetic ${name}` }).waitFor();
  const stateItems = () => page.evaluate(() => state.items);
  const fullItem = id => page.evaluate(id => window.Save2ShipHosted.detail(id), id);
  const waitJob = async kind => {
    for (let attempt = 0; attempt < 60; attempt++) {
      const job = await page.evaluate(async kind => { await pollRetrieval(false); return state.retrieval_jobs.find(job => job.kind === kind); }, kind);
      if (job?.status === 'COMPLETED') return job;
      if (['FAILED', 'UNCERTAIN', 'QUOTA_BLOCKED', 'CANCELLED'].includes(job?.status)) throw new Error(`${kind} fixture job stopped: ${job.status}: ${job.error || ''}`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(`${kind} fixture job did not complete`);
  };
  const importFile = async (buffer, restore = false) => {
    if (restore) { await action('hosted-account').click(); await action('hosted-restore').click(); }
    else await action('import').click();
    await page.locator('#hosted-archive-file').setInputFiles({ name: restore ? 'synthetic-backup.zip' : 'synthetic-linkedin.zip', mimeType: 'application/zip', buffer: Buffer.from(buffer) });
    await action(restore ? 'hosted-restore-review' : 'hosted-import-review').click();
    await action('hosted-import-confirm').waitFor();
    await action('hosted-import-confirm').click(); await closeModal();
  };

  const initialResponse = await page.goto(url);
  assert.match(initialResponse.headers()['content-security-policy'] || '', /object-src 'none'/);
  await memberReady(page, 'alice');
  await page.locator('#theme-mode').selectOption('dark');
  assert.equal(await page.evaluate(() => state.items.length), 0);
  assert.equal(requests.filter(request => request.path === '/api/item').length, 0);
  await importFile(syntheticZIP());
  await page.waitForFunction(() => state.items.length === 2);
  assert.equal(requests.filter(request => request.path === '/api/item').length, 0);
  assert.equal(requests.filter(request => ['/api/retrieve/start', '/api/classify-ai'].includes(request.path)).length, 0);
  passed('Browser worker imports only Saved Items and loads metadata without item bodies or paid work');

  await action('settings').click();
  await page.locator('#f-apify_token').fill('synthetic-apify-key');
  await page.locator('#f-openai_key').fill('synthetic-openai-key');
  await page.getByRole('button', { name: 'Save settings', exact: true }).click(); await closeModal();
  await page.waitForFunction(() => state.settings.ai_available && state.settings.extractor_available);
  assert.equal(requests.filter(request => ['/api/retrieve/start', '/api/classify-ai'].includes(request.path)).length, 0);
  await action('retrieve').click();
  assert.equal(await page.locator('#f-limit option').count(), 2);
  await page.getByRole('button', { name: 'Retrieve post content' }).click(); await closeModal();
  await waitJob('retrieval');
  assert.ok((await stateItems()).every(item => item.has_content));
  await action('classify').click(); await action('run-ai').click(); await closeModal();
  await waitJob('classification');
  assert.ok((await stateItems()).every(item => item.kind === 'learning'));
  passed('Settings do not submit work; explicit retrieval and classification finish through durable mocked jobs');

  await page.locator('#sidebar [data-view="learning"]').click();
  const [learning, project] = await stateItems();
  await page.locator(`.reading-row [data-item="${learning.id}"]`).click();
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.reading?.status === 'reading', learning.id);
  const source = (await fullItem(learning.id)).content;
  await page.locator('.reader-actions [data-action="notes"]').click();
  await page.locator('#f-note').fill('Alice private takeaway: reproduce the SQLite experiment.');
  await page.getByRole('button', { name: 'Save context', exact: true }).click(); await closeModal();
  assert.equal((await fullItem(learning.id)).content, source);
  assert.match((await fullItem(learning.id)).note, /Alice private takeaway/);
  await action('library-back').click();
  await page.locator('#search').fill('private takeaway');
  await page.waitForFunction(() => document.querySelectorAll('.reading-row').length === 1);
  await page.reload(); await memberReady(page, 'alice');
  await page.waitForFunction(() => document.querySelectorAll('.reading-row').length === 1);
  assert.equal(await page.locator('#search').inputValue(), 'private takeaway');
  await page.locator(`.reading-row [data-item="${learning.id}"]`).click();
  passed('Note-only search finds the same save after reload without hydrating its source');
  await action('reading-status').click();
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.reading?.status === 'read', learning.id);
  await page.screenshot({ path: resolve(evidence, 'learning-dark-desktop.png'), fullPage: true });
  await action('library-back').click();
  await page.locator('#search').fill('');
  await page.locator(`.reading-row [data-item="${project.id}"]`).click();
  await action('reading-organize').click();
  await page.locator('#f-kind').selectOption('project');
  await page.locator('#f-project_id').selectOption('__new_section__');
  await page.locator('#f-new_project_name').fill('SQLite prototype');
  await page.locator('#f-title').fill('Build a tiny SQLite prototype');
  await page.getByRole('button', { name: 'Save organization', exact: true }).click(); await closeModal();
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.kind === 'project', project.id);
  await page.locator('#sidebar [data-view="backlog"]').focus(); await page.keyboard.press('Enter');
  const move = page.locator(`[data-move-id="${project.id}"]`);
  await move.focus(); assert.equal(await move.getAttribute('aria-label'), 'Move Build a tiny SQLite prototype');
  await move.selectOption('ready');
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.status === 'ready', project.id);
  await page.locator(`[data-move-id="${project.id}"]`).selectOption('doing');
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.status === 'doing', project.id);
  const handle = await page.locator(`[data-tile-id="${project.id}"] .drag-handle`).boundingBox();
  const destination = await page.locator('[data-drop-status="done"] .lane-body').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(destination.x + destination.width / 2, destination.y + 80, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(id => state.items.find(item => item.id === id)?.status === 'done', project.id);
  await page.waitForFunction(() => !suppressTileClick);
  assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
  passed('Learning progress and notes stay independent; inline project creation, keyboard navigation and tile drag work');

  await page.locator('#sidebar [data-view="inbox"]').click();
  await action('capture').click();
  await page.locator('#f-url').fill('https://www.linkedin.com/feed/update/urn:li:activity:900000000000000003');
  await page.locator('#f-title').fill('A useful engineering experience');
  await page.locator('#f-content').fill('A synthetic story about learning from a small production experiment.');
  await page.getByRole('button', { name: 'Add to inbox', exact: true }).click(); await closeModal();
  await page.waitForFunction(() => state.items.length === 3);
  const experience = (await stateItems()).find(item => item.title === 'A useful engineering experience');
  await page.locator(`.save-open[data-item="${experience.id}"]`).click();
  await page.getByText('More details', { exact: true }).click();
  await page.locator('#f-kind').selectOption('experience');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await closeModal();
  await page.locator('#sidebar [data-view="experiences"]').click();
  assert.equal(await page.locator('.reading-row').count(), 1);
  await page.locator('#theme-mode').selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.screenshot({ path: resolve(evidence, 'experiences-dark-desktop.png'), fullPage: true });
  passed('Experiences remain a distinct reading space and dark mode applies');

  // A second browser changes the same save while the first browser holds a draft.
  await page.locator('#sidebar [data-view="inbox"]').click();
  await page.locator(`[data-action="notes"][data-id="${learning.id}"]`).click();
  await page.locator('#f-note').fill('Draft kept during a conflict.');
  const returning = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  second = await returning.newPage(); second.on('pageerror', error => errors.push(error.message));
  await second.goto(url); await memberReady(second, 'alice');
  await second.waitForFunction(() => state.items.length === 3);
  await second.locator('#sidebar [data-view="inbox"]').click();
  await second.locator(`[data-action="notes"][data-id="${learning.id}"]`).click();
  assert.match(await second.locator('#f-note').inputValue(), /Alice private takeaway/);
  await second.locator('#f-note').fill('Alice private takeaway: confirmed from a second browser.');
  await second.getByRole('button', { name: 'Save context', exact: true }).click();
  await second.locator('#modal').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Save context', exact: true }).click();
  await page.locator('#form-error:not(.hidden)').waitFor();
  assert.equal(await page.locator('#f-note').inputValue(), 'Draft kept during a conflict.');
  assert.match(await page.locator('#form-error').innerText(), /changed in another tab/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await second.locator('#sidebar [data-view="learning"]').click();
  await second.locator('[data-action="reading-filter"][data-value="all"]').click();
  assert.equal(await second.locator('.reading-row').count(), 1);
  assert.equal(await second.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await second.screenshot({ path: resolve(evidence, 'learning-dark-mobile.png'), fullPage: true });
  await returning.close();
  await page.bringToFront();
  // Headless Chromium can leave both contexts focused. Exercise the same return
  // event explicitly; headed acceptance checks also cover native tab switching.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(id => !state.items.find(item => item.id === id)?.note?.includes('reproduce'), learning.id);
  await page.locator(`[data-action="notes"][data-id="${learning.id}"]`).click();
  await page.locator('#modal').waitFor({ state: 'visible' });
  assert.match(await page.locator('#f-note').inputValue(), /confirmed from a second browser/);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  passed('A new browser resumes saved work; mobile layout fits and conflicts preserve the unsaved draft');

  const downloadPromise = page.waitForEvent('download'); await action('export').click();
  const download = await downloadPromise; const backup = await readFile(await download.path());
  const exported = JSON.parse(strFromU8(unzipSync(backup)['backlog.json']));
  assert.equal(exported.version, 1); assert.equal(exported.items.length, 3);
  assert.equal(exported.items.find(item => item.id === learning.id).reading.status, 'read');
  assert.match(exported.items.find(item => item.id === learning.id).note, /second browser/);
  assert.doesNotMatch(JSON.stringify(exported), /synthetic-apify-key|synthetic-openai-key/);
  await page.evaluate(() => window.__fixtureSignIn('bob')); await memberReady(page, 'bob');
  assert.equal(await page.evaluate(() => state.items.length), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /Alice private takeaway|SQLite prototype/);
  await importFile(backup, true); await page.waitForFunction(() => state.items.length === 3);
  assert.equal((await fullItem(learning.id)).reading.status, 'read');
  assert.match((await fullItem(learning.id)).note, /second browser/);
  assert.equal(await page.evaluate(() => state.settings.ai_available || state.settings.extractor_available), false);
  // Repeat restore after deleting an item must be a new operation, not an old receipt replay.
  await page.locator(`[data-action="notes"][data-id="${experience.id}"]`).click();
  await action('hosted-delete-item').click(); await action('hosted-confirm-delete-item').click(); await closeModal();
  await page.waitForFunction(() => state.items.length === 2);
  await importFile(backup, true); await page.waitForFunction(() => state.items.length === 3);
  await action('hosted-account').click(); await action('hosted-signout').click();
  await page.locator('#hosted-sign-in').waitFor();
  assert.equal(await page.evaluate(() => state.items.length), 0);
  assert.doesNotMatch(await page.locator('body').innerText(), /Alice private takeaway|SQLite prototype/);
  await page.screenshot({ path: resolve(evidence, 'signed-out.png'), fullPage: true });
  passed('Authenticated backup export/restore preserves annotations without keys; deletion recovery and sign-out clear caches');

  // Existing members re-enter a full beta; a third identity gets a capacity screen.
  await page.evaluate(() => window.__fixtureSignIn('charlie'));
  await page.getByRole('heading', { name: 'A little room is opening soon.' }).waitFor();
  assert.equal(await page.evaluate(() => state.items.length), 0);
  await page.screenshot({ path: resolve(evidence, 'beta-full.png'), fullPage: true });
  await page.evaluate(() => window.__fixtureSignIn('alice')); await memberReady(page, 'alice');
  await page.waitForFunction(() => state.items.length === 3);
  assert.deepEqual(errors, []);
  passed('Full beta rejects a new identity while an existing member returns; no browser runtime errors');
  await page.evaluate(() => window.__fixtureSignIn('bob')); await memberReady(page, 'bob');
  let deletionAttempts = 0;
  await page.route('**/api/account/delete', async route => {
    deletionAttempts++;
    assert.equal(route.request().headers()['x-workspace-session'], undefined);
    if (deletionAttempts === 1) {
      // Put the real fixture in the server's frozen deletion state, then model a
      // failed external abort. API tests exercise the provider failure itself.
      const member = await (await fetch(new URL('/__fixture__/registry', url), { method: 'POST', body: JSON.stringify({ operation: 'lookup', input: { uid: 'synthetic-bob' } }) })).json();
      assert.equal(member.ok, true);
      const access = { uid: member.data.uid, generation: member.data.generation };
      const frozen = await (await fetch(new URL('/__fixture__/workspace', url), { method: 'POST', body: JSON.stringify({ access, operation: 'delete.prepare' }) })).json();
      assert.equal(frozen.ok, true);
      const deleting = await (await fetch(new URL('/__fixture__/registry', url), { method: 'POST', body: JSON.stringify({ operation: 'deleting', input: access }) })).json();
      assert.equal(deleting.ok, true);
    }
    if (deletionAttempts < 3) {
      if (deletionAttempts === 2) assert.deepEqual(route.request().postDataJSON(), { apify_token: 'synthetic-replacement-token' });
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: 'ACCOUNT_DELETING', error: 'Synthetic provider abort is still pending. You can retry safely.' }) });
    } else await route.continue();
  });
  await action('hosted-account').click(); await action('hosted-delete').click();
  await action('hosted-confirm-delete').click();
  await page.getByRole('heading', { name: 'Deletion needs one more step.' }).waitFor();
  assert.equal(await page.evaluate(() => state.items.length), 0);
  // Re-entry must use the same recovery surface when /api/session is forbidden.
  await page.evaluate(() => window.__fixtureSignIn('alice')); await memberReady(page, 'alice');
  await page.evaluate(() => window.__fixtureSignIn('bob'));
  await page.getByRole('heading', { name: 'Deletion needs one more step.' }).waitFor();
  const replacement = page.locator('#hosted-replacement-apify-token');
  assert.equal(await replacement.getAttribute('type'), 'password');
  await replacement.fill('synthetic-replacement-token');
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  await page.getByText('Synthetic provider abort is still pending. You can retry safely.', { exact: true }).waitFor();
  assert.equal(await replacement.inputValue(), '');
  assert.doesNotMatch(await page.locator('body').innerText(), /Alice private takeaway|synthetic-replacement-token/);
  await page.screenshot({ path: resolve(evidence, 'deletion-paused.png'), fullPage: true });
  await replacement.fill('synthetic-replacement-token');
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  // This fixture has no retained provider run, so the actual API correctly rejects
  // an unnecessary replacement key. Its safe error must leave a blank retry form.
  await page.getByText('No provider key is needed for this deletion.', { exact: true }).waitFor();
  assert.equal(await replacement.inputValue(), '');
  await page.getByRole('button', { name: 'Retry deletion', exact: true }).click();
  await page.getByRole('heading', { name: 'Your workspace was deleted.' }).waitFor();
  assert.equal(deletionAttempts, 4);
  assert.equal(await page.evaluate(() => state.items.length), 0);
  await page.evaluate(() => window.__fixtureSignIn('charlie')); await memberReady(page, 'charlie');
  assert.equal(await page.evaluate(() => state.items.length), 0);
  assert.deepEqual(errors, []);
  passed('Paused deletion survives re-entry, clears replacement keys after attempts, retries safely and releases the seat');
  await writeFile(resolve(evidence, 'report.json'), JSON.stringify({ synthetic: true, checks, browserErrors: errors, screenshots: ['learning-dark-desktop.png', 'experiences-dark-desktop.png', 'learning-dark-mobile.png', 'signed-out.png', 'beta-full.png', 'deletion-paused.png'] }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: resolve(evidence, 'failure.png'), fullPage: true }).catch(() => {});
    console.error('Synthetic browser failure:', JSON.stringify({ errors, networkFailures, requests: requests.slice(-10), body: (await page.locator('body').innerText()).slice(0, 6000) }));
  }
  if (second && !second.isClosed()) console.error('Second synthetic browser:', (await second.locator('body').innerText()).slice(0, 6000));
  throw error;
} finally {
  await browser?.close(); await fixture?.close();
}
