import test from 'node:test';
import assert from 'node:assert/strict';
import { createFirebaseAuthentication } from '../client/firebase-auth.mjs';

function fixture() {
  const calls = [];
  const user = { uid: 'synthetic-email', email: 'reader@example.invalid', emailVerified: false,
    providerData: [{ providerId: 'password' }], getIdToken: async force => { calls.push(['refresh', force]); } };
  const sdk = {
    initializeApp: config => config, getAuth: app => app, browserLocalPersistence: 'persistent',
    setPersistence: async (...args) => calls.push(['persist', ...args]),
    beforeAuthStateChanged: (...args) => calls.push(['guard', ...args]),
    onIdTokenChanged: (...args) => calls.push(['observe', ...args]),
    GoogleAuthProvider: class { setCustomParameters(value) { this.parameters = value; } },
    EmailAuthProvider: { credential: (email, password) => ({ email, password }) },
    signInWithPopup: async (_auth, provider) => calls.push(['popup', provider]),
    signInWithEmailAndPassword: async (...args) => calls.push(['email', ...args]),
    createUserWithEmailAndPassword: async (...args) => { calls.push(['create', ...args]); return { user }; },
    sendEmailVerification: async value => calls.push(['verify', value.uid]),
    sendPasswordResetEmail: async (...args) => calls.push(['reset', ...args]),
    reload: async value => { calls.push(['reload', value.uid]); value.emailVerified = true; },
    signOut: async () => calls.push(['signout']), deleteUser: async value => calls.push(['delete', value.uid]),
    reauthenticateWithCredential: async (...args) => calls.push(['confirm-password', ...args]),
    reauthenticateWithPopup: async (...args) => calls.push(['confirm-google', ...args]),
  };
  return { sdk, user, calls, auth: createFirebaseAuthentication(sdk) };
}

test('Firebase adapter persists auth, signs in with either method, and sends verification only on explicit registration', async () => {
  const { auth, user, calls } = fixture(), config = { projectId: 'synthetic' };
  const onUser = () => {}, onError = () => {};
  await auth.initialize(config, onUser, onError);
  assert.deepEqual(calls[0], ['persist', config, 'persistent']);
  assert.equal(calls[1][0], 'guard'); assert.equal(typeof calls[1][2], 'function');
  assert.equal(calls[2][0], 'observe'); assert.equal(typeof calls[2][2], 'function'); assert.equal(calls[2][3], onError);
  await auth.signIn(); assert.deepEqual(calls.at(-1)[1].parameters, { prompt: 'select_account' });
  await auth.signInWithEmail(user.email, 'synthetic-password');
  assert.equal(calls.at(-1)[0], 'email'); assert.equal(calls.filter(call => call[0] === 'verify').length, 0);
  await auth.signUpWithEmail(user.email, 'synthetic-password');
  assert.deepEqual(calls.slice(-2).map(call => call[0]), ['create', 'verify']);
  assert.equal(auth.needsVerification(user), true);
  await auth.reloadUser(user);
  assert.equal(auth.needsVerification(user), false);
  assert.deepEqual(calls.slice(-2), [['reload', user.uid], ['refresh', true]]);
});

test('password reset does not disclose a missing account and still reports operational failures', async () => {
  const { auth, sdk, user } = fixture();
  sdk.sendPasswordResetEmail = async () => { throw { code: 'auth/user-not-found' }; };
  await auth.resetPassword(user.email);
  sdk.sendPasswordResetEmail = async () => { throw { code: 'auth/network-request-failed' }; };
  await assert.rejects(auth.resetPassword(user.email), { code: 'auth/network-request-failed' });
});

test('verification mail failure leaves the created account available for verification retry', async () => {
  const { auth, sdk, user } = fixture();
  const error = { code: 'auth/too-many-requests' };
  sdk.sendEmailVerification = async () => { throw error; };
  assert.deepEqual(await auth.signUpWithEmail(user.email, 'synthetic-password'), { user, verificationError: error });
  assert.equal(auth.needsVerification(user), true);
});

