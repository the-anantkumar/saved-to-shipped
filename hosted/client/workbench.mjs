import { HostedTransport } from './transport.mjs';
import { ARCHIVE_LIMIT, exportZIP, syntheticZIP, restoreChunks } from './archive.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
let authentication, currentUser = null, hooks, starting = false, worker = null, parsedImport = null, emailView = 'closed';
const transport = new HostedTransport({ getUser: () => currentUser, onReset: () => hooks?.reset() });

function emailControls() {
  if (!authentication.signInWithEmail) return '';
  if (emailView === 'closed') return '<button class="quiet-link" id="hosted-email-toggle">Continue with email</button>';
  const signup = emailView === 'signup', reset = emailView === 'reset';
  return `<form id="hosted-email-form" class="hosted-auth-form"><div class="field"><label for="hosted-email">Email</label><input id="hosted-email" type="email" required maxlength="254" autocomplete="username" autocapitalize="none" spellcheck="false"></div>${reset ? '' : `<div class="field"><label for="hosted-password">Password</label><input id="hosted-password" type="password" required ${signup ? 'minlength="6"' : ''} maxlength="4096" autocomplete="${signup ? 'new-password' : 'current-password'}"></div>`}<button class="button primary" type="submit">${reset ? 'Send reset link' : signup ? 'Create account' : 'Sign in with email'}</button><div class="hosted-auth-options">${signup || reset ? '<button class="quiet-link" type="button" data-auth-view="signin">Back to sign in</button>' : '<button class="quiet-link" type="button" data-auth-view="signup">Create an account</button><button class="quiet-link" type="button" data-auth-view="reset">Forgot password?</button>'}</div></form>`;
}

function passwordConfirmation() {
  return authentication.requiresPassword?.(currentUser) ? '<div class="field"><label for="hosted-confirm-password">Confirm your password</label><input id="hosted-confirm-password" type="password" required maxlength="4096" autocomplete="current-password"></div>' : '';
}

function gate(title, message, { login = false, retry = false, deletion = false, verification = false } = {}) {
  document.body.dataset.hostedGate = 'true';
  document.querySelector('#sidebar').innerHTML = '';
  document.querySelector('#main').classList.remove('board-page', 'reading-page');
  document.querySelector('#main').innerHTML = `<section class="hosted-gate"><a class="brand" href="/">save2ship<span class="brand-period">.</span></a><span class="eyebrow">A LITTLE LESS SAVING. A LITTLE MORE DOING.</span><h1 tabindex="-1">${escape(title)}</h1><p>${escape(message)}</p>${login ? `<div class="hosted-auth-options"><button class="button ${emailView === 'closed' ? 'primary' : ''}" id="hosted-sign-in">Continue with Google</button>${emailControls()}</div>` : ''}${verification ? '<div class="hosted-auth-options"><button class="button primary" id="hosted-verify-check">I verified my email</button><button class="quiet-link" id="hosted-verify-send">Resend verification email</button></div>' : ''}${retry ? '<button class="button" id="hosted-retry">Try again</button>' : ''}${deletion ? `<p>Your workspace is frozen while deletion finishes. A known provider run may still be active. We keep its details so it can be stopped safely.</p><form id="hosted-deletion-form"><div class="field"><label for="hosted-replacement-apify-token">Replacement Apify token (optional)</label><input id="hosted-replacement-apify-token" type="password" maxlength="2048" autocomplete="off" autocapitalize="none" spellcheck="false"></div>${passwordConfirmation()}<p class="helper">Use a working token for the same Apify account. It is encrypted on the server and removed with your workspace. Retrying does not submit new provider work. Confirm your sign-in again to continue.</p><button class="button primary" type="submit">Retry deletion</button></form>` : ''}<p id="hosted-auth-status" role="status" aria-live="polite"></p>${currentUser ? '<button class="quiet-link" id="hosted-sign-out">Sign out</button>' : ''}<p class="helper">${deletion ? 'Your saved data and membership remain locked until deletion completes.' : 'Your private workspace follows you between devices. Retrieval and optional AI use your own provider accounts.'}</p></section>`;
  document.querySelector('#hosted-sign-in')?.addEventListener('click', loginWithGoogle);
  document.querySelector('#hosted-email-toggle')?.addEventListener('click', () => showEmail('signin'));
  for (const button of document.querySelectorAll('[data-auth-view]')) button.addEventListener('click', () => showEmail(button.dataset.authView));
  document.querySelector('#hosted-email-form')?.addEventListener('submit', event => { event.preventDefault(); void submitEmail(event.currentTarget); });
  document.querySelector('#hosted-verify-check')?.addEventListener('click', () => void verifyEmail(false));
  document.querySelector('#hosted-verify-send')?.addEventListener('click', () => void verifyEmail(true));
  document.querySelector('#hosted-sign-out')?.addEventListener('click', logout);
  document.querySelector('#hosted-retry')?.addEventListener('click', openWorkspace);
  document.querySelector('#hosted-deletion-form')?.addEventListener('submit', event => {
    event.preventDefault();
    const field = document.querySelector('#hosted-replacement-apify-token');
    const token = field.value.trim(); field.value = '';
    const password = takePassword();
    event.currentTarget.querySelector('button').disabled = true;
    void retryDelete(token, password);
  });
}

