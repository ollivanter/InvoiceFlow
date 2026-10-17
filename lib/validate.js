'use strict';

// Server-side whitelisting of everything the client syncs. Unknown fields are dropped (blocks
// field tampering / mass assignment), types are coerced and lengths capped.

const CURRENCIES = ['INR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'SGD', 'AED'];
const LEGACY_CURRENCY = { '₹': 'INR', $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' };
const STATUSES = ['Draft', 'Sent', 'Paid'];
const FONTS = ['Inter', 'Outfit', 'Playfair Display', 'Space Grotesk', 'Lato', 'Merriweather'];
const STYLES = ['default', 'classic', 'modern', 'minimal'];
const MAX_LOGO_BYTES = 256 * 1024;
const MAX_INVOICES = 5000;
const MAX_CLIENTS = 2000;
const MAX_CATALOG = 1000;
const MAX_ITEMS = 200;

class ValidationError extends Error {}

const isObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max = 200) => (typeof v === 'string' || typeof v === 'number' ? String(v).slice(0, max) : '');
const text = (v, max = 2000) => str(v, max).replace(/\r\n/g, '\n');
function num(v, min = 0, max = 1e12, fallback = 0) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n * 10000) / 10000));
}
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const id = v => (typeof v === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null);
const date = v => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
const stamp = v => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);
const email = v => {
  const s = str(v, 254).trim();
  return s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s : '';
};
const currency = v => (CURRENCIES.includes(v) ? v : LEGACY_CURRENCY[v] || 'INR');
const color = v => (typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : '#4f46e5');

function logo(v) {
  if (v == null || v === '') return null;
  const m = typeof v === 'string' && v.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!m) throw new ValidationError('Logo must be a PNG, JPEG or WebP image.');
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > MAX_LOGO_BYTES) throw new ValidationError('Logo is too large. Please use an image under 256 KB.');
  // Verify the file signature so a renamed file (e.g. SVG/HTML) can't pass as an image.
  const sig = {
    png: bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    webp: bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  };
  if (!sig[m[1]]) throw new ValidationError('Logo file is not a valid image.');
  return v;
}

function list(v, max, map) {
  if (!Array.isArray(v)) return [];
  if (v.length > max) throw new ValidationError(`Too many records (limit ${max}).`);
  const seen = new Set();
  const out = [];
  for (const raw of v) {
    if (!isObj(raw)) continue;
    const item = map(raw);
    if (!item || seen.has(item.id)) continue;
    seen.add(item.id);
    out.push(item);
  }
  return out;
}

function catalogItem(raw) {
  const itemId = id(raw.id);
  if (!itemId) return null;
  return { id: itemId, name: str(raw.name, 200), price: num(raw.price), taxRate: num(raw.taxRate, 0, 100), updatedAt: stamp(raw.updatedAt) };
}

function profile(raw) {
  raw = isObj(raw) ? raw : {};
  const b = isObj(raw.branding) ? raw.branding : {};
  return {
    name: str(raw.name, 160),
    email: email(raw.email),
    phone: str(raw.phone, 40),
    address: text(raw.address, 500),
    tax: str(raw.tax, 60),
    web: str(raw.web, 200),
    currency: currency(raw.currency),
    taxRate: num(raw.taxRate, 0, 100, 18),
    taxLabel: str(raw.taxLabel, 30) || 'GST',
    terms: text(raw.terms, 2000),
    invoicePrefix: str(raw.invoicePrefix, 12).replace(/[^A-Za-z0-9/_-]/g, '') || 'INV-',
    dueDays: Math.round(num(raw.dueDays, 0, 365, 15)),
    onboarded: raw.onboarded === true || raw.profileComplete === true,
    branding: {
      logoData: logo(b.logoData),
      logoName: str(b.logoName, 120) || null,
      color: color(b.color),
      font: oneOf(b.font, FONTS, 'Inter'),
      style: oneOf(b.style, STYLES, 'default')
    },
    catalog: list(raw.catalog, MAX_CATALOG, catalogItem),
    updatedAt: stamp(raw.updatedAt)
  };
}

function lineItem(raw) {
  return {
    desc: str(raw.desc, 500),
    qty: num(raw.qty, 0, 1e9, 1),
    rate: num(raw.rate),
    discount: num(raw.discount, 0, 100),
    taxRate: num(raw.taxRate, 0, 100)
  };
}

function invoice(raw) {
  const invId = id(raw.id);
  if (!invId) return null;
  const items = Array.isArray(raw.items) ? raw.items.slice(0, MAX_ITEMS).filter(isObj).map(lineItem) : [];
  // Totals are recomputed here so stored amounts always match the line items.
  let subtotal = 0, discount = 0, tax = 0;
  for (const it of items) {
    const base = it.qty * it.rate;
    const disc = base * it.discount / 100;
    subtotal += base;
    discount += disc;
    tax += (base - disc) * it.taxRate / 100;
  }
  const round = n => Math.round(n * 100) / 100;
  return {
    id: invId,
    number: str(raw.number, 40),
    currency: currency(raw.currency),
    date: date(raw.date),
    dueDate: date(raw.dueDate),
    clientId: id(raw.clientId),
    clientName: str(raw.clientName, 160),
    clientEmail: email(raw.clientEmail),
    clientAddress: text(raw.clientAddress, 500),
    taxLabel: str(raw.taxLabel, 30),
    notes: text(raw.notes, 2000),
    items,
    subtotal: round(subtotal),
    discount: round(discount),
    tax: round(tax),
    total: round(subtotal - discount + tax),
    // "Overdue" is derived from the due date, so legacy records storing it become "Sent".
    status: raw.status === 'Overdue' ? 'Sent' : oneOf(raw.status, STATUSES, 'Draft'),
    createdAt: stamp(raw.createdAt) || new Date().toISOString(),
    updatedAt: stamp(raw.updatedAt) || new Date().toISOString(),
    sentAt: stamp(raw.sentAt),
    paidAt: stamp(raw.paidAt)
  };
}

function client(raw) {
  const clientId = id(raw.id);
  if (!clientId) return null;
  return {
    id: clientId,
    name: str(raw.name, 160),
    email: email(raw.email),
    phone: str(raw.phone, 40),
    address: text(raw.address, 500),
    taxId: str(raw.taxId, 60),
    notes: text(raw.notes, 1000),
    createdAt: stamp(raw.createdAt) || new Date().toISOString(),
    updatedAt: stamp(raw.updatedAt) || new Date().toISOString()
  };
}

function tombstones(raw) {
  raw = isObj(raw) ? raw : {};
  const out = {};
  for (const kind of ['invoices', 'clients', 'catalog']) {
    out[kind] = {};
    const entries = isObj(raw[kind]) ? Object.entries(raw[kind]).slice(-5000) : [];
    for (const [key, ts] of entries) if (id(key) && stamp(ts)) out[kind][key] = stamp(ts);
  }
  return out;
}

function userDoc(raw) {
  raw = isObj(raw) ? raw : {};
  return {
    profile: profile(raw.profile),
    invoices: list(raw.invoices, MAX_INVOICES, invoice),
    clients: list(raw.clients, MAX_CLIENTS, client),
    tombstones: tombstones(raw.tombstones)
  };
}

function emptyDoc() {
  return userDoc({});
}

module.exports = { userDoc, emptyDoc, ValidationError };
