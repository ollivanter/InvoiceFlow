import { state, upsertInvoice, deleteInvoice, restoreInvoice } from '../store.js';
import { esc, icon, money, fmtDate, relativeDue, uid, nowIso, todayIso, addDays, download, csvCell, debounce, initials } from '../util.js';
import { statusOf, badge, nextNumber, printInvoice } from '../invoice.js';
import { openMenu, toast, confirmDialog } from '../ui.js';
import { EMPTY_ART } from './dashboard.js';

const FILTERS = ['All', 'Draft', 'Sent', 'Overdue', 'Paid'];
const ui = { filter: 'All', query: '', sort: 'date', dir: -1, client: null };

export function render(view, params = {}) {
  ui.client = params.query?.get('client') || null;
  view.innerHTML = `
    <div class="page-head">
      <div><h2>Invoices</h2><p>Track, update and export every invoice.</p></div>
      <div class="page-actions">
        <button class="btn btn-ghost" type="button" data-act="export">${icon('download')}Export CSV</button>
        <a class="btn btn-primary" href="#/invoices/new">${icon('plus')}New invoice</a>
      </div>
    </div>
    <section class="card">
      <div class="toolbar">
        <div class="segmented" role="group" aria-label="Filter by status" id="inv-filters"></div>
        <label class="search-input"><span class="sr-only">Search invoices</span>${icon('search')}<input type="search" id="inv-search" placeholder="Search client or number…" value="${esc(ui.query)}"></label>
      </div>
      <div id="client-filter"></div>
      <div id="inv-table"></div>
    </section>`;

  view.querySelector('#inv-search').addEventListener('input', debounce(e => { ui.query = e.target.value.trim().toLowerCase(); draw(view); }, 120));
  view.querySelector('[data-act="export"]').addEventListener('click', exportCsv);
  draw(view);
}

function filtered() {
  let list = state.invoices.map(inv => ({ ...inv, st: statusOf(inv) }));
  if (ui.client) list = list.filter(i => i.clientId === ui.client);
  const counts = Object.fromEntries(FILTERS.map(f => [f, f === 'All' ? list.length : list.filter(i => i.st === f).length]));
  if (ui.filter !== 'All') list = list.filter(i => i.st === ui.filter);
  if (ui.query) list = list.filter(i => `${i.number} ${i.clientName} ${i.clientEmail}`.toLowerCase().includes(ui.query));
  const key = { number: i => i.number, client: i => (i.clientName || '').toLowerCase(), date: i => i.date || '', due: i => i.dueDate || '', amount: i => Number(i.total) || 0, status: i => i.st }[ui.sort];
  list.sort((a, b) => (key(a) > key(b) ? 1 : key(a) < key(b) ? -1 : 0) * ui.dir);
  return { list, counts };
}

function draw(view) {
  const { list, counts } = filtered();
  view.querySelector('#inv-filters').innerHTML = FILTERS.map(f =>
    `<button type="button" data-filter="${f}" class="${ui.filter === f ? 'active' : ''}" aria-pressed="${ui.filter === f}">${f}<span class="count">${counts[f]}</span></button>`).join('');
  view.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { ui.filter = b.dataset.filter; draw(view); });

  const clientBox = view.querySelector('#client-filter');
  const client = ui.client && state.clients.find(c => c.id === ui.client);
  clientBox.innerHTML = client ? `<div class="toolbar" style="padding:10px 16px"><span class="badge plain" style="background:var(--primary-soft);color:var(--primary-text)">Client: ${esc(client.name)}</span><a class="link small" href="#/invoices">Clear filter</a></div>` : '';

  const table = view.querySelector('#inv-table');
  if (!state.invoices.length) {
    table.innerHTML = `<div class="empty">${EMPTY_ART}<h3>No invoices yet</h3><p>Your invoices will appear here. Start with your first one.</p><a class="btn btn-primary" href="#/invoices/new">${icon('plus')}Create invoice</a></div>`;
    return;
  }
  if (!list.length) {
    table.innerHTML = `<div class="empty"><h3>No matching invoices</h3><p>Try a different search or status filter.</p></div>`;
    return;
  }
  const th = (key, label, cls = '') => {
    const active = ui.sort === key;
    const dir = active ? (ui.dir === 1 ? 'ascending' : 'descending') : 'none';
    return `<th class="sortable ${cls}" aria-sort="${dir}"><button type="button" class="linkish" data-sort="${key}">${label}<span class="sort-ind" aria-hidden="true">${active ? (ui.dir === 1 ? '▲' : '▼') : ''}</span></button></th>`;
  };
  table.innerHTML = `<div class="table-wrap"><table class="table">
    <caption class="sr-only">Invoices, ${list.length} shown</caption>
    <thead><tr>${th('number', 'Invoice')}${th('client', 'Client')}${th('date', 'Issued')}${th('due', 'Due')}${th('amount', 'Amount', 'right')}${th('status', 'Status')}<th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${list.map(inv => `<tr class="clickable" data-id="${esc(inv.id)}">
      <td><a class="cell-main mono" href="#/invoices/${esc(inv.id)}">${esc(inv.number)}</a></td>
      <td><div class="client-cell"><span class="avatar sm" aria-hidden="true">${esc(initials(inv.clientName))}</span><div><div class="cell-main">${esc(inv.clientName || '—')}</div><div class="cell-sub">${esc(inv.clientEmail || '')}</div></div></div></td>
      <td>${esc(fmtDate(inv.date))}</td>
      <td><div>${esc(fmtDate(inv.dueDate))}</div>${inv.st === 'Sent' || inv.st === 'Overdue' ? `<div class="cell-sub" style="${inv.st === 'Overdue' ? 'color:var(--danger-text)' : ''}">${esc(relativeDue(inv.dueDate))}</div>` : ''}</td>
      <td class="right cell-main num">${esc(money(inv.total, inv.currency))}</td>
      <td>${badge(inv.st)}</td>
      <td class="actions"><button class="icon-btn sm" type="button" data-menu="${esc(inv.id)}" aria-label="Actions for ${esc(inv.number)}" aria-haspopup="menu">${icon('dots')}</button></td>
    </tr>`).join('')}</tbody></table></div>
    <div class="table-foot"><span>${list.length} invoice${list.length === 1 ? '' : 's'}</span><span>Total ${esc(summarize(list))}</span></div>`;

  table.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {
    ui.dir = ui.sort === b.dataset.sort ? -ui.dir : (b.dataset.sort === 'client' || b.dataset.sort === 'number' ? 1 : -1);
    ui.sort = b.dataset.sort;
    draw(view);
  });
  table.querySelectorAll('tr.clickable').forEach(row => row.addEventListener('click', e => {
    if (e.target.closest('button,a')) return;
    location.hash = `#/invoices/${row.dataset.id}`;
  }));
  table.querySelectorAll('[data-menu]').forEach(btn => btn.addEventListener('click', () => invoiceMenu(btn, btn.dataset.menu)));
}

