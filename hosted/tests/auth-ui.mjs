// Synthetic auth interaction checks. No Firebase account, mail or provider request.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const { outputFiles } = await build({ stdin: { resolveDir: resolve('.'), sourcefile: 'auth-ui-fixture.mjs', contents: `
  import { installHostedWorkbench } from './client/workbench.mjs';
  let notify, active = null;
  const controls = window.__authFixture = { verified: false, failVerification: false, resets: 0, opened: 0, calls: [], pending: null };
  function identity(provider, verified) {
    return { uid: 'synthetic-' + provider, email: 'reader@example.invalid', displayName: 'Synthetic reader', emailVerified: verified,
      providerData: [{ providerId: provider }], getIdToken: async () => active.uid + ':' + active.emailVerified };
  }
  function signIn(provider, verified) { active = identity(provider, verified); notify(active); }
  const workbench = installHostedWorkbench({
    async initialize(_config, onUser) { notify = onUser; notify(null); },
    async signIn() { if (controls.cancelGoogle) throw { code: 'auth/popup-closed-by-user' }; signIn('google.com', true); },
    async signInWithEmail(_email, password) { controls.calls.push('signin'); if (password !== 'synthetic-password') throw { code: 'auth/invalid-credential' }; signIn('password', controls.verified); },
    async signUpWithEmail() { controls.calls.push('signup'); signIn('password', false); return { user: active, verificationError: controls.failVerification ? { code: 'auth/too-many-requests' } : null }; },
    async resetPassword() { controls.calls.push('reset'); },
    async sendVerification() { controls.calls.push('verify'); },
    async reloadUser(user) { user.emailVerified = controls.verified; },
    needsVerification: user => user?.emailVerified === false,
    requiresPassword: user => user?.providerData[0].providerId === 'password',
    async reauthenticate(_user, password) { controls.calls.push('reauth'); if (password !== 'synthetic-password') throw { code: 'auth/invalid-credential' }; },
    async signOut() { active = null; notify(null); },
    async deleteUser() { active = null; notify(null); },
  });
  controls.signOut = () => workbench.logout();
  controls.delete = () => workbench.removeAccount();
  controls.confirmDelete = () => workbench.confirmDelete();
  await workbench.start({ reset() { controls.resets++; }, open() { controls.opened++; document.querySelector('#main').textContent = 'Synthetic workspace'; },
    modal(_title, body) { document.querySelector('#dialog-content').innerHTML = body; document.querySelector('#modal').showModal(); } });
` }, write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
const style = await readFile('../saved_to_shipped/web/style.css', 'utf8');
let browser;
const checks = [], errors = [], requests = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://auth-test.invalid/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><head><style>${style}</style></head><body><aside id="sidebar"></aside><main id="main"></main><dialog id="modal"><div id="dialog-content"></div></dialog></body></html>` });
    if (path === '/api/config') return route.fulfill({ json: { mode: 'hosted', enabled: true, firebase: { apiKey: 'synthetic', projectId: 'synthetic', authDomain: 'synthetic.invalid' } } });
    requests.push(path);
    if (path === '/api/session') {
      const [uid, verified] = route.request().headers().authorization.slice(7).split(':');
      assert.equal(verified, 'true', 'an unverified user must never request a workspace session');
      return route.fulfill({ json: { workspace_session: 'synthetic-capability', expires_at: Date.now() + 60_000, membership: { uid } } });
    }
    if (path === '/api/account/delete') return route.fulfill({ json: { ok: true } });
    throw new Error(`Unexpected request ${path}`);
  });
  await page.goto('http://auth-test.invalid/');
  await page.addScriptTag({ type: 'module', content: outputFiles[0].text });
  const byButton = name => page.getByRole('button', { name, exact: true });
  await byButton('Continue with Google').waitFor();
  await page.evaluate(() => { window.__authFixture.cancelGoogle = true; });
  await byButton('Continue with Google').click();
  await page.getByText('Sign-in was cancelled. You can try again whenever you are ready.').waitFor();
  assert.equal(await byButton('Continue with Google').isEnabled(), true);
  await byButton('Continue with email').click();
  await page.getByLabel('Email', { exact: true }).fill('reader@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('wrong-password');
  await byButton('Sign in with email').click();
  await page.getByText('Email or password is incorrect. Try again or reset your password.').waitFor();
  assert.equal(await page.getByLabel('Password', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'reader@example.invalid');
  passed('Cancelled Google popup and incorrect email credentials preserve a usable sign-in screen');

  await byButton('Forgot password?').click();
  assert.equal(await page.getByLabel('Email', { exact: true }).inputValue(), 'reader@example.invalid');
  await byButton('Send reset link').click();
  await page.getByText('If this email has a password account, a reset link is on its way.', { exact: false }).waitFor();
  assert.equal(requests.length, 0);
  passed('Password reset gives a generic result and performs no workspace request');

  await byButton('Back to sign in').click();
  await byButton('Create an account').click();
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await page.evaluate(() => { window.__authFixture.failVerification = true; });
  await byButton('Create account').click();
  await page.getByRole('heading', { name: 'One quick email check.' }).waitFor();
  await page.getByText('Too many attempts. Wait a little before trying again.').waitFor();
  assert.equal(requests.length, 0);
  await byButton('Resend verification email').click();
  await page.getByText('Verification email sent. Check your inbox and spam folder.').waitFor();
  await byButton('I verified my email').click();
  await page.getByText('Your email is not verified yet.', { exact: false }).waitFor();
  assert.equal(requests.length, 0);
  await mkdir('.local/auth-ui', { recursive: true });
  await page.screenshot({ path: '.local/auth-ui/verification-dark-mobile.png', fullPage: true });
  await page.evaluate(() => { window.__authFixture.verified = true; });
  await byButton('I verified my email').click();
  await page.getByText('Synthetic workspace', { exact: true }).waitFor();
  assert.deepEqual(requests, ['/api/session']);
  passed('Registration stays gated after mail failure and opens only after explicit verification refresh');

  await page.evaluate(() => window.__authFixture.delete());
  await page.getByLabel('Confirm your password').fill('synthetic-password');
  await page.evaluate(() => window.__authFixture.confirmDelete());
  await page.locator('#modal').evaluate(dialog => dialog.close());
  await page.getByRole('heading', { name: 'Your workspace was deleted.' }).waitFor();
  assert.equal(await page.getByLabel('Confirm your password').inputValue(), '');
  assert.deepEqual(requests, ['/api/session', '/api/account/delete']);
  passed('Password account deletion confirms the password and clears it before the deletion request');
  await page.evaluate(() => window.__authFixture.signOut());
  await byButton('Continue with email').click();
  await page.getByLabel('Email', { exact: true }).fill('reader@example.invalid');
  await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
  await byButton('Sign in with email').click();
  await page.getByText('Synthetic workspace', { exact: true }).waitFor();
  await page.evaluate(() => window.__authFixture.signOut());
  await byButton('Continue with Google').waitFor();
  assert.ok(await page.evaluate(() => window.__authFixture.resets >= 5));
  assert.deepEqual(errors, []);
  passed('Verified email sign-in and sign-out clear private workspace state');
  console.log(`${checks.length} auth browser checks passed.`);
} finally { await browser?.close(); }
