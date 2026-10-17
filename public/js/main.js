import { api } from './api.js';
import { $, $$, esc, icon, initials, storageGet, storageSet, timeAgo, money } from './util.js';
import { state, subscribe, initSession, clearSession, updateUser, flushNow, setAuthLostHandler } from './store.js';
import { toast, openModal, closeMenu, openMenu, observeReveals, hasOpenModal, trapFocus, setBusy, showFormError } from './ui.js';
import { initAuth, showAuthPanel, togglePassword, resendCode, authBack } from './auth.js';
import { renderOnboarding } from './onboarding.js';
import { statusOf } from './invoice.js';
import * as dashboard from './views/dashboard.js';
import * as invoices from './views/invoices.js';
import * as editor from './views/editor.js';
import * as clients from './views/clients.js';
import * as products from './views/products.js';
import * as settings from './views/settings.js';
import { clientModal } from './views/clients.js';
import { productModal } from './views/products.js';

const PRIVATE_ROUTES = [
  { re: /^dashboard$/, view: dashboard, title: 'Dashboard', nav: 'dashboard' },
  { re: /^invoices$/, view: invoices, title: 'Invoices', nav: 'invoices' },
  { re: /^invoices\/([\w-]+)$/, view: editor, title: 'Invoice', nav: 'invoices', params: m => ({ id: m[1] }) },
  { re: /^clients$/, view: clients, title: 'Clients', nav: 'clients' },
  { re: /^products$/, view: products, title: 'Products', nav: 'products' },
  { re: /^settings(?:\/(\w+))?$/, view: settings, title: 'Settings', nav: 'settings', params: m => ({ section: m[1] }) }
];
const AUTH_ROUTES = ['login', 'signup', 'forgot', 'verify'];

let current = null;      // { route, path, handle }
let currentHash = '';
let business = null;
let afterLogin = null;

// ─── Boot ───────────────────────────────────────────────────────────────────
async function boot() {
  const [biz, cfg] = await Promise.all([
    fetch('business.json').then(r => r.json()).catch(() => null),
    api('/api/config').catch(() => ({}))
  ]);
  business = biz;
  settings.setBusiness(biz);
  renderBusinessDetails();
  initAuth({ appConfig: cfg, onSuccess: onAuthenticated });
  setAuthLostHandler(onSessionLost);

  try {
    const { user } = await api('/api/auth/me');
    if (user) {
      const data = await api('/api/sync');
      initSession(user, data);
    }
  } catch (err) {
    if (err.status !== 401) toast(err.message, { type: 'error' });
  }

  subscribe(onStoreChange);
  window.addEventListener('hashchange', route);
  await route();
  hideSplash();
  maybeShowCookieNotice();
}

function hideSplash() {
  const splash = $('#splash');
  splash.classList.add('hide');
  setTimeout(() => splash.remove(), 350);
}

function renderBusinessDetails() {
  const el = $('[data-business-details]');
  if (!el || !business) return;
  const year = new Date().getFullYear();
  el.innerHTML = `© ${year} ${esc(business.legalName)} · ${esc(business.address)}<br>` +
    `${business.registrationNumber ? `Reg. ${esc(business.registrationNumber)} · ` : ''}${business.taxId ? `Tax ID ${esc(business.taxId)} · ` : ''}` +
    `Contact: <a class="link" href="mailto:${esc(business.contactEmail.replace(/^\[|\]$/g, ''))}">${esc(business.contactEmail)}</a>`;
}

async function onAuthenticated(result) {
  initSession(result.user, result.data);
  const target = afterLogin || '#/dashboard';
  afterLogin = null;
  if (location.hash === target) await route();
  else location.hash = target;
}

