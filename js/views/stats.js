/*
 * Stats : la version simple de l'Analyse.
 *  - sport (Tout, Ski, Course & trail, Vélo) et période (4 semaines, 3 mois, 12 mois) ;
 *  - 4 chiffres clés (temps, séances, distance, dénivelé) comparés à la période précédente ;
 *  - volume par semaine (par mois sur 12 mois), coloré par sport ;
 *  - évolution de la forme sur 100 (même calcul qu'Aujourd'hui).
 * L'Analyse détaillée (et la connexion Strava) reste accessible en bas.
 */
import { $, esc } from '../core/utils.js';
import { addDays, dateKey, formatDate, fromKey, mondayOf, todayKey } from '../core/dates.js';
import { getActivities } from '../core/activities.js';
import { familyOf } from '../core/training.js';
import { GROUPS, READY, formBySport, formHistory } from '../core/form.js';
import { readJSON, write } from '../services/storage.js';
import { maybeAutoSync, stravaStatus } from './strava.js';

const KEY = 'allure_stats';
const PERIODS = [
  { id: '4w', name: '4 sem.', days: 28 },
  { id: '3m', name: '3 mois', days: 91 },
  { id: '12m', name: '12 mois', days: 364 }
];
let pick = { sport: 'all', period: '4w' };
let onOpenView = () => {};

const groupOfAct = a => GROUPS.find(g => g.fams.includes(familyOf(a)))?.id || 'other';
const OTHER = { id: 'other', short: 'Autres', color: '#9a9aa0' };
const look = id => GROUPS.find(g => g.id === id) || OTHER;
const nf = (n, d = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: d, minimumFractionDigits: d });
const hm = h => {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
};

function totals(list) {
  return {
    hours: list.reduce((n, a) => n + a.duration, 0) / 3600,
    count: list.length,
    km: list.reduce((n, a) => n + (a.distance || 0), 0) / 1000,
    gain: list.reduce((n, a) => n + (a.gain || 0), 0)
  };
}

function kpiHTML(now, before) {
  const delta = (a, b) => {
    if (!b) return '';
    const p = Math.round(((a - b) / b) * 100);
    return `<small class="st-d${p > 0 ? ' is-up' : p < 0 ? ' is-down' : ''}">${p > 0 ? '+' : ''}${p} %</small>`;
  };
  const cells = [
    ['Temps', hm(now.hours), delta(now.hours, before.hours)],
    ['Séances', nf(now.count), delta(now.count, before.count)],
    ['Distance', `${nf(now.km)} km`, delta(now.km, before.km)],
    ['Dénivelé', `${nf(now.gain)} m`, delta(now.gain, before.gain)]
  ];
  return `<section class="st-kpis">${cells.map(([l, v, d]) => `<div class="st-kpi"><span>${l}</span><strong>${v}</strong>${d || '<small class="st-d">—</small>'}</div>`).join('')}</section>`;
}