function showEmail(view) {
  const email = document.querySelector('#hosted-email')?.value || '';
  emailView = view;
  gate(view === 'signup' ? 'Make room for what matters.' : view === 'reset' ? 'Find your way back.' : 'Your ideas, ready when you are.',
    view === 'signup' ? 'Create your account, then verify your email to open your workspace.' : view === 'reset' ? 'We will send a link to reset your password.' : 'Sign in to keep your saves, projects and reading together.', { login: true });
  const field = document.querySelector('#hosted-email'); field.value = email; field.focus();
}

function authStatus(message) { const status = document.querySelector('#hosted-auth-status'); if (status) status.textContent = message; }

async function submitEmail(form) {
  const email = form.querySelector('#hosted-email').value.trim(), passwordField = form.querySelector('#hosted-password');
  const password = passwordField?.value || '', view = emailView;
  if (passwordField) passwordField.value = '';
  for (const button of form.querySelectorAll('button')) button.disabled = true;
  authStatus('');
  try {
    if (view === 'reset') {
      await authentication.resetPassword(email);
      if (form.isConnected) authStatus('If this email has a password account, a reset link is on its way. Check your inbox and spam folder.');
    } else if (view === 'signup') {
      const result = await authentication.signUpWithEmail(email, password);
      if (result?.verificationError && result.user?.uid === currentUser?.uid && authentication.needsVerification?.(currentUser))
        verificationGate(authMessage(result.verificationError));
    }
    else await authentication.signInWithEmail(email, password);
  } catch (error) {
    if (form.isConnected) authStatus(authMessage(error));
  } finally { if (form.isConnected) for (const button of form.querySelectorAll('button')) button.disabled = false; }
}

function verificationGate(message = '') {
  gate('One quick email check.', 'Open the verification email, then come back here. Your workspace opens after your email is verified.', { verification: true });
  if (message) authStatus(message);
}

async function verifyEmail(resend) {
  const user = currentUser, epoch = transport.epoch;
  if (!user) return;
  const active = () => currentUser?.uid === user.uid && transport.epoch === epoch;
  const buttons = document.querySelectorAll('#hosted-verify-check, #hosted-verify-send');
  for (const button of buttons) button.disabled = true;
  authStatus('');
  try {
    if (resend) { await authentication.sendVerification(user); if (active()) authStatus('Verification email sent. Check your inbox and spam folder.'); }
    else {
      await authentication.reloadUser(user);
      if (!active()) return;
      if (authentication.needsVerification(user)) authStatus('Your email is not verified yet. Open the link in your verification email, then try again.');
      else await openWorkspace();
    }
  } catch (error) { if (active()) authStatus(authMessage(error)); }
  finally { for (const button of buttons) if (button.isConnected) button.disabled = false; }
}

