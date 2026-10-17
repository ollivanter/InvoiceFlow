import { state, upsertInvoice, upsertClient } from '../store.js';
import { $, $$, esc, icon, money, uid, nowIso, todayIso, addDays, CURRENCIES, currencyCode, highlight, debounce } from '../util.js';
import { calcTotals, lineTotal, nextNumber, renderInvoiceDoc, printInvoice, statusOf, badge } from '../invoice.js';
import { toast, confirmDialog, invalid, clearInvalid } from '../ui.js';
import { invoiceMenu, setStatus } from './invoices.js';

let draft = null;
let dirty = false;
let isNew = true;

export function render(view, params) {
  const p = state.profile;
  const existing = params.id !== 'new' && state.invoices.find(i => i.id === params.id);
  if (params.id !== 'new' && !existing) {
    view.innerHTML = `<div class="empty"><h3>Invoice not found</h3><p>It may have been deleted on another device.</p><a class="btn btn-primary" href="#/invoices">Back to invoices</a></div>`;
    return {};
  }
  isNew = !existing;
  dirty = false;
  const fromClient = params.query?.get('client') && state.clients.find(c => c.id === params.query.get('client'));
  draft = existing ? structuredClone(existing) : {
    id: uid(),
    number: nextNumber(state.invoices, p.invoicePrefix || 'INV-'),
    currency: currencyCode(p.currency),
    date: todayIso(),
    dueDate: addDays(todayIso(), p.dueDays ?? 15),
    clientId: fromClient?.id || null,
    clientName: fromClient?.name || '',
    clientEmail: fromClient?.email || '',
    clientAddress: fromClient?.address || '',
    taxLabel: p.taxLabel || 'GST',
    notes: p.terms || '',
    items: [{ desc: '', qty: 1, rate: 0, discount: 0, taxRate: Number(p.taxRate) || 0 }],
    status: 'Draft'
  };
  draft.items = draft.items?.length ? draft.items : [{ desc: '', qty: 1, rate: 0, discount: 0, taxRate: 0 }];

  view.innerHTML = `
    <div class="page-head">
      <div><a class="back-link" href="#/invoices">${icon('arrow-left')}Invoices</a>
        <h2 style="margin-top:6px">${isNew ? 'New invoice' : `Invoice ${esc(draft.number)}`} <span id="ed-status">${isNew ? '' : badge(statusOf(draft))}</span></h2></div>
      <div class="page-actions">${isNew ? '' : `<button class="btn btn-ghost" type="button" id="ed-more" aria-haspopup="menu">${icon('dots')}More</button>`}</div>
    </div>
    <div class="editor">
      <form class="editor-form" id="ed-form" novalidate>
        <section class="card"><div class="card-body">
          <div class="section-title">Details</div>
          <div class="form-grid">
            <div class="field"><label for="f-number">Invoice number <span class="req">*</span></label><input id="f-number" data-f="number" value="${esc(draft.number)}" maxlength="40" required></div>
            <div class="field"><label for="f-currency">Currency</label><select id="f-currency" data-f="currency">${CURRENCIES.map(c => `<option value="${c.code}" ${c.code === draft.currency ? 'selected' : ''}>${esc(c.symbol)} ${c.code}</option>`).join('')}</select></div>
            <div class="field"><label for="f-date">Issue date</label><input id="f-date" type="date" data-f="date" value="${esc(draft.date)}"></div>
            <div class="field"><label for="f-due">Due date</label><input id="f-due" type="date" data-f="dueDate" value="${esc(draft.dueDate)}"></div>
          </div>
        </div></section>

        <section class="card"><div class="card-body">
          <div class="section-title">Bill to <a class="link small" href="#/clients">Manage clients</a></div>
          <div class="form-grid">
            <div class="field span-2"><label for="f-client">Client name <span class="req">*</span></label>
              <div class="ac-wrap"><input id="f-client" data-f="clientName" value="${esc(draft.clientName)}" autocomplete="off" placeholder="Start typing to search your clients" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ac-client" maxlength="160"><div class="ac-list" id="ac-client" role="listbox" hidden></div></div>
              <span class="hint" id="client-hint">${draft.clientId ? 'Linked to a saved client.' : 'New names are saved to your clients automatically.'}</span></div>
            <div class="field"><label for="f-email">Client email</label><input id="f-email" type="email" data-f="clientEmail" value="${esc(draft.clientEmail)}" placeholder="billing@client.com" maxlength="254"></div>
            <div class="field"><label for="f-taxlabel">Tax label</label><input id="f-taxlabel" data-f="taxLabel" value="${esc(draft.taxLabel)}" maxlength="30"></div>
            <div class="field span-2"><label for="f-address">Client address</label><textarea id="f-address" data-f="clientAddress" rows="2" maxlength="500">${esc(draft.clientAddress)}</textarea></div>
          </div>
        </div></section>

        <section class="card"><div class="card-body">
          <div class="section-title">Line items <span class="muted small">${(p.catalog || []).length ? 'Type to search your products' : '<a class="link" href="#/products">Add products</a> to auto-fill prices'}</span></div>
          <table class="items-table">
            <thead><tr><th class="c-desc">Description</th><th class="c-qty">Qty</th><th class="c-rate">Rate</th><th class="c-pct">Disc %</th><th class="c-pct">Tax %</th><th class="c-amt">Amount</th><th class="c-del"><span class="sr-only">Remove</span></th></tr></thead>
            <tbody id="ed-items"></tbody>
          </table>
          <button type="button" class="add-row" id="ed-add">${icon('plus')}Add line item</button>
          <div class="totals" id="ed-totals" aria-live="polite"></div>
        </div></section>

        <section class="card"><div class="card-body">
          <div class="field"><label for="f-notes">Notes &amp; payment terms</label><textarea id="f-notes" data-f="notes" rows="3" maxlength="2000" placeholder="Bank details, payment instructions, thank-you note…">${esc(draft.notes)}</textarea></div>
        </div></section>

        <div class="editor-actions">
          <span class="save-hint" id="ed-hint">${icon('cloud')}<span>${isNew ? 'Not saved yet' : 'All changes saved'}</span></span>
          <span class="spacer"></span>
          <button type="button" class="btn btn-ghost" id="ed-print">${icon('printer')}<span>PDF</span></button>
          <button type="button" class="btn btn-ghost" id="ed-save">Save draft</button>
          <button type="submit" class="btn btn-primary" id="ed-primary"></button>
        </div>
      </form>

      <aside class="editor-preview" aria-label="Invoice preview">
        <div class="preview-shell">
          <div class="preview-bar"><span class="label"><span class="live-dot"></span>Live preview</span><a class="btn btn-subtle btn-sm" href="#/settings/branding">${icon('palette')}Branding</a></div>
          <div class="preview-stage"><div class="preview-paper" id="ed-paper"><div id="ed-doc"></div></div></div>
        </div>
      </aside>
    </div>`;

  renderItems(view);
  updatePrimary(view);
  refresh(view);
  bind(view);

  const ro = new ResizeObserver(() => scalePreview(view));
  ro.observe($('.preview-stage', view));

  const onKey = e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(view, draft.status === 'Draft' ? 'Draft' : draft.status);
    }
  };
  document.addEventListener('keydown', onKey);

  if (isNew && !fromClient) setTimeout(() => $('#f-client', view)?.focus(), 50);

  return {
    liveUpdate: false,
    async canLeave() {
      if (!dirty) return true;
      return confirmDialog({ title: 'Discard unsaved changes?', message: 'You have changes to this invoice that haven\'t been saved.', confirmText: 'Discard changes', danger: true });
    },
    destroy() {
      ro.disconnect();
      document.removeEventListener('keydown', onKey);
    }
  };
}

