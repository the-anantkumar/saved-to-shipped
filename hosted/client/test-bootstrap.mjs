// Test-only entry. Never imported by build-client.mjs or production assets.
import { installHostedWorkbench } from './workbench.mjs';
let notify, active = null;
async function signIn(user = 'alice') {
  const response = await fetch(`/__fixture__/identity?user=${encodeURIComponent(user)}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Synthetic identity fixture unavailable.');
  const identity = await response.json();
  active = { uid: identity.uid, displayName: `Synthetic ${user}`, email: `${user}@example.invalid`, getIdToken: async () => identity.token };
  notify(active);
}
const workbench = installHostedWorkbench({
  async initialize(_config, onUser) { notify = onUser; await signIn('alice'); },
  signIn: () => signIn('alice'),
  signOut: async () => { active = null; notify(null); },
  reauthenticate: async () => {},
  deleteUser: async () => { active = null; notify(null); },
});
window.__fixtureSignIn = signIn;
window.__fixtureSignOut = () => workbench.logout();