function onSessionLost() {
  if (hasOpenModal()) return;
  const m = openModal({
    title: 'Your session has expired',
    iconName: 'lock',
    description: 'Your recent changes are saved on this device and will sync after you sign in again.',
    footer: '<button class="btn btn-primary" type="button" data-relogin>Sign in again</button>',
    dismissible: true
  });
  $('[data-relogin]', m.el).onclick = () => {
    m.close();
    // Keep the local cache (it's scoped to this user) so unsynced edits survive re-login.
    state.user = null;
    afterLogin = location.hash;
    location.hash = '#/login';
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────
function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs] = raw.split('?');
  return { path, query: new URLSearchParams(qs || '') };
}

async function route() {
  // In-page anchors on the landing page (e.g. #features) are not routes.
  if (location.hash && !location.hash.startsWith('#/')) {
    if (!state.user) showScreen('landing');
    return;
  }
  const { path, query } = parseHash();

  if (current?.handle?.canLeave && location.hash !== currentHash) {
    const ok = await current.handle.canLeave();
    if (!ok) {
      history.replaceState(null, '', currentHash);
      return;
    }
  }

  if (!state.user) {
    if (AUTH_ROUTES.includes(path)) {
      showScreen('auth');
      showAuthPanel(path);
    } else if (path === '' ) {
      showScreen('landing');
      document.title = 'InvoiceFlow — Professional invoicing for modern businesses';
    } else {
      afterLogin = `#/${path}${query.toString() ? `?${query}` : ''}`;
      location.replace('#/login');
    }
    currentHash = location.hash;
    return;
  }

  if (state.user.needsConsent) {
    showScreen('app');
    return showConsentGate();
  }
  if (!state.profile.onboarded) {
    showScreen('onboarding');
    renderOnboarding(() => { location.hash = '#/dashboard'; route(); });
    return;
  }
  if (path === '' || AUTH_ROUTES.includes(path)) return location.replace('#/dashboard');

  const match = PRIVATE_ROUTES.map(r => ({ r, m: path.match(r.re) })).find(x => x.m);
  if (!match) return location.replace('#/dashboard');
  showScreen('app');
  renderView(match.r, { ...(match.r.params ? match.r.params(match.m) : {}), query });
  currentHash = location.hash;
}

