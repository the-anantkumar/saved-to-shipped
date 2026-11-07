import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, EmailAuthProvider, browserLocalPersistence, setPersistence, onIdTokenChanged,
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification,
  sendPasswordResetEmail, reload, signOut, reauthenticateWithPopup, reauthenticateWithCredential, deleteUser } from 'firebase/auth';
import { createFirebaseAuthentication } from './firebase-auth.mjs';
import { installHostedWorkbench } from './workbench.mjs';

installHostedWorkbench(createFirebaseAuthentication({ initializeApp, getAuth, GoogleAuthProvider, EmailAuthProvider,
  browserLocalPersistence, setPersistence, onIdTokenChanged, signInWithPopup, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, sendEmailVerification, sendPasswordResetEmail, reload, signOut,
  reauthenticateWithPopup, reauthenticateWithCredential, deleteUser }));
