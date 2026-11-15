const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const count = value => Number.isSafeInteger(value) && value >= 0 ? value.toLocaleString() : '—';
const date = value => Number.isSafeInteger(value) && value > 0 && Number.isFinite(new Date(value).getTime())
  ? new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(value) : null;
const checkoutURL = value => typeof value === 'string' && /^https:\/\/rzp\.io\/(?:rzp|i)\/[A-Za-z0-9_-]{1,100}$/.test(value);
const pending = info => ['CREATING', 'UNCERTAIN'].includes(info?.checkout?.status);
const priceReady = info => info?.available === true && info.entitlements?.enabled === true && ['test', 'live'].includes(info.mode) &&
  Number.isSafeInteger(info.price?.amount) && info.price.amount > 0 && info.price.currency === 'INR' &&
  info.price.period === 'monthly' && Number.isSafeInteger(info.price.total_count) && info.price.total_count > 0;

function billingMessage(error) {
  if (['BILLING_DISABLED', 'BILLING_UNAVAILABLE', 'BILLING_CONFIGURATION_INVALID'].includes(error?.code)) return 'Upgrades are being prepared. Your current workspace is still available.';
  if (error?.code === 'RECENT_SIGN_IN_REQUIRED') return 'Confirm your sign-in again before cancelling renewal.';
  if (error?.code === 'BILLING_CLOSED') return 'That checkout is closed. Check payment status before starting again.';
  if (error?.code === 'BILLING_CANCELLATION_PENDING') return 'Cancellation is still being confirmed. Check payment status before trying again.';
  return 'We could not confirm the payment status. Check again before starting another checkout.';
}