function renderView(r, params, { keepFocus = false } = {}) {
  closeMenu();
  current?.handle?.destroy?.();
  const view = $('#view');
  view.style.animation = 'none';
  void view.offsetWidth;
  view.style.animation = '';
  const handle = r.view.render(view, params) || {};
  current = { route: r, params, handle };
  const title = r === PRIVATE_ROUTES[2] ? (params.id === 'new' ? 'New invoice' : 'Edit invoice') : r.title;
  $('#page-title').textContent = title;
  document.title = `${title} — InvoiceFlow`;
  $$('[data-nav]').forEach(a => {
    const on = a.dataset.nav === r.nav;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  $('#app').classList.remove('nav-open');
  if (!keepFocus) {
    $('#route-announcer').textContent = `${title} page`;
    view.focus({ preventScroll: true });
    window.scrollTo({ top: 0 });
  }
}

function showScreen(name) {
  const screens = { landing: '#landing', auth: '#auth', onboarding: '#onboarding', app: '#app' };
  for (const [key, sel] of Object.entries(screens)) $(sel).hidden = key !== name;
  $('.skip-link').setAttribute('href', { landing: '#main-content', auth: '#auth-main', onboarding: '#onboarding', app: '#view' }[name]);
  if (name === 'landing') observeReveals($('#landing'));
  if (name === 'app') renderShell();
}

function onStoreChange(kind) {
  if (kind === 'sync') return renderSync();
  if (kind === 'user') renderShell();
  if (!state.user || $('#app').hidden || !current) return;
  renderShell();
  // Views with local, unsaved form state opt out of live re-rendering.
  if (current.handle.liveUpdate === false) return;
  const active = document.activeElement;
  const typing = active && $('#view').contains(active) && /INPUT|TEXTAREA|SELECT/.test(active.tagName);
  if (!typing && !hasOpenModal()) renderView(current.route, current.params, { keepFocus: true });
}

// ─── Shell ──────────────────────────────────────────────────────────────────
function renderShell() {
  if (!state.user) return;
  const logo = state.profile.branding?.logoData;
  const avatar = $('#user-avatar');
  avatar.innerHTML = logo ? `<img src="${esc(logo)}" alt="">` : esc(initials(state.user.name));
  $('#user-name').textContent = state.user.name;
  $('#user-email').textContent = state.user.email;
  const open = state.invoices.filter(i => ['Sent', 'Overdue'].includes(statusOf(i))).length;
  $('#nav-count-invoices').textContent = open ? String(open) : '';
  $('#nav-count-invoices').setAttribute('aria-label', open ? `${open} unpaid` : '');
  renderSync();
}

function renderSync() {
  const pill = $('#sync-pill');
  const { status, message, at } = state.sync;
  const labels = { synced: 'Synced', syncing: 'Syncing…', pending: 'Saving…', offline: 'Offline', error: 'Sync issue', auth: 'Signed out' };
  pill.dataset.state = status === 'synced' ? 'idle' : status;
  $('.sync-text', pill).textContent = labels[status] || 'Synced';
  pill.title = message || (at ? `All changes saved to the cloud · ${timeAgo(new Date(at).toISOString())}` : 'All changes saved to the cloud');
  pill.setAttribute('aria-label', `Cloud sync: ${labels[status]}. ${message}`);
}

function userMenu(anchor) {
  openMenu(anchor, [
    { header: `<strong>${esc(state.user.name)}</strong><span>${esc(state.user.email)}</span>` },
    { label: 'Account & security', icon: 'shield', onClick: () => { location.hash = '#/settings/account'; } },
    { label: 'Data & backups', icon: 'database', onClick: () => { location.hash = '#/settings/data'; } },
    { label: 'Toggle dark mode', icon: 'moon', onClick: toggleTheme },
    'divider',
    { label: 'Sign out', icon: 'logout', onClick: logout }
  ], { align: 'left', placement: 'above' });
}

async function logout() {
  const synced = await flushNow(6000);
  if (!synced) {
    const ok = await import('./ui.js').then(ui => ui.confirmDialog({
      title: 'Some changes haven\'t synced',
      message: 'If you sign out now, changes that haven\'t reached the cloud will be lost. Check your connection and try again, or sign out anyway.',
      confirmText: 'Sign out anyway',
      danger: true
    }));
    if (!ok) return;
  }
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch { /* ignore */ }
  current?.handle?.destroy?.();
  current = null;
  clearSession();
  location.hash = '#/';
  toast('You have been signed out.', { type: 'info' });
}

window.addEventListener('if:account-deleted', () => {
  current?.handle?.destroy?.();
  current = null;
  clearSession();
  location.hash = '#/';
  toast('Your account and all associated data have been deleted.', { type: 'info', duration: 7000 });
});

// ─── Consent gate (existing users when Terms change) ───────────────────────
function showConsentGate() {
  if (hasOpenModal()) return;
  const m = openModal({
    title: 'Please review our updated terms',
    iconName: 'shield',
    dismissible: false,
    description: 'To keep using InvoiceFlow, please review and accept the current Terms of Service and Privacy Policy.',
    body: `<form id="consent-form" class="consents" novalidate style="gap:12px">
      <label class="check"><input type="checkbox" name="acceptTerms"><span>I agree to the <a class="link" href="legal/terms.html" target="_blank" rel="noopener">Terms of Service</a> and have read the <a class="link" href="legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</span></label>
      <label class="check"><input type="checkbox" name="ageConfirmed"><span>I confirm I am at least ${esc(business?.legal?.minimumAge ?? 18)} years old.</span></label>
      <div class="form-error" role="alert"></div></form>`,
    footer: '<button class="btn btn-ghost" type="button" data-signout>Sign out</button><button class="btn btn-primary" type="submit" form="consent-form">Continue</button>'
  });
  $('[data-signout]', m.el).onclick = () => { m.close(); logout(); };
  $('#consent-form', m.el).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.acceptTerms.checked || !f.ageConfirmed.checked) return showFormError(f, 'Please tick both boxes to continue.');
    const btn = $('button[type=submit]', m.el);
    setBusy(btn, true);
    try {
      const { user } = await api('/api/account/consent', { method: 'POST', body: { acceptTerms: true, ageConfirmed: true } });
      updateUser(user);
      m.close();
      route();
    } catch (err) { showFormError(f, err.message); setBusy(btn, false); }
  });
}

