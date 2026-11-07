// Human UAT only. This entrypoint is never bundled by the production build.
import { installHostedWorkbench } from './workbench.mjs';

const STORAGE_KEY = 'save2ship.synthetic-uat.identity';
const PEOPLE = ['alice', 'bob', 'charlie'];
let notify, active = null, sequence = 0;

function remembered() {
  try {
    const name = localStorage.getItem(STORAGE_KEY);
    return PEOPLE.includes(name) || name === 'signed-out' ? name : 'alice';
  } catch { return 'alice'; }
}
function remember(name) {
  // Only a synthetic account name persists. Tokens stay in this module's memory.
  try { localStorage.setItem(STORAGE_KEY, name); } catch { /* private mode can disable storage */ }
}

function controls() {
  const style = document.createElement('style');
  style.textContent = `
    body { padding-top: var(--uat-height, 72px); }
    #sidebar { top: var(--uat-height, 72px); }
    #uat-controls { position: fixed; inset: 0 0 auto; z-index: 50; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 9px 18px; background: var(--amber-soft); color: var(--ink); border-bottom: 1px solid var(--line-strong); font-size: 12px; }
    #uat-controls p { margin: 0; flex: 1 1 280px; line-height: 1.5; }
    #uat-controls small { display: block; color: var(--muted); }
    #uat-controls form { display: flex; align-items: center; flex-wrap: wrap; gap: 7px; }
    #uat-controls select, #uat-controls button { max-width: 100%; font: inherit; padding: 6px 9px; border: 1px solid var(--line-strong); border-radius: 6px; color: var(--ink); background: var(--paper); }
    #uat-status { flex-basis: 100%; color: var(--error-ink); }
    #uat-status:empty { display: none; }
  `;
  document.head.append(style);
  const panel = document.createElement('section');
  panel.id = 'uat-controls'; panel.setAttribute('aria-label', 'Synthetic UAT controls');
  panel.innerHTML = `<p><strong>Synthetic UAT</strong> · Local test data, mocked Google and providers.<small>No real keys needed. Restart the UAT command to reset all sample work.</small></p>
    <form><label for="uat-person">Test account</label><select id="uat-person"><option value="alice">Alice · sample workspace</option><option value="bob">Bob · empty workspace</option><option value="charlie">Charlie · beta full</option></select><button type="submit">Use account</button><button type="button" id="uat-sign-out">Sign out</button></form><span id="uat-status" role="status"></span>`;
  document.body.prepend(panel);
  const name = remembered();
  if (PEOPLE.includes(name)) panel.querySelector('select').value = name;
  panel.querySelector('form').addEventListener('submit', event => {
    event.preventDefault();
    void perform(() => signIn(panel.querySelector('select').value));
  });
  panel.querySelector('#uat-sign-out').addEventListener('click', () => void perform(() => workbench.logout()));
  new ResizeObserver(() => document.documentElement.style.setProperty('--uat-height', `${panel.getBoundingClientRect().height}px`)).observe(panel);
}

async function perform(action) {
  const panel = document.querySelector('#uat-controls');
  panel.querySelector('#uat-status').textContent = '';
  for (const button of panel.querySelectorAll('button')) button.disabled = true;
  try { await action(); }
  catch (error) { panel.querySelector('#uat-status').textContent = error.message || 'The synthetic session could not be opened. Try again.'; }
  finally { for (const button of panel.querySelectorAll('button')) button.disabled = false; }
}

async function identity(name) {
  let token = '', renewAfter = 0, pending = null;
  const user = {
    uid: `synthetic-${name}`, displayName: `Synthetic ${name}`, email: `${name}@example.invalid`,
    async getIdToken(force = false) {
      if (!force && token && Date.now() < renewAfter) return token;
      if (!pending) pending = (async () => {
        const response = await fetch(`/__fixture__/identity?user=${encodeURIComponent(name)}`, { cache: 'no-store', credentials: 'omit' });
        if (!response.ok) throw new Error('Synthetic identity fixture unavailable. Restart the UAT command if it was stopped.');
        const fresh = await response.json();
        if (fresh.uid !== user.uid || typeof fresh.token !== 'string') throw new Error('Invalid synthetic identity.');
        token = fresh.token; renewAfter = Date.now() + 50 * 60_000;
        return token;
      })();
      try { return await pending; } finally { pending = null; }
    },
  };
  await user.getIdToken();
  return user;
}

async function signIn(name = 'alice', persist = true) {
  if (!PEOPLE.includes(name)) throw new Error('Choose a synthetic UAT account.');
  const ticket = ++sequence;
  const user = await identity(name);
  if (ticket !== sequence) return;
  active = user;
  if (persist) remember(name);
  document.querySelector('#uat-person').value = name;
  notify(user);
}

function signedOut(persist = true) {
  sequence++; active = null;
  if (persist) remember('signed-out');
  notify(null);
}

const workbench = installHostedWorkbench({
  async initialize(_config, onUser) {
    notify = onUser; controls();
    window.addEventListener('storage', event => {
      if (event.key !== STORAGE_KEY) return;
      const name = remembered();
      if (name === 'signed-out') signedOut(false);
      else if (active?.uid !== `synthetic-${name}`) void perform(() => signIn(name, false));
    });
    const name = remembered();
    if (name === 'signed-out') signedOut(false); else await signIn(name, false);
  },
  signIn: () => signIn(document.querySelector('#uat-person')?.value || 'alice'),
  signOut: async () => signedOut(),
  reauthenticate: async user => { await user.getIdToken(true); },
  deleteUser: async () => signedOut(),
});
