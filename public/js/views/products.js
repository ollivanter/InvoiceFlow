import { state, upsertCatalogItem, deleteCatalogItem } from '../store.js';
import { $, esc, icon, money, uid, debounce, currencyCode } from '../util.js';
import { openModal, openMenu, toast, confirmDialog, invalid, clearInvalid } from '../ui.js';

let query = '';

export function render(view) {
  view.innerHTML = `
    <div class="page-head">
      <div><h2>Products &amp; services</h2><p>Save what you sell once. Line items search this list and fill in price and tax automatically.</p></div>
      <div class="page-actions"><button class="btn btn-primary" type="button" id="add-product">${icon('plus')}Add product</button></div>
    </div>
    <section class="card">
      <div class="toolbar"><label class="search-input" style="margin-left:0"><span class="sr-only">Search products</span>${icon('search')}<input type="search" id="product-search" placeholder="Search products…" value="${esc(query)}"></label></div>
      <div id="product-table"></div>
    </section>`;
  $('#add-product', view).onclick = () => productModal();
  $('#product-search', view).addEventListener('input', debounce(e => { query = e.target.value.trim().toLowerCase(); draw(view); }, 120));
  draw(view);
}

function usage(name) {
  const key = name.trim().toLowerCase();
  return state.invoices.reduce((n, inv) => n + inv.items.filter(it => it.desc.trim().toLowerCase() === key).length, 0);
}

function draw(view) {
  const box = $('#product-table', view);
  const catalog = state.profile.catalog || [];
  const cur = currencyCode(state.profile.currency);
  const list = catalog.filter(p => !query || p.name.toLowerCase().includes(query));
  if (!catalog.length) {
    box.innerHTML = `<div class="empty"><div class="feature-icon" style="margin:0 auto 8px">${icon('box')}</div><h3>No products yet</h3><p>Add the services or products you bill most often to fill invoices in seconds.</p><button class="btn btn-primary" type="button" id="empty-add">${icon('plus')}Add product</button></div>`;
    $('#empty-add', box).onclick = () => productModal();
    return;
  }
  if (!list.length) {
    box.innerHTML = '<div class="empty"><h3>No matching products</h3><p>Try a different search.</p></div>';
    return;
  }
  box.innerHTML = `<div class="table-wrap"><table class="table">
    <caption class="sr-only">Products and services</caption>
    <thead><tr><th>Name</th><th class="right">Price</th><th class="right">Tax</th><th class="right">Used on</th><th class="actions"><span class="sr-only">Actions</span></th></tr></thead>
    <tbody>${list.map(p => `<tr>
      <td><button type="button" class="linkish cell-main" data-edit="${esc(p.id)}">${esc(p.name || 'Untitled')}</button></td>
      <td class="right num">${esc(money(p.price, cur))}</td>
      <td class="right num">${esc(p.taxRate)}%</td>
      <td class="right num">${usage(p.name)} line${usage(p.name) === 1 ? '' : 's'}</td>
      <td class="actions"><button class="icon-btn sm" type="button" data-menu="${esc(p.id)}" aria-label="Actions for ${esc(p.name)}" aria-haspopup="menu">${icon('dots')}</button></td>
    </tr>`).join('')}</tbody></table></div>
    <div class="table-foot"><span>${list.length} product${list.length === 1 ? '' : 's'}</span><span>Prices in ${esc(cur)}</span></div>`;
  box.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => productModal(catalog.find(p => p.id === b.dataset.edit)));
  box.querySelectorAll('[data-menu]').forEach(b => b.onclick = () => {
    const p = catalog.find(x => x.id === b.dataset.menu);
    openMenu(b, [
      { label: 'Edit', icon: 'edit', onClick: () => productModal(p) },
      'divider',
      { label: 'Delete', icon: 'trash', danger: true, onClick: () => removeProduct(p) }
    ]);
  });
}

export function productModal(product) {
  const p = product || { id: uid(), name: '', price: 0, taxRate: Number(state.profile.taxRate) || 0 };
  const m = openModal({
    title: product ? 'Edit product' : 'Add product',
    body: `<form id="product-form" class="form-grid" novalidate>
      <div class="field span-2"><label for="p-name">Name <span class="req">*</span></label><input id="p-name" name="name" value="${esc(p.name)}" maxlength="200" placeholder="e.g. Website design" required autofocus></div>
      <div class="field"><label for="p-price">Default price (${esc(currencyCode(state.profile.currency))})</label><input id="p-price" name="price" type="number" min="0" step="any" value="${esc(p.price)}"></div>
      <div class="field"><label for="p-tax">Tax rate (%)</label><input id="p-tax" name="taxRate" type="number" min="0" max="100" step="any" value="${esc(p.taxRate)}"></div>
    </form>`,
    footer: `<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-primary" type="submit" form="product-form">${product ? 'Save changes' : 'Add product'}</button>`
  });
  $('#product-form', m.el).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    clearInvalid(f);
    const name = f.name.value.trim();
    const price = Number(f.price.value);
    const taxRate = Number(f.taxRate.value);
    if (!name) return invalid(f.name, 'Please enter a name.');
    if (Number.isNaN(price) || price < 0) return invalid(f.price, 'Enter a price of 0 or more.');
    if (Number.isNaN(taxRate) || taxRate < 0 || taxRate > 100) return invalid(f.taxRate, 'Enter a rate between 0 and 100.');
    upsertCatalogItem({ ...p, name, price, taxRate });
    m.close();
    toast(product ? 'Product updated.' : `${name} added.`);
  });
}

async function removeProduct(p) {
  const ok = await confirmDialog({ title: `Delete ${p.name}?`, message: 'Existing invoices are not affected.', confirmText: 'Delete product', danger: true });
  if (!ok) return;
  deleteCatalogItem(p.id);
  toast(`${p.name} deleted.`, { action: { label: 'Undo', onClick: () => { delete state.tombstones.catalog[p.id]; upsertCatalogItem(p); } } });
}