function updatePrimary(view) {
  const st = statusOf(draft);
  const btn = $('#ed-primary', view);
  if (isNew || st === 'Draft') btn.innerHTML = `${icon('send')}Save &amp; mark sent`;
  else if (st === 'Paid') btn.innerHTML = `${icon('check')}Save changes`;
  else btn.innerHTML = `${icon('cash')}Save &amp; mark paid`;
  $('#ed-save', view).hidden = !(isNew || st === 'Draft');
}

function markDirty(view) {
  dirty = true;
  $('#ed-hint span', view).textContent = 'Unsaved changes';
}

const previewLater = debounce(view => {
  $('#ed-doc', view).innerHTML = renderInvoiceDoc(draft, state.profile);
  scalePreview(view);
}, 60);

function refresh(view) {
  const t = calcTotals(draft.items);
  const c = draft.currency;
  $('#ed-totals', view).innerHTML = `
    <div class="totals-row"><span>Subtotal</span><span>${esc(money(t.subtotal, c))}</span></div>
    ${t.discount ? `<div class="totals-row"><span>Discount</span><span>−${esc(money(t.discount, c))}</span></div>` : ''}
    ${t.tax ? `<div class="totals-row"><span>${esc(draft.taxLabel || 'Tax')}</span><span>${esc(money(t.tax, c))}</span></div>` : ''}
    <div class="totals-row grand"><span>Total</span><span>${esc(money(t.total, c))}</span></div>`;
  $$('[data-amt]', view).forEach(el => { el.textContent = money(lineTotal(draft.items[Number(el.dataset.amt)]), c); });
  previewLater(view);
}