function deletionGate(message) {
  worker?.terminate(); worker = null; parsedImport = null;
  transport.reset(currentUser?.uid || null);
  history.replaceState(null, '', '/');
  gate('Deletion needs one more step.', message || 'Workspace deletion is paused. Retry to finish removing your data.', { deletion: true });
}

function authMessage(error) {
  const code = error?.code;
  if (['auth/popup-closed-by-user', 'auth/cancelled-popup-request'].includes(code)) return 'Sign-in was cancelled. You can try again whenever you are ready.';
  if (code === 'auth/popup-blocked') return 'Allow the Google sign-in popup, then try again.';
  if (code === 'auth/unauthorized-domain') return 'Google sign-in is not configured for this address yet.';
  if (['auth/invalid-credential', 'auth/user-not-found', 'auth/wrong-password'].includes(code)) return 'Email or password is incorrect. Try again or reset your password.';
  if (code === 'auth/invalid-email') return 'Enter a valid email address.';
  if (code === 'auth/email-already-in-use') return 'Could not create this account. Try signing in or resetting your password.';
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') return 'Choose a stronger password with at least six characters.';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Wait a little before trying again.';
  if (code === 'auth/network-request-failed') return 'Check your connection, then try again.';
  if (code === 'auth/operation-not-allowed') return 'This sign-in method is not configured yet.';
  if (code === 'auth/account-exists-with-different-credential') return 'Use the sign-in method you previously used for this email.';
  return error?.message && !String(code).startsWith('auth/') ? error.message : 'Sign-in could not finish. Please try again.';
}

async function loginWithGoogle() {
  const button = document.querySelector('#hosted-sign-in'); if (button) button.disabled = true;
  try { await authentication.signIn(); }
  catch (error) { if (button?.isConnected) authStatus(authMessage(error)); }
  finally { if (button?.isConnected) button.disabled = false; }
}

async function openWorkspace() {
  if (!currentUser) return gate('Make room for what matters.', 'Sign in to keep your saves, projects and reading together.', { login: true });
  if (authentication.needsVerification?.(currentUser)) return verificationGate();
  const uid = currentUser.uid, epoch = transport.epoch;
  try { await transport.session(); if (currentUser?.uid === uid && transport.epoch === epoch) { delete document.body.dataset.hostedGate; await hooks.open(); } }
  catch (error) {
    if (currentUser?.uid !== uid || transport.epoch !== epoch) return;
    if (error.code === 'ACCOUNT_DELETING') deletionGate(error.message);
    else gate(error.code === 'BETA_FULL' ? 'A little room is opening soon.' : 'Could not open your workspace.', error.message, { retry: error.code !== 'BETA_FULL' });
  }
}

