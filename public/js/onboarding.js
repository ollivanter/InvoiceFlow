// First-run setup: business details → tax & defaults → branding.
import { state, updateProfile } from './store.js';
import { $, esc, icon, CURRENCIES, processLogo } from './util.js';
import { invalid, clearInvalid, toast } from './ui.js';
import { BRAND_COLORS } from './invoice.js';

let step = 1;
let draft = {};

export function renderOnboarding(onDone) {
  const p = state.profile;
  draft = {
    name: p.name || state.user.name || '',
    email: p.email || state.user.email || '',
    phone: p.phone || '',
    address: p.address || '',
    tax: p.tax || '',
    currency: p.currency || 'INR',
    taxLabel: p.taxLabel || 'GST',
    taxRate: p.taxRate ?? 18,
    dueDays: p.dueDays ?? 15,
    terms: p.terms || '',
    branding: { color: '#4f46e5', font: 'Inter', style: 'default', logoData: null, logoName: null, ...(p.branding || {}) }
  };
  step = 1;
  const root = $('#onboarding');
  root.innerHTML = `<div class="ob-card" role="dialog" aria-modal="true" aria-labelledby="ob-title">
    <div class="ob-head">
      <div class="brand"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><use href="#logo-mark"/></svg><span class="brand-name">InvoiceFlow</span></div>
      <div class="ob-progress" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="ob-step-label" id="ob-step-label"></div>
      <h1 id="ob-title"></h1>
      <p id="ob-sub"></p>
    </div>
    <form class="ob-body" id="ob-body" novalidate></form>
    <div class="ob-foot">
      <button class="btn btn-subtle" type="button" id="ob-back">Back</button>
      <button class="btn btn-primary" type="submit" form="ob-body" id="ob-next">Continue ${icon('arrow-right')}</button>
    </div>
  </div>`;
  $('#ob-back').onclick = () => { collect(); go(step - 1); };
  $('#ob-body').onsubmit = e => {
    e.preventDefault();
    if (!collect(true)) return;
    if (step < 3) return go(step + 1);
    updateProfile({ ...draft, onboarded: true });
    toast(`You're all set, ${draft.name.split(' ')[0]}! Create your first invoice whenever you're ready.`);
    onDone();
  };
  go(1);
}

const STEPS = {
  1: {
    title: 'Tell us about your business',
    sub: 'These details appear on every invoice you send.',
    body: () => `<div class="form-grid">
      <div class="field span-2"><label for="ob-name">Business or your name <span class="req">*</span></label><input id="ob-name" name="name" value="${esc(draft.name)}" autocomplete="organization" required></div>
      <div class="field"><label for="ob-email">Billing email <span class="req">*</span></label><input id="ob-email" name="email" type="email" value="${esc(draft.email)}" autocomplete="email" required></div>
      <div class="field"><label for="ob-phone">Phone <span class="muted small">(optional)</span></label><input id="ob-phone" name="phone" value="${esc(draft.phone)}" autocomplete="tel"></div>
      <div class="field span-2"><label for="ob-address">Business address <span class="muted small">(optional)</span></label><textarea id="ob-address" name="address" rows="3">${esc(draft.address)}</textarea></div>
    </div>`
  },
  2: {
    title: 'Tax & invoice defaults',
    sub: 'Used to pre-fill new invoices. You can change these per invoice.',
    body: () => `<div class="form-grid">
      <div class="field"><label for="ob-currency">Default currency</label><select id="ob-currency" name="currency">${CURRENCIES.map(c => `<option value="${c.code}" ${c.code === draft.currency ? 'selected' : ''}>${esc(c.symbol)} ${c.code} — ${esc(c.label)}</option>`).join('')}</select></div>
      <div class="field"><label for="ob-tax">Tax registration no. <span class="muted small">(optional)</span></label><input id="ob-tax" name="tax" value="${esc(draft.tax)}" placeholder="e.g. GSTIN or VAT number"></div>
      <div class="field"><label for="ob-taxlabel">Tax label</label><input id="ob-taxlabel" name="taxLabel" value="${esc(draft.taxLabel)}" placeholder="GST, VAT, Sales tax"></div>
      <div class="field"><label for="ob-taxrate">Default tax rate (%)</label><input id="ob-taxrate" name="taxRate" type="number" min="0" max="100" step="0.01" value="${esc(draft.taxRate)}"></div>
      <div class="field"><label for="ob-due">Payment due after (days)</label><input id="ob-due" name="dueDays" type="number" min="0" max="365" value="${esc(draft.dueDays)}"></div>
      <div class="field span-2"><label for="ob-terms">Default notes / payment terms <span class="muted small">(optional)</span></label><textarea id="ob-terms" name="terms" rows="3" placeholder="e.g. Bank transfer to … within 15 days.">${esc(draft.terms)}</textarea></div>
    </div>`
  },
  3: {
    title: 'Make it yours',
    sub: 'Add your logo and brand colour. You can fine-tune fonts and layouts later in Settings.',
    body: () => `<div style="display:flex;flex-direction:column;gap:22px">
      <div class="field"><span class="label">Logo <span class="muted small">(optional)</span></span>
        <label class="logo-drop" id="ob-logo-drop"><input type="file" accept="image/png,image/jpeg,image/webp" id="ob-logo" aria-label="Upload logo">
          <div class="logo-box">${draft.branding.logoData ? `<img src="${esc(draft.branding.logoData)}" alt="Your logo">` : icon('upload')}</div>
          <div><strong>${draft.branding.logoData ? 'Replace logo' : 'Upload your logo'}</strong><div class="muted small">PNG, JPEG or WebP. We resize it automatically.</div></div>
        </label>
      </div>
      <div class="field"><span class="label" id="ob-color-label">Brand colour</span>
        <div class="swatches" role="radiogroup" aria-labelledby="ob-color-label">${BRAND_COLORS.map(c => `<button type="button" class="swatch ${c === draft.branding.color ? 'active' : ''}" style="background:${c}" data-color="${c}" role="radio" aria-checked="${c === draft.branding.color}" aria-label="Colour ${c}"></button>`).join('')}</div>
      </div>
    </div>`
  }
};