function scalePreview(view) {
  const stage = $('.preview-stage', view);
  const paper = $('#ed-paper', view);
  const doc = $('.invoice-doc', paper);
  if (!stage || !doc) return;
  const scale = Math.min(1, (stage.clientWidth - 40) / 794);
  doc.style.transform = `scale(${scale})`;
  doc.style.transformOrigin = 'top left';
  paper.style.width = `${794 * scale}px`;
  paper.style.height = `${doc.offsetHeight * scale}px`;
  paper.style.margin = '0 auto';
}

function renderItems(view) {
  const c = draft.currency;
  $('#ed-items', view).innerHTML = draft.items.map((it, i) => `<tr class="item-row">
    <td class="c-desc"><div class="ac-wrap"><input data-row="${i}" data-k="desc" value="${esc(it.desc)}" placeholder="Item or service" aria-label="Description, line ${i + 1}" autocomplete="off" maxlength="500" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="ac-item-${i}"><div class="ac-list" id="ac-item-${i}" role="listbox" hidden></div></div></td>
    <td class="c-qty" data-label="Qty"><input type="number" min="0" step="any" data-row="${i}" data-k="qty" value="${esc(it.qty)}" aria-label="Quantity, line ${i + 1}"></td>
    <td class="c-rate" data-label="Rate"><input type="number" min="0" step="any" data-row="${i}" data-k="rate" value="${esc(it.rate)}" aria-label="Rate, line ${i + 1}"></td>
    <td class="c-pct" data-label="Disc %"><input type="number" min="0" max="100" step="any" data-row="${i}" data-k="discount" value="${esc(it.discount || 0)}" aria-label="Discount percent, line ${i + 1}"></td>
    <td class="c-pct" data-label="Tax %"><input type="number" min="0" max="100" step="any" data-row="${i}" data-k="taxRate" value="${esc(it.taxRate || 0)}" aria-label="Tax percent, line ${i + 1}"></td>
    <td class="c-amt" data-amt="${i}">${esc(money(lineTotal(it), c))}</td>
    <td class="c-del"><button type="button" class="icon-btn sm" data-del="${i}" aria-label="Remove line ${i + 1}" ${draft.items.length === 1 ? 'disabled' : ''}>${icon('trash')}</button></td>
  </tr>`).join('');
  $$('#ed-items [data-k="desc"]', view).forEach(input => attachAutocomplete(input, {
    source: q => (state.profile.catalog || []).filter(c => c.name && (!q || c.name.toLowerCase().includes(q))).slice(0, 8),
    render: (item, q) => `<span>${highlight(item.name, q)}</span><span class="ac-meta">${esc(money(item.price, draft.currency))} · ${esc(item.taxRate)}%</span>`,
    onPick: item => {
      const row = Number(input.dataset.row);
      Object.assign(draft.items[row], { desc: item.name, rate: Number(item.price) || 0, taxRate: Number(item.taxRate) || 0 });
      markDirty(view);
      renderItems(view);
      refresh(view);
      $(`#ed-items [data-row="${row}"][data-k="qty"]`, view)?.focus();
    }
  }));
}