async function start(callbacks) {
  hooks = callbacks;
  if (starting) return;
  starting = true;
  try {
    const response = await fetch('/api/config', { cache: 'no-store', credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('The hosted configuration could not be loaded.');
    const config = await response.json();
    if (config.mode !== 'hosted') throw new Error('This address is not configured as a hosted workspace.');
    if (!config.enabled || !config.firebase?.apiKey || !config.firebase?.projectId || !config.firebase?.authDomain) {
      gate('A little room is being made.', 'The hosted beta is being prepared. Sign-in will appear here when it is ready.'); return;
    }
    let observed = false, neededVerification = false;
    await authentication.initialize(config.firebase, user => {
      const changed = currentUser?.uid !== user?.uid;
      const verificationNeeded = Boolean(authentication.needsVerification?.(user));
      const verificationChanged = verificationNeeded !== neededVerification;
      neededVerification = verificationNeeded;
      if (changed && currentUser) history.replaceState(null, '', '/');
      currentUser = user;
      if (changed || !observed || verificationChanged) {
        observed = true;
        parsedImport = null; worker?.terminate(); worker = null;
        transport.reset(user?.uid || null); openWorkspace();
      }
    }, error => gate('Sign-in needs another try.', authMessage(error), { login: true }));
  } catch (error) { gate('Could not open the hosted workbench.', authMessage(error)); }
}

async function logout() {
  worker?.terminate(); worker = null; parsedImport = null;
  // Discard private browser state immediately, even if Firebase's local sign-out fails.
  currentUser = null; emailView = 'closed'; transport.reset();
  history.replaceState(null, '', '/');
  try { await authentication.signOut(); } finally { gate('See you when you are ready.', 'Your saved workspace will be here when you sign in again.', { login: true }); }
}

function accountDialog() {
  hooks.modal('Your workspace', `<p>Signed in as <strong>${escape(currentUser?.email || currentUser?.displayName || 'Member')}</strong>.</p><p>Your saves and encrypted provider keys are stored in your private hosted workspace. Signing out clears this browser’s workbench cache.</p><div class="hosted-account-actions"><button class="button" data-action="hosted-signout">Sign out</button><button class="quiet-link" data-action="hosted-restore">Restore a backup</button><button class="quiet-link danger" data-action="hosted-delete">Delete my account and workspace</button></div>`);
}

async function removeAccount() {
  hooks.modal('Delete your workspace?', `<p>This permanently removes your hosted saves, notes, projects and stored provider credentials. Export a backup first if you want to keep them. Confirm your sign-in before deletion.</p><p>Any provider run already submitted may still incur charges. Resolve pending work before deleting your account.</p>${passwordConfirmation()}`, '<button class="button" data-action="close">Keep my workspace</button><button class="button danger" data-action="hosted-confirm-delete">Delete permanently</button>');
}
function takePassword() {
  const field = document.querySelector('#hosted-confirm-password');
  const password = field?.value || '';
  if (field) field.value = '';
  return password;
}
async function deleteAccount(apifyToken = '', password = '') {
  if (!currentUser) return;
  const user = currentUser, epoch = transport.epoch;
  await authentication.reauthenticate(user, password);
  if (currentUser?.uid !== user.uid || epoch !== transport.epoch) throw new Error('Account changed. Open account settings again.');
  // Paused deletion cannot obtain a workspace session. This endpoint accepts only
  // the freshly verified identity and cannot read or mutate ordinary workspace data.
  await transport.raw('/api/account/delete', { session: false, refreshToken: true, data: apifyToken ? { apify_token: apifyToken } : {} });
  try { await authentication.deleteUser(user); }
  catch { await logout(); gate('Your workspace was deleted.', 'The sign-in profile could not be removed. Your hosted workspace and saved provider keys have been deleted.'); return; }
  await logout(); gate('Your workspace was deleted.', 'Your hosted saves and provider keys have been removed.');
}
async function confirmDelete() {
  try { await deleteAccount('', takePassword()); }
  catch (error) { if (error.code === 'ACCOUNT_DELETING') deletionGate(error.message); else throw new Error(authMessage(error)); }
}
async function retryDelete(token, password) {
  const uid = currentUser?.uid;
  try { await deleteAccount(token, password); }
  catch (error) { if (uid && currentUser?.uid === uid) deletionGate(authMessage(error)); }
}

function download(bytes, filename, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportData() { const workspace = await transport.exportWorkspace(); download(exportZIP(workspace), 'saved-to-shipped.zip', 'application/zip'); }
async function downloadPrompt() {
  const result = await transport.api('/api/prompt');
  download(result.prompt || result.text || '', 'triage_prompt.md', 'text/markdown');
}

async function parseFile(file, mode = 'import') {
  if (!file || file.size > ARCHIVE_LIMIT) throw new Error('Choose a file smaller than 128 MiB.');
  worker?.terminate();
  const owned = new Worker('/import-worker.js', { type: 'module' }); worker = owned;
  const bytes = await file.arrayBuffer();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { owned.terminate(); reject(new Error('Archive processing took too long. Choose the data file directly.')); }, 30_000);
    const finish = () => { clearTimeout(timer); owned.terminate(); if (worker === owned) worker = null; };
    owned.onmessage = ({ data }) => { finish(); if (data.ok) resolve(data); else reject(new Error(data.error)); };
    owned.onerror = () => { finish(); reject(new Error('The archive could not be read. Choose the data file directly.')); };
    owned.postMessage({ bytes, filename: file.name, mode }, [bytes]);
  });
}