test('account deletion reauthenticates with an existing provider and never sends an empty password', async () => {
  const { auth, user, calls } = fixture();
  assert.equal(auth.requiresPassword(user), true);
  assert.throws(() => auth.reauthenticate(user, ''), /Enter your password/);
  assert.equal(calls.length, 0);
  await auth.reauthenticate(user, 'synthetic-password');
  assert.deepEqual(calls.at(-1), ['confirm-password', user, { email: user.email, password: 'synthetic-password' }]);
  user.providerData.push({ providerId: 'google.com' });
  assert.equal(auth.requiresPassword(user), false);
  await auth.reauthenticate(user);
  assert.equal(calls.at(-1)[0], 'confirm-google');
  await auth.deleteUser(user); assert.deepEqual(calls.at(-1), ['delete', user.uid]);
});

test('email security state comes from token claims and enrollment uses recent credentials with native TOTP', async () => {
  const { auth, sdk, user, calls } = fixture();
  let claims = { firebase: { sign_in_provider: 'password' } };
  const factor = { factorId: 'totp', uid: 'synthetic-factor' };
  const factors = [];
  const secret = { secretKey: 'SYNTHETIC-ONLY' };
  sdk.getIdTokenResult = async () => ({ claims });
  sdk.multiFactor = () => ({ enrolledFactors: factors, getSession: async () => 'synthetic-session',
    enroll: async (...args) => calls.push(['enroll', ...args]) });
  sdk.TotpMultiFactorGenerator = { FACTOR_ID: 'totp', generateSecret: async session => { calls.push(['secret', session]); return secret; },
    assertionForEnrollment: (secret, code) => ({ secret, code }) };
  assert.deepEqual(await auth.securityState(user), { required: true, verified: false, enrolled: false });
  factors.push(factor);
  assert.deepEqual(await auth.securityState(user), { required: true, verified: false, enrolled: true });
  claims = { firebase: { sign_in_provider: 'password', sign_in_second_factor: 'totp' } };
  assert.equal((await auth.securityState(user)).verified, true);
  // A linked Google provider does not exempt a password sign-in.
  user.providerData.push({ providerId: 'google.com' });
  assert.equal((await auth.securityState(user)).required, true);
  claims = { firebase: { sign_in_provider: 'google.com' } };
  assert.equal((await auth.securityState(user)).required, false);
  await assert.rejects(auth.beginTotpEnrollment(user, 'synthetic-password'));
  user.emailVerified = true;
  assert.equal(await auth.beginTotpEnrollment(user, 'synthetic-password'), secret);
  assert.deepEqual(calls.slice(-2).map(call => call[0]), ['confirm-password', 'secret']);
  await auth.enrollTotp(user, secret, '123456');
  assert.deepEqual(calls.at(-1), ['enroll', { secret, code: '123456' }, 'Authenticator']);
});

