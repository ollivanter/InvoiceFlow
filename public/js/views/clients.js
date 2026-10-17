import { state, upsertClient, deleteClient } from '../store.js';
import { $, esc, icon, money, uid, initials, debounce, currencyCode } from '../util.js';
import { statusOf } from '../invoice.js';
import { openModal, openMenu, toast, confirmDialog, invalid, clearInvalid } from '../ui.js';

let query = '';

export function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h2>Clients</h2><p>Everyone you bill, with what they've been invoiced and what's outstanding.</p></div>
      <div class="page-actions"><button class="btn btn-primary" type="button" id="add-client">${icon('plus')}Add client</button></div>
    </div>
    <section class="card">
      <div class="toolbar"><label class="search-input" style="margin-left:0"><span class="sr-only">Search clients</span>${icon('search')}<input type="search" id="client-search" placeholder="Search clients…" value="${esc(query)}"></label></div>
      <div id="client-table"></div>
    </section>`;
  $('#add-client', view).onclick = () => clientModal();
  $('#client-search', view).addEventListener('input', debounce(e => { query = e.target.value.trim().toLowerCase(); draw(view); }, 120));
  draw(view);
}

function stats(client) {
  const base = currencyCode(state.profile.currency);
  const invoices = state.invoices.filter(i => i.clientId === client.id || (!i.clientId && i.clientName?.trim().toLowerCase() === client.name.trim().toLowerCase()));
  const inBase = invoices.filter(i => currencyCode(i.currency) === base);
  const billed = inBase.filter(i => statusOf(i) !== 'Draft').reduce((s, i) => s + (Number(i.total) || 0), 0);
  const due = inBase.filter(i => ['Sent', 'Overdue'].includes(statusOf(i))).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const overdue = invoices.some(i => statusOf(i) === 'Overdue');
  return { count: invoices.length, billed, due, overdue, base };
}

function draw(view) {
  const box = $('#client-table', view);
  const list = state.clients.filter(c => !query || `${c.name} ${c.email}`.toLowerCase().includes(query));
  if (!state.clients.length) {
    box.innerHTML = `<div class="empty"><div class="feature-icon" style="margin:0 auto 8px">${icon('users')}</div><h3>No clients yet</h3><p>Add clients here, or just type a new name when creating an invoice — we'll save it for you.</p><button class="btn btn-primary" type="button" id="empty-add">${icon('plus')}Add client</button></div>`;
    $('#empty-add', box).onclick = () => clientModal();
    return;
  }
  if (!list.length) {
    box.innerHTML = '<div class="empty"><h3>No matching clients</h3><p>Try a different search.</p></div>';
    return;
  }
  box.innerHTML = `<div class="table-wrap"><table class="table">
    <caption class="sr-only">Clients</caption>
    <thead><tr><th>Client</th><th class="right">Invoices</th><th class="right">Billed</th><th class="right">Outstanding</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${list.map(c => {
      const s = stats(c);
      return `<tr>
        <td><div class="client-cell"><span class="avatar sm" aria-hidden="true">${esc(initials(c.name))}</span><div><button type="button" class="linkish cell-main" data-edit="${esc(c.id)}">${esc(c.name)}</button><div class="cell-sub">${esc(c.email || 'No email')}</div></div></div></td>
        <td class="right num">${s.count}</td>
        <td class="right num">${esc(money(s.billed, s.base))}</td>
        <td class="right num" style="${s.overdue ? 'color:var(--danger-text);font-weight:600' : ''}">${esc(money(s.due, s.base))}${s.overdue ? ' <span class="sr-only">(includes overdue)</span>' : ''}</td>
        <td class="actions"><button class="icon-btn sm" type="button" data-menu="${esc(c.id)}" aria-label="Actions for ${esc(c.name)}" aria-haspopup="menu">${icon('dots')}</button></td>
      </tr>`;
    }).join('')}</tbody></table></div>
    <div class="table-foot"><span>${list.length} client${list.length === 1 ? '' : 's'}</span><span>Amounts in ${esc(currencyCode(state.profile.currency))}</span></div>`;

  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => clientModal(state.clients.find(c => c.id === b.dataset.edit)));
  box.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => {
    const c = state.clients.find(x => x.id === b.dataset.menu);
    openMenu(b, [
      { label: 'New invoice', icon: 'plus', onClick: () => { location.hash = `#/invoices/new?client=${c.id}`; } },
      { label: 'View invoices', icon: 'file', onClick: () => { location.hash = `#/invoices?client=${c.id}`; } },
      { label: 'Edit', icon: 'edit', onClick: () => clientModal(c) },
      'divider',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeClient(c) }
    ]);
  });
}

export function clientModal(client) {
  const c = client || { id: uid(), name: '', email: '', phone: '', address: '', taxId: '', notes: '' };
  const m = openModal({
    title: client ? 'Edit client' : 'Add client',
    wide: true,
    body: `<form id="client-form" class="form-grid" novalidate>
      <div class="field span-2"><label for="c-name">Name <span class="req">*</span></label><input id="c-name" name="name" value="${esc(c.name)}" maxlength="160" required autofocus></div>
      <div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" value="${esc(c.email)}" maxlength="254"></div>
      <div class="field"><label for="c-phone">Phone</label><input id="c-phone" name="phone" value="${esc(c.phone)}" maxlength="40"></div>
      <div class="field span-2"><label for="c-address">Address</label><textarea id="c-address" name="address" rows="2" maxlength="500">${esc(c.address)}</textarea></div>
      <div class="field"><label for="c-tax">Tax ID</label><input id="c-tax" name="taxId" value="${esc(c.taxId)}" maxlength="60"></div>
      <div class="field"><label for="c-notes">Private notes</label><input id="c-notes" name="notes" value="${esc(c.notes)}" maxlength="1000"></div>
    </form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="client-form">${client ? 'Save changes' : 'Add client'}</button>`
  });
  $('#client-form', m.el).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    clearInvalid(f);
    const name = f.name.value.trim();
    const email = f.email.value.trim();
    if (!name) return invalid(f.name, 'Please enter a name.');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return invalid(f.email, 'Enter a valid email address.');
    if (state.clients.some(x => x.id !== c.id && x.name.trim().toLowerCase() === name.toLowerCase())) return invalid(f.name, 'You already have a client with this name.');
    upsertClient({ ...c, name, email, phone: f.phone.value.trim(), address: f.address.value.trim(), taxId: f.taxId.value.trim(), notes: f.notes.value.trim() });
    m.close();
    toast(client ? 'Client updated.' : `${name} added to your clients.`);
  });
}

async function removeClient(c) {
  const count = state.invoices.filter(i => i.clientId === c.id).length;
  const ok = await confirmDialog({
    title: `Delete ${c.name}?`,
    message: count ? `Their ${count} invoice${count === 1 ? '' : 's'} will keep the client details already on them.` : 'This removes the client from your directory.',
    confirmText: 'Delete client',
    danger: true
  });
  if (!ok) return;
  deleteClient(c.id);
  toast(`${c.name} deleted.`, { action: { label: 'Undo', onClick: () => { delete state.tombstones.clients[c.id]; upsertClient(c); } } });
}