/* Barres empilées par sport : semaines (4 sem., 3 mois) ou mois (12 mois). */
function volumeHTML(acts, period, sport) {
  const t = todayKey();
  const buckets = [];
  if (period.id === '12m') {
    const d = fromKey(t);
    for (let i = 11; i >= 0; i--) {
      const first = new Date(d.getFullYear(), d.getMonth() - i, 1);
      const last = new Date(d.getFullYear(), d.getMonth() - i + 1, 0);
      buckets.push({ from: dateKey(first), to: dateKey(last), label: formatDate(first, { month: 'narrow' }), title: formatDate(first, { month: 'long', year: 'numeric' }) });
    }
  } else {
    const n = period.id === '4w' ? 8 : 13;
    const monday = mondayOf(fromKey(t));
    for (let i = n - 1; i >= 0; i--) {
      const m = addDays(monday, -7 * i);
      buckets.push({ from: dateKey(m), to: dateKey(addDays(m, 6)), label: String(m.getDate()), title: `Semaine du ${formatDate(m, { day: 'numeric', month: 'short' })}` });
    }
  }
  const ids = sport === 'all' ? [...GROUPS.map(g => g.id), 'other'] : [sport];
  const rows = buckets.map(b => {
    const by = {};
    for (const a of acts) if (a.date >= b.from && a.date <= b.to) by[groupOfAct(a)] = (by[groupOfAct(a)] || 0) + a.duration / 3600;
    return { ...b, by, total: ids.reduce((n, id) => n + (by[id] || 0), 0) };
  });
  const max = Math.max(1, ...rows.map(r => r.total));
  const avg = rows.reduce((n, r) => n + r.total, 0) / rows.length;
  const W = 320, H = 150, top = 16, bottom = 22, gap = 4;
  const bw = (W - gap * (rows.length - 1)) / rows.length;
  const y = v => H - bottom - ((H - top - bottom) * v) / max;
  const bars = rows
    .map((r, i) => {
      let base = H - bottom;
      const x = i * (bw + gap);
      const segs = ids
        .filter(id => r.by[id])
        .map(id => {
          const h = ((H - top - bottom) * r.by[id]) / max;
          base -= h;
          return `<rect x="${x.toFixed(1)}" y="${base.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="3" fill="${look(id).color}"/>`;
        })
        .join('');
      return `<g><title>${esc(r.title)} : ${hm(r.total)}</title>${segs || `<rect x="${x.toFixed(1)}" y="${H - bottom - 2}" width="${bw.toFixed(1)}" height="2" rx="1" fill="var(--surface-3)"/>`}
        <text x="${(x + bw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="st-ax">${esc(r.label)}</text></g>`;
    })
    .join('');
  const ay = y(avg);
  const legend = sport === 'all'
    ? `<p class="st-legend">${ids.filter(id => rows.some(r => r.by[id])).map(id => `<span><i style="background:${look(id).color}"></i>${esc(look(id).short)}</span>`).join('')}</p>`
    : '';
  return `<section class="card st-card">
    <div class="st-row"><h2 class="st-h">Volume ${period.id === '12m' ? 'par mois' : 'par semaine'}</h2><span class="st-muted">moy. ${hm(avg)}</span></div>
    <svg class="st-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Heures d’entraînement ${period.id === '12m' ? 'par mois' : 'par semaine'}">
      <line x1="0" x2="${W}" y1="${ay.toFixed(1)}" y2="${ay.toFixed(1)}" stroke="var(--text-3)" stroke-dasharray="3 4"/>
      ${bars}
      <text x="${W}" y="${top - 4}" text-anchor="end" class="st-ax">max ${hm(max)}</text>
    </svg>
    ${legend}
  </section>`;
}