test('TOTP resolver filters unsupported factors, rejects injected IDs and codes, and supports reauthentication', async () => {
  const { auth, sdk, calls } = fixture();
  const error = { code: 'auth/multi-factor-auth-required' };
  sdk.TotpMultiFactorGenerator = { FACTOR_ID: 'totp', assertionForSignIn: (uid, code) => ({ uid, code }) };
  sdk.getMultiFactorResolver = () => ({ hints: [{ uid: 'phone', factorId: 'phone' }, { uid: 'totp-one', factorId: 'totp', displayName: 'Backup' }],
    resolveSignIn: async assertion => calls.push(['resolve', assertion]) });
  sdk.signInWithEmailAndPassword = async () => { throw error; };
  await assert.rejects(auth.signInWithEmail('reader@example.invalid', 'synthetic-password'), error);
  assert.equal(auth.challenge({ code: 'auth/invalid-credential' }), null);
  const challenge = auth.challenge(error);
  assert.deepEqual(challenge.factors, [{ uid: 'totp-one', name: 'Backup' }]);
  assert.throws(() => challenge.resolve('phone', '123456'));
  assert.throws(() => challenge.resolve('totp-one', '12x456'));
  assert.equal(calls.length, 0);
  await challenge.resolve('totp-one', '123456');
  assert.deepEqual(calls.at(-1), ['resolve', { uid: 'totp-one', code: '123456' }]);
  sdk.getMultiFactorResolver = () => ({ hints: [{ uid: 'phone', factorId: 'phone' }] });
  assert.throws(() => auth.challenge(error), /no supported authenticator/);
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
for (const newAccountBeforeSettlement of [false, true]) {
  test(`cancelled native MFA cannot persist its identity; newer sign-in ${newAccountBeforeSettlement ? 'queues behind' : 'follows'} settlement`, async () => {
    const { auth, sdk } = fixture();
    const held = deferred(), started = deferred(), persisted = [], observed = [];
    let guard, notify, newerStarted = false;
    sdk.beforeAuthStateChanged = (_auth, callback) => { guard = callback; };
    sdk.onIdTokenChanged = (_auth, callback) => { notify = callback; };
    const publish = async user => { await guard(user); persisted.push(user?.uid || null); notify(user); };
    const error = { code: 'auth/multi-factor-auth-required' };
    sdk.signInWithEmailAndPassword = async (_auth, email) => {
      if (email === 'alice@example.invalid') throw error;
      newerStarted = true; await publish({ uid: 'synthetic-bob' });
    };
    sdk.signOut = () => publish(null);
    sdk.TotpMultiFactorGenerator = { FACTOR_ID: 'totp', assertionForSignIn: () => ({}) };
    sdk.getMultiFactorResolver = () => ({ hints: [{ uid: 'factor', factorId: 'totp' }], resolveSignIn: async () => {
      started.resolve(); await held.promise; await publish({ uid: 'synthetic-alice' });
    } });
    await auth.initialize({}, user => observed.push(user?.uid || null));
    await assert.rejects(auth.signInWithEmail('alice@example.invalid', 'synthetic-password'), error);
    const challenge = auth.challenge(error), resolving = challenge.resolve('factor', '123456');
    await started.promise; challenge.cancel();
    const logout = auth.signOut();
    let newer;
    if (newAccountBeforeSettlement) {
      newer = auth.signInWithEmail('bob@example.invalid', 'synthetic-password');
      await Promise.resolve(); assert.equal(newerStarted, false);
    }
    held.resolve(); await assert.rejects(resolving, { code: 'auth/cancelled-popup-request' });
    await logout;
    if (!newer) newer = auth.signInWithEmail('bob@example.invalid', 'synthetic-password');
    await newer;
    assert.deepEqual(persisted, [null, 'synthetic-bob']);
    assert.deepEqual(observed, [null, 'synthetic-bob']);
    assert.equal(auth.challenge(error), null, 'an old challenge cannot be installed over the new account');
  });
}

test('a late first-factor MFA error cannot install a challenge after logout or newer sign-in', async () => {
  const { auth, sdk } = fixture(), held = deferred(), started = deferred();
  const error = { code: 'auth/multi-factor-auth-required' };
  sdk.signInWithEmailAndPassword = async (_auth, email) => {
    if (email === 'alice@example.invalid') { started.resolve(); await held.promise; throw error; }
  };
  const first = auth.signInWithEmail('alice@example.invalid', 'synthetic-password');
  await started.promise;
  const logout = auth.signOut(), newer = auth.signInWithEmail('bob@example.invalid', 'synthetic-password');
  held.resolve();
  await assert.rejects(first, { code: 'auth/cancelled-popup-request' });
  await logout; await newer;
  assert.equal(auth.challenge(error), null);
});

test('logout immediately clears the native user so late reauthentication cannot persist or notify old tokens', async () => {
  const { auth, sdk, user } = fixture(), held = deferred(), started = deferred();
  let current = user, notify, writes = 0;
  const observed = [], error = { code: 'auth/multi-factor-auth-required' };
  sdk.onIdTokenChanged = (_auth, callback) => { notify = callback; callback(current); };
  sdk.reauthenticateWithCredential = async () => { throw error; };
  sdk.signOut = async () => { current = null; notify(null); };
  sdk.TotpMultiFactorGenerator = { FACTOR_ID: 'totp', assertionForSignIn: () => ({}) };
  sdk.getMultiFactorResolver = () => ({ hints: [{ uid: 'factor', factorId: 'totp' }], resolveSignIn: async () => {
    started.resolve(); await held.promise;
    // Firebase reauth updates tokens conditionally on currentUser, without
    // invoking the blocking observer used by new sign-in operations.
    if (current === user) { writes++; notify(user); }
  } });
  await auth.initialize({}, value => observed.push(value?.uid || null));
  await assert.rejects(auth.reauthenticate(user, 'synthetic-password'), error);
  const resolving = auth.challenge(error).resolve('factor', '123456');
  await started.promise; await auth.signOut();
  assert.equal(current, null, 'SDK logout must not wait for the pending reauthentication response');
  held.resolve(); await assert.rejects(resolving, { code: 'auth/cancelled-popup-request' });
  assert.equal(writes, 0);
  assert.deepEqual(observed, [user.uid, null]);
});