function importDialog() {
  parsedImport = null;
  hooks.modal('Bring your saves in.', '<p>Choose your LinkedIn archive. Only Saved Items rows leave your device; unrelated archive files stay here.</p><label class="dropzone" for="hosted-archive-file">Choose a ZIP or Saved Items CSV<input id="hosted-archive-file" type="file" accept=".zip,.csv"></label><p class="helper">Up to 128 MiB for the archive and 8 MiB for Saved Items. Existing notes and organization are preserved. Interrupted imports can be resumed by selecting the same file.</p><button class="quiet-link" data-action="hosted-sample">Download a synthetic test ZIP</button><div id="hosted-import-plan" role="status"></div>', '<button class="button" data-action="close">Cancel</button><button class="button primary" data-action="hosted-import-review">Review import</button>');
}

async function reviewImport() {
  const file = document.querySelector('#hosted-archive-file')?.files[0];
  const status = document.querySelector('#hosted-import-plan');
  status.textContent = 'Reading Saved Items on your device…';
  const userId = currentUser?.uid;
  const parsed = await parseFile(file);
  if (!userId || currentUser?.uid !== userId) throw new Error('Account changed. Choose the file again.');
  const rows = parsed.rows.slice(0, 1000);
  if (!rows.length) throw new Error('No saved LinkedIn links were found in this CSV.');
  let added = 0, duplicates = 0, estimatedBytes = 0, availableItems, availableBytes;
  for (let offset = 0; offset < rows.length; offset += 25) {
    const plan = await transport.api('/api/import/plan', { rows: rows.slice(offset, offset + 25) });
    added += Number(plan.added ?? plan.new_items ?? plan.newItems ?? 0);
    duplicates += Number(plan.duplicates || 0);
    estimatedBytes += Number(plan.estimated_logical_bytes || 0);
    availableItems = plan.remaining_items; availableBytes = plan.remaining_logical_bytes;
  }
  // Keep one stable operation for retries. A later review may restore a deliberately
  // removed save; content-addressed row IDs deduplicate an interrupted earlier operation.
  parsedImport = { ...parsed, import_id: `${parsed.import_id}-${crypto.randomUUID()}`, rows, filename: 'LinkedIn Saved Items', uid: userId };
  const capacity = transport.summary?.usage;
  const space = availableItems === undefined ? '' : `<p>Room for ${Number(availableItems)} more saves and approximately ${(Number(availableBytes || 0) / 1_000_000).toFixed(2)} MB of content. New rows are estimated at ${(estimatedBytes / 1_000_000).toFixed(2)} MB before processing records; repeated links across chunks may reduce this estimate.</p>`;
  status.innerHTML = `<p><strong>${rows.length} saved rows ready.</strong> ${added || duplicates ? `${added} new candidates, ${duplicates} existing saves.` : 'Duplicate links will be skipped.'}</p>${space}${parsed.rows.length > rows.length ? `<p>This import processes the first ${rows.length} of ${parsed.rows.length} rows. Keep the original CSV for the remaining rows.</p>` : ''}<p>Storage limits also apply to post text and notes.${capacity ? ` You currently have ${Number(capacity.items || 0)} saves.` : ''} If a chunk exceeds capacity, earlier chunks stay saved and the remaining rows stay in your original file.</p><button class="button primary" data-action="hosted-import-confirm">Import these saves</button>`;
}

