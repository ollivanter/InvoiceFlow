// Lightweight SVG charts. Palette (validated for CVD separation and contrast in both themes)
// lives in app.css as --series-1 / --series-2; status colors are reserved for invoice states.
import { esc } from './util.js';

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'chart-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.append(tip);
  }
  return tip;
}
export function showTip(html, x, y) {
  const t = tooltip();
  t.innerHTML = html;
  t.classList.add('show');
  const w = t.offsetWidth;
  t.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
  t.style.top = `${Math.max(8, y - t.offsetHeight - 12)}px`;
}
export function hideTip() {
  tip?.classList.remove('show');
}

function niceMax(value) {
  if (value <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(value)));
  const n = value / exp;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp;
}

/**
 * Grouped bars: data = [{ label, values: [a, b] }], series = [{ name, color }].
 * Rendered with a legend (identity never relies on color alone) and a visually hidden table.
 */
export function groupedBars(container, { data, series, format, formatAxis }) {
  const W = 640, H = 260, pad = { t: 12, r: 8, b: 28, l: 56 };
  const max = niceMax(Math.max(0, ...data.flatMap(d => d.values)));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const group = innerW / data.length;
  const barW = Math.min(22, (group - 18) / series.length - 2);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => f * max);
  const y = v => pad.t + innerH - (v / max) * innerH;

  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(series.map(s => s.name).join(' and '))} by month">`;
  for (const t of ticks) {
    svg += `<line class="gridline" x1="${pad.l}" x2="${W - pad.r}" y1="${y(t)}" y2="${y(t)}"/>`;
    svg += `<text class="axis" x="${pad.l - 10}" y="${y(t) + 4}" text-anchor="end">${esc(formatAxis(t))}</text>`;
  }
  data.forEach((d, i) => {
    const gx = pad.l + i * group + (group - (barW + 2) * series.length) / 2;
    svg += `<g data-i="${i}">`;
    svg += `<rect class="bar-hit" x="${pad.l + i * group}" y="${pad.t}" width="${group}" height="${innerH}"/>`;
    d.values.forEach((v, s) => {
      const h = Math.max(v > 0 ? 2 : 0, (v / max) * innerH);
      const x = gx + s * (barW + 2);
      const top = pad.t + innerH - h;
      const r = Math.min(4, barW / 2, h);
      // Rounded data end, square at the baseline.
      svg += `<path class="bar" style="animation-delay:${i * 60 + s * 30}ms" fill="${series[s].color}" d="M${x},${top + h}V${top + r}Q${x},${top} ${x + r},${top}H${x + barW - r}Q${x + barW},${top} ${x + barW},${top + r}V${top + h}Z"/>`;
    });
    svg += `<text class="axis" x="${pad.l + i * group + group / 2}" y="${H - 8}" text-anchor="middle">${esc(d.label)}</text></g>`;
  });
  svg += `<line x1="${pad.l}" x2="${W - pad.r}" y1="${pad.t + innerH}" y2="${pad.t + innerH}" stroke="var(--border-strong)"/></svg>`;

  const table = `<table class="sr-only"><caption>${esc(series.map(s => s.name).join(' and '))} by month</caption><thead><tr><th>Month</th>${series.map(s => `<th>${esc(s.name)}</th>`).join('')}</tr></thead><tbody>${data.map(d => `<tr><td>${esc(d.label)}</td>${d.values.map(v => `<td>${esc(format(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  container.innerHTML = svg + table;

  container.querySelectorAll('g[data-i]').forEach(g => {
    const d = data[Number(g.dataset.i)];
    const html = `<strong>${esc(d.label)}</strong>${series.map((s, k) => `<div>${esc(s.name)}: ${esc(format(d.values[k]))}</div>`).join('')}`;
    g.addEventListener('mousemove', e => showTip(html, e.clientX, e.clientY));
    g.addEventListener('mouseleave', hideTip);
  });
}

/** Donut for invoice status mix. segments = [{ label, value, color }] */
export function donut(container, { segments, centerLabel, centerValue }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const R = 70, C = 2 * Math.PI * R;
  let offset = 0;
  let rings = `<circle cx="90" cy="90" r="${R}" fill="none" stroke="var(--surface-3)" stroke-width="18"/>`;
  if (total > 0) {
    for (const seg of segments) {
      if (!seg.value) continue;
      const len = (seg.value / total) * C;
      // 2px surface gap between segments.
      const gap = segments.filter(s => s.value).length > 1 ? 2 : 0;
      rings += `<circle cx="90" cy="90" r="${R}" fill="none" stroke="${seg.color}" stroke-width="18" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-offset}" transform="rotate(-90 90 90)"><title>${esc(seg.label)}: ${seg.value}</title></circle>`;
      offset += len;
    }
  }
  container.innerHTML = `<svg class="donut" viewBox="0 0 180 180" role="img" aria-label="Invoices by status: ${esc(segments.map(s => `${s.label} ${s.value}`).join(', '))}">${rings}
    <text class="donut-center" x="90" y="92" text-anchor="middle">${esc(centerValue)}</text>
    <text class="donut-sub" x="90" y="112" text-anchor="middle">${esc(centerLabel)}</text></svg>
    <div class="donut-legend">${segments.map(s => `<div><i style="background:${s.color}"></i><span>${esc(s.label)}</span><span>${s.value}</span></div>`).join('')}</div>`;
}

/** Small decorative trend line for KPI cards (the KPI value itself is the accessible content). */
export function sparkline(values, color) {
  // A trend needs at least two non-zero points; otherwise it reads as noise.
  if (values.filter(v => v > 0).length < 2) return '';
  const max = Math.max(...values) || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 110, 40 - (v / max) * 34]);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ');
  const id = `sg${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="kpi-spark" viewBox="0 0 110 44" aria-hidden="true" preserveAspectRatio="none"><defs><linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs><path d="${line} L110 44 L0 44Z" fill="url(#${id})"/><path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
