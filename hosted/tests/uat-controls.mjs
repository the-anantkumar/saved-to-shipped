// Human UAT shell acceptance. Exercise visible controls without synthetic auth globals.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { startUAT } from './uat.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const fixture = await startUAT();
let browser;
const errors = [], checks = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const identityRequests = [];
  page.on('request', request => { if (new URL(request.url()).pathname === '/__fixture__/identity') identityRequests.push(request.url()); });
  const member = name => page.locator('[data-action="hosted-account"]').filter({ hasText: `Synthetic ${name}` }).waitFor();
  const choose = async name => {
    await page.locator('#uat-person').selectOption(name);
    await page.locator('#uat-controls').getByRole('button', { name: 'Use account', exact: true }).click();
  };
  await page.goto(fixture.url);
  await member('alice');
  await page.locator('#uat-controls').getByText('Synthetic UAT', { exact: true }).waitFor();
  await page.locator('[data-tile-id]').filter({ hasText: 'Build a tiny SQLite playground' }).waitFor();
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some(key => /token|credential|session/i.test(key))), false);
  passed('Visible synthetic mode opens Alice with an organized sample project and no persisted credentials');

  await page.locator('#sidebar [data-view="learning"]').click();
  assert.equal(await page.locator('.reading-row').count(), 1);
  await page.locator('#sidebar [data-view="experiences"]').click();
  assert.equal(await page.locator('.reading-row').count(), 1);
  passed('Learning and Experiences each have a separate readable sample');
  await page.locator('#sidebar [data-view="learning"]').click();
  await page.locator('#search').fill('quasarneedle');
  await page.locator('.reading-row').filter({ hasText: 'How to read an unfamiliar codebase' }).waitFor();
  await page.reload(); await member('alice');
  await page.locator('.reading-row').filter({ hasText: 'How to read an unfamiliar codebase' }).waitFor();
  await page.locator('#sidebar [data-view="inbox"]').click();
  await page.locator('#search').fill('tiny SQLite');
  await page.locator('.save-open').filter({ hasText: 'Build a tiny SQLite playground' }).waitFor();
  await page.goBack();
  await page.locator('.reading-row').filter({ hasText: 'How to read an unfamiliar codebase' }).waitFor();
  assert.equal(await page.locator('#search').inputValue(), 'quasarneedle');
  passed('Full-note search survives reload and browser Back after a different search');

  await page.locator('#uat-sign-out').click();
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).waitFor();
  assert.equal(await page.locator('[data-action="hosted-account"]').count(), 0);
  await page.reload();
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).waitFor();
  assert.equal(await page.locator('[data-tile-id], .reading-row').count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem('save2ship.synthetic-uat.identity')), 'signed-out');
  await page.getByRole('button', { name: 'Continue with Google', exact: true }).click();
  await member('alice');
  passed('Sign-out clears the workbench, survives reload and supports visible sign-in');

  await choose('bob'); await member('bob');
  assert.equal(await page.locator('[data-tile-id], .reading-row, .save-open').count(), 0);
  await page.reload(); await member('bob');
  assert.equal(await page.locator('#uat-person').inputValue(), 'bob');
  assert.equal(await page.locator('[data-tile-id], .reading-row, .save-open').count(), 0);
  passed('Account switching and reload retain Bob while keeping Alice content private');

  await choose('charlie');
  await page.getByRole('heading', { name: 'A little room is opening soon.', exact: true }).waitFor();
  assert.equal(await page.locator('[data-action="hosted-account"]').count(), 0);
  await choose('alice'); await member('alice');
  await page.locator('[data-tile-id]').filter({ hasText: 'Build a tiny SQLite playground' }).waitFor();
  passed('The full-beta account cannot enter while an existing member can return');

  await page.clock.install();
  const requestsBefore = identityRequests.length;
  await page.clock.setSystemTime(new Date(Date.now() + 51 * 60_000));
  await page.locator('[data-action="notes"]').first().click();
  await page.locator('#f-note').waitFor();
  assert.ok(identityRequests.length > requestsBefore, 'An old synthetic token must be renewed before opening private detail');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.clock.setSystemTime(new Date());
  passed('Long-running UAT sessions renew synthetic identity on demand');

  const second = await context.newPage();
  await second.goto(fixture.url);
  await second.locator('[data-action="hosted-account"]').filter({ hasText: 'Synthetic alice' }).waitFor();
  await page.locator('#uat-sign-out').click();
  await second.getByRole('button', { name: 'Continue with Google', exact: true }).waitFor();
  assert.equal(await second.locator('[data-tile-id], .reading-row').count(), 0);
  passed('Sign-out also clears another open tab');

  await page.setViewportSize({ width: 390, height: 844 });
  await choose('bob'); await member('bob');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.locator('#theme-mode').selectOption('dark');
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  assert.deepEqual(errors, []);
  passed('UAT controls fit a mobile viewport and support the shared dark theme without runtime errors');
  await choose('alice'); await member('alice');
  await page.locator('#sidebar [data-view="learning"]').click();
  await page.locator('.reading-row h2 button').click();
  await page.locator('[data-action="library-back"]').first().waitFor();
  await second.locator('[data-action="hosted-account"]').filter({ hasText: 'Synthetic alice' }).waitFor();
  await second.locator('#sidebar [data-view="learning"]').click();
  await second.locator('.reading-row [data-action="notes"]').click();
  await second.locator('[data-action="hosted-delete-item"]').click();
  await second.locator('[data-action="hosted-confirm-delete-item"]').click();
  await second.locator('#modal').waitFor({ state: 'hidden' });
  // Headless focus emulation keeps tabs visible; dispatch the return event.
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.locator('.reading-list').waitFor();
  assert.equal(await page.locator('[data-action="library-back"]').count(), 0);
  assert.equal(await page.locator('.reading-row').count(), 0);
  passed('Deleting an open reader from another session returns safely to the updated library');
  assert.deepEqual(errors, []);
  await mkdir('.local/uat-controls', { recursive: true });
  await writeFile('.local/uat-controls/report.json', JSON.stringify({ synthetic: true, checks, browserErrors: errors }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, runtimeErrors: errors.length }));
} finally {
  await browser?.close();
  await fixture.close();
}