// ─── Theme & cookie notice ──────────────────────────────────────────────────
function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  storageSet('if:theme', next);
  syncThemeIcons();
}
function syncThemeIcons() {
  const dark = document.documentElement.dataset.theme === 'dark';
  $$('[data-action="toggle-theme"]').forEach(btn => {
    btn.querySelector('use')?.setAttribute('href', dark ? '#i-sun' : '#i-moon');
    btn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
  });
}

function maybeShowCookieNotice(force = false) {
  if (!force && storageGet('if:cookie-notice')) return;
  $('#cookie-banner').hidden = false;
}

// ─── Command palette ────────────────────────────────────────────────────────
let cmdItems = [];
let cmdActive = 0;

function openCmdk() {
  if (!state.user || !state.profile.onboarded) return;
  const el = $('#cmdk');
  el.hidden = false;
  el.dataset.prev = '';
  const input = $('#cmdk-input');
  input.value = '';
  drawCmdk('');
  input.focus();
}
function closeCmdk() {
  $('#cmdk').hidden = true;
}

function drawCmdk(q) {
  q = q.trim().toLowerCase();
  const go = h => () => { location.hash = h; };
  const actions = [
    { group: 'Actions', label: 'New invoice', icon: 'plus', run: go('#/invoices/new') },
    { group: 'Actions', label: 'Add client', icon: 'users', run: () => { location.hash = '#/clients'; setTimeout(() => clientModal(), 50); } },
    { group: 'Actions', label: 'Add product', icon: 'box', run: () => { location.hash = '#/products'; setTimeout(() => productModal(), 50); } },
    { group: 'Actions', label: 'Toggle dark mode', icon: 'moon', run: toggleTheme },
    { group: 'Go to', label: 'Dashboard', icon: 'home', run: go('#/dashboard') },
    { group: 'Go to', label: 'Invoices', icon: 'file', run: go('#/invoices') },
    { group: 'Go to', label: 'Clients', icon: 'users', run: go('#/clients') },
    { group: 'Go to', label: 'Products', icon: 'box', run: go('#/products') },
    { group: 'Go to', label: 'Branding', icon: 'palette', run: go('#/settings/branding') },
    { group: 'Go to', label: 'Data & backups', icon: 'database', run: go('#/settings/data') },
    { group: 'Go to', label: 'Account & security', icon: 'shield', run: go('#/settings/account') }
  ].filter(a => !q || a.label.toLowerCase().includes(q));
  const invs = q ? state.invoices.filter(i => `${i.number} ${i.clientName}`.toLowerCase().includes(q)).slice(0, 6)
    .map(i => ({ group: 'Invoices', label: `${i.number} · ${i.clientName}`, meta: money(i.total, i.currency), icon: 'file', run: go(`#/invoices/${i.id}`) })) : [];
  const cls = q ? state.clients.filter(c => `${c.name} ${c.email}`.toLowerCase().includes(q)).slice(0, 5)
    .map(c => ({ group: 'Clients', label: c.name, meta: c.email, icon: 'users', run: go(`#/invoices?client=${c.id}`) })) : [];
  cmdItems = [...invs, ...cls, ...actions];
  cmdActive = 0;
  const list = $('#cmdk-list');
  if (!cmdItems.length) {
    list.innerHTML = `<div class="cmdk-empty">No results for “${esc(q)}”</div>`;
    return;
  }
  let lastGroup = '';
  list.innerHTML = cmdItems.map((it, i) => {
    const head = it.group !== lastGroup ? `<div class="cmdk-group" role="presentation">${esc(it.group)}</div>` : '';
    lastGroup = it.group;
    return `${head}<div class="cmdk-item ${i === 0 ? 'active' : ''}" role="option" id="cmdk-o${i}" data-i="${i}" aria-selected="${i === 0}">${icon(it.icon)}<span>${esc(it.label)}</span>${it.meta ? `<span class="meta">${esc(it.meta)}</span>` : ''}</div>`;
  }).join('');
  $('#cmdk-input').setAttribute('aria-activedescendant', 'cmdk-o0');
}