function bind(view) {
  const form = $('#ed-form', view);
  form.addEventListener('input', e => {
    const t = e.target;
    t.closest('.field')?.classList.remove('invalid');
    if (t.dataset.f) {
      draft[t.dataset.f] = t.value;
      if (t.dataset.f === 'clientName' && draft.clientId) {
        const linked = state.clients.find(c => c.id === draft.clientId);
        if (!linked || linked.name !== t.value) {
          draft.clientId = null;
          $('#client-hint', view).textContent = 'New names are saved to your clients automatically.';
        }
      }
    } else if (t.dataset.row !== undefined) {
      const it = draft.items[Number(t.dataset.row)];
      it[t.dataset.k] = t.dataset.k === 'desc' ? t.value : (t.value === '' ? 0 : Number(t.value));
    }
    markDirty(view);
    refresh(view);
  });
  form.addEventListener('change', e => {
    if (e.target.dataset.f === 'currency') { renderItems(view); refresh(view); }
  });
  form.addEventListener('click', e => {
    const del = e.target.closest('[data-del]');
    if (del && draft.items.length > 1) {
      draft.items.splice(Number(del.dataset.del), 1);
      markDirty(view);
      renderItems(view);
      refresh(view);
    }
  });
  $('#ed-add', view).addEventListener('click', () => {
    draft.items.push({ desc: '', qty: 1, rate: 0, discount: 0, taxRate: Number(state.profile.taxRate) || 0 });
    renderItems(view);
    refresh(view);
    markDirty(view);
    $(`#ed-items [data-row="${draft.items.length - 1}"][data-k="desc"]`, view).focus();
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const st = statusOf(draft);
    save(view, isNew || st === 'Draft' ? 'Sent' : st === 'Paid' ? 'Paid' : 'Paid');
  });
  $('#ed-save', view).addEventListener('click', () => save(view, 'Draft'));
  $('#ed-print', view).addEventListener('click', () => {
    if (!validate(view)) return;
    printInvoice({ ...draft, ...calcTotals(draft.items) }, state.profile);
  });
  $('#ed-more', view)?.addEventListener('click', e => invoiceMenu(e.currentTarget, draft.id, {
    onChange: () => {
      const latest = state.invoices.find(i => i.id === draft.id);
      if (!latest) { dirty = false; location.hash = '#/invoices'; return; }
      draft.status = latest.status;
      draft.paidAt = latest.paidAt;
      $('#ed-status', view).innerHTML = badge(statusOf(draft));
      updatePrimary(view);
      refresh(view);
    }
  }));

  attachAutocomplete($('#f-client', view), {
    source: q => state.clients.filter(c => !q || `${c.name} ${c.email}`.toLowerCase().includes(q)).slice(0, 8),
    render: (c, q) => `<span>${highlight(c.name, q)}</span><span class="ac-meta">${esc(c.email || '')}</span>`,
    onPick: c => {
      Object.assign(draft, { clientId: c.id, clientName: c.name, clientEmail: c.email || '', clientAddress: c.address || '' });
      $('#f-client', view).value = c.name;
      $('#f-email', view).value = c.email || '';
      $('#f-address', view).value = c.address || '';
      $('#client-hint', view).textContent = 'Linked to a saved client.';
      markDirty(view);
      refresh(view);
    },
    footer: 'Enter to select · Esc to close'
  });
}

function validate(view) {
  clearInvalid(view);
  const num = draft.number.trim();
  if (!num) return invalid($('#f-number', view), 'Invoice number is required.');
  if (state.invoices.some(i => i.id !== draft.id && i.number.trim().toLowerCase() === num.toLowerCase())) {
    return invalid($('#f-number', view), 'Another invoice already uses this number.');
  }
  if (draft.date && draft.dueDate && draft.dueDate < draft.date) return invalid($('#f-due', view), 'Due date can\'t be before the issue date.');
  if (!draft.clientName.trim()) return invalid($('#f-client', view), 'Enter the client\'s name.');
  if (draft.clientEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.clientEmail.trim())) return invalid($('#f-email', view), 'Enter a valid email address.');
  const firstItem = $('#ed-items [data-k="desc"]', view);
  if (!draft.items.some(it => it.desc.trim())) return invalid(firstItem, 'Add at least one line item with a description.');
  if (draft.items.some(it => Number(it.qty) < 0 || Number(it.rate) < 0)) { toast('Quantities and rates can\'t be negative.', { type: 'error' }); return false; }
  if (draft.items.some(it => Number(it.discount) > 100 || Number(it.taxRate) > 100)) { toast('Discount and tax must be between 0 and 100%.', { type: 'error' }); return false; }
  return true;
}

