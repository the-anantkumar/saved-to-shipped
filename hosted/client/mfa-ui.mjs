import QRCode from 'qrcode';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const codeField = '<div class="field"><label for="hosted-totp-code">Authenticator code</label><input id="hosted-totp-code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required></div>';
const recovery = '<p class="helper">Keep a protected copy of your setup key or a backup in your authenticator. If you lose access, a project administrator must verify ownership and reset your authenticator. Password reset does not remove two-factor authentication.</p>';

/** Secrets and pending sign-in challenges live only in this screen's closure. */
export function showTotpEnrollment({ mount, user, authentication, current, message, complete }) {
  let active = true, secret = null;
  const live = () => active && mount.isConnected && current();
  const status = text => { if (live()) mount.querySelector('[role="status"]').textContent = text; };
  function firstStep() {
    secret = null;
    mount.innerHTML = '<form id="hosted-totp-setup"><div class="field"><label for="hosted-totp-password">Confirm your password</label><input id="hosted-totp-password" type="password" autocomplete="current-password" maxlength="4096" required></div><button class="button primary" type="submit">Set up authenticator</button></form><p role="status" aria-live="polite"></p>';
    mount.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const field = mount.querySelector('#hosted-totp-password'), password = field.value;
      field.value = ''; const button = event.currentTarget.querySelector('button'); button.disabled = true; status('');
      try {
        const generated = await authentication.beginTotpEnrollment(user, password);
        if (!live()) return;
        secret = generated; await codeStep();
      } catch (error) { status(message(error)); }
      finally { if (live() && button.isConnected) button.disabled = false; }
    });
  }
  async function codeStep() {
    mount.innerHTML = `<p>Add save2ship to your authenticator app by scanning this code, or enter the setup key manually.</p><canvas aria-label="Authenticator setup QR code" class="hosted-totp-qr"></canvas><div class="field"><label for="hosted-totp-key">Setup key</label><input id="hosted-totp-key" value="${escape(secret.secretKey)}" readonly autocomplete="off" spellcheck="false"></div>${recovery}<form id="hosted-totp-enroll">${codeField}<label class="hosted-auth-check"><input type="checkbox" required> I have a protected backup of my authenticator or setup key.</label><button class="button primary" type="submit">Enable two-factor authentication</button></form><button class="quiet-link" id="hosted-totp-restart" type="button">Start setup again</button><p role="status" aria-live="polite"></p>`;
    mount.querySelector('#hosted-totp-restart').addEventListener('click', firstStep);
    mount.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      const field = mount.querySelector('#hosted-totp-code'), code = field.value.trim(); field.value = '';
      if (!/^\d{6}$/.test(code)) return status('Enter the six-digit code from your authenticator.');
      const enrolled = secret, buttons = mount.querySelectorAll('button');
      for (const button of buttons) button.disabled = true;
      status('');
      try {
        await authentication.enrollTotp(user, enrolled, code);
        if (!live()) return;
        secret = null; mount.replaceChildren(); await complete();
      } catch (error) { status(message(error)); }
      finally { if (live()) for (const button of buttons) button.disabled = false; }
    });
    try {
      await QRCode.toCanvas(mount.querySelector('canvas'), secret.generateQrCodeUrl(user.email, 'save2ship'),
        { width: 208, margin: 2, color: { dark: '#151515', light: '#ffffff' } });
    } catch { status('Use the setup key above if the QR code cannot be displayed.'); }
    if (live()) mount.querySelector('#hosted-totp-code')?.focus();
  }
  firstStep();
  return () => { active = false; secret = null; mount.replaceChildren(); };
}

export function showTotpChallenge({ mount, challenge, current, message, complete, cancel = () => {} }) {
  let active = true, finished = false;
  const factors = challenge.factors;
  const live = () => active && mount.isConnected && current();
  mount.innerHTML = `<form id="hosted-totp-challenge">${factors.length > 1 ? `<div class="field"><label for="hosted-totp-factor">Authenticator</label><select id="hosted-totp-factor">${factors.map(factor => `<option value="${escape(factor.uid)}">${escape(factor.name)}</option>`).join('')}</select></div>` : ''}${codeField}<button class="button primary" type="submit">Verify and continue</button></form><p class="helper">Lost your authenticator? Contact the project administrator to verify ownership and recover access.</p><p role="status" aria-live="polite"></p>`;
  mount.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    const field = mount.querySelector('#hosted-totp-code'), code = field.value.trim(); field.value = '';
    const status = mount.querySelector('[role="status"]');
    if (!/^\d{6}$/.test(code)) { status.textContent = 'Enter the six-digit code from your authenticator.'; return; }
    const uid = mount.querySelector('select')?.value || factors[0].uid;
    const button = event.currentTarget.querySelector('button'); button.disabled = true; status.textContent = '';
    try {
      await challenge.resolve(uid, code);
      if (!live()) return;
      finished = true; mount.replaceChildren(); await complete();
    } catch (error) { if (live()) status.textContent = message(error); }
    finally { if (live() && button.isConnected) button.disabled = false; }
  });
  mount.querySelector('#hosted-totp-code').focus();
  return (cancelPending = true) => { active = false; mount.replaceChildren(); if (!finished && cancelPending) { challenge.cancel?.(); cancel(); } };
}
