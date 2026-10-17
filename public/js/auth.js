// Sign in, sign up (with email verification + consent), and password reset.
import { api } from './api.js';
import { $, $$, esc } from './util.js';
import { setBusy, showFormError, invalid, clearInvalid, toast } from './ui.js';

let config = { turnstileSiteKey: null, minimumAge: 18 };
let onAuthenticated = () => {};
let pending = null; // { purpose: 'register' | 'reset', email, name, password, consents }
let resendTimer = null;

export function initAuth({ appConfig, onSuccess }) {
  config = { ...config, ...appConfig };
  onAuthenticated = onSuccess;
  $$('[data-min-age]').forEach(el => { el.textContent = config.minimumAge; });

  $('[data-auth-panel="login"]').addEventListener('submit', submitLogin);
  $('[data-auth-panel="signup"]').addEventListener('submit', submitSignup);
  $('[data-auth-panel="forgot"]').addEventListener('submit', submitForgot);
  $('[data-auth-panel="verify"]').addEventListener('submit', submitVerify);
  $$('#auth input').forEach(input => input.addEventListener('input', () => {
    input.closest('.field')?.classList.remove('invalid');
    input.removeAttribute('aria-invalid');
  }));
  $$('[data-strength]').forEach(input => input.addEventListener('input', () => updateStrength(input)));
  setupOtpInputs();
}

export function showAuthPanel(panel) {
  if (panel === 'verify' && !pending) panel = 'signup';
  $$('[data-auth-panel]').forEach(form => { form.hidden = form.dataset.authPanel !== panel; });
  const form = $(`[data-auth-panel="${panel}"]`);
  showFormError(form, '');
  clearInvalid(form);
  document.title = `${{ login: 'Sign in', signup: 'Create account', forgot: 'Reset password', verify: 'Verify email' }[panel]} — InvoiceFlow`;
  ensureTurnstile(form);
  requestAnimationFrame(() => (panel === 'verify' ? $('.otp-inputs input', form) : $('input:not([type=checkbox]):not([tabindex="-1"])', form))?.focus());
}

// ─── Password strength ──────────────────────────────────────────────────────
function scorePassword(pw) {
  const rules = { len: pw.length >= 8, letter: /[A-Za-z]/.test(pw), num: /\d/.test(pw) };
  let score = 0;
  if (pw) score = 1;
  if (rules.len && rules.letter && rules.num) score = 2;
  if (score === 2 && pw.length >= 12) score = 3;
  if (score >= 2 && pw.length >= 12 && /[^A-Za-z0-9]/.test(pw) && /[a-z]/.test(pw) && /[A-Z]/.test(pw)) score = 4;
  return { score, rules };
}

function updateStrength(input) {
  const field = input.closest('.field');
  const { score, rules } = scorePassword(input.value);
  $('.pw-meter', field).dataset.score = score;
  $$('.pw-rules li', field).forEach(li => li.classList.toggle('ok', rules[li.dataset.rule]));
}

function passwordProblem(pw) {
  const { rules } = scorePassword(pw);
  if (!rules.len) return 'Use at least 8 characters.';
  if (!rules.letter || !rules.num) return 'Include at least one letter and one number.';
  return '';
}

const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

// ─── Bot protection (optional Cloudflare Turnstile + honeypot) ──────────────
let turnstileLoading = null;
const widgets = new Map();

function ensureTurnstile(form) {
  const slot = $('[data-turnstile]', form);
  if (!config.turnstileSiteKey || !slot || widgets.has(slot)) return;
  turnstileLoading = turnstileLoading || new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = resolve;
    s.onerror = reject;
    document.head.append(s);
  });
  turnstileLoading.then(() => {
    if (!widgets.has(slot)) widgets.set(slot, window.turnstile.render(slot, { sitekey: config.turnstileSiteKey, theme: 'auto' }));
  }).catch(() => showFormError(form, 'Could not load the verification challenge. Check your connection and reload.'));
}

function botFields(form) {
  const slot = $('[data-turnstile]', form);
  const widget = slot && widgets.get(slot);
  return {
    website: $('[name=website]', form)?.value || '',
    turnstileToken: widget !== undefined && window.turnstile ? window.turnstile.getResponse(widget) : undefined
  };
}