function setCmdActive(i) {
  cmdActive = (i + cmdItems.length) % cmdItems.length;
  $$('.cmdk-item').forEach((el, k) => { el.classList.toggle('active', k === cmdActive); el.setAttribute('aria-selected', String(k === cmdActive)); });
  $(`#cmdk-o${cmdActive}`)?.scrollIntoView({ block: 'nearest' });
  $('#cmdk-input').setAttribute('aria-activedescendant', `cmdk-o${cmdActive}`);
}

function runCmd(i) {
  const item = cmdItems[i];
  if (!item) return;
  closeCmdk();
  item.run();
}

$('#cmdk-input').addEventListener('input', e => drawCmdk(e.target.value));
$('#cmdk').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setCmdActive(cmdActive + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setCmdActive(cmdActive - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); runCmd(cmdActive); }
  else if (e.key === 'Escape') { e.preventDefault(); closeCmdk(); }
  else trapFocus($('.cmdk-panel'), e);
});
$('#cmdk-list').addEventListener('click', e => {
  const el = e.target.closest('.cmdk-item');
  if (el) runCmd(Number(el.dataset.i));
});

// ─── Global events ──────────────────────────────────────────────────────────
document.addEventListener('click', e => {
  const scrollLink = e.target.closest('a[data-scroll]');
  if (scrollLink) {
    const target = document.querySelector(scrollLink.getAttribute('href'));
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
    return;
  }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  if (action === 'skip') {
    e.preventDefault();
    const target = $(el.getAttribute('href'));
    target?.setAttribute('tabindex', '-1');
    target?.focus();
    return;
  }
  ({
    'toggle-theme': toggleTheme,
    'toggle-password': () => togglePassword(el),
    'resend-code': resendCode,
    'auth-back': authBack,
    'new-invoice': () => { location.hash = '#/invoices/new'; },
    'user-menu': () => userMenu(el),
    'open-sidebar': () => $('#app').classList.add('nav-open'),
    'close-sidebar': () => $('#app').classList.remove('nav-open'),
    'open-cmdk': openCmdk,
    'close-cmdk': closeCmdk,
    'dismiss-cookie-notice': () => { storageSet('if:cookie-notice', '1'); $('#cookie-banner').hidden = true; },
    'show-cookie-notice': () => maybeShowCookieNotice(true)
  })[action]?.();
});

$('#sync-pill').addEventListener('click', () => {
  if (state.sync.status === 'auth') onSessionLost();
  else if (state.sync.status !== 'synced' && state.sync.message) toast(state.sync.message, { type: 'info' });
});

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if ($('#cmdk').hidden) openCmdk(); else closeCmdk();
  } else if (e.key === 'Escape' && $('#app').classList.contains('nav-open')) {
    $('#app').classList.remove('nav-open');
  }
});

window.addEventListener('scroll', () => $('#lp-nav')?.classList.toggle('scrolled', window.scrollY > 8), { passive: true });
$('#cmdk-kbd').textContent = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';
syncThemeIcons();

boot();
