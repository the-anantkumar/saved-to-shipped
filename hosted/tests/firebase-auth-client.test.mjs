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
  assert.deepEqual(calls, [['persist', config, 'persistent'], ['observe', config, onUser, onError]]);
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
