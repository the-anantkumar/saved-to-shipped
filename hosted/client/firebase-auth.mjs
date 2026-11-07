/** Firebase-only adapter. The workbench never stores an email password. */
export function createFirebaseAuthentication(sdk) {
  let auth;
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
      sdk.onIdTokenChanged(auth, onUser, onError);
    },
    async signIn() {
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await sdk.signInWithPopup(auth, provider);
    },
    signInWithEmail: (email, password) => sdk.signInWithEmailAndPassword(auth, email, password),
    async signUpWithEmail(email, password) {
      const { user } = await sdk.createUserWithEmailAndPassword(auth, email, password);
      try { await sdk.sendEmailVerification(user); return { user }; }
      catch (verificationError) { return { user, verificationError }; }
    },
    async resetPassword(email) {
      try { await sdk.sendPasswordResetEmail(auth, email); }
      catch (error) { if (error.code !== 'auth/user-not-found') throw error; }
    },
    sendVerification: user => sdk.sendEmailVerification(user),
    async reloadUser(user) { await sdk.reload(user); await user.getIdToken(true); },
    needsVerification,
    requiresPassword,
    signOut: () => sdk.signOut(auth),
    reauthenticate(user, password) {
      if (requiresPassword(user)) {
        if (!password || !user.email) throw new Error('Enter your password to confirm deletion.');
        return sdk.reauthenticateWithCredential(user, sdk.EmailAuthProvider.credential(user.email, password));
      }
      return sdk.reauthenticateWithPopup(user, new sdk.GoogleAuthProvider());
    },
    deleteUser: user => sdk.deleteUser(user),
  };
}