function save(view, status) {
  if (!validate(view)) return;
  // Link to an existing client by name, or save a new one.
  if (!draft.clientId) {
    const match = state.clients.find(c => c.name.trim().toLowerCase() === draft.clientName.trim().toLowerCase());
    const client = match || upsertClient({ id: uid(), name: draft.clientName.trim(), email: draft.clientEmail.trim(), address: draft.clientAddress.trim(), phone: '', taxId: '', notes: '' });
    draft.clientId = client.id;
  }
  const items = draft.items.filter(it => it.desc.trim() || Number(it.rate));
  const record = {
    ...draft,
    number: draft.number.trim(),
    clientName: draft.clientName.trim(),
    clientEmail: draft.clientEmail.trim(),
    items,
    ...calcTotals(items),
    status
  };
  if (status === 'Sent' && !record.sentAt) record.sentAt = nowIso();
  if (status === 'Paid' && !record.paidAt) record.paidAt = nowIso();
  if (status !== 'Paid') record.paidAt = null;
  const saved = upsertInvoice(record);
  draft = structuredClone(saved);
  dirty = false;
  const label = { Draft: 'saved as draft', Sent: 'saved and marked as sent', Paid: draft.paidAt && status === 'Paid' ? 'saved and marked as paid' : 'saved' }[status];
  toast(`${saved.number} ${label}.`);
  if (isNew) {
    isNew = false;
    history.replaceState(null, '', `#/invoices/${saved.id}`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    $('#ed-hint span', view).textContent = 'All changes saved';
    $('#ed-status', view).innerHTML = badge(statusOf(draft));
    updatePrimary(view);
  }
}

/** Accessible combobox autocomplete (arrow keys, Enter, Esc). */
function attachAutocomplete(input, { source, render, onPick, footer }) {
  const list = document.getElementById(input.getAttribute('aria-controls'));
  let items = [];
  let active = -1;
  const close = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; input.removeAttribute('aria-activedescendant'); };
  const open = () => {
    const q = input.value.trim().toLowerCase();
    items = source(q);
    if (!items.length) return close();
    list.innerHTML = items.map((it, i) => `<div class="ac-item" role="option" id="${list.id}-o${i}" data-i="${i}" aria-selected="false">${render(it, q)}</div>`).join('') + (footer ? `<div class="ac-foot">${esc(footer)}</div>` : '');
    list.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    active = -1;
  };
  const setActive = i => {
    active = i;
    $$('.ac-item', list).forEach((el, k) => { el.classList.toggle('active', k === i); el.setAttribute('aria-selected', String(k === i)); });
    if (i >= 0) { input.setAttribute('aria-activedescendant', `${list.id}-o${i}`); $(`#${list.id}-o${i}`)?.scrollIntoView({ block: 'nearest' }); }
  };
  input.addEventListener('focus', open);
  input.addEventListener('input', open);
  input.addEventListener('blur', () => setTimeout(close, 120));
  input.addEventListener('keydown', e => {
    if (list.hidden) { if (e.key === 'ArrowDown') { open(); e.preventDefault(); } return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(items.length - 1, active + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(0, active - 1)); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); const it = items[active]; close(); onPick(it); }
    else if (e.key === 'Escape') { e.stopPropagation(); close(); }
  });
  list.addEventListener('mousedown', e => {
    const el = e.target.closest('.ac-item');
    if (!el) return;
    e.preventDefault();
    const it = items[Number(el.dataset.i)];
    close();
    onPick(it);
  });
}

export { setStatus };