function resetTurnstile(form) {
  const slot = $('[data-turnstile]', form);
  if (slot && widgets.has(slot) && window.turnstile) window.turnstile.reset(widgets.get(slot));
}

// ─── Login ──────────────────────────────────────────────────────────────────
async function submitLogin(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearInvalid(form);
  showFormError(form, '');
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!isEmail(email)) return invalid(form.email, 'Enter a valid email address.');
  if (!password) return invalid(form.password, 'Enter your password.');
  const btn = $('button[type=submit]', form);
  setBusy(btn, true);
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: { email, password, ...botFields(form) } });
    form.password.value = '';
    await onAuthenticated(result);
  } catch (err) {
    showFormError(form, err.message);
    resetTurnstile(form);
  } finally {
    setBusy(btn, false);
  }
}

// ─── Sign up ────────────────────────────────────────────────────────────────
async function submitSignup(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearInvalid(form);
  showFormError(form, '');
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const password = form.password.value;
  if (!name) return invalid(form.name, 'Please enter your name.');
  if (!isEmail(email)) return invalid(form.email, 'Enter a valid email address.');
  const problem = passwordProblem(password);
  if (problem) return invalid(form.password, problem);
  const consents = {
    acceptTerms: form.acceptTerms.checked,
    ageConfirmed: form.ageConfirmed.checked,
    marketingOptIn: form.marketingOptIn.checked
  };
  const consentBox = $('.consents', form);
  consentBox.classList.toggle('invalid', !consents.acceptTerms || !consents.ageConfirmed);
  if (!consents.acceptTerms) { form.acceptTerms.focus(); return showFormError(form, 'Please accept the Terms of Service and Privacy Policy to continue.'); }
  if (!consents.ageConfirmed) { form.ageConfirmed.focus(); return showFormError(form, `You must be at least ${config.minimumAge} years old to create an account.`); }

  pending = { purpose: 'register', email, name, password, consents };
  const btn = $('button[type=submit]', form);
  setBusy(btn, true);
  try {
    await requestCode(form);
    location.hash = '#/verify';
  } catch (err) {
    showFormError(form, err.message);
    resetTurnstile(form);
  } finally {
    setBusy(btn, false);
  }
}

// ─── Forgot password ────────────────────────────────────────────────────────
async function submitForgot(e) {
  e.preventDefault();
  const form = e.currentTarget;
  clearInvalid(form);
  showFormError(form, '');
  const email = form.email.value.trim();
  if (!isEmail(email)) return invalid(form.email, 'Enter a valid email address.');
  pending = { purpose: 'reset', email };
  const btn = $('button[type=submit]', form);
  setBusy(btn, true);
  try {
    await requestCode(form);
    location.hash = '#/verify';
  } catch (err) {
    showFormError(form, err.message);
    resetTurnstile(form);
  } finally {
    setBusy(btn, false);
  }
}

async function requestCode(form) {
  const body = { purpose: pending.purpose, email: pending.email, ...botFields(form) };
  if (pending.purpose === 'register') Object.assign(body, { name: pending.name, password: pending.password, ...pending.consents });
  const result = await api('/api/auth/otp', { method: 'POST', body });
  prepareVerify(result.devCode);
}

function prepareVerify(devCode) {
  const form = $('[data-auth-panel="verify"]');
  const isReset = pending.purpose === 'reset';
  $('[data-verify-title]', form).textContent = isReset ? 'Enter your reset code' : 'Check your email';
  $('[data-verify-email]', form).textContent = pending.email;
  $('[data-reset-only]', form).hidden = !isReset;
  $('[data-verify-submit]', form).textContent = isReset ? 'Reset password' : 'Verify & create account';
  const dev = $('[data-dev-code]', form);
  dev.hidden = !devCode;
  dev.innerHTML = devCode ? `Development mode — email delivery isn't configured. Your code is <strong>${esc(devCode)}</strong>` : '';
  if (isReset && !devCode) {
    $('.auth-sub', form).innerHTML = `If an account exists for <strong>${esc(pending.email)}</strong>, we've sent it a 6-digit code. It expires in 10 minutes.`;
  } else {
    $('.auth-sub', form).innerHTML = `We sent a 6-digit code to <strong>${esc(pending.email)}</strong>. It expires in 10 minutes.`;
  }
  $$('.otp-inputs input', form).forEach(i => { i.value = ''; i.classList.remove('filled'); });
  startResendCountdown();
}

