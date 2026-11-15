/** Firebase-only adapter. The workbench never stores an email password. */
export function createFirebaseAuthentication(sdk) {
  let auth, generation = 0, operation = null, queue = Promise.resolve();
  const challenges = new WeakMap();
  const cancelled = () => Object.assign(new Error('Sign-in was cancelled. Please try again.'), { code: 'auth/cancelled-popup-request' });
  // Firebase mutates its persistent user before resolveSignIn returns. Fence that
  // transition inside the SDK, and serialize a newer sign-in behind its cleanup.
  function perform(action, epoch = ++generation) {
    const result = queue.catch(() => {}).then(async () => {
      if (generation !== epoch) throw cancelled();
      const active = { epoch }; operation = active;
      try {
        const result = await action();
        if (generation !== epoch) throw cancelled();
        return result;
      } catch (error) {
        if (generation !== epoch) throw cancelled();
        if (error?.code === 'auth/multi-factor-auth-required') challenges.set(error, epoch);
        throw error;
      } finally { if (operation === active) operation = null; }
    });
    queue = result.catch(() => {}); return result;
  }
  // Linked accounts can confirm with Google. Password-only accounts must use
  // their existing password, rather than accidentally creating a Google login.
  const requiresPassword = user => user?.providerData?.some(provider => provider.providerId === 'password') &&
    !user.providerData.some(provider => provider.providerId === 'google.com');
  const needsVerification = user => user?.emailVerified === false &&
    user.providerData?.some(provider => provider.providerId === 'password');
  return {
    async initialize(config, onUser, onError) {
      auth = sdk.getAuth(sdk.initializeApp(config));
      await sdk.setPersistence(auth, sdk.browserLocalPersistence);
      sdk.beforeAuthStateChanged(auth, user => {
        if (user && operation && operation.epoch !== generation) throw cancelled();
      });
      sdk.onIdTokenChanged(auth, user => {
        if (user && operation && operation.epoch !== generation) return;
        onUser(user);
      }, onError);
    },
    async signIn() {
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await perform(() => sdk.signInWithPopup(auth, provider));
    },
    signInWithEmail: (email, password) => perform(() => sdk.signInWithEmailAndPassword(auth, email, password)),
    async signUpWithEmail(email, password) {
      return perform(async () => {
        const { user } = await sdk.createUserWithEmailAndPassword(auth, email, password);
        try { await sdk.sendEmailVerification(user); return { user }; }
        catch (verificationError) { return { user, verificationError }; }
      });
    },
    async resetPassword(email) {
      try { await sdk.sendPasswordResetEmail(auth, email); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    },
    sendVerification: user => sdk.sendEmailVerification(user),
    async reloadUser(user) { await sdk.reload(user); await user.getIdToken(true); },
    needsVerification,
    requiresPassword,
    async securityState(user) {
      const { claims } = await sdk.getIdTokenResult(user);
      const password = claims.firebase?.sign_in_provider === 'password';
      return { required: password, verified: !password || claims.firebase?.sign_in_second_factor === 'totp',
        enrolled: sdk.multiFactor(user).enrolledFactors.some(factor => factor.factorId === sdk.TotpMultiFactorGenerator.FACTOR_ID) };
    },
    async beginTotpEnrollment(user, password) {
      if (!user.emailVerified || !user.email || !password) throw new Error('Verify your email and enter your password first.');
      return perform(async () => {
        await sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, password));
        return sdk.TotpMultiFactorGenerator.generateSecret(await sdk.multiFactor(user).getSession());
      });
    },
    async enrollTotp(user, secret, code) {
      await sdk.multiFactor(user).enroll(sdk.TotpMultiFactorGenerator.assertionForEnrollment(secret, code), 'Authenticator');
    },
    challenge(error) {
      if (error?.code !== 'auth/multi-factor-auth-required') return null;
      const epoch = challenges.get(error);
      if (epoch === undefined || epoch !== generation) return null;
      const resolver = sdk.getMultiFactorResolver(auth, error);
      const factors = resolver.hints.filter(factor => factor.factorId === sdk.TotpMultiFactorGenerator.FACTOR_ID);
      if (!factors.length) throw new Error('This account has no supported authenticator. Contact the project administrator to recover access.');
      return { factors: factors.map(({ uid, displayName }) => ({ uid, name: displayName || 'Authenticator' })),
        resolve: (uid, code) => {
          if (!factors.some(factor => factor.uid === uid) || !/^\d{6}$/.test(code)) throw new Error('Enter the six-digit code from your authenticator.');
          return perform(() => resolver.resolveSignIn(sdk.TotpMultiFactorGenerator.assertionForSignIn(uid, code)), epoch);
        }, cancel: () => { if (generation === epoch) generation++; } };
    },
    signOut() {
      generation++;
      // Clear Firebase's current user immediately as well as the workbench UI.
      // Reauthentication updates tokens without beforeAuthStateChanged, but only
      // persists/notifies while that same user is still current in the SDK.
      const pending = queue, result = Promise.resolve(sdk.signOut(auth));
      queue = Promise.all([pending.catch(() => {}), result.catch(() => {})]).then(() => {});
      return result;
    },
    reauthenticate(user, password) {
      if (requiresPassword(user)) {
        if (!password || !user.email) throw new Error('Enter your password to confirm deletion.');
        return perform(() => sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, password)));
      }
      return perform(() => sdk.reauthenticateWithPopup(user, new sdk.GoogleAuthProvider()));
    },
    deleteUser: user => sdk.deleteUser(user),
  };
}
