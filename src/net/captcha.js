import { CONFIG } from '../config.js';
import { STR } from '../content/strings.js';
import { el, Button, Panel } from '../ui/ui.js';

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let loading = null;

/** Loads Cloudflare's Turnstile script once (it must come from this exact URL: no proxying, no bundling). */
function loadScript() {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { loading = null; s.remove(); reject(new Error('captcha-load')); };
    document.head.append(s);
  });
  return loading;
}

/**
 * "I'm not a robot" check before opening a signalling socket. Resolves with a single-use Turnstile token, or null when
 * no site key is configured (the check is off). Rejects when the player cancels or the widget fails. The worker verifies
 * the token with siteverify; this client side part alone protects nothing.
 */
export async function solveCaptcha() {
  const sitekey = CONFIG.net.turnstileSiteKey;
  if (!sitekey) return null;
  await loadScript();
  return new Promise((resolve, reject) => {
    const box = el('div', { class: 'captcha__box' });
    let widget = null;
    const finish = (settle, value) => {
      try { if (widget != null) window.turnstile.remove(widget); } catch { /* already gone */ }
      overlay.remove();
      settle(value);
    };
    const overlay = el('div', { class: 'captcha', role: 'dialog', 'aria-modal': 'true' },
      el('div', { class: 'dialog' },
        Panel({ title: STR.net.captchaTitle, body: [el('p', { class: 'net__hint', text: STR.net.captchaHint }), box], className: 'net__panel captcha__panel' }),
        Button({ label: STR.menu.back, size: 'sm', onClick: () => finish(reject, new Error('captcha-cancel')) })));
    document.body.append(overlay);
    try {
      widget = window.turnstile.render(box, {
        sitekey,
        theme: 'dark',
        callback: token => finish(resolve, token),
        'error-callback': () => { finish(reject, new Error('captcha-error')); return true; },
        'timeout-callback': () => finish(reject, new Error('captcha-timeout')),
      });
    } catch (err) { finish(reject, err); }
  });
}
