import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, browserLocalPersistence, setPersistence, onIdTokenChanged, signInWithPopup, signOut, reauthenticateWithPopup, deleteUser } from 'firebase/auth';
import { installHostedWorkbench } from './workbench.mjs';

let auth;
installHostedWorkbench({
  async initialize(config, onUser, onError) {
    auth = getAuth(initializeApp(config));
    await setPersistence(auth, browserLocalPersistence);
    onIdTokenChanged(auth, onUser, onError);
  },
  async signIn() {
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await signInWithPopup(auth, provider);
  },
  signOut: () => signOut(auth),
  reauthenticate: user => reauthenticateWithPopup(user, new GoogleAuthProvider()),
  deleteUser: user => deleteUser(user),
});
