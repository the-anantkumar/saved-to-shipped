// Synthetic MFA interaction checks. No Firebase account, mail, SMS or provider call.
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { build } from 'esbuild';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= resolve('.local/playwright');
const { chromium } = await import('playwright');
const { outputFiles } = await build({ stdin: { resolveDir: resolve('.'), sourcefile: 'mfa-ui-fixture.mjs', contents: `
  import { installHostedWorkbench } from './client/workbench.mjs';
  let notify, active = null;
  const controls = window.__mfaFixture = { enrolled: false, enrollmentProof: false, opened: 0, resets: 0, calls: [], deferSetup: false, setupPending: false, deferChallenge: false, challengePending: false, challengeFinished: false, deleteResult: null };
  const secret = { secretKey: 'JBSWY3DPEHPK3PXP', generateQrCodeUrl: () => 'otpauth://totp/save2ship:reader%40example.invalid?secret=JBSWY3DPEHPK3PXP&issuer=save2ship' };
  function identity(verified = false, provider = 'password') {
    return { uid: 'synthetic-mfa-reader', email: 'reader@example.invalid', displayName: 'Synthetic reader', emailVerified: true, mfaVerified: verified,
      providerData: [{ providerId: provider }], getIdToken: async () => 'synthetic-mfa-reader:true:' + (active?.mfaVerified ? 'totp' : 'password') };
  }
  const authentication = {
    async initialize(_config, onUser) { notify = onUser; notify(null); },
    async signIn() { active = identity(true, 'google.com'); notify(active); },
    async signInWithEmail(_email, password) {
      controls.calls.push('signin');
      if (password !== 'synthetic-password') throw { code: 'auth/invalid-credential' };
      if (controls.enrolled) throw { code: 'auth/multi-factor-auth-required', kind: 'signin' };
      active = identity(); notify(active);
    },
    needsVerification: () => false,
    requiresPassword: user => user?.providerData[0].providerId === 'password',
    async securityState(user) { return { required: user.providerData[0].providerId === 'password', verified: user.mfaVerified, enrolled: controls.enrolled }; },
    async beginTotpEnrollment(_user, password) {
      controls.calls.push('setup');
      if (password !== 'synthetic-password') throw { code: 'auth/invalid-credential' };
      if (controls.deferSetup) { controls.setupPending = true; return new Promise(resolve => { controls.finishSetup = () => { controls.setupPending = false; resolve(secret); }; }); }
      return secret;
    },
    async enrollTotp(_user, value, code) {
      controls.calls.push('enroll');
      if (value !== secret || code !== '123456') throw { code: 'auth/invalid-verification-code' };
      controls.enrolled = true;
      if (controls.enrollmentProof) active.mfaVerified = true;
    },
    challenge(error) {
      if (error?.code !== 'auth/multi-factor-auth-required') return null;
      return { factors: [{ uid: 'synthetic-totp', name: 'Authenticator' }], async resolve(uid, code) {
        controls.calls.push('code');
        if (uid !== 'synthetic-totp' || code !== '123456') throw { code: 'auth/invalid-verification-code' };
        if (controls.deferChallenge) { controls.challengePending = true; await new Promise(resolve => { controls.finishChallenge = resolve; }); }
        if (error.kind === 'reauth') active.mfaVerified = true;
        else { active = identity(true); notify(active); }
        controls.challengePending = false; controls.challengeFinished = true;
      } };
    },
    async reauthenticate(_user, password) {
      controls.calls.push('reauth');
      if (password !== 'synthetic-password') throw { code: 'auth/invalid-credential' };
      throw { code: 'auth/multi-factor-auth-required', kind: 'reauth' };
    },
    async signOut() { active = null; notify(null); },
    async deleteUser() { active = null; notify(null); },
  };
  const workbench = installHostedWorkbench(authentication);
  controls.logout = () => workbench.logout();
  controls.delete = () => workbench.removeAccount();
  controls.confirmDelete = () => {
    controls.deleteResult = 'pending';
    workbench.confirmDelete().then(() => { controls.deleteResult = 'deleted'; }, error => { controls.deleteResult = error.message; });
  };
  await workbench.start({ reset() { controls.resets++; }, open() { controls.opened++; document.querySelector('#main').textContent = 'Synthetic workspace'; },
    modal(title, body, footer = '') {
      document.querySelector('#dialog-content').innerHTML = '<h2>' + title + '</h2>' + body + footer;
      document.querySelector('#modal').showModal();
    } });
  document.addEventListener('click', event => { if (event.target.closest('[data-action="close"]')) document.querySelector('#modal').close(); });
` }, write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
const nativeFixture = await build({ stdin: { resolveDir: resolve('.'), sourcefile: 'mfa-lifecycle-fixture.mjs', contents: `
  import { installHostedWorkbench } from './client/workbench.mjs';
  import { createFirebaseAuthentication } from './client/firebase-auth.mjs';
  let notify, guard, persistedUser = null;
  const controls = window.__mfaFixture = { opened: 0, persisted: [], observed: [], calls: [], firstPending: false,
    firstFinished: false, resolverPending: false, resolverFinished: false, holdFirst: false, newerResult: null, logoutResult: null };
  function user(uid, provider = 'password') {
    return { uid, email: uid === 'synthetic-mfa-reader' ? 'reader@example.invalid' : 'newer@example.invalid', emailVerified: true,
      providerData: [{ providerId: provider }], getIdToken: async () => uid + ':true:totp' };
  }
  // Faithful persistence order: Firebase calls its blocking observer before
  // writing currentUser or browser persistence, then sends the ID-token event.
  async function publish(value) {
    await guard(value);
    persistedUser = value; controls.persisted.push(value?.uid || null); notify(value);
  }
  const sdk = {
    initializeApp: config => config, getAuth: () => ({}), browserLocalPersistence: 'synthetic-local',
    async setPersistence() {}, beforeAuthStateChanged(_auth, callback) { guard = callback; },
    onIdTokenChanged(_auth, callback) { notify = value => { controls.observed.push(value?.uid || null); callback(value); }; notify(null); },
    GoogleAuthProvider: class { setCustomParameters() {} },
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    async signInWithPopup() { controls.calls.push('newer-started'); await publish(user('synthetic-mfa-newer', 'google.com')); },
    async signInWithEmailAndPassword(_auth, _email, password) {
      if (password !== 'synthetic-password') throw { code: 'auth/invalid-credential' };
      if (controls.holdFirst) { controls.firstPending = true; await new Promise(resolve => { controls.finishFirst = resolve; }); }
      controls.firstFinished = true;
      throw { code: 'auth/multi-factor-auth-required' };
    },
    async getIdTokenResult(value) { return { claims: { firebase: { sign_in_provider: value.providerData[0].providerId, sign_in_second_factor: 'totp' } } }; },
    multiFactor: () => ({ enrolledFactors: [{ uid: 'synthetic-totp', factorId: 'totp' }] }),
    TotpMultiFactorGenerator: { FACTOR_ID: 'totp', assertionForSignIn: (uid, code) => ({ uid, code }) },
    getMultiFactorResolver: () => ({ hints: [{ uid: 'synthetic-totp', factorId: 'totp', displayName: 'Authenticator' }],
      async resolveSignIn(assertion) {
        if (assertion.uid !== 'synthetic-totp' || assertion.code !== '123456') throw { code: 'auth/invalid-verification-code' };
        controls.resolverPending = true;
        try { await new Promise(resolve => { controls.finishResolver = resolve; }); await publish(user('synthetic-mfa-reader')); }
        finally { controls.resolverFinished = true; }
      } }),
    async signOut() { await publish(null); },
  };
  const authentication = createFirebaseAuthentication(sdk), workbench = installHostedWorkbench(authentication);
  controls.logout = () => { workbench.logout().then(() => { controls.logoutResult = 'done'; }, error => { controls.logoutResult = error.message; }); };
  controls.attemptNewer = () => { authentication.signIn().then(() => { controls.newerResult = 'done'; }, error => { controls.newerResult = error.message; }); };
  controls.persistedUid = () => persistedUser?.uid || null;
  await workbench.start({ reset() {}, open() { controls.opened++; document.querySelector('#main').textContent = 'Synthetic workspace for ' + workbench.user.email; },
    modal(title, body) { document.querySelector('#dialog-content').innerHTML = '<h2>' + title + '</h2>' + body; document.querySelector('#modal').showModal(); } });
` }, write: false, bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
const style = await readFile('../saved_to_shipped/web/style.css', 'utf8');
const checks = [], errors = [], unexpected = [], requests = [];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
let browser;
try {
  browser = await chromium.launch({ headless: true });
  async function newPage({ native = false } = {}) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, colorScheme: 'dark' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      if (url.origin !== 'http://mfa-test.invalid') { unexpected.push(url.origin); return route.abort(); }
      if (path === '/') return route.fulfill({ contentType: 'text/html', body: `<html data-theme="dark"><head><style>${style}</style></head><body><aside id="sidebar"></aside><main id="main"></main><dialog id="modal"><div id="dialog-content"></div></dialog></body></html>` });
      if (path === '/api/config') return route.fulfill({ json: { mode: 'hosted', enabled: true, firebase: { apiKey: 'synthetic', projectId: 'synthetic', authDomain: 'synthetic.invalid' } } });
      requests.push(path);
      const token = route.request().headers().authorization;
      assert.match(token, /^Bearer synthetic-mfa-(reader|newer):true:totp$/, 'only a completed MFA identity can reach the API');
      const uid = token.slice(7).split(':')[0];
      if (path === '/api/session') return route.fulfill({ json: { workspace_session: 'synthetic-capability', expires_at: Date.now() + 60_000, membership: { uid } } });
      if (path === '/api/account/delete') return route.fulfill({ json: { ok: true } });
      unexpected.push(path); return route.abort();
    });
    await page.goto('http://mfa-test.invalid/');
    await page.addScriptTag({ type: 'module', content: (native ? nativeFixture.outputFiles : outputFiles)[0].text });
    await page.getByRole('button', { name: 'Continue with email', exact: true }).waitFor();
    return page;
  }
  async function emailSignIn(page) {
    await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
    await page.getByLabel('Email', { exact: true }).fill('reader@example.invalid');
    await page.getByLabel('Password', { exact: true }).fill('synthetic-password');
    await page.getByRole('button', { name: 'Sign in with email', exact: true }).click();
  }
  async function code(page, value) {
    await page.getByLabel('Authenticator code', { exact: true }).fill(value);
    await page.getByRole('button', { name: 'Verify and continue', exact: true }).click();
  }
  const page = await newPage();
  await emailSignIn(page);
  await page.getByRole('heading', { name: 'Protect your saved ideas.', exact: true }).waitFor();
  assert.deepEqual(requests, []);
  assert.equal(await page.evaluate(() => window.__mfaFixture.opened), 0);
  await page.getByLabel('Confirm your password', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  await page.getByText('Email or password is incorrect. Try again or reset your password.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Confirm your password', { exact: true }).inputValue(), '');
  assert.equal(await page.locator('canvas').count(), 0);
  passed('Verified email/password sign-in stays outside the workspace until authenticator enrollment and clears reauthentication passwords');

  await page.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await page.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  await page.getByLabel('Setup key', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Setup key', { exact: true }).inputValue(), 'JBSWY3DPEHPK3PXP');
  assert.equal(await page.locator('canvas').evaluate(canvas => canvas.width >= 180 && canvas.width <= 208 && canvas.width === canvas.height &&
    canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data.some((value, index) => index % 4 !== 3 && value === 0x15)), true);
  assert.equal(await page.getByLabel('Confirm your password', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('JBSWY3DPEHPK3PXP')), false);
  await page.getByRole('checkbox').check();
  await page.getByLabel('Authenticator code', { exact: true }).fill('000000');
  await page.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click();
  await page.getByText('That code was not accepted. Check your authenticator and try a fresh code.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Authenticator code', { exact: true }).inputValue(), '');
  assert.equal(await page.getByLabel('Setup key', { exact: true }).count(), 1);
  assert.deepEqual(requests, []);
  await mkdir('.local/mfa-ui', { recursive: true });
  await page.screenshot({ path: '.local/mfa-ui/enrollment-dark-mobile.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  passed('Enrollment renders a local QR and manual key, keeps secrets out of browser storage, retries wrong codes and fits dark mobile layout');

  await page.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await page.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click();
  await page.getByRole('heading', { name: 'Two-factor authentication is ready.', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Setup key', { exact: true }).count(), 0);
  assert.equal(await page.locator('canvas').count(), 0);
  assert.equal(await page.getByLabel('Authenticator code', { exact: true }).count(), 0);
  assert.deepEqual(requests, []);
  passed('Successful enrollment discards the secret and requires a fresh password-plus-code sign-in before any session request');

  await emailSignIn(page);
  await page.getByLabel('Authenticator code', { exact: true }).waitFor();
  await code(page, '000000');
  await page.getByText('That code was not accepted. Check your authenticator and try a fresh code.', { exact: true }).waitFor();
  assert.equal(await page.getByLabel('Authenticator code', { exact: true }).inputValue(), '');
  assert.deepEqual(requests, []);
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await page.getByRole('button', { name: 'Continue with email', exact: true }).waitFor();
  assert.equal(await page.getByLabel('Authenticator code', { exact: true }).count(), 0);
  await emailSignIn(page);
  await code(page, '123456');
  await page.getByText('Synthetic workspace', { exact: true }).waitFor();
  assert.deepEqual(requests, ['/api/session']);
  passed('Sign-in code challenges allow retry and cancellation, and create a workspace session only after the correct authenticator code');

  await page.evaluate(() => window.__mfaFixture.delete());
  await page.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await page.evaluate(() => window.__mfaFixture.confirmDelete());
  await page.getByRole('heading', { name: 'Confirm your authenticator', exact: true }).waitFor();
  await code(page, '000000');
  await page.getByText('That code was not accepted. Check your authenticator and try a fresh code.', { exact: true }).waitFor();
  assert.equal(requests.includes('/api/account/delete'), false);
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.waitForFunction(() => window.__mfaFixture.deleteResult === 'Security confirmation was cancelled.');
  assert.equal(requests.includes('/api/account/delete'), false);
  assert.equal(await page.getByLabel('Authenticator code', { exact: true }).count(), 0);
  await page.evaluate(() => window.__mfaFixture.delete());
  await page.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await page.evaluate(() => window.__mfaFixture.confirmDelete());
  await page.getByRole('heading', { name: 'Confirm your authenticator', exact: true }).waitFor();
  await code(page, '123456');
  await page.getByRole('heading', { name: 'Your workspace was deleted.', exact: true }).waitFor();
  assert.deepEqual(requests, ['/api/session', '/api/account/delete']);
  assert.equal(await page.getByLabel('Authenticator code', { exact: true }).count(), 0);
  passed('Deletion requires a fresh authenticator code, cancelled confirmation performs no deletion, and completed confirmation clears code UI');

  const delayed = await newPage();
  await emailSignIn(delayed);
  await delayed.getByRole('heading', { name: 'Protect your saved ideas.', exact: true }).waitFor();
  await delayed.evaluate(() => { window.__mfaFixture.deferSetup = true; });
  await delayed.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await delayed.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  await delayed.waitForFunction(() => window.__mfaFixture.setupPending);
  await delayed.getByRole('button', { name: 'Sign out', exact: true }).click();
  await delayed.getByRole('button', { name: 'Continue with email', exact: true }).waitFor();
  await delayed.evaluate(() => window.__mfaFixture.finishSetup());
  await delayed.waitForFunction(() => !window.__mfaFixture.setupPending);
  assert.equal(await delayed.getByLabel('Setup key', { exact: true }).count(), 0);
  assert.equal(await delayed.locator('canvas').count(), 0);
  assert.equal(await delayed.evaluate(() => window.__mfaFixture.opened), 0);
  assert.deepEqual(requests, ['/api/session', '/api/account/delete']);
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  passed('Sign-out during pending setup ignores the late secret response and makes no external requests or workspace calls');
  const raceFailures = [];
  for (const newerBeforeSettlement of [false, true]) {
    const lateSignIn = await newPage({ native: true });
    await emailSignIn(lateSignIn);
    const beforeLateSignIn = requests.length;
    await code(lateSignIn, '123456');
    await lateSignIn.waitForFunction(() => window.__mfaFixture.resolverPending);
    await lateSignIn.getByRole('button', { name: 'Back to sign in', exact: true }).click();
    if (newerBeforeSettlement) {
      await lateSignIn.evaluate(() => window.__mfaFixture.attemptNewer());
      assert.equal(await lateSignIn.evaluate(() => window.__mfaFixture.calls.includes('newer-started')), false,
        'a newer sign-in must remain queued behind the cancelled resolver');
    }
    await lateSignIn.evaluate(() => window.__mfaFixture.finishResolver());
    await lateSignIn.waitForFunction(() => window.__mfaFixture.resolverFinished);
    if (!newerBeforeSettlement) {
      await lateSignIn.getByRole('button', { name: 'Continue with Google', exact: true }).waitFor();
      assert.equal(await lateSignIn.evaluate(() => window.__mfaFixture.opened), 0);
      assert.equal(requests.length, beforeLateSignIn);
      await lateSignIn.getByRole('button', { name: 'Continue with Google', exact: true }).click();
    } else await lateSignIn.waitForFunction(() => window.__mfaFixture.newerResult === 'done');
    await lateSignIn.getByText('Synthetic workspace for newer@example.invalid', { exact: true }).waitFor();
    const state = await lateSignIn.evaluate(() => ({ persisted: window.__mfaFixture.persisted, observed: window.__mfaFixture.observed,
      uid: window.__mfaFixture.persistedUid(), opened: window.__mfaFixture.opened }));
    assert.deepEqual(state.persisted, [null, 'synthetic-mfa-newer']);
    assert.deepEqual(state.observed, [null, null, 'synthetic-mfa-newer']);
    assert.equal(state.uid, 'synthetic-mfa-newer');
    assert.equal(state.opened, 1);
    assert.equal(requests.length, beforeLateSignIn + 1);
    passed('Native adapter rejects cancelled MFA before persistence; newer account ' + (newerBeforeSettlement ? 'waits behind the pending resolver' : 'signs in after settlement'));
  }

  const lateFirst = await newPage({ native: true });
  await lateFirst.evaluate(() => { window.__mfaFixture.holdFirst = true; });
  await emailSignIn(lateFirst);
  await lateFirst.waitForFunction(() => window.__mfaFixture.firstPending);
  await lateFirst.evaluate(() => { window.__mfaFixture.logout(); window.__mfaFixture.attemptNewer(); });
  assert.equal(await lateFirst.evaluate(() => window.__mfaFixture.calls.includes('newer-started')), false);
  await lateFirst.evaluate(() => window.__mfaFixture.finishFirst());
  await lateFirst.getByText('Synthetic workspace for newer@example.invalid', { exact: true }).waitFor();
  assert.equal(await lateFirst.getByLabel('Authenticator code', { exact: true }).count(), 0);
  assert.deepEqual(await lateFirst.evaluate(() => window.__mfaFixture.persisted), [null, 'synthetic-mfa-newer']);
  assert.deepEqual(await lateFirst.evaluate(() => window.__mfaFixture.observed), [null, null, 'synthetic-mfa-newer']);
  assert.equal(await lateFirst.evaluate(() => window.__mfaFixture.opened), 1);
  passed('Late first-factor MFA errors cannot replace the newer account screen or create a stale challenge');

  const lateReauth = await newPage();
  await lateReauth.evaluate(() => { window.__mfaFixture.enrolled = true; });
  await emailSignIn(lateReauth); await code(lateReauth, '123456');
  await lateReauth.getByText('Synthetic workspace', { exact: true }).waitFor();
  await lateReauth.evaluate(() => { window.__mfaFixture.deferChallenge = true; window.__mfaFixture.challengeFinished = false; });
  await lateReauth.evaluate(() => window.__mfaFixture.delete());
  await lateReauth.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await lateReauth.evaluate(() => window.__mfaFixture.confirmDelete());
  await lateReauth.getByRole('heading', { name: 'Confirm your authenticator', exact: true }).waitFor();
  const beforeLateDelete = requests.filter(path => path === '/api/account/delete').length;
  await code(lateReauth, '123456');
  await lateReauth.waitForFunction(() => window.__mfaFixture.challengePending);
  await lateReauth.getByRole('button', { name: 'Cancel', exact: true }).click();
  await lateReauth.waitForFunction(() => window.__mfaFixture.deleteResult === 'Security confirmation was cancelled.');
  await lateReauth.evaluate(() => window.__mfaFixture.finishChallenge());
  await lateReauth.waitForFunction(() => window.__mfaFixture.challengeFinished);
  await lateReauth.evaluate(async () => { for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame); });
  if (requests.filter(path => path === '/api/account/delete').length !== beforeLateDelete) {
    raceFailures.push('A late reauthentication resolver submitted account deletion after cancellation.');
    console.log('FAIL Late reauthentication resolver must not delete after cancellation');
  } else passed('A late reauthentication resolver cannot delete the workspace after cancellation');
  const nativeEnrollment = await newPage();
  await nativeEnrollment.evaluate(() => { window.__mfaFixture.enrollmentProof = true; });
  const beforeNativeEnrollment = requests.length;
  await emailSignIn(nativeEnrollment);
  await nativeEnrollment.getByRole('heading', { name: 'Protect your saved ideas.', exact: true }).waitFor();
  await nativeEnrollment.getByLabel('Confirm your password', { exact: true }).fill('synthetic-password');
  await nativeEnrollment.getByRole('button', { name: 'Set up authenticator', exact: true }).click();
  await nativeEnrollment.getByLabel('Setup key', { exact: true }).waitFor();
  await nativeEnrollment.getByRole('checkbox').check();
  await nativeEnrollment.getByLabel('Authenticator code', { exact: true }).fill('000000');
  await nativeEnrollment.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click();
  await nativeEnrollment.getByText('That code was not accepted. Check your authenticator and try a fresh code.', { exact: true }).waitFor();
  assert.equal(requests.length, beforeNativeEnrollment);
  assert.equal(await nativeEnrollment.evaluate(() => window.__mfaFixture.opened), 0);
  await nativeEnrollment.getByLabel('Authenticator code', { exact: true }).fill('123456');
  await nativeEnrollment.getByRole('button', { name: 'Enable two-factor authentication', exact: true }).click();
  await nativeEnrollment.getByText('Synthetic workspace', { exact: true }).waitFor();
  assert.equal(requests.length, beforeNativeEnrollment + 1);
  assert.equal(requests.at(-1), '/api/session');
  assert.equal(await nativeEnrollment.evaluate(() => window.__mfaFixture.opened), 1);
  assert.equal(await nativeEnrollment.getByLabel('Setup key', { exact: true }).count(), 0);
  assert.equal(await nativeEnrollment.getByLabel('Authenticator code', { exact: true }).count(), 0);
  assert.equal(await nativeEnrollment.locator('canvas').count(), 0);
  passed('Native enrollment proof opens the workspace immediately after a correct code, without a second sign-in or retained setup secret');
  await writeFile('.local/mfa-ui/report.json', JSON.stringify({ synthetic: true, checks, failures: raceFailures, runtimeErrors: errors, unexpectedRequests: unexpected }, null, 2) + '\n');
  assert.deepEqual(unexpected, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(raceFailures, []);
  console.log(`${checks.length} MFA browser checks passed.`);
} finally { await browser?.close(); }
