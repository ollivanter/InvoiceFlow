import { state } from '../store.js';
import { esc, icon, money, fmtDate, relativeDue, todayIso, currencyCode, initials } from '../util.js';
import { statusOf, badge } from '../invoice.js';
import { groupedBars, donut, sparkline } from '../charts.js';
import { countUp } from '../ui.js';

export const EMPTY_ART = `<svg class="empty-art" viewBox="0 0 140 110" aria-hidden="true">
  <rect x="30" y="10" width="80" height="96" rx="10" fill="var(--surface-2)" stroke="var(--border-strong)"/>
  <rect x="42" y="26" width="34" height="6" rx="3" fill="var(--primary-soft-2)"/>
  <rect x="42" y="42" width="56" height="5" rx="2.5" fill="var(--surface-3)"/>
  <rect x="42" y="54" width="48" height="5" rx="2.5" fill="var(--surface-3)"/>
  <rect x="42" y="66" width="52" height="5" rx="2.5" fill="var(--surface-3)"/>
  <rect x="64" y="84" width="34" height="9" rx="4.5" fill="var(--primary)"/>
  <circle cx="108" cy="22" r="14" fill="var(--success-soft)" stroke="var(--success)" stroke-width="1.5"/>
  <path d="m102 22 4 4 8-8" fill="none" stroke="var(--success)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function monthKey(iso) {
  return String(iso || '').slice(0, 7);
}

function lastMonths(n) {
  const out = [];
  const d = new Date();
  d.setDate(1);
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1);
    out.push({ key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: m.toLocaleDateString(undefined, { month: 'short' }) });
  }
  return out;
}

export function render(view) {
  const p = state.profile;
  const cur = currencyCode(p.currency);
  const fmt = v => money(v, cur);
  const all = state.invoices;
  const inBase = all.filter(i => currencyCode(i.currency) === cur);
  const otherCurrencies = all.length - inBase.length;
  const withStatus = inBase.map(i => ({ ...i, st: statusOf(i) }));
  const sum = list => list.reduce((s, i) => s + (Number(i.total) || 0), 0);

  const paid = withStatus.filter(i => i.st === 'Paid');
  const outstanding = withStatus.filter(i => i.st === 'Sent');
  const overdue = withStatus.filter(i => i.st === 'Overdue');
  const thisMonth = withStatus.filter(i => monthKey(i.date) === todayIso().slice(0, 7) && i.st !== 'Draft');

  const months = lastMonths(6);
  const series = months.map(m => ({
    label: m.label,
    values: [
      sum(withStatus.filter(i => i.st !== 'Draft' && monthKey(i.date) === m.key)),
      sum(paid.filter(i => monthKey(i.paidAt ? i.paidAt.slice(0, 10) : i.date) === m.key))
    ]
  }));

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const firstName = (state.user.name || p.name || '').split(' ')[0];

  const checklist = [
    { done: !!(p.name && p.email), label: 'Add your business details', href: '#/settings/business' },
    { done: !!p.branding?.logoData, label: 'Upload your logo', href: '#/settings/branding' },
    { done: (p.catalog || []).length > 0, label: 'Add a product or service', href: '#/products' },
    { done: state.clients.length > 0, label: 'Add your first client', href: '#/clients' },
    { done: all.length > 0, label: 'Create your first invoice', href: '#/invoices/new' }
  ];
  const doneCount = checklist.filter(c => c.done).length;

  const upcoming = withStatus
    .filter(i => i.st === 'Sent' || i.st === 'Overdue')
    .sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)))
    .slice(0, 5);

  const kpis = [
    { label: 'Collected', value: sum(paid), sub: `${paid.length} paid invoice${paid.length === 1 ? '' : 's'}`, tone: 'success', icon: 'cash', spark: series.map(s => s.values[1]), color: 'var(--series-2)' },
    { label: 'Outstanding', value: sum(outstanding), sub: `${outstanding.length} awaiting payment`, tone: 'primary', icon: 'clock', spark: series.map(s => s.values[0]), color: 'var(--series-1)' },
    { label: 'Overdue', value: sum(overdue), sub: overdue.length ? `${overdue.length} past due date` : 'Nothing overdue', tone: overdue.length ? 'danger' : 'success', icon: overdue.length ? 'alert' : 'check' },
    { label: 'Invoiced this month', value: sum(thisMonth), sub: `${thisMonth.length} invoice${thisMonth.length === 1 ? '' : 's'} issued`, tone: 'warning', icon: 'file' }
  ];

  view.innerHTML = `
    <div class="page-head">
      <div><h2>${esc(greeting)}${firstName ? `, ${esc(firstName)}` : ''}</h2><p>Here's how your invoicing is going${otherCurrencies ? ` · totals shown in ${cur} (${otherCurrencies} invoice${otherCurrencies === 1 ? '' : 's'} in other currencies not included)` : ''}.</p></div>
      <div class="page-actions"><a class="btn btn-ghost" href="#/invoices">${icon('file')}View invoices</a><a class="btn btn-primary" href="#/invoices/new">${icon('plus')}New invoice</a></div>
    </div>

    <section class="kpi-grid" aria-label="Key figures">
      ${kpis.map((k, i) => `<article class="card kpi">
        <div class="kpi-top"><span class="kpi-label">${esc(k.label)}</span><span class="kpi-icon ${k.tone}">${icon(k.icon)}</span></div>
        <div class="kpi-value" data-kpi="${i}">${esc(fmt(k.value))}</div>
        <div class="kpi-sub">${esc(k.sub)}</div>
        ${k.spark ? sparkline(k.spark, k.color) : ''}
      </article>`).join('')}
    </section>

    <div class="dash-grid">
      <section class="card" aria-labelledby="rev-title">
        <div class="card-head"><div><h3 id="rev-title">Revenue</h3><p>Last 6 months</p></div>
          <div class="legend"><span><i style="background:var(--series-1)"></i>Invoiced</span><span><i style="background:var(--series-2)"></i>Collected</span></div></div>
        <div class="chart-wrap" id="rev-chart"></div>
      </section>
      <section class="card" aria-labelledby="mix-title">
        <div class="card-head"><div><h3 id="mix-title">Invoice status</h3><p>All invoices</p></div></div>
        <div class="donut-wrap" id="status-donut"></div>
      </section>
    </div>

    <div class="dash-grid">
      <section class="card" aria-labelledby="recent-title">
        <div class="card-head"><div><h3 id="recent-title">Recent invoices</h3></div><a class="btn btn-subtle btn-sm" href="#/invoices">View all ${icon('arrow-right')}</a></div>
        ${all.length ? `<div class="list-rows" style="margin-top:12px">${all.slice(0, 6).map(inv => {
          const st = statusOf(inv);
          return `<a class="list-row" href="#/invoices/${esc(inv.id)}">
            <span class="avatar sm" aria-hidden="true">${esc(initials(inv.clientName))}</span>
            <span class="grow"><span class="title">${esc(inv.clientName || 'No client')}</span><span class="sub">${esc(inv.number)} · ${esc(fmtDate(inv.date))}</span></span>
            ${badge(st)}
            <span class="amt">${esc(money(inv.total, inv.currency))}</span>
          </a>`;
        }).join('')}</div>` : `<div class="empty">${EMPTY_ART}<h3>No invoices yet</h3><p>Create your first invoice — it only takes a moment with your saved details.</p><a class="btn btn-primary" href="#/invoices/new">${icon('plus')}Create invoice</a></div>`}
      </section>

      ${doneCount < checklist.length ? `<section class="card" aria-labelledby="gs-title">
        <div class="card-head"><div><h3 id="gs-title">Get started</h3><p>${doneCount} of ${checklist.length} complete</p></div></div>
        <div style="padding:14px 20px 4px"><div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${checklist.length}" aria-valuenow="${doneCount}" aria-label="Setup progress"><span style="width:${(doneCount / checklist.length) * 100}%"></span></div></div>
        <div class="checklist">${checklist.map(c => `<a class="check-item ${c.done ? 'done' : ''}" href="${c.href}">
          <span class="check-box">${icon('check')}</span><span class="check-label">${esc(c.label)}</span><span class="sr-only">${c.done ? '(done)' : '(to do)'}</span>${icon('arrow-right', 'go')}</a>`).join('')}</div>
      </section>` : `<section class="card" aria-labelledby="up-title">
        <div class="card-head"><div><h3 id="up-title">Upcoming payments</h3><p>Sent invoices by due date</p></div></div>
        ${upcoming.length ? `<div class="list-rows" style="margin-top:12px">${upcoming.map(inv => `<a class="list-row" href="#/invoices/${esc(inv.id)}">
          <span class="grow"><span class="title">${esc(inv.clientName)}</span><span class="sub" style="color:${inv.st === 'Overdue' ? 'var(--danger-text)' : ''}">${esc(relativeDue(inv.dueDate))}</span></span>
          <span class="amt">${esc(money(inv.total, inv.currency))}</span></a>`).join('')}</div>`
          : `<div class="empty"><h3>All caught up</h3><p>No invoices are waiting for payment.</p></div>`}
      </section>`}
    </div>`;

  view.querySelectorAll('[data-kpi]').forEach(el => countUp(el, kpis[Number(el.dataset.kpi)].value, fmt));

  groupedBars(view.querySelector('#rev-chart'), {
    data: series,
    series: [{ name: 'Invoiced', color: 'var(--series-1)' }, { name: 'Collected', color: 'var(--series-2)' }],
    format: fmt,
    formatAxis: v => money(v, cur, { compact: true })
  });

  const counts = st => all.filter(i => statusOf(i) === st).length;
  donut(view.querySelector('#status-donut'), {
    centerValue: String(all.length),
    centerLabel: all.length === 1 ? 'invoice' : 'invoices',
    segments: [
      { label: 'Paid', value: counts('Paid'), color: 'var(--status-paid)' },
      { label: 'Sent', value: counts('Sent'), color: 'var(--status-sent)' },
      { label: 'Overdue', value: counts('Overdue'), color: 'var(--status-overdue)' },
      { label: 'Draft', value: counts('Draft'), color: 'var(--status-draft)' }
    ]
  });
}
