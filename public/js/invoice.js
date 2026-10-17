// Invoice calculations, numbering, status and document rendering/printing.
import { esc, escMultiline, money, round2, todayIso, fmtDate, currencyCode } from './util.js';

export const FONTS = [
  { value: 'Inter', label: 'Inter', body: "'Inter',sans-serif", head: "'Inter',sans-serif", sample: 'Clean & modern' },
  { value: 'Outfit', label: 'Outfit', body: "'Outfit',sans-serif", head: "'DM Serif Display',serif", sample: 'Friendly serif' },
  { value: 'Playfair Display', label: 'Playfair', body: "'Inter',sans-serif", head: "'Playfair Display',serif", sample: 'Editorial' },
  { value: 'Space Grotesk', label: 'Space Grotesk', body: "'Space Grotesk',sans-serif", head: "'Space Grotesk',sans-serif", sample: 'Geometric' },
  { value: 'Lato', label: 'Lato', body: "'Lato',sans-serif", head: "'Merriweather',serif", sample: 'Professional' },
  { value: 'Merriweather', label: 'Merriweather', body: "'Merriweather',serif", head: "'Merriweather',serif", sample: 'Classic serif' }
];

export const STYLES = [
  { value: 'default', label: 'Standard' },
  { value: 'classic', label: 'Classic' },
  { value: 'modern', label: 'Bold' },
  { value: 'minimal', label: 'Minimal' }
];

export const BRAND_COLORS = ['#4f46e5', '#0f766e', '#1d4ed8', '#7c3aed', '#be123c', '#b45309', '#15803d', '#334155'];

export function lineTotal(item) {
  const base = (Number(item.qty) || 0) * (Number(item.rate) || 0);
  const afterDiscount = base * (1 - (Number(item.discount) || 0) / 100);
  return afterDiscount * (1 + (Number(item.taxRate) || 0) / 100);
}

export function calcTotals(items = []) {
  let subtotal = 0, discount = 0, tax = 0;
  for (const it of items) {
    const base = (Number(it.qty) || 0) * (Number(it.rate) || 0);
    const disc = base * (Number(it.discount) || 0) / 100;
    subtotal += base;
    discount += disc;
    tax += (base - disc) * (Number(it.taxRate) || 0) / 100;
  }
  return { subtotal: round2(subtotal), discount: round2(discount), tax: round2(tax), total: round2(subtotal - discount + tax) };
}

/** Overdue is derived: a sent invoice whose due date has passed. */
export function statusOf(inv) {
  if (inv.status === 'Paid') return 'Paid';
  if (inv.status === 'Draft' || !inv.status) return 'Draft';
  if (inv.dueDate && inv.dueDate < todayIso()) return 'Overdue';
  return 'Sent';
}

export function badge(status) {
  return `<span class="badge ${status.toLowerCase()}">${esc(status)}</span>`;
}

