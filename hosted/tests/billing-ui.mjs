// Isolated billing/browser fixtures. No merchant, card details or provider calls.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const { outputFiles } = await build({ stdin: { resolveDir: resolve('.'), sourcefile: 'billing-ui-fixture.mjs', contents: `
  import { installHostedWorkbench } from './client/workbench.mjs';
  let notify, active;
  const controls = window.__billingFixture = { authCalls: [], refreshes: 0, mfa: false, holdAuth: false, holdCode: false, holdToken: false, cancels: 0 };
  const identity = (uid, provider = 'google.com') => ({ uid, email: uid + '@example.invalid', displayName: uid,
    emailVerified: true, providerData: [{ providerId: provider }], async getIdToken(force) {
      if (controls.holdToken) { controls.tokenPending = true; await new Promise(resolve => controls.finishToken = resolve); controls.tokenPending = false; controls.holdToken = false; }
      return uid + (force ? ':fresh' : ':cached');
    } });
  const workbench = installHostedWorkbench({
    async initialize(_config, onUser) { notify = onUser; active = identity('synthetic-alice'); notify(active); },
    async signIn() {}, needsVerification: () => false,
    requiresPassword: user => user.providerData[0].providerId === 'password',
    async reauthenticate(user, password) {
      controls.authCalls.push(user.uid);
      if (controls.holdAuth) { controls.authPending = true; await new Promise(resolve => controls.finishAuth = resolve); controls.authPending = false; }
      if (user.providerData[0].providerId === 'password' && password !== 'synthetic-password') throw { code: 'auth/invalid-credential' };
      if (controls.mfa) throw { code: 'auth/multi-factor-auth-required' };
    },
    challenge(error) {
      if (error.code !== 'auth/multi-factor-auth-required') return null;
      return { factors: [{ uid: 'synthetic-factor', name: 'Authenticator' }], async resolve(_uid, code) {
        if (code !== '123456') throw { code: 'auth/invalid-verification-code' };
        if (controls.holdCode) { controls.codePending = true; await new Promise(resolve => controls.finishCode = resolve); controls.codePending = false; }
      }, cancel() { controls.cancels++; } };
    },
    async signOut() { active = null; notify(null); }, async deleteUser() {},
  });
  controls.open = () => workbench.billingDialog();
  controls.switchUser = (uid, provider) => { active = identity(uid, provider); notify(active); };
  controls.logout = () => workbench.logout();
  controls.delete = () => workbench.removeAccount();
  controls.confirmDelete = () => workbench.confirmDelete();
  const modal = (title, body, footer = '<button data-action="close" class="button">Close</button>') => {
    const dialog = document.querySelector('#modal');
    dialog.innerHTML = '<div class="dialog-head"><h2>' + title + '</h2><button aria-label="Close dialog" data-action="close">×</button></div><div class="dialog-body">' + body + '</div><div class="dialog-footer">' + footer + '</div>';
    if (!dialog.open) dialog.showModal();
  };
  controls.otherDialog = () => modal('Another screen', '<p>New draft kept.</p>');
  document.addEventListener('click', event => { if (event.target.closest('[data-action="close"]')) document.querySelector('#modal').close(); });
  await workbench.start({ modal, reset() {}, open() { document.querySelector('#main').textContent = 'Workspace for ' + active.uid; }, refresh() { controls.refreshes++; } });
