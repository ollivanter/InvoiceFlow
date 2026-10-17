import { state, updateProfile, updateBranding, updateUser, replaceFromServer, flushNow } from '../store.js';
import { api } from '../api.js';
import { $, $$, esc, icon, CURRENCIES, currencyCode, processLogo, fmtDate, timeAgo, download, todayIso } from '../util.js';
import { toast, confirmDialog, openModal, setBusy, invalid, clearInvalid, showFormError } from '../ui.js';
import { FONTS, STYLES, BRAND_COLORS, brandingOf, renderInvoiceDoc, nextNumber } from '../invoice.js';

const SECTIONS = [
  { id: 'business', label: 'Business profile', icon: 'building' },
  { id: 'defaults', label: 'Invoice defaults', icon: 'file' },
  { id: 'branding', label: 'Branding', icon: 'palette' },
  { id: 'account', label: 'Account & security', icon: 'shield' },
  { id: 'data', label: 'Data & backups', icon: 'database' }
];

let business = null;
export function setBusiness(b) { business = b; }

export function render(view, params) {
  const section = SECTIONS.find(s => s.id === params.section) || SECTIONS[0];
  view.innerHTML = `
    <div class="page-head"><div><h2>Settings</h2><p>Manage your business, branding, account and data.</p></div></div>
    <div class="settings">
      <nav class="settings-nav" aria-label="Settings sections">${SECTIONS.map(s => `<a href="#/settings/${s.id}" class="${s.id === section.id ? 'active' : ''}" ${s.id === section.id ? 'aria-current="page"' : ''}>${icon(s.icon)}${esc(s.label)}</a>`).join('')}</nav>
      <div id="settings-body"></div>
    </div>`;
  const body = $('#settings-body', view);
  ({ business: renderBusiness, defaults: renderDefaults, branding: renderBranding, account: renderAccount, data: renderData })[section.id](body);
  return { liveUpdate: section.id === 'branding' || section.id === 'data' ? false : undefined };
}

// ─── Business ───────────────────────────────────────────────────────────────
function renderBusiness(body) {
  const p = state.profile;
  body.innerHTML = `<form class="card settings-section" id="biz-form" novalidate>
    <div class="card-head"><div><h3>Business profile</h3><p>Shown in the “From” section of your invoices.</p></div></div>
    <div class="card-body"><div class="form-grid">
      <div class="field span-2"><label for="s-name">Business or your name <span class="req">*</span></label><input id="s-name" name="name" value="${esc(p.name)}" maxlength="160" required></div>
      <div class="field"><label for="s-email">Billing email</label><input id="s-email" name="email" type="email" value="${esc(p.email)}" maxlength="254"></div>
      <div class="field"><label for="s-phone">Phone</label><input id="s-phone" name="phone" value="${esc(p.phone)}" maxlength="40"></div>
      <div class="field span-2"><label for="s-address">Address</label><textarea id="s-address" name="address" rows="3" maxlength="500">${esc(p.address)}</textarea></div>
      <div class="field"><label for="s-tax">Tax registration no.</label><input id="s-tax" name="tax" value="${esc(p.tax)}" maxlength="60" placeholder="GSTIN / VAT number"></div>
      <div class="field"><label for="s-web">Website</label><input id="s-web" name="web" value="${esc(p.web)}" maxlength="200"></div>
    </div></div>
    <div class="settings-foot"><button class="btn btn-primary" type="submit">Save changes</button></div>
  </form>`;
  $('#biz-form', body).addEventListener('submit', e => {
    e.preventDefault();
    const f = e.currentTarget;
    clearInvalid(f);
    if (!f.name.value.trim()) return invalid(f.name, 'Please enter your business name.');
    if (f.email.value.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.value.trim())) return invalid(f.email, 'Enter a valid email address.');
    updateProfile(Object.fromEntries(['name', 'email', 'phone', 'address', 'tax', 'web'].map(k => [k, f[k].value.trim()])));
    toast('Business profile saved.');
  });
}

