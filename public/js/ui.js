// UI primitives: toasts, accessible modals, menus, count-up, reveal-on-scroll.
import { $, $$, esc, icon, prefersReducedMotion } from './util.js';

// ─── Toasts ─────────────────────────────────────────────────────────────────
export function toast(message, { type = 'success', action, duration = 4000 } = {}) {
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  const iconName = { success: 'check', error: 'alert', info: 'info' }[type] || 'info';
  el.innerHTML = `<div class="toast-icon">${icon(iconName)}</div><div class="toast-msg">${esc(message)}</div>` +
    (action ? `<button class="toast-action" type="button">${esc(action.label)}</button>` : '') +
    `<button class="icon-btn sm" type="button" aria-label="Dismiss">${icon('x')}</button>`;
  const close = () => {
    el.classList.add('leaving');
    setTimeout(() => el.remove(), 250);
  };
  el.querySelector('.icon-btn').onclick = close;
  if (action) el.querySelector('.toast-action').onclick = () => { action.onClick(); close(); };
  root.append(el);
  while (root.children.length > 4) root.firstElementChild.remove();
  setTimeout(close, action ? duration + 2000 : duration);
}

// ─── Modals ─────────────────────────────────────────────────────────────────
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
const modalStack = [];

export function trapFocus(container, event) {
  if (event.key !== 'Tab') return;
  const items = $$(FOCUSABLE, container).filter(el => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0];
  const last = items[items.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

/**
 * Opens a modal dialog. Returns { el, close }. Focus is trapped inside and restored on close.
 * `dismissible: false` hides the close button and ignores Esc/backdrop (used for required consent).
 */
export function openModal({ title, description = '', body = '', footer = '', wide = false, iconName, iconTone = 'primary', dismissible = true, onClose }) {
  const previous = document.activeElement;
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  const titleId = `m-${Math.random().toString(36).slice(2)}`;
  overlay.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
    <div class="modal-head"><div>${iconName ? `<div class="modal-icon ${iconTone}">${icon(iconName)}</div>` : ''}<h3 id="${titleId}">${esc(title)}</h3>${description ? `<p>${description}</p>` : ''}</div>
    ${dismissible ? `<button class="icon-btn sm" type="button" data-close aria-label="Close">${icon('x')}</button>` : ''}</div>
    <div class="modal-body">${body}</div>
    ${footer ? `<div class="modal-foot">${footer}</div>` : ''}
  </div>`;
  const modal = overlay.firstElementChild;
  let closed = false;
  const close = result => {
    if (closed) return;
    closed = true;
    overlay.classList.add('closing');
    modalStack.splice(modalStack.indexOf(api), 1);
    setTimeout(() => overlay.remove(), 160);
    if (!modalStack.length) document.body.style.overflow = '';
    if (previous && previous.focus) previous.focus();
    onClose?.(result);
  };
  const api = { el: modal, close };
  overlay.addEventListener('mousedown', e => { if (e.target === overlay && dismissible) close(); });
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); close(); }
    trapFocus(modal, e);
  });
  $$('[data-close]', modal).forEach(btn => btn.addEventListener('click', () => close()));
  $('#modal-root').append(overlay);
  modalStack.push(api);
  document.body.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    const target = $('[autofocus]', modal) || $$(FOCUSABLE, $('.modal-body', modal))[0] || $$(FOCUSABLE, modal)[0];
    target?.focus();
  });
  return api;
}

export const hasOpenModal = () => modalStack.length > 0;

export function confirmDialog({ title, message, confirmText = 'Confirm', danger = false, iconName }) {
  return new Promise(resolve => {
    let result = false;
    const m = openModal({
      title,
      body: `<p class="muted">${message}</p>`,
      iconName: iconName || (danger ? 'alert' : 'info'),
      iconTone: danger ? 'danger' : 'primary',
      footer: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn ${danger ? 'btn-danger' : 'btn-primary'}" type="button" data-ok autofocus>${esc(confirmText)}</button>`,
      onClose: () => resolve(result)
    });
    $('[data-ok]', m.el).onclick = () => { result = true; m.close(); };
  });
}

// ─── Menus ──────────────────────────────────────────────────────────────────
let openMenuEl = null;

export function closeMenu() {
  if (!openMenuEl) return;
  const { el, anchor } = openMenuEl;
  openMenuEl = null;
  el.remove();
  anchor?.setAttribute('aria-expanded', 'false');
}