function summarize(list) {
  const byCur = {};
  for (const i of list) byCur[i.currency] = (byCur[i.currency] || 0) + (Number(i.total) || 0);
  return Object.entries(byCur).map(([c, v]) => money(v, c)).join(' + ');
}

export function invoiceMenu(anchor, id, { onChange } = {}) {
  const inv = state.invoices.find(i => i.id === id);
  if (!inv) return;
  const st = statusOf(inv);
  const items = [
    { label: 'Edit', icon: 'edit', onClick: () => { location.hash = `#/invoices/${id}`; } },
    { label: 'Duplicate', icon: 'copy', onClick: () => duplicateInvoice(inv) },
    { label: 'Print / save PDF', icon: 'printer', onClick: () => printInvoice(inv, state.profile) }
  ];
  if (st === 'Draft') items.push({ label: 'Mark as sent', icon: 'send', onClick: () => { setStatus(inv, 'Sent'); onChange?.(); } });
  if (st !== 'Paid') items.push({ label: 'Mark as paid', icon: 'cash', onClick: () => { setStatus(inv, 'Paid'); onChange?.(); } });
  else items.push({ label: 'Mark as unpaid', icon: 'clock', onClick: () => { setStatus(inv, 'Sent'); onChange?.(); } });
  items.push('divider', { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeInvoice(inv, onChange) });
  openMenu(anchor, items);
}

export function setStatus(inv, status) {
  const patch = { status };
  if (status === 'Sent' && !inv.sentAt) patch.sentAt = nowIso();
  if (status === 'Paid') patch.paidAt = nowIso();
  if (status !== 'Paid') patch.paidAt = null;
  upsertInvoice({ ...inv, ...patch });
  toast(`${inv.number} marked as ${status.toLowerCase()}.`);
}

export function duplicateInvoice(inv) {
  const copy = {
    ...inv,
    id: uid(),
    number: nextNumber(state.invoices, state.profile.invoicePrefix || 'INV-'),
    status: 'Draft',
    date: todayIso(),
    dueDate: addDays(todayIso(), state.profile.dueDays ?? 15),
    createdAt: nowIso(),
    sentAt: null,
    paidAt: null,
    items: inv.items.map(it => ({ ...it }))
  };
  upsertInvoice(copy);
  toast(`Created ${copy.number} as a draft copy.`);
  location.hash = `#/invoices/${copy.id}`;
}

export async function removeInvoice(inv, after) {
  const ok = await confirmDialog({
    title: `Delete ${inv.number}?`,
    message: 'This removes the invoice from all your devices. You can undo right after, or restore it later from a backup.',
    confirmText: 'Delete invoice',
    danger: true
  });
  if (!ok) return;
  deleteInvoice(inv.id);
  after?.();
  toast(`${inv.number} deleted.`, { action: { label: 'Undo', onClick: () => restoreInvoice(inv) } });
}

function exportCsv() {
  const rows = [['Number', 'Client', 'Client email', 'Issue date', 'Due date', 'Status', 'Currency', 'Subtotal', 'Discount', 'Tax', 'Total', 'Paid at']];
  for (const inv of state.invoices) {
    rows.push([inv.number, inv.clientName, inv.clientEmail, inv.date, inv.dueDate, statusOf(inv), inv.currency, inv.subtotal, inv.discount, inv.tax, inv.total, inv.paidAt || '']);
  }
  download(`invoices-${todayIso()}.csv`, '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n'), 'text/csv;charset=utf-8');
  toast(`Exported ${state.invoices.length} invoice${state.invoices.length === 1 ? '' : 's'}.`);
}