function restoreDialog() {
  parsedImport = null;
  hooks.modal('Bring a backup back.', '<p>Choose a Save2Ship ZIP backup or backlog.json. Missing saves and sections are added with their notes, organization and reading progress. Existing saves stay as they are.</p><label class="dropzone" for="hosted-archive-file">Choose a ZIP backup or JSON<input id="hosted-archive-file" type="file" accept=".zip,.json"></label><p class="helper">Version-1 backups, up to 1,000 saves and 16 MiB of JSON. Provider credentials are never restored. Storage limits apply; completed chunks remain saved if capacity runs out.</p><div id="hosted-import-plan" role="status"></div>', '<button class="button" data-action="close">Cancel</button><button class="button primary" data-action="hosted-restore-review">Review backup</button>');
}

async function reviewRestore() {
  const file = document.querySelector('#hosted-archive-file')?.files[0];
  const status = document.querySelector('#hosted-import-plan');
  status.textContent = 'Reading your backup on this device…';
  const uid = currentUser?.uid;
  const parsed = await parseFile(file, 'restore');
  if (!uid || currentUser?.uid !== uid) throw new Error('Account changed. Choose the file again.');
  const chunks = restoreChunks(parsed);
  parsedImport = { ...parsed, import_id: `${parsed.import_id}-${crypto.randomUUID()}`, chunks, filename: 'Save2Ship backup', uid, mode: 'restore' };
  const capacity = transport.summary?.usage;
  status.innerHTML = `<p><strong>${parsed.rows.length} saves and ${parsed.workspace.projects.length} sections in this backup.</strong></p><p>${capacity ? `Your workspace currently holds ${Number(capacity.items || 0)} saves. ` : ''}Only missing saves are added. If a chunk exceeds capacity or a section name conflicts, earlier chunks remain saved. You can select this same backup again to resume.</p><button class="button primary" data-action="hosted-import-confirm">Restore missing saves</button>`;
}

async function confirmImport() {
  const pending = parsedImport;
  if (!pending || pending.uid !== currentUser?.uid) throw new Error('Choose the archive again.');
  const status = document.querySelector('#hosted-import-plan'); let added = 0, duplicates = 0, processed = 0;
  const chunks = pending.chunks || Array.from({ length: Math.ceil(pending.rows.length / 25) }, (_, index) => ({ rows: pending.rows.slice(index * 25, (index + 1) * 25) }));
  for (let index = 0; index < chunks.length; index++) {
    if (pending.uid !== currentUser?.uid) throw new Error('Account changed. Choose the file again.');
    status.textContent = `${pending.mode === 'restore' ? 'Restoring' : 'Importing'} ${processed} of ${pending.rows.length} rows…`;
    const result = await transport.api(pending.mode === 'restore' ? '/api/restore' : '/api/import', {
      ...chunks[index], import_id: pending.import_id, sequence: index, filename: pending.filename,
      request_id: `import:${pending.import_id}:${index}`,
    });
    added += Number(result.added || 0); duplicates += Number(result.duplicates || 0);
    processed += chunks[index].rows.length;
  }
  parsedImport = null; document.querySelector('#modal').close();
  await hooks.refresh(); hooks.toast(`${added} saves added. ${duplicates} duplicates skipped.`);
}

export function installHostedWorkbench(adapter) {
  authentication = adapter;
  window.Save2ShipHosted = {
  start, api: (...args) => transport.api(...args), detail: (...args) => transport.detail(...args), hasDetail: id => transport.hasDetail(id),
  accountDialog, logout, removeAccount, confirmDelete, importDialog, reviewImport, confirmImport, restoreDialog, reviewRestore, exportData, downloadPrompt,
  sample: () => download(syntheticZIP(), 'synthetic-linkedin-archive.zip', 'application/zip'),
  get user() { return currentUser ? { name: currentUser.displayName || 'Your account', email: currentUser.email || '' } : null; },
  get epoch() { return transport.epoch; },
};

  return window.Save2ShipHosted;
}
