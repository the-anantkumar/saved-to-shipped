// Shared local UI behavior with an isolated synthetic workspace. No provider calls.
// Run from hosted/: node tests/polish-interactions.mjs
// Set SAVE2SHIP_TEST_PYTHON to a Python 3.10+ interpreter if python3 is older.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const root = resolve('..');
const directory = await mkdtemp(join(tmpdir(), 'save2ship-polish-'));
const server = spawn(process.env.SAVE2SHIP_TEST_PYTHON || 'python3', ['-m', 'saved_to_shipped', '--port', '0', '--state', join(directory, 'workspace.json'), '--no-browser'],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
const checks = [], errors = [], providerCalls = [];
const pass = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  const url = await new Promise((resolveURL, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('Synthetic local server did not start. Check SAVE2SHIP_TEST_PYTHON.')), 10000);
    server.once('error', error => { clearTimeout(timer); reject(error); });
    server.once('exit', code => { clearTimeout(timer); reject(new Error(`Synthetic local server exited: ${code}`)); });
    server.stdout.on('data', chunk => {
      output += chunk;
      const found = output.match(/Saved to Shipped: (http:\/\/127\.0\.0\.1:\d+\/)/);
      if (found) { clearTimeout(timer); resolveURL(found[1]); }
    });
  });
  browser = await chromium.launch({headless: true});
  const page = await browser.newPage({viewport: {width: 1280, height: 900}});
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    if (['/api/retrieve/start', '/api/classify-ai'].includes(new URL(request.url()).pathname)) providerCalls.push(request.url());
  });
  await page.goto(url);
  await page.getByRole('heading', {name: 'Start with your saved posts.', exact: true}).waitFor();
  assert.equal(await page.locator('.welcome-space').count(), 3);
  await page.getByRole('link', {name: /Take a look around first/}).click();
  await page.locator('#sidebar [data-view="learning"]').click();
  await page.locator('.reading-topics > button').filter({hasText: 'Learning lab'}).click();
  await page.locator('h1').focus();
  await page.keyboard.press('/');
  await page.locator('#search:focus').waitFor();
  assert.equal(await page.evaluate(() => location.hash), '#inbox');
  assert.equal(await page.locator('[data-filter="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.evaluate(() => projectFilter), '');
  pass('First use explains each space and keyboard Find opens the full collection');

  const trigger = page.locator('.save-row [data-action="notes"]').first();
  const itemID = await trigger.getAttribute('data-id');
  await trigger.click();
  const note = page.locator('#f-note'), source = page.locator('#f-content');
  const originalNote = await note.inputValue(), originalSource = await source.inputValue();
  await note.fill('An unsaved synthetic takeaway.');
  await note.press('Escape');
  await page.locator('#discard-prompt:not(.hidden)').waitFor();
  assert.equal(await note.inputValue(), 'An unsaved synthetic takeaway.');
  assert.equal(await page.locator('[data-action="keep-editing"]').evaluate(el => el === document.activeElement), true);
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  assert.equal(await note.evaluate(el => el === document.activeElement), true);
  await page.mouse.click(2, 2);
  await page.locator('#discard-prompt:not(.hidden)').waitFor();
  await page.getByRole('button', {name: 'Discard changes', exact: true}).click();
  await page.locator('#modal').waitFor({state: 'hidden'});
  await page.locator(`.save-row [data-action="notes"][data-id="${itemID}"]`).click();
  assert.equal(await note.inputValue(), originalNote);
  pass('Escape and backdrop preserve dirty notes until explicit discard');

  await page.locator('#modal summary').filter({hasText: 'Post text'}).click();
  await source.fill(originalSource + '\n\nSynthetic source correction.');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.locator('#discard-prompt:not(.hidden)').waitFor();
  await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  await note.fill('A saved synthetic takeaway.');
  await page.route('**/api/item?*', route => route.fulfill({status: 409, contentType: 'application/json', body: JSON.stringify({error: 'Synthetic conflict. Your edits are still here.'})}));
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.locator('#form-error:not(.hidden)').waitFor();
  assert.equal(await note.inputValue(), 'A saved synthetic takeaway.');
  assert.equal(await source.inputValue(), originalSource + '\n\nSynthetic source correction.');
  assert.equal(await note.isDisabled(), false);
  await page.unroute('**/api/item?*');
  await page.getByRole('button', {name: 'Save changes', exact: true}).click();
  await page.locator('#modal').waitFor({state: 'hidden'});
  await page.waitForFunction(id => document.activeElement?.dataset.action === 'notes' && document.activeElement?.dataset.id === id, itemID);
  await page.locator(`.save-row [data-action="notes"][data-id="${itemID}"]`).click();
  assert.equal(await note.inputValue(), 'A saved synthetic takeaway.');
  assert.equal(await source.inputValue(), originalSource + '\n\nSynthetic source correction.');
  await page.getByRole('button', {name: 'Cancel', exact: true}).click();
  await page.locator('#modal').waitFor({state: 'hidden'});
  pass('Source edits survive a failed save; successful retry persists both fields and restores focus');

  // Exercise the shared UI's local and hosted branches with held HTTP replies.
  // The hosted adapter here is deliberately synthetic; backend/auth contracts
  // remain covered by the dedicated hosted suites.
  const snapshot = await (await page.request.get(`${url}api/state?workspace=demo`)).json();
  snapshot.settings.extractor_available = true;
  for (const hostedMode of [false, true]) {
    for (const completed of [false, true]) {
      const checking = await browser.newPage();
      checking.on('pageerror', error => errors.push(error.message));
      checking.on('request', request => {
        if (['/api/retrieve/start', '/api/classify-ai'].includes(new URL(request.url()).pathname)) providerCalls.push(request.url());
      });
      if (hostedMode) await checking.addInitScript(() => {
        window.Save2ShipHosted = {
          epoch: 1, user: {name: 'Synthetic member'},
          start({open}) { void open(); }, hasDetail() { return true; },
          api: (route, data) => fetch(route, data === undefined ? {} : {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data)}).then(response => response.json()),
        };
      });
      const synthetic = structuredClone(snapshot);
      synthetic.retrieval_jobs = [{id: 'synthetic-poll', run_id: 'synthetic-run', kind: 'retrieval', status: 'RUNNING', total: 1, item_ids: [synthetic.items.at(-1).id]}];
      await checking.route('**/api/state*', route => route.fulfill({json: synthetic}));
      let held, markRequested;
      const requested = new Promise(resolveRequest => { markRequested = resolveRequest; });
      await checking.route(`**/api/${hostedMode ? 'jobs' : 'retrieve'}/poll*`, route => { held = route; markRequested(); });
      await checking.goto(`${url}#inbox`);
      await checking.locator('.save-row').first().waitFor();
      await checking.evaluate(() => {
        clearTimeout(retrievalTimer); retrievalTimer = null;
        const check = pollRetrieval;
        pollRetrieval = async manual => { try { return await check(manual); } finally { if (manual) window.polishPollFinished = true; } };
      });
      await checking.locator('[data-action="retrieve"]').first().click();
      await checking.locator('[data-action="poll-retrieval"]').click();
      await requested;
      await checking.getByRole('button', {name: 'Close', exact: true}).click();
      await checking.locator('.save-row [data-action="notes"]').first().click();
      await checking.locator('#f-note').fill('Keep this draft while the old request finishes.');
      if (completed) synthetic.retrieval_jobs = [];
      const response = hostedMode ? {job: {kind: 'retrieval', status: completed ? 'COMPLETED' : 'RUNNING'}} : completed ? {applied_at: '2026-11-17T12:00:00Z', counts: {extracted: 1, partial: 0}} : {status: 'RUNNING'};
      const stateRefreshed = checking.waitForResponse(value => new URL(value.url()).pathname === '/api/state');
      await held.fulfill({json: response});
      await stateRefreshed;
      await checking.waitForFunction(() => window.polishPollFinished === true);
      assert.equal(await checking.locator('#modal').evaluate(dialog => dialog.open), true);
      assert.equal(await checking.locator('#f-note').inputValue(), 'Keep this draft while the old request finishes.');
      assert.equal(await checking.evaluate(() => notesAreDirty()), true);
      assert.equal(await checking.locator('#dialog-title').innerText(), 'Your notes');
      // A result still updates the workspace, even though it no longer owns the dialog.
      assert.equal(await checking.evaluate(() => state.retrieval_jobs.length), completed ? 0 : 1);
      await checking.close();
    }
    pass(`Delayed ${hostedMode ? 'hosted' : 'local'} manual polling preserves a newer notes draft for pending and completed results`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(providerCalls, []);
  console.log(`Shared polish interactions: ${checks.length} checks passed, zero provider calls or browser errors.`);
} finally {
  await browser?.close();
  if (server.pid && server.exitCode === null) {
    server.kill('SIGTERM');
    await new Promise(resolveExit => server.exitCode !== null ? resolveExit() : server.once('exit', resolveExit));
  }
  await rm(directory, {recursive: true, force: true});
}