function go(next) {
  step = Math.max(1, Math.min(3, next));
  const s = STEPS[step];
  $('#ob-step-label').textContent = `Step ${step} of 3`;
  $('#ob-title').textContent = s.title;
  $('#ob-sub').textContent = s.sub;
  const body = $('#ob-body');
  body.innerHTML = s.body();
  body.style.animation = 'none';
  void body.offsetWidth;
  body.style.animation = '';
  $('#ob-back').style.visibility = step === 1 ? 'hidden' : 'visible';
  $('#ob-next').innerHTML = step === 3 ? `Finish setup ${icon('check')}` : `Continue ${icon('arrow-right')}`;
  document.querySelectorAll('.ob-progress span').forEach((el, i) => el.classList.toggle('done', i < step));
  if (step === 3) bindBranding();
  body.querySelector('input,select,textarea,button')?.focus();
}

function collect(validate = false) {
  const body = $('#ob-body');
  clearInvalid(body);
  const val = name => body.querySelector(`[name="${name}"]`)?.value ?? undefined;
  if (step === 1) {
    if (validate && !val('name').trim()) return invalid(body.querySelector('[name=name]'), 'Please enter your business name.');
    if (validate && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val('email').trim())) return invalid(body.querySelector('[name=email]'), 'Enter a valid email address.');
    Object.assign(draft, { name: val('name').trim(), email: val('email').trim(), phone: val('phone').trim(), address: val('address').trim() });
  } else if (step === 2) {
    const rate = Number(val('taxRate'));
    if (validate && (Number.isNaN(rate) || rate < 0 || rate > 100)) return invalid(body.querySelector('[name=taxRate]'), 'Enter a rate between 0 and 100.');
    Object.assign(draft, {
      currency: val('currency'), tax: val('tax').trim(), taxLabel: val('taxLabel').trim() || 'Tax',
      taxRate: rate || 0, dueDays: Math.max(0, Math.min(365, Number(val('dueDays')) || 0)), terms: val('terms').trim()
    });
  }
  return true;
}

function bindBranding() {
  $('#ob-body').querySelectorAll('.swatch').forEach(btn => btn.addEventListener('click', () => {
    draft.branding.color = btn.dataset.color;
    go(3);
  }));
  $('#ob-logo').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      draft.branding.logoData = await processLogo(file);
      draft.branding.logoName = file.name.slice(0, 120);
      go(3);
    } catch (err) {
      toast(err.message, { type: 'error' });
    }
  });
}