` }, bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022' });
const style = await readFile('../saved_to_shipped/web/style.css', 'utf8');
const nextMonth = Date.UTC(2026, 11, 1), base = 'http://localhost:8123/';
function info(overrides = {}) {
  return { available: true, mode: 'test', price: { amount: 12300, currency: 'INR', period: 'monthly', total_count: 12 },
    checkout: null, subscription: null, entitlements: { enabled: true, plan: 'free', limits: { saves: 100, sections: 3 },
      saves: { used: 17, limit: 100, remaining: 83 }, sections: { used: 2, limit: 3, remaining: 1 },
      points: { used: 2, reserved: 3, remaining: 15, limit: 20, period_end: nextMonth } }, ...overrides };
}
function proInfo() {
  const value = info({ subscription: { status: 'active', closed: false, cancel_at_end: false, period_end: nextMonth } });
  value.entitlements.plan = 'pro'; value.entitlements.saves.limit = 1000; value.entitlements.sections.limit = 25;
  value.entitlements.points.limit = 200; value.entitlements.points.remaining = 195;
  return value;
}
let browser;
const checks = [], errors = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
async function fixture(initial = info(), { query = '', mobile = false, paused = false, suspended = false } = {}) {
  const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 900 }, colorScheme: mobile ? 'dark' : 'light' });
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  const server = { info: initial, requests: [], sessions: 0, checkout: { checkout_url: 'https://rzp.io/i/synthetic_checkout', replayed: false }, checkoutError: null, hold: null };
  await page.route('**/*', async route => {
    const url = new URL(route.request().url()), path = url.pathname;
    if (url.origin === 'https://rzp.io') return route.fulfill({ contentType: 'text/html', body: '<p>Synthetic hosted payment page</p>' });
    assert.equal(url.origin, new URL(base).origin, 'no external provider request');
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<html data-theme="${mobile ? 'dark' : 'light'}"><head><style>${style}</style></head><body><aside id="sidebar"></aside><main id="main"></main><dialog id="modal"></dialog></body></html>` });
    if (path === '/api/config') return route.fulfill({ json: { mode: 'hosted', enabled: !paused, billing_recovery: true, firebase: { apiKey: 'synthetic', projectId: 'synthetic', authDomain: 'synthetic.invalid' } } });
    if (path === '/api/session') {
      server.sessions++;
      if (suspended) return route.fulfill({ status: 403, json: { ok: false, code: 'MEMBERSHIP_SUSPENDED', message: 'This workspace is paused.' } });
      return route.fulfill({ json: { workspace_session: 'synthetic-session', expires_at: Date.now() + 900_000, membership: { uid: route.request().headers().authorization.slice(7).split(':')[0] } } });
    }
    assert.match(path, /^\/api\/(?:billing(?:\/(?:checkout|sync|cancel))?|account\/delete)$/);
    const body = route.request().postDataJSON();
    server.requests.push({ path, body, token: route.request().headers().authorization });
    if (path === '/api/account/delete') {
      assert.deepEqual(body, {});
      if (server.deletePending) return route.fulfill({ status: 409, json: { ok: false, code: 'BILLING_DELETION_PENDING', message: 'Subscription cancellation is still being confirmed. Retry deletion to finish.' } });
      return route.fulfill({ json: { ok: true } });
    }
    if (server.hold === path) { server.pending = true; await new Promise(resolve => { server.release = resolve; }); server.pending = false; server.hold = null; }
    if (path === '/api/billing/checkout') {
      assert.deepEqual(Object.keys(body), ['intent_id']); assert.match(body.intent_id, /^[a-f0-9-]{36}$/);
      if (server.checkoutError) return route.fulfill({ status: 503, json: { ok: false, code: server.checkoutError, message: 'PRIVATE_PROVIDER_DETAILS must not reach UI' } });
      return route.fulfill({ json: server.checkout });
    }
    if (path === '/api/billing/cancel') {
      assert.deepEqual(body, {}); assert.match(route.request().headers().authorization, /:fresh$/);
      assert.equal(route.request().headers()['x-workspace-session'], undefined);
      server.info.subscription.cancel_at_end = true;
      return route.fulfill({ json: { cancelled: true, cancel_at_end: true } });
    }
    if (path === '/api/billing/sync') assert.deepEqual(body, {});
    return route.fulfill({ json: structuredClone(server.info) });
  });
  await page.goto(base + query); await page.addScriptTag({ type: 'module', content: outputFiles[0].text });
  if (paused) await page.getByRole('heading', { name: 'The workbench is paused.', exact: true }).waitFor();
  else if (suspended) await page.getByRole('heading', { name: 'Could not open your workspace.', exact: true }).waitFor();
  else await page.getByText('Workspace for synthetic-alice', { exact: true }).waitFor();
  return { page, server, close: () => context.close(), open: async () => { await page.evaluate(() => window.__billingFixture.open()); await page.getByRole('heading', { name: 'Your plan and points', exact: true }).waitFor(); } };
}
const button = (page, name) => page.getByRole('button', { name, exact: true });
const checkoutRequests = server => server.requests.filter(value => value.path === '/api/billing/checkout');
const cancelRequests = server => server.requests.filter(value => value.path === '/api/billing/cancel');
try {
  browser = await chromium.launch({ headless: true });
  const unavailable = await fixture(info({ available: false, price: null }), { mobile: true });
  await unavailable.open();
  await unavailable.page.getByText('Upgrades are being prepared.', { exact: false }).waitFor();
  assert.equal(await unavailable.page.locator('[data-billing="checkout"]').count(), 0);
  assert.match(await unavailable.page.locator('#hosted-billing').innerText(), /Test mode[\s\S]*15 left of 20[\s\S]*3 held for pending work/);
  assert.match(await unavailable.page.locator('#hosted-billing').innerText(), /own provider accounts[\s\S]*billed separately/);
  assert.equal(await unavailable.page.locator('#hosted-billing input').count(), 0);
  assert.equal(await unavailable.page.evaluate(() => document.querySelector('#modal').scrollWidth > document.querySelector('#modal').clientWidth + 1), false);
  await mkdir('.local/billing-ui', { recursive: true });
  await unavailable.page.screenshot({ path: '.local/billing-ui/free-dark-mobile.png', fullPage: true });
  await unavailable.close();
  passed('Unconfigured checkout keeps Free usage, held points, test mode and separate provider fees clear on mobile');

  const ready = await fixture(info(), { query: '?payment=success&plan=pro' });
  await ready.open();
  assert.match(await ready.page.locator('#hosted-billing').innerText(), /Your plan: Free/);
  assert.equal(checkoutRequests(ready.server).length, 0);
  await ready.page.screenshot({ path: '.local/billing-ui/free-light-desktop.png', fullPage: true });
  await button(ready.page, 'Open Pro checkout').click();
  await ready.page.waitForURL('https://rzp.io/i/synthetic_checkout');
  assert.equal(checkoutRequests(ready.server).length, 1);
  await ready.close();
  passed('Only an explicit checkout click navigates to Razorpay; return query flags never grant Pro');

  for (const url of ['javascript:alert(1)', 'https://rzp.io.attacker.invalid/i/one', 'https://rzp.io@attacker.invalid/i/one', 'https://rzp.io/i/one?redirect=https://attacker.invalid', 'https://rzp.io/i/../evil']) {
    const unsafe = await fixture(); unsafe.server.checkout.checkout_url = url;
    await unsafe.open(); await button(unsafe.page, 'Open Pro checkout').click();
    await unsafe.page.getByText('We could not confirm the payment status.', { exact: false }).waitFor();
    assert.equal(unsafe.page.url(), base); assert.equal(checkoutRequests(unsafe.server).length, 1);
    assert.equal(await unsafe.page.locator('[data-billing="checkout"]').count(), 0);
    assert.doesNotMatch(await unsafe.page.locator('#hosted-billing').innerText(), /PRIVATE_PROVIDER_DETAILS/);
    await unsafe.close();
  }
  passed('Unsafe checkout destinations stay blocked and never expose provider details');

  const uncertain = await fixture(); uncertain.server.checkoutError = 'BILLING_UNCERTAIN';
  await uncertain.open(); await button(uncertain.page, 'Open Pro checkout').click();
  await uncertain.page.getByText('Checkout is still being checked.', { exact: false }).waitFor();
  uncertain.server.info.checkout = { status: 'UNCERTAIN' };
  await button(uncertain.page, 'Close').click(); await uncertain.open();
  assert.equal(await uncertain.page.locator('[data-billing="checkout"]').count(), 0);
  await button(uncertain.page, 'Check payment status').click();
  await uncertain.page.getByText('The checkout is still pending.', { exact: false }).waitFor();
  assert.equal(checkoutRequests(uncertain.server).length, 1);
  uncertain.server.info.checkout = null; uncertain.server.checkoutError = null;
  await button(uncertain.page, 'Check payment status').click();
  await button(uncertain.page, 'Retry checkout').waitFor();
  await button(uncertain.page, 'Retry checkout').click();
  await uncertain.page.waitForURL('https://rzp.io/i/synthetic_checkout');
  const attempts = checkoutRequests(uncertain.server);
  assert.equal(attempts.length, 2); assert.equal(attempts[0].body.intent_id, attempts[1].body.intent_id);
  await uncertain.close();
  passed('Uncertain checkout requires status checks and explicit retry with the same intent, including after reopening');

  const cancel = await fixture(proInfo());
  await cancel.page.evaluate(() => { window.__billingFixture.mfa = true; window.__billingFixture.switchUser('synthetic-alice', 'password'); });
  await cancel.open(); await button(cancel.page, 'Cancel renewal').click();
  await cancel.page.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await button(cancel.page, 'Confirm cancellation').click();
  await cancel.page.getByLabel('Authenticator code').waitFor();
  assert.equal(await cancel.page.getByLabel('Confirm your password', { exact: true }).inputValue(), '');
  assert.equal(cancelRequests(cancel.server).length, 0);
  await cancel.page.getByLabel('Authenticator code').fill('123456');
  await button(cancel.page, 'Verify and continue').click();
  await cancel.page.getByText('Renewal cancelled. Your saved work is kept.', { exact: true }).waitFor();
  assert.equal(cancelRequests(cancel.server).length, 1);
  assert.match(await cancel.page.locator('#hosted-billing').innerText(), /Your plan: Pro[\s\S]*paid access continues/);
  assert.equal(await cancel.page.locator('[data-billing="cancel"]').count(), 0);
  await cancel.close();
  passed('Cancellation confirms password and TOTP with a fresh token, retaining paid access and saved work');

  const switchMfa = await fixture(proInfo());
  await switchMfa.page.evaluate(() => { window.__billingFixture.mfa = true; window.__billingFixture.holdCode = true; window.__billingFixture.switchUser('synthetic-alice', 'password'); });
  await switchMfa.open(); await button(switchMfa.page, 'Cancel renewal').click();
  await switchMfa.page.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await button(switchMfa.page, 'Confirm cancellation').click();
  await switchMfa.page.getByLabel('Authenticator code').fill('123456');
  await button(switchMfa.page, 'Verify and continue').click();
  await switchMfa.page.waitForFunction(() => window.__billingFixture.codePending);
  await button(switchMfa.page, 'Close').click();
  await switchMfa.page.evaluate(() => { window.__billingFixture.switchUser('synthetic-bob'); window.__billingFixture.finishCode(); });
  await switchMfa.page.waitForFunction(() => !window.__billingFixture.codePending);
  assert.equal(cancelRequests(switchMfa.server).length, 0);
  assert.equal(await switchMfa.page.locator('#modal').isVisible(), false);
  assert.equal(await switchMfa.page.evaluate(() => window.__billingFixture.cancels), 1);
  await switchMfa.close();
  passed('Closing a pending MFA confirmation and switching accounts cannot cancel renewal or reopen private billing');

  const tokenWait = await fixture(proInfo());
  await tokenWait.open(); await button(tokenWait.page, 'Cancel renewal').click();
  await tokenWait.page.evaluate(() => { window.__billingFixture.holdToken = true; });
  await button(tokenWait.page, 'Confirm cancellation').click();
  await tokenWait.page.waitForFunction(() => window.__billingFixture.tokenPending);
  await button(tokenWait.page, 'Close').click();
  await tokenWait.page.evaluate(() => window.__billingFixture.finishToken());
  await tokenWait.page.waitForFunction(() => !window.__billingFixture.tokenPending);
  assert.equal(cancelRequests(tokenWait.server).length, 0);
  assert.equal(tokenWait.server.info.subscription.cancel_at_end, false);
  await tokenWait.close();
  passed('Closing during token refresh prevents the cancellation POST even without changing accounts');

  const authWait = await fixture(proInfo());
  await authWait.open(); await button(authWait.page, 'Cancel renewal').click();
  await authWait.page.evaluate(() => { window.__billingFixture.holdAuth = true; window.__billingFixture.mfa = true; });
  await button(authWait.page, 'Confirm cancellation').click();
  await authWait.page.waitForFunction(() => window.__billingFixture.authPending);
  await button(authWait.page, 'Close').click();
  await authWait.page.evaluate(() => window.__billingFixture.finishAuth());
  await authWait.page.waitForFunction(() => !window.__billingFixture.authPending);
  assert.equal(cancelRequests(authWait.server).length, 0);
  assert.equal(await authWait.page.locator('#modal').isVisible(), false);
  assert.equal(await authWait.page.evaluate(() => window.__billingFixture.cancels), 1);
  await authWait.close();
  passed('Late first-factor reauthentication cannot surface MFA after the billing dialog closes');

  const held = await fixture(); held.server.hold = '/api/billing/checkout';
  await held.open(); await button(held.page, 'Open Pro checkout').click();
  while (!held.server.pending) await new Promise(resolve => setTimeout(resolve, 10));
  await held.page.evaluate(() => window.__billingFixture.switchUser('synthetic-bob'));
  held.server.release();
  await held.page.getByText('Workspace for synthetic-bob', { exact: true }).waitFor();
  assert.equal(held.page.url(), base); assert.equal(await held.page.locator('#modal').isVisible(), false);
  await held.close();
  passed('A checkout response for the previous account cannot redirect the new account');

  const stale = await fixture(); stale.server.hold = '/api/billing';
  await stale.page.evaluate(() => { void window.__billingFixture.open(); });
  while (!stale.server.pending) await new Promise(resolve => setTimeout(resolve, 10));
  await stale.page.evaluate(() => window.__billingFixture.otherDialog());
  stale.server.release();
  await stale.page.getByText('New draft kept.', { exact: true }).waitFor();
  assert.equal(await stale.page.locator('#hosted-billing').count(), 0);
  await stale.close();
  passed('Late plan loading cannot replace a newer modal or resurface a closed billing screen');

  const deletion = await fixture(proInfo()); deletion.server.deletePending = true;
  await deletion.page.evaluate(async () => { await window.__billingFixture.delete(); await window.__billingFixture.confirmDelete(); });
  await deletion.page.getByRole('heading', { name: 'Deletion needs one more step.', exact: true }).waitFor();
  assert.equal(await deletion.page.locator('#hosted-replacement-apify-token').count(), 0);
  await deletion.page.getByText('Your workspace is frozen while subscription cancellation finishes.', { exact: false }).waitFor();
  deletion.server.deletePending = false;
  await button(deletion.page, 'Retry deletion').click();
  await deletion.page.getByRole('heading', { name: 'Your workspace was deleted.', exact: true }).waitFor();
  assert.equal(deletion.server.requests.filter(value => value.path === '/api/account/delete').length, 2);
  await deletion.close();
  passed('Account deletion explains pending subscription cancellation and retries without an unrelated Apify token');

  for (const recovery of [{ paused: true }, { suspended: true }]) {
    const blocked = await fixture(proInfo(), recovery);
    const sessions = blocked.server.sessions;
    await button(blocked.page, 'Cancel subscription renewal').click();
    assert.equal(blocked.server.requests.length, 0);
    await button(blocked.page, 'Confirm cancellation').click();
    await blocked.page.getByRole('heading', { name: 'Renewal cancelled.', exact: true }).waitFor();
    assert.equal(blocked.server.sessions, sessions, 'cancellation must not obtain a workspace capability');
    assert.deepEqual(blocked.server.requests.map(value => value.path), ['/api/billing/cancel']);
    assert.equal(await blocked.page.getByText('Workspace for synthetic-alice', { exact: true }).count(), 0);
    assert.equal(await blocked.page.locator('.billing-overview').count(), 0);
    await blocked.close();
  }
  passed('Paused and suspended members can cancel renewal without a workspace session or private billing read');
  assert.deepEqual(errors, []);
  console.log(`${checks.length} billing browser checks passed.`);
} finally { await browser?.close(); }