/** items: [{ label, icon, onClick, danger }] or 'divider' or { header: html } */
export function openMenu(anchor, items, { align = 'right', placement = 'below' } = {}) {
  if (openMenuEl?.anchor === anchor) return closeMenu();
  closeMenu();
  const el = document.createElement('div');
  el.className = 'menu';
  el.setAttribute('role', 'menu');
  el.innerHTML = items.map((item, i) => {
    if (item === 'divider') return '<hr>';
    if (item.header) return `<div class="menu-head">${item.header}</div>`;
    return `<button type="button" role="menuitem" tabindex="-1" data-i="${i}" class="${item.danger ? 'danger' : ''}">${item.icon ? icon(item.icon) : ''}${esc(item.label)}</button>`;
  }).join('');
  document.body.append(el);
  const rect = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let left = align === 'right' ? rect.right - w : rect.left;
  let top = placement === 'above' ? rect.top - h - 6 : rect.bottom + 6;
  if (top + h > window.innerHeight - 8) top = rect.top - h - 6;
  if (top < 8) top = 8;
  left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
  anchor.setAttribute('aria-expanded', 'true');
  openMenuEl = { el, anchor };

  const buttons = $$('button', el);
  buttons[0]?.focus();
  el.addEventListener('click', e => {
    const btn = e.target.closest('button[data-i]');
    if (!btn) return;
    const item = items[Number(btn.dataset.i)];
    closeMenu();
    anchor.focus();
    item.onClick?.();
  });
  el.addEventListener('keydown', e => {
    const idx = buttons.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); buttons[(idx + 1) % buttons.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); buttons[(idx - 1 + buttons.length) % buttons.length].focus(); }
    else if (e.key === 'Home') { e.preventDefault(); buttons[0].focus(); }
    else if (e.key === 'End') { e.preventDefault(); buttons[buttons.length - 1].focus(); }
    else if (e.key === 'Escape' || e.key === 'Tab') { e.preventDefault(); closeMenu(); anchor.focus(); }
  });
}

document.addEventListener('mousedown', e => {
  if (openMenuEl && !openMenuEl.el.contains(e.target) && !openMenuEl.anchor.contains(e.target)) closeMenu();
});
window.addEventListener('resize', closeMenu);
window.addEventListener('scroll', closeMenu, true);

// ─── Motion helpers ─────────────────────────────────────────────────────────
export function countUp(el, value, format) {
  if (prefersReducedMotion()) { el.textContent = format(value); return; }
  const start = performance.now();
  const duration = 900;
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = format(value * eased);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

let revealObserver;
export function observeReveals(root = document) {
  const targets = $$('.reveal:not(.in), .showcase:not(.in)', root);
  if (!('IntersectionObserver' in window) || prefersReducedMotion()) {
    targets.forEach(el => el.classList.add('in'));
    return;
  }
  revealObserver = revealObserver || new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('in');
        revealObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
  targets.forEach(el => revealObserver.observe(el));
}

export function setBusy(button, busy) {
  if (!button) return;
  button.disabled = busy;
  button.classList.toggle('loading', busy);
  button.setAttribute('aria-busy', busy ? 'true' : 'false');
}

export function showFormError(form, message) {
  const el = $('.form-error', form);
  if (!el) return toast(message, { type: 'error' });
  el.textContent = message || '';
  el.classList.remove('show');
  if (message) {
    void el.offsetWidth; // restart the shake animation
    el.classList.add('show');
  }
}

/** Marks a field invalid and focuses it. Returns false so callers can `return invalid(...)`. */
export function invalid(input, message) {
  const field = input.closest('.field');
  if (field) {
    field.classList.add('invalid');
    let err = $('.err', field);
    if (!err) {
      err = document.createElement('span');
      err.className = 'err';
      err.id = `${input.id || input.name}-err`;
      field.append(err);
    }
    err.textContent = message;
    input.setAttribute('aria-invalid', 'true');
    input.setAttribute('aria-describedby', err.id);
  }
  input.focus();
  return false;
}

export function clearInvalid(root) {
  $$('.field.invalid', root).forEach(f => f.classList.remove('invalid'));
  $$('[aria-invalid]', root).forEach(i => i.removeAttribute('aria-invalid'));
}
