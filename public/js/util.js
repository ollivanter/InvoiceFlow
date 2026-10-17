// Shared helpers: DOM, escaping, formatting, dates.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Escape any user-provided value before it is placed in HTML. */
export const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ESC[c]);
export const escMultiline = value => esc(value).replace(/\n/g, '<br>');

export const icon = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

export function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now()).replace(/-/g, '').slice(0, 24);
}

export const nowIso = () => new Date().toISOString();

export const CURRENCIES = [
  { code: 'INR', label: 'Indian Rupee', symbol: '₹', locale: 'en-IN' },
  { code: 'USD', label: 'US Dollar', symbol: '$', locale: 'en-US' },
  { code: 'EUR', label: 'Euro', symbol: '€', locale: 'en-IE' },
  { code: 'GBP', label: 'British Pound', symbol: '£', locale: 'en-GB' },
  { code: 'JPY', label: 'Japanese Yen', symbol: '¥', locale: 'ja-JP' },
  { code: 'AUD', label: 'Australian Dollar', symbol: 'A$', locale: 'en-AU' },
  { code: 'CAD', label: 'Canadian Dollar', symbol: 'C$', locale: 'en-CA' },
  { code: 'SGD', label: 'Singapore Dollar', symbol: 'S$', locale: 'en-SG' },
  { code: 'AED', label: 'UAE Dirham', symbol: 'AED', locale: 'en-AE' }
];
const LEGACY_SYMBOLS = { '₹': 'INR', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
export const currencyCode = code => (CURRENCIES.some(c => c.code === code) ? code : LEGACY_SYMBOLS[code] || 'INR');

const formatters = new Map();
export function money(amount, code = 'INR', { compact = false } = {}) {
  code = currencyCode(code);
  const key = `${code}:${compact}`;
  if (!formatters.has(key)) {
    const cur = CURRENCIES.find(c => c.code === code);
    formatters.set(key, new Intl.NumberFormat(cur.locale, {
      style: 'currency',
      currency: code,
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : {})
    }));
  }
  return formatters.get(key).format(Number(amount) || 0);
}

export const round2 = n => Math.round((Number(n) || 0) * 100) / 100;

// Dates are handled as local YYYY-MM-DD strings to avoid UTC off-by-one errors.
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function addDays(iso, days) {
  const [y, m, d] = (iso || todayIso()).split('-').map(Number);
  const date = new Date(y, m - 1, d + Number(days || 0));
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function fmtDate(iso, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!iso) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T00:00:00`) : new Date(iso);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString(undefined, opts);
}

export function daysBetween(fromIso, toIso) {
  const a = new Date(`${fromIso}T00:00:00`);
  const b = new Date(`${toIso}T00:00:00`);
  return Math.round((b - a) / 86400000);
}

export function relativeDue(dueIso) {
  if (!dueIso) return '';
  const diff = daysBetween(todayIso(), dueIso);
  if (diff === 0) return 'Due today';
  if (diff === 1) return 'Due tomorrow';
  if (diff > 1) return `Due in ${diff} days`;
  return `${Math.abs(diff)} day${diff === -1 ? '' : 's'} overdue`;
}

export function timeAgo(iso) {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 45) return 'just now';
  const units = [[60, 'minute'], [3600, 'hour'], [86400, 'day'], [2592000, 'month'], [31536000, 'year']];
  let unit = units[0];
  for (const u of units) if (seconds >= u[0]) unit = u;
  const value = Math.round(seconds / unit[0]);
  return `${value} ${unit[1]}${value === 1 ? '' : 's'} ago`;
}

export function initials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export function debounce(fn, wait = 200) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

export function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const idx = String(text).toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return safe;
  return esc(text.slice(0, idx)) + `<mark>${esc(text.slice(idx, idx + query.length))}</mark>` + esc(text.slice(idx + query.length));
}

export function download(filename, content, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function csvCell(value) {
  let s = String(value ?? '');
  // Prevent spreadsheet formula injection from user-entered text.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function storageSet(key, value) {
  try { localStorage.setItem(key, value); return true; } catch { return false; }
}
export function storageRemove(key) {
  try { localStorage.removeItem(key); } catch { /* ignore */ }
}

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Downscale an uploaded image and re-encode it so logos stay small and are always raster. */
export function processLogo(file, maxSize = 480) {
  return new Promise((resolve, reject) => {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return reject(new Error('Please upload a PNG, JPEG or WebP image.'));
    if (file.size > 5 * 1024 * 1024) return reject(new Error('Image must be under 5 MB.'));
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      let data = canvas.toDataURL('image/png');
      // Fall back to WebP (keeps transparency) when PNG is too large.
      if (data.length > 300_000) data = canvas.toDataURL('image/webp', 0.9);
      if (data.length > 340_000) return reject(new Error('This image is too detailed. Try a simpler or smaller logo.'));
      resolve(data);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file could not be read as an image.'));
    };
    img.src = url;
  });
}