/** All displayed access comes from the server. A checkout redirect never grants a plan. */
export function createBillingUI({ getUser, getEpoch, request, modal, requiresPassword, reauthenticate, authMessage, refresh }) {
  let view = null, intent = null;
  function closeView() {
    if (!view) return;
    view.active = false; view.dialog.removeEventListener('close', view.closed); view.observer.disconnect(); view = null;
  }
  function reset() {
    const previous = view; closeView(); intent = null;
    if (previous?.frame.isConnected) { previous.frame.replaceChildren(); if (previous.dialog.open) previous.dialog.close(); }
  }
  function currentIntent(owner) {
    if (!intent || intent.uid !== owner.uid || intent.epoch !== owner.epoch)
      intent = { uid: owner.uid, epoch: owner.epoch, id: crypto.randomUUID(), uncertain: false };
    return intent;
  }
  function applyInfo(owner, info) {
    owner.info = info;
    if (intent?.uid === owner.uid && intent.epoch === owner.epoch) intent.uncertain = pending(info);
  }
  function alive(owner) { return owner.active && view === owner && getUser()?.uid === owner.uid && getEpoch() === owner.epoch && owner.frame.isConnected && owner.dialog.open; }
  function status(owner, message) { if (alive(owner)) owner.frame.querySelector('[role="status"]').textContent = message; }
  function controls(owner) { for (const button of owner.frame.querySelectorAll('button')) button.disabled = owner.busy; }
  async function updateWorkspace(owner) {
    if (!alive(owner)) return;
    try { await refresh?.(); } catch { /* The billing result remains authoritative; ordinary refresh can retry later. */ }
    if (!alive(owner)) return;
  }

  function render(owner, message = '') {
    if (!alive(owner)) return;
    const info = owner.info;
    if (!info) {
      owner.frame.innerHTML = '<p>Loading your plan…</p><p role="status" aria-live="polite"></p><button class="button" data-billing="load">Try again</button>';
      owner.frame.querySelector('button').hidden = !message;
    } else {
      const entitlement = info.entitlements || {}, pro = entitlement.plan === 'pro', subscription = info.subscription;
      const uncertain = pending(info) || (intent?.uid === owner.uid && intent.epoch === owner.epoch && intent.uncertain);
      const end = date(subscription?.period_end), pointEnd = date(entitlement.points?.period_end);
      const closed = subscription?.closed === true;
      const resumable = info.checkout?.status === 'CREATED' && !closed;
      const canCheckout = priceReady(info) && !pro && !uncertain && (!subscription || closed || resumable);
      const canCancel = subscription && !subscription.cancel_at_end && !closed;
      const price = priceReady(info) ? new Intl.NumberFormat(undefined, { style: 'currency', currency: 'INR' }).format(info.price.amount / 100) : null;
      owner.frame.innerHTML = `${info.mode === 'test' ? '<p class="billing-test"><strong>Test mode.</strong> Use only Razorpay test payment details. This does not create a live subscription.</p>' : ''}
        ${entitlement.enabled ? `<p>Your plan: <strong>${pro ? 'Pro' : 'Free'}</strong></p><dl class="billing-overview"><dt>Saved items</dt><dd>${count(entitlement.saves?.used)} / ${count(entitlement.saves?.limit)}</dd><dt>Sections</dt><dd>${count(entitlement.sections?.used)} / ${count(entitlement.sections?.limit)}</dd><dt>Organization points</dt><dd>${count(entitlement.points?.remaining)} left of ${count(entitlement.points?.limit)}<br><small>${count(entitlement.points?.used)} used · ${count(entitlement.points?.reserved)} held for pending work</small></dd></dl><p class="billing-note">${pointEnd ? (pro ? `This allowance ends ${escape(pointEnd)} (UTC). New points follow the next confirmed paid period.` : `Points reset ${escape(pointEnd)} (UTC).`) : 'Points refresh with each allowance period.'} Unused points do not roll over.</p>` : '<p>Your current workspace remains available. Plan details are being prepared.</p>'}
        <details><summary>Compare Free and Pro</summary><table class="billing-plans"><caption>Starting plan allowances</caption><thead><tr><th scope="col">Included</th><th scope="col">Free</th><th scope="col">Pro</th></tr></thead><tbody><tr><th scope="row">Saves</th><td>100</td><td>1,000</td></tr><tr><th scope="row">Sections</th><td>3</td><td>25</td></tr><tr><th scope="row">Organization points</th><td>20 / month</td><td>200 / paid month</td></tr></tbody></table></details>
        <p>One successfully AI-organized save uses one point. Notes, manual organization, reading progress and exports use zero points.</p>
        <p><strong>Retrieval and AI use your own provider accounts.</strong> Apify retrieval and OpenAI usage are billed separately by those providers. A save2ship subscription does not pay their fees.</p>
        ${price ? `<p><strong>Pro: ${escape(price)} per month.</strong> Renews monthly for up to ${count(info.price.total_count)} payments unless cancelled. Payment details stay on Razorpay.</p>` : '<p>Upgrades are being prepared. Keep using your current workspace.</p>'}
        ${subscription?.cancel_at_end || closed ? `<p>Renewal is cancelled.${pro && end ? ` Your paid access continues until ${escape(end)} (UTC).` : ''} Your saves, notes and progress stay available; adding more is limited by your current plan.</p>` : ''}
        ${uncertain ? '<p>Checkout is still being checked. Check payment status before trying again. No new checkout will start automatically.</p>' : resumable && !pro ? '<p>A checkout is already waiting. Continue it or check payment status if you have paid.</p>' : ''}
        <div class="billing-actions">${canCheckout ? `<button class="button primary" data-billing="checkout">${resumable ? 'Continue checkout' : intent?.uid === owner.uid && intent.epoch === owner.epoch ? 'Retry checkout' : 'Open Pro checkout'}</button>` : ''}<button class="button" data-billing="sync">Check payment status</button>${canCancel ? '<button class="quiet-link" data-billing="cancel">Cancel renewal</button>' : ''}</div>
        <p class="billing-note">Changing plans never deletes your saved work. Existing items stay readable, editable and exportable if you exceed a lower plan’s limits.</p><p role="status" aria-live="polite"></p>`;
    }
    owner.frame.querySelector('[data-billing="load"]')?.addEventListener('click', () => void load(owner));
    owner.frame.querySelector('[data-billing="sync"]')?.addEventListener('click', () => void sync(owner));
    owner.frame.querySelector('[data-billing="checkout"]')?.addEventListener('click', () => void checkout(owner));
    owner.frame.querySelector('[data-billing="cancel"]')?.addEventListener('click', () => cancelConfirmation(owner));
    controls(owner); status(owner, message);
  }
  async function load(owner) {
    if (!alive(owner) || owner.busy) return;
    owner.busy = true; render(owner);
    try {
      const info = await request('/api/billing', undefined, { current: () => alive(owner) });
      if (!alive(owner)) return;
      applyInfo(owner, info); owner.busy = false; render(owner);
    } catch (error) { if (alive(owner)) { owner.busy = false; render(owner, billingMessage(error)); } }
  }
  async function sync(owner) {
    if (!alive(owner) || owner.busy) return;
    owner.busy = true; controls(owner); status(owner, 'Checking your payment status…');
    try {
      const info = await request('/api/billing/sync', {}, { current: () => alive(owner) });
      if (!alive(owner)) return;
      applyInfo(owner, info); render(owner, pending(info) ? 'The checkout is still pending. Check again later.' : 'Payment status checked. Your plan above reflects confirmed payments.');
      await updateWorkspace(owner);
      if (!alive(owner)) return;
    } catch (error) { status(owner, billingMessage(error)); }
    finally { if (alive(owner)) { owner.busy = false; controls(owner); } }
  }
  async function checkout(owner) {
    if (!alive(owner) || owner.busy || !priceReady(owner.info)) return;
    const checkoutIntent = currentIntent(owner); owner.busy = true; checkoutIntent.uncertain = true;
    controls(owner); status(owner, 'Opening your secure checkout…');
    try {
      const result = await request('/api/billing/checkout', { intent_id: checkoutIntent.id }, { current: () => alive(owner) });
      if (!alive(owner)) return;
      if (!checkoutURL(result?.checkout_url)) throw new Error('Unsafe checkout URL');
      // The initiating click authorized navigation, not a local plan upgrade.
      window.location.assign(result.checkout_url);
    } catch (error) { if (alive(owner)) { owner.busy = false; render(owner, billingMessage(error)); } }
  }
  function cancelConfirmation(owner) {
    if (!alive(owner) || owner.busy) return;
    owner.frame.innerHTML = `<div class="billing-confirm"><h3>Cancel your next renewal?</h3><p>Any paid access continues until the end of its paid period. Your saves, notes and progress are kept. Adding more after that follows Free limits.</p><form id="hosted-billing-cancel">${requiresPassword(owner.user) ? '<div class="field"><label for="hosted-billing-password">Confirm your password</label><input id="hosted-billing-password" type="password" autocomplete="current-password" maxlength="4096" required></div>' : '<p>Confirm your Google sign-in to continue.</p>'}<div class="billing-actions"><button class="button danger" type="submit">Confirm cancellation</button><button class="button" data-billing="back" type="button">Keep renewal</button></div></form><div id="hosted-billing-mfa"></div><p role="status" aria-live="polite"></p></div>`;
    owner.frame.querySelector('[data-billing="back"]').addEventListener('click', () => owner.recovery ? owner.dialog.close() : render(owner));
    owner.frame.querySelector('form').addEventListener('submit', event => {
      event.preventDefault(); const field = owner.frame.querySelector('#hosted-billing-password');
      const password = field?.value || ''; if (field) field.value = '';
      void cancel(owner, password);
    });
  }
  async function cancel(owner, password) {
    if (!alive(owner) || owner.busy) return;
    owner.busy = true; controls(owner); status(owner, 'Confirming your sign-in…');
    let submitted = false;
    try {
      await reauthenticate(owner.user, password, () => alive(owner), owner.frame.querySelector('#hosted-billing-mfa'));
      if (!alive(owner)) return;
      submitted = true; status(owner, 'Cancelling renewal…');
      const result = await request('/api/billing/cancel', {}, { fresh: true, session: false, current: () => alive(owner) });
      if (!alive(owner)) return;
      if (result?.cancelled !== true) throw new Error('Cancellation not confirmed');
      owner.frame.innerHTML = '<h3>Renewal cancelled.</h3><p>Your saved work is kept. Any paid access continues through its paid period.</p><p role="status" aria-live="polite"></p>';
      if (!owner.recovery) {
        // Cancellation is already confirmed, even when normal workspace reads
        // have become unavailable. Never turn that into an uncertain payment.
        try {
          const info = await request('/api/billing', undefined, { current: () => alive(owner) });
          if (!alive(owner)) return;
          applyInfo(owner, info); render(owner, 'Renewal cancelled. Your saved work is kept.');
          await updateWorkspace(owner);
          if (!alive(owner)) return;
        } catch { /* Keep the confirmed receipt visible without private plan data. */ }
      }
    } catch (error) {
      if (!alive(owner)) return;
      if (submitted) {
        if (!owner.recovery) render(owner, 'We could not confirm cancellation. Check payment status before trying again.');
        else status(owner, 'We could not confirm cancellation. Your workspace remains closed. Try confirming cancellation again.');
      }
      else status(owner, authMessage(error));
    } finally { if (alive(owner)) { owner.busy = false; controls(owner); } }
  }
  async function open(recovery = false) {
    const user = getUser(); if (!user) return;
    closeView();
    modal(recovery ? 'Cancel subscription renewal' : 'Your plan and points', '<section id="hosted-billing"></section>');
    const owner = { user, uid: user.uid, epoch: getEpoch(), dialog: document.querySelector('#modal'), frame: document.querySelector('#hosted-billing'), active: true, busy: false, info: null, recovery };
    owner.close = () => { if (view === owner) closeView(); };
    // A previous close event can arrive after this same native dialog reopens.
    owner.closed = () => { if (!owner.dialog.open) owner.close(); };
    owner.observer = new MutationObserver(() => { if (!alive(owner)) owner.close(); });
    view = owner; owner.dialog.addEventListener('close', owner.closed);
    owner.observer.observe(owner.dialog, { childList: true, subtree: true });
    if (recovery) return cancelConfirmation(owner);
    render(owner); await load(owner);
    if (!alive(owner)) return;
  }
  return { open: () => open(), openCancellation: () => open(true), reset };
}