function startResendCountdown() {
  const btn = $('[data-action="resend-code"]');
  let left = 30;
  clearInterval(resendTimer);
  btn.disabled = true;
  btn.textContent = `Resend code in ${left}s`;
  resendTimer = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      clearInterval(resendTimer);
      btn.disabled = false;
      btn.textContent = 'Resend code';
    } else {
      btn.textContent = `Resend code in ${left}s`;
    }
  }, 1000);
}

export async function resendCode() {
  if (!pending) return;
  const form = $('[data-auth-panel="verify"]');
  try {
    await requestCode(form);
    toast('A new code is on its way.', { type: 'info' });
  } catch (err) {
    showFormError(form, err.message);
  }
}

export function authBack() {
  location.hash = pending?.purpose === 'reset' ? '#/forgot' : '#/signup';
}

// ─── Verify / reset ─────────────────────────────────────────────────────────
function readCode() {
  return $$('[data-auth-panel="verify"] .otp-inputs input').map(i => i.value).join('');
}

async function submitVerify(e) {
  e.preventDefault();
  const form = e.currentTarget;
  showFormError(form, '');
  if (!pending) return authBack();
  const code = readCode();
  const group = $('.otp-inputs', form);
  if (!/^\d{6}$/.test(code)) {
    group.classList.add('error');
    setTimeout(() => group.classList.remove('error'), 400);
    return showFormError(form, 'Enter the 6-digit code from your email.');
  }
  const btn = $('button[type=submit]', form);
  setBusy(btn, true);
  try {
    let result;
    if (pending.purpose === 'register') {
      result = await api('/api/auth/register', {
        method: 'POST',
        body: { name: pending.name, email: pending.email, password: pending.password, code, ...pending.consents, website: '' }
      });
    } else {
      const password = form.password.value;
      const problem = passwordProblem(password);
      if (problem) { setBusy(btn, false); return invalid(form.password, problem); }
      result = await api('/api/auth/reset', { method: 'POST', body: { email: pending.email, code, password } });
      toast('Password updated. You are now signed in.');
    }
    pending = null;
    clearInterval(resendTimer);
    form.password.value = '';
    $('[data-auth-panel="signup"]').reset();
    await onAuthenticated(result);
  } catch (err) {
    showFormError(form, err.message);
    group.classList.add('error');
    setTimeout(() => group.classList.remove('error'), 400);
  } finally {
    setBusy(btn, false);
  }
}

function setupOtpInputs() {
  const inputs = $$('[data-auth-panel="verify"] .otp-inputs input');
  inputs.forEach((input, idx) => {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '');
      if (digits.length > 1) return fill(digits, idx);
      input.value = digits;
      input.classList.toggle('filled', !!digits);
      if (digits && idx < inputs.length - 1) inputs[idx + 1].focus();
      if (readCode().length === 6) $('[data-auth-panel="verify"]').requestSubmit();
    });
    input.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !input.value && idx > 0) { inputs[idx - 1].focus(); inputs[idx - 1].value = ''; inputs[idx - 1].classList.remove('filled'); }
      if (e.key === 'ArrowLeft' && idx > 0) inputs[idx - 1].focus();
      if (e.key === 'ArrowRight' && idx < inputs.length - 1) inputs[idx + 1].focus();
    });
    input.addEventListener('paste', e => {
      e.preventDefault();
      fill((e.clipboardData.getData('text') || '').replace(/\D/g, ''), 0);
    });
    input.addEventListener('focus', () => input.select());
  });
  function fill(digits, start) {
    digits.slice(0, inputs.length - start).split('').forEach((d, k) => {
      inputs[start + k].value = d;
      inputs[start + k].classList.add('filled');
    });
    inputs[Math.min(inputs.length - 1, start + digits.length)].focus();
    if (readCode().length === 6) $('[data-auth-panel="verify"]').requestSubmit();
  }
}

export function togglePassword(btn) {
  const input = btn.parentElement.querySelector('input');
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
  btn.querySelector('use').setAttribute('href', show ? '#i-eye-off' : '#i-eye');
}