/* Courbes de forme (sur 100) des 26 dernières semaines, bande « prêt ». */
function formHTML(sport) {
  const forms = formBySport();
  const list = forms.filter(f => sport === 'all' || f.id === sport);
  if (!list.length) return '';
  const weeks = 26;
  const W = 320, H = 150, top = 10, bottom = 20, left = 22;
  const x = i => left + ((W - left - 6) * i) / (weeks - 1);
  const y = v => H - bottom - ((H - top - bottom) * v) / 100;
  const lines = list
    .map(f => {
      const h = formHistory(f.id, weeks);
      const pts = h.map((p, i) => `${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
      const last = h.at(-1);
      return `<polyline points="${pts}" fill="none" stroke="${f.color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
        <circle cx="${x(weeks - 1).toFixed(1)}" cy="${y(last.score).toFixed(1)}" r="4.5" fill="${f.color}" stroke="var(--surface)" stroke-width="2"/>`;
    })
    .join('');
  const t = fromKey(todayKey());
  const start = addDays(t, -7 * (weeks - 1));
  return `<section class="card st-card">
    <div class="st-row"><h2 class="st-h">Ta forme</h2><span class="st-muted">sur 100 · 100 = ton meilleur</span></div>
    <svg class="st-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Évolution de la forme sur 6 mois">
      <rect x="${left}" y="${y(100)}" width="${W - left}" height="${(y(READY) - y(100)).toFixed(1)}" fill="color-mix(in srgb, var(--an-good) 14%, transparent)"/>
      ${[0, 50, 100].map(v => `<line x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--border-strong)" stroke-dasharray="${v ? '2 4' : '0'}"/><text x="0" y="${y(v) + 3.5}" class="st-ax">${v}</text>`).join('')}
      <text x="${W - 4}" y="${y(100) + 11}" text-anchor="end" class="st-ax">prêt · ${READY}+</text>
      ${lines}
      <text x="${left}" y="${H - 4}" class="st-ax">${esc(formatDate(start, { month: 'short' }))}</text>
      <text x="${W - 4}" y="${H - 4}" text-anchor="end" class="st-ax">auj.</text>
    </svg>
    <p class="st-legend">${list.map(f => `<span><i style="background:${f.color}"></i>${esc(f.short)} <b>${f.score}</b></span>`).join('')}</p>
  </section>`;
}

export function renderStats() {
  const body = $('#statsBody');
  if (!body) return;
  maybeAutoSync();
  const all = getActivities();
  const period = PERIODS.find(p => p.id === pick.period) || PERIODS[0];
  const seg = (name, items, cur) =>
    `<div class="segmented st-seg" role="radiogroup" aria-label="${name}">${items.map(i => `<button type="button" role="radio" data-st="${name === 'Sport' ? 'sport' : 'period'}" data-v="${i.id}" aria-checked="${i.id === cur}">${esc(i.name)}</button>`).join('')}</div>`;
  const sports = [{ id: 'all', name: 'Tout' }, ...GROUPS.map(g => ({ id: g.id, name: g.short }))];
  const controls = seg('Sport', sports, pick.sport) + seg('Période', PERIODS, pick.period);
  if (!all.length) {
    body.innerHTML = `${controls}<section class="card st-card"><h2 class="st-h">Pas encore d’activités</h2><p class="st-muted">Connecte Strava pour voir tes chiffres.</p>
      <button type="button" class="btn btn--primary btn--sm" data-st="analysis">Connecter Strava</button></section>`;
    return;
  }
  const acts = pick.sport === 'all' ? all : all.filter(a => groupOfAct(a) === pick.sport);
  const t = todayKey();
  const from = dateKey(addDays(fromKey(t), -period.days + 1));
  const prevFrom = dateKey(addDays(fromKey(t), -2 * period.days + 1));
  const now = totals(acts.filter(a => a.date >= from && a.date <= t));
  const before = totals(acts.filter(a => a.date >= prevFrom && a.date < from));
  body.innerHTML = `${controls}
    <p class="st-cap">${esc(period.id === '4w' ? '4 dernières semaines' : period.id === '3m' ? '3 derniers mois' : '12 derniers mois')}, comparé à la période d’avant</p>
    ${kpiHTML(now, before)}
    ${volumeHTML(acts, period, pick.sport)}
    ${formHTML(pick.sport)}
    <button type="button" class="st-link" data-st="analysis"><span><b>Analyse détaillée</b><small>${esc(stravaStatus() || 'Strava, bilan complet, plan')}</small></span><span aria-hidden="true">›</span></button>`;
}

export function initStats({ openView } = {}) {
  if (openView) onOpenView = openView;
  try {
    const saved = readJSON(KEY, null);
    if (saved && typeof saved === 'object') pick = { ...pick, ...saved };
  } catch {
    /* réglage absent : valeurs par défaut */
  }
  $('#statsBody').addEventListener('click', e => {
    const b = e.target.closest('[data-st]');
    if (!b) return;
    if (b.dataset.st === 'analysis') return onOpenView('analysisView');
    pick = { ...pick, [b.dataset.st]: b.dataset.v };
    write(KEY, pick);
    renderStats();
  });
}