export function nextNumber(invoices, prefix = 'INV-') {
  let max = 0;
  for (const inv of invoices) {
    const m = String(inv.number || '').match(/(\d+)\s*$/);
    if (m && String(inv.number).startsWith(prefix)) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}

export function brandingOf(profile) {
  const b = profile.branding || {};
  return {
    color: /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#4f46e5',
    font: FONTS.find(f => f.value === b.font) || FONTS[0],
    style: STYLES.some(s => s.value === b.style) ? b.style : 'default',
    logoData: b.logoData || null
  };
}

function hexToRgba(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

/** Renders the invoice as HTML. Every user-provided value is escaped. */
export function renderInvoiceDoc(inv, profile) {
  const b = brandingOf(profile);
  const cur = currencyCode(inv.currency || profile.currency);
  const totals = calcTotals(inv.items);
  const status = statusOf(inv);
  const taxLabel = inv.taxLabel || profile.taxLabel || 'Tax';
  const fromLines = [profile.address, profile.email, profile.phone, profile.web].filter(Boolean).map(escMultiline).join('<br>');
  const style = `--brand:${b.color};--brand-soft:${hexToRgba(b.color, 0.08)};--brand-font:${b.font.body};--brand-head:${b.font.head}`;
  const rows = (inv.items || []).map(it => `<tr>
      <td class="desc">${esc(it.desc || '—')}</td>
      <td class="r">${esc(it.qty ?? 0)}</td>
      <td class="r">${money(it.rate, cur)}</td>
      <td class="r">${Number(it.discount) ? `${esc(it.discount)}%` : '—'}</td>
      <td class="r">${Number(it.taxRate) ? `${esc(it.taxRate)}%` : '—'}</td>
      <td class="r">${money(lineTotal(it), cur)}</td>
    </tr>`).join('');

  return `<div class="invoice-doc style-${b.style}" style="${style}">
    <div class="d-head">
      <div>
        ${b.logoData ? `<img class="d-logo" src="${esc(b.logoData)}" alt="${esc(profile.name || 'Company')} logo">` : ''}
        <div class="d-brand">${esc(profile.name || 'Your business')}</div>
        <div class="d-from">${fromLines}${profile.tax ? `<br>${esc(taxLabel)} No: ${esc(profile.tax)}` : ''}</div>
      </div>
      <div class="d-title">
        <h1>Invoice</h1>
        <div class="d-num">${esc(inv.number || '')}</div>
        ${status !== 'Draft' ? `<span class="d-status ${status.toLowerCase()}">${esc(status)}</span>` : ''}
      </div>
    </div>
    <div class="d-meta">
      <div>
        <div class="d-label">Bill to</div>
        <div class="d-strong">${esc(inv.clientName || 'Client name')}</div>
        <div class="d-muted">${[inv.clientEmail, inv.clientAddress].filter(Boolean).map(escMultiline).join('<br>')}</div>
      </div>
      <div><div class="d-label">Issue date</div><div class="d-strong">${esc(fmtDate(inv.date))}</div></div>
      <div><div class="d-label">Due date</div><div class="d-strong">${esc(fmtDate(inv.dueDate))}</div></div>
    </div>
    <table>
      <thead><tr><th>Description</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Disc.</th><th class="r">${esc(taxLabel)}</th><th class="r">Amount</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="d-muted">No items yet</td></tr>'}</tbody>
    </table>
    <div class="d-bottom">
      <div class="d-notes">${inv.notes ? `<div class="d-label">Notes &amp; terms</div>${esc(inv.notes)}` : ''}</div>
      <div class="d-totals">
        <div class="d-row"><span>Subtotal</span><span>${money(totals.subtotal, cur)}</span></div>
        ${totals.discount ? `<div class="d-row"><span>Discount</span><span>−${money(totals.discount, cur)}</span></div>` : ''}
        ${totals.tax ? `<div class="d-row"><span>${esc(taxLabel)}</span><span>${money(totals.tax, cur)}</span></div>` : ''}
        <div class="d-grand"><span>Total due</span><span>${money(totals.total, cur)}</span></div>
      </div>
    </div>
    <div class="d-foot"><span>${esc(profile.name || '')}</span><span>${esc(inv.number || '')}</span></div>
  </div>`;
}

/**
 * Prints via a hidden same-origin iframe (no popup, so it isn't blocked). The browser's print
 * dialog offers "Save as PDF"; the document title becomes the default file name.
 */
export function printInvoice(inv, profile) {
  return new Promise(resolve => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
    document.body.append(frame);
    const doc = frame.contentDocument;
    const origin = location.origin;
    doc.open();
    doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(inv.number || 'Invoice')} - ${esc(inv.clientName || '')}</title>
      <link rel="stylesheet" href="${origin}/fonts/fonts.css"><link rel="stylesheet" href="${origin}/css/invoice.css"></head>
      <body>${renderInvoiceDoc(inv, profile)}</body></html>`);
    doc.close();
    const go = async () => {
      try { await doc.fonts?.ready; } catch { /* fonts optional */ }
      const imgs = [...doc.images].map(img => (img.complete ? null : new Promise(r => { img.onload = img.onerror = r; })));
      await Promise.all(imgs.filter(Boolean));
      frame.contentWindow.focus();
      frame.contentWindow.print();
      setTimeout(() => { frame.remove(); resolve(); }, 1000);
    };
    if (doc.readyState === 'complete') go();
    else frame.addEventListener('load', go, { once: true });
  });
}