// ─── Defaults ───────────────────────────────────────────────────────────────
function renderDefaults(body) {
  const p = state.profile;
  const prefix = p.invoicePrefix || 'INV-';
  body.innerHTML = `<form class="card settings-section" id="def-form" novalidate>
    <div class="card-head"><div><h3>Invoice defaults</h3><p>Pre-filled on every new invoice. Existing invoices aren't changed.</p></div></div>
    <div class="card-body"><div class="form-grid">
      <div class="field"><label for="d-currency">Default currency</label><select id="d-currency" name="currency">${CURRENCIES.map(c => `<option value="${c.code}" ${c.code === currencyCode(p.currency) ? 'selected' : ''}>${esc(c.symbol)} ${c.code} — ${esc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="d-prefix">Invoice number prefix</label><input id="d-prefix" name="invoicePrefix" value="${esc(prefix)}" maxlength="12"><span class="hint">Next number: <strong id="next-num">${esc(nextNumber(state.invoices, prefix))}</strong></span></div>
      <div class="field"><label for="d-taxlabel">Tax label</label><input id="d-taxlabel" name="taxLabel" value="${esc(p.taxLabel || 'GST')}" maxlength="30"></div>
      <div class="field"><label for="d-taxrate">Default tax rate (%)</label><input id="d-taxrate" name="taxRate" type="number" min="0" max="100" step="any" value="${esc(p.taxRate ?? 18)}"></div>
      <div class="field"><label for="d-due">Payment due after (days)</label><input id="d-due" name="dueDays" type="number" min="0" max="365" value="${esc(p.dueDays ?? 15)}"></div>
      <div class="field span-2"><label for="d-terms">Default notes &amp; payment terms</label><textarea id="d-terms" name="terms" rows="4" maxlength="2000">${esc(p.terms)}</textarea></div>
    </div></div>
    <div class="settings-foot"><button class="btn btn-primary" type="submit">Save changes</button></div>
  </form>`;
  const f = $('#def-form', body);
  f.invoicePrefix.addEventListener('input', () => {
    const clean = f.invoicePrefix.value.replace(/[^A-Za-z0-9/_-]/g, '') || 'INV-';
    $('#next-num', body).textContent = nextNumber(state.invoices, clean);
  });
  f.addEventListener('submit', e => {
    e.preventDefault();
    clearInvalid(f);
    const rate = Number(f.taxRate.value);
    if (Number.isNaN(rate) || rate < 0 || rate > 100) return invalid(f.taxRate, 'Enter a rate between 0 and 100.');
    updateProfile({
      currency: f.currency.value,
      invoicePrefix: f.invoicePrefix.value.replace(/[^A-Za-z0-9/_-]/g, '') || 'INV-',
      taxLabel: f.taxLabel.value.trim() || 'Tax',
      taxRate: rate,
      dueDays: Math.max(0, Math.min(365, Number(f.dueDays.value) || 0)),
      terms: f.terms.value.trim()
    });
    toast('Invoice defaults saved.');
  });
}

// ─── Branding ───────────────────────────────────────────────────────────────
function renderBranding(body) {
  const b = brandingOf(state.profile);
  const raw = state.profile.branding || {};
  body.innerHTML = `<section class="card settings-section">
    <div class="card-head"><div><h3>Branding</h3><p>Changes apply instantly and sync to all your devices.</p></div></div>
    <div class="card-body">
      <div class="field"><span class="label">Logo</span>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <label class="logo-drop" style="flex:1;min-width:260px"><input type="file" accept="image/png,image/jpeg,image/webp" id="logo-input" aria-label="Upload logo">
            <div class="logo-box">${b.logoData ? `<img src="${esc(b.logoData)}" alt="Current logo">` : icon('upload')}</div>
            <div><strong>${b.logoData ? 'Replace logo' : 'Upload logo'}</strong><div class="muted small">${b.logoData ? esc(raw.logoName || 'Uploaded image') : 'PNG, JPEG or WebP · resized automatically'}</div></div>
          </label>
          ${b.logoData ? `<button class="btn btn-danger-ghost btn-sm" type="button" id="logo-remove">${icon('trash')}Remove</button>` : ''}
        </div>
      </div>
      <div class="field"><span class="label" id="color-label">Brand colour</span>
        <div class="swatches" role="radiogroup" aria-labelledby="color-label">
          ${BRAND_COLORS.map(c => `<button type="button" class="swatch ${c === b.color ? 'active' : ''}" style="background:${c}" data-color="${c}" role="radio" aria-checked="${c === b.color}" aria-label="Colour ${c}"></button>`).join('')}
          <span class="color-input"><input type="color" id="color-picker" value="${esc(b.color)}" aria-label="Custom colour"><input type="text" id="color-hex" value="${esc(b.color)}" maxlength="7" aria-label="Hex colour code" spellcheck="false"></span>
        </div>
      </div>
      <div class="field"><span class="label" id="font-label">Font</span>
        <div class="option-grid" role="radiogroup" aria-labelledby="font-label">${FONTS.map(f => `<button type="button" class="option ${f.value === b.font.value ? 'active' : ''}" data-font="${esc(f.value)}" role="radio" aria-checked="${f.value === b.font.value}"><div class="option-name">${esc(f.label)}</div><div class="option-sample" style="font-family:${f.head}">${esc(f.sample)}</div></button>`).join('')}</div>
      </div>
      <div class="field"><span class="label" id="style-label">Layout</span>
        <div class="option-grid cols-4" role="radiogroup" aria-labelledby="style-label">${STYLES.map(s => `<button type="button" class="option ${s.value === b.style ? 'active' : ''}" data-style="${s.value}" role="radio" aria-checked="${s.value === b.style}">
          <div class="layout-thumb" aria-hidden="true" style="${s.value === 'classic' ? `border-top:4px solid ${b.color}` : ''}"><i class="lt-head" style="background:${s.value === 'modern' ? b.color : s.value === 'minimal' ? '#334155' : '#dfe3ea'};width:${s.value === 'modern' ? '100%' : '50%'}"></i><i style="width:80%"></i><i style="width:65%"></i><i style="width:40%;margin-left:auto;background:${s.value === 'minimal' ? '#334155' : b.color}"></i></div>
          <div class="option-name">${esc(s.label)}</div></button>`).join('')}</div>
      </div>
      <div class="field"><span class="label">Preview</span>
        <div class="preview-shell"><div class="preview-stage" style="max-height:520px"><div class="preview-paper" id="brand-paper"></div></div></div>
      </div>
    </div>
  </section>`;

  const sample = state.invoices[0] || {
    number: nextNumber([], state.profile.invoicePrefix || 'INV-'), currency: currencyCode(state.profile.currency), date: todayIso(), dueDate: todayIso(),
    clientName: 'Sample Client Pvt Ltd', clientEmail: 'accounts@example.com', clientAddress: '42 Sample Street', taxLabel: state.profile.taxLabel || 'GST',
    items: [{ desc: 'Brand identity design', qty: 1, rate: 25000, discount: 0, taxRate: 18 }, { desc: 'Website landing page', qty: 1, rate: 18000, discount: 10, taxRate: 18 }],
    notes: state.profile.terms || 'Thank you for your business.', status: 'Draft'
  };
  const paper = $('#brand-paper', body);
  paper.innerHTML = renderInvoiceDoc(sample, state.profile);
  const doc = $('.invoice-doc', paper);
  const fit = () => {
    const scale = Math.min(1, (paper.parentElement.clientWidth - 40) / 794);
    doc.style.transform = `scale(${scale})`;
    doc.style.transformOrigin = 'top left';
    paper.style.width = `${794 * scale}px`;
    paper.style.height = `${doc.offsetHeight * scale}px`;
    paper.style.margin = '0 auto';
  };
  requestAnimationFrame(fit);

  const apply = patch => { updateBranding(patch); renderBranding(body); };
  $$('[data-color]', body).forEach(btn => btn.onclick = () => apply({ color: btn.dataset.color }));
  $$('[data-font]', body).forEach(btn => btn.onclick = () => apply({ font: btn.dataset.font }));
  $$('[data-style]', body).forEach(btn => btn.onclick = () => apply({ style: btn.dataset.style }));
  $('#color-picker', body).addEventListener('change', e => apply({ color: e.target.value.toLowerCase() }));
  $('#color-hex', body).addEventListener('change', e => {
    const v = e.target.value.trim();
    if (/^#[0-9a-f]{6}$/i.test(v)) apply({ color: v.toLowerCase() });
    else toast('Enter a colour like #4f46e5.', { type: 'error' });
  });
  $('#logo-input', body).addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      apply({ logoData: await processLogo(file), logoName: file.name.slice(0, 120) });
      toast('Logo updated.');
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });
  $('#logo-remove', body)?.addEventListener('click', () => { apply({ logoData: null, logoName: null }); toast('Logo removed.'); });
}

// ─── Account ────────────────────────────────────────────────────────────────
function renderAccount(body) {
  const u = state.user;
  body.innerHTML = `
    <section class="card settings-section">
      <div class="card-head"><div><h3>Account</h3><p>Member since ${esc(fmtDate(u.createdAt))}</p></div></div>
      <div class="card-body">
        <form id="acct-form" class="form-grid" novalidate>
          <div class="field"><label for="a-name">Your name</label><input id="a-name" name="name" value="${esc(u.name)}" maxlength="120" required></div>
          <div class="field"><label for="a-email">Sign-in email</label><input id="a-email" value="${esc(u.email)}" disabled><span class="hint">Contact support to change your sign-in email.</span></div>
          <div class="span-2"><button class="btn btn-ghost" type="submit">Update name</button></div>
        </form>
      </div>
    </section>

    <section class="card settings-section">
      <div class="card-head"><div><h3>Email preferences</h3><p>Security emails (verification and reset codes) are only sent when you request them.</p></div></div>
      <div class="card-body">
        <label class="switch"><input type="checkbox" id="mkt" ${u.marketingOptIn ? 'checked' : ''}><span class="track" aria-hidden="true"></span>Product updates and tips</label>
      </div>
    </section>

    <section class="card settings-section">
      <div class="card-head"><div><h3>Change password</h3><p>Other devices will be signed out.</p></div></div>
      <form class="card-body" id="pw-form" novalidate>
        <div class="form-grid">
          <div class="field span-2"><label for="pw-cur">Current password</label><div class="pw-wrap"><input id="pw-cur" name="current" type="password" autocomplete="current-password"><button type="button" class="pw-toggle" data-action="toggle-password" aria-label="Show password">${icon('eye')}</button></div></div>
          <div class="field span-2"><label for="pw-new">New password</label><div class="pw-wrap"><input id="pw-new" name="next" type="password" autocomplete="new-password" placeholder="At least 8 characters, with a letter and a number"><button type="button" class="pw-toggle" data-action="toggle-password" aria-label="Show password">${icon('eye')}</button></div></div>
        </div>
        <div class="form-error" role="alert"></div>
        <div><button class="btn btn-primary" type="submit">Update password</button></div>
      </form>
    </section>

    <section class="card settings-section">
      <div class="card-head"><div><h3>Sessions</h3></div></div>
      <div class="card-body"><div class="setting-row"><div><h4>Sign out other devices</h4><p>Ends every session except this one.</p></div><button class="btn btn-ghost" type="button" id="logout-others">${icon('logout')}Sign out others</button></div></div>
    </section>

    <section class="card settings-section danger-zone">
      <div class="card-head"><div><h3>Delete account</h3><p>Permanently erase your account, invoices, clients, products and all backups. This cannot be undone.</p></div></div>
      <div class="card-body"><div class="setting-row"><div><h4>Before you go</h4><p>You may want to <a class="link" href="#/settings/data">export your data</a> first.</p></div><button class="btn btn-danger" type="button" id="delete-account">${icon('trash')}Delete account</button></div></div>
    </section>`;

  $('#acct-form', body).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    if (!f.name.value.trim()) return invalid(f.name, 'Name cannot be empty.');
    const btn = $('button[type=submit]', f);
    setBusy(btn, true);
    try {
      const { user } = await api('/api/account', { method: 'PATCH', body: { name: f.name.value.trim() } });
      updateUser(user);
      toast('Name updated.');
    } catch (err) { toast(err.message, { type: 'error' }); } finally { setBusy(btn, false); }
  });

  $('#mkt', body).addEventListener('change', async e => {
    try {
      const { user } = await api('/api/account', { method: 'PATCH', body: { marketingOptIn: e.target.checked } });
      updateUser(user);
      toast(user.marketingOptIn ? 'Subscribed to product updates.' : 'Unsubscribed from product updates.');
    } catch (err) {
      e.target.checked = !e.target.checked;
      toast(err.message, { type: 'error' });
    }
  });

  $('#pw-form', body).addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.currentTarget;
    clearInvalid(f);
    showFormError(f, '');
    if (!f.current.value) return invalid(f.current, 'Enter your current password.');
    if (f.next.value.length < 8 || !/[A-Za-z]/.test(f.next.value) || !/\d/.test(f.next.value)) return invalid(f.next, 'Use 8+ characters with at least one letter and one number.');
    const btn = $('button[type=submit]', f);
    setBusy(btn, true);
    try {
      await api('/api/account/password', { method: 'POST', body: { currentPassword: f.current.value, newPassword: f.next.value } });
      f.reset();
      toast('Password updated. Other devices have been signed out.');
    } catch (err) { showFormError(f, err.message); } finally { setBusy(btn, false); }
  });

  $('#logout-others', body).addEventListener('click', async e => {
    const btn = e.currentTarget;
    setBusy(btn, true);
    try {
      const { revoked } = await api('/api/account/logout-others', { method: 'POST', body: {} });
      toast(revoked ? `Signed out ${revoked} other session${revoked === 1 ? '' : 's'}.` : 'No other active sessions.');
    } catch (err) { toast(err.message, { type: 'error' }); } finally { setBusy(btn, false); }
  });

  $('#delete-account', body).addEventListener('click', () => {
    const m = openModal({
      title: 'Delete your account?',
      iconName: 'alert',
      iconTone: 'danger',
      description: 'Your account, all invoices, clients, products and backups will be permanently erased from our servers immediately.',
      body: `<form id="del-form" novalidate style="display:flex;flex-direction:column;gap:14px">
        <div class="field"><label for="del-pw">Enter your password to confirm</label><input id="del-pw" name="password" type="password" autocomplete="current-password" autofocus></div>
        <label class="check"><input type="checkbox" name="understand"><span>I understand this cannot be undone.</span></label>
        <div class="form-error" role="alert"></div></form>`,
      footer: '<button class="btn btn-ghost" type="button" data-close>Cancel</button><button class="btn btn-danger" type="submit" form="del-form">Permanently delete</button>'
    });
    $('#del-form', m.el).addEventListener('submit', async e => {
      e.preventDefault();
      const f = e.currentTarget;
      if (!f.password.value) return invalid(f.password, 'Enter your password.');
      if (!f.understand.checked) return showFormError(f, 'Please confirm you understand this cannot be undone.');
      const btn = $('button[type=submit]', m.el);
      setBusy(btn, true);
      try {
        await api('/api/account/delete', { method: 'POST', body: { password: f.password.value } });
        m.close();
        window.dispatchEvent(new CustomEvent('if:account-deleted'));
      } catch (err) { showFormError(f, err.message); setBusy(btn, false); }
    });
  });
}

// ─── Data & backups ─────────────────────────────────────────────────────────
function renderData(body) {
  const privacyEmail = business?.privacyEmail || 'our privacy contact';
  body.innerHTML = `
    <section class="card settings-section">
      <div class="card-head"><div><h3>Backups</h3><p>Snapshots are taken automatically (at most every 10 minutes while you work) and kept for your last 30 versions. They're encrypted at rest.</p></div>
        <button class="btn btn-ghost btn-sm" type="button" id="backup-now">${icon('cloud')}Back up now</button></div>
      <div class="card-body"><div class="backup-list" id="backup-list"><div class="skeleton" style="height:48px"></div><div class="skeleton" style="height:48px;margin-top:10px"></div></div></div>
    </section>

    <section class="card settings-section">
      <div class="card-head"><div><h3>Export your data</h3><p>Download a complete copy of your account at any time.</p></div></div>
      <div class="card-body">
        <div class="setting-row"><div><h4>Full account export (JSON)</h4><p>Account details, consents, profile, invoices, clients, products and backup list.</p></div><button class="btn btn-ghost" type="button" id="export-json">${icon('download')}Export all data</button></div>
        <div class="setting-row"><div><h4>Invoices (CSV)</h4><p>Open in Excel, Google Sheets or your accounting software.</p></div><a class="btn btn-ghost" href="#/invoices">${icon('file')}Go to invoices</a></div>
      </div>
    </section>

    <section class="card settings-section">
      <div class="card-head"><div><h3>Privacy &amp; data requests</h3></div></div>
      <div class="card-body">
        <p class="muted">You can delete your account and all data yourself in <a class="link" href="#/settings/account">Account &amp; security</a>. For any other request about your data (access, correction or deletion), email <strong>${esc(privacyEmail)}</strong>. Read our <a class="link" href="legal/privacy.html" target="_blank" rel="noopener">Privacy Policy</a>, <a class="link" href="legal/terms.html" target="_blank" rel="noopener">Terms</a> and <a class="link" href="legal/cookies.html" target="_blank" rel="noopener">Cookie Policy</a>.</p>
      </div>
    </section>`;

  loadBackups(body);

  $('#backup-now', body).addEventListener('click', async e => {
    const btn = e.currentTarget;
    setBusy(btn, true);
    try {
      await flushNow();
      const { backups } = await api('/api/backups', { method: 'POST', body: {} });
      drawBackups(body, backups);
      toast('Backup created.');
    } catch (err) { toast(err.message, { type: 'error' }); } finally { setBusy(btn, false); }
  });

  $('#export-json', body).addEventListener('click', async e => {
    const btn = e.currentTarget;
    setBusy(btn, true);
    try {
      await flushNow();
      const response = await fetch('/api/account/export', { credentials: 'same-origin' });
      if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || 'Export failed.');
      download(`invoiceflow-export-${todayIso()}.json`, await response.text(), 'application/json');
      toast('Your data export has been downloaded.');
    } catch (err) { toast(err.message, { type: 'error' }); } finally { setBusy(btn, false); }
  });
}

async function loadBackups(body) {
  try {
    const { backups } = await api('/api/backups');
    drawBackups(body, backups);
  } catch (err) {
    $('#backup-list', body).innerHTML = `<p class="muted">${esc(err.message)}</p>`;
  }
}

function drawBackups(body, backups) {
  const list = $('#backup-list', body);
  if (!list) return;
  if (!backups.length) {
    list.innerHTML = '<p class="muted">No backups yet. One is created automatically after your next change.</p>';
    return;
  }
  const reasons = { auto: 'Automatic', manual: 'Manual', 'before-restore': 'Before restore' };
  list.innerHTML = backups.map(b => `<div class="backup-row">
    <div class="backup-icon">${icon(b.reason === 'manual' ? 'cloud' : 'clock')}</div>
    <div style="flex:1;min-width:0"><div class="cell-main">${esc(new Date(b.createdAt).toLocaleString())}</div>
      <div class="cell-sub">${esc(reasons[b.reason] || b.reason)} · ${b.invoiceCount} invoice${b.invoiceCount === 1 ? '' : 's'} · ${b.clientCount} client${b.clientCount === 1 ? '' : 's'} · ${esc(timeAgo(b.createdAt))}</div></div>
    <button class="btn btn-ghost btn-sm" type="button" data-restore="${esc(b.id)}">${icon('refresh')}Restore</button>
  </div>`).join('');
  $$('[data-restore]', list).forEach(btn => btn.addEventListener('click', async () => {
    const backup = backups.find(b => b.id === btn.dataset.restore);
    const ok = await confirmDialog({
      title: 'Restore this backup?',
      message: `Your data will be replaced with the version from ${esc(new Date(backup.createdAt).toLocaleString())}. A backup of your current data is taken first, so you can undo this.`,
      confirmText: 'Restore backup'
    });
    if (!ok) return;
    setBusy(btn, true);
    try {
      await flushNow();
      const { data } = await api('/api/backups/restore', { method: 'POST', body: { id: backup.id } });
      replaceFromServer(data);
      toast('Backup restored.');
      loadBackups(body);
    } catch (err) { toast(err.message, { type: 'error' }); setBusy(btn, false); }
  }));
}
