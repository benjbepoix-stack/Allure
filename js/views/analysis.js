/*
 * Vue Analyse : indicateurs calculés depuis l'export RunGap (toutes les séances).
 * Forme / fatigue / fraîcheur, volume par sport, intensité, repos, bilan des
 * phases de Cadence, efficacité, puissance / FC, records et jour J des courses.
 */
import { $, $$, esc, parseNumber } from '../core/utils.js';
import { addDays, formatKey, fromKey, todayKey } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { getPhases, phaseType } from '../core/season.js';
import { getActivities, importInfo, mergeExport } from '../core/activities.js';
import { racePriority } from '../core/planner.js';
import {
  ANALYSIS_KEY, FAMILIES, PERIODS, ZONES, analysisSettings, buckets, dailySeries, efficiency, familyOf,
  isFlatRun, periodRange, records, streaks, summarize, zoneOf
} from '../core/training.js';
import { openSheet, closeSheet } from '../ui/dialog.js';
import { renderPlan, selectPlanWeek } from './plan-view.js';
import { openPlanner } from './planner.js';
import { toast, toastError } from '../ui/toast.js';
import { readText, write } from '../services/storage.js';

const PERIOD_KEY = 'allure_analysis_period';
const W = 340;
let period = PERIODS.some(p => p.id === readText(PERIOD_KEY, '')) ? readText(PERIOD_KEY, '') : '12m';
let offset = 0;
const MODE_KEY = 'allure_analysis_mode';
const SPORT_KEY = 'allure_analysis_sport';
let mode = readText(MODE_KEY, 'bilan') === 'plan' ? 'plan' : 'bilan';
let sport = readText(SPORT_KEY, 'all');
let memo = { list: null, settings: '', series: null };

/* ---------- Formats ---------- */
const nf = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const hours = min => (min >= 600 ? `${nf(min / 60)} h` : `${nf(min / 60, 1)} h`);
const duration = s => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};
const pace = speed => {
  const s = Math.round(1000 / speed);
  return `${Math.floor(s / 60)}'${String(s % 60).padStart(2, '0')}/km`;
};
const km = m => `${nf(m / 1000, m < 100000 ? 1 : 0)} km`;
const shortDate = key => formatKey(key, { day: 'numeric', month: 'short' });
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf(Math.abs(n))}`;
const pct = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf(Math.abs(n))} %`;

function series() {
  const list = getActivities();
  const s = analysisSettings();
  const sk = JSON.stringify(s) + todayKey();
  if (memo.list !== list || memo.settings !== sk || memo.length !== list.length) {
    memo = { list, settings: sk, length: list.length, series: dailySeries(list, s) };
  }
  return memo.series;
}

/** Fraîcheur : ce que la valeur veut dire. */
function freshness(tsb) {
  if (tsb < -30) return { text: 'très fatigué, risque de surmenage', cls: 'bad' };
  if (tsb < -10) return { text: 'en charge', cls: 'warn' };
  if (tsb <= 5) return { text: 'équilibré', cls: 'neutral' };
  if (tsb <= 25) return { text: 'frais, prêt pour une course', cls: 'good' };
  return { text: 'très reposé, la forme baisse', cls: 'warn' };
}

/* ---------- Graphiques SVG ---------- */
function niceMax(v) {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  return [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].map(f => f * pow).find(x => x >= v);
}

/** Abscisse d'un jour dans [start, end]. */
function xScale(start, end, x0 = 30, x1 = W - 6) {
  const t0 = fromKey(start).getTime();
  const span = Math.max(1, (fromKey(end).getTime() - t0) / 864e5);
  return key => x0 + ((x1 - x0) * (fromKey(key).getTime() - t0)) / 864e5 / span;
}

/** Repères de mois sous un graphique (un sur deux au-delà de 7 mois). */
function monthTicks(start, end, X, y) {
  const days = (fromKey(end) - fromKey(start)) / 864e5;
  if (days <= 45) {
    return buckets(start, end, 'week')
      .filter(b => b.start >= start)
      .map(b => `<text x="${X(b.start)}" y="${y}" text-anchor="middle">${shortDate(b.start)}</text>`)
      .join('');
  }
  const step = days > 400 ? 3 : days > 220 ? 2 : 1;
  return buckets(start, end, 'month')
    .filter((b, i) => b.start >= start && i % step === 0)
    .map(b => `<text x="${X(b.start)}" y="${y}" text-anchor="middle">${formatKey(b.start, { month: 'short' })}</text>`)
    .join('');
}

const pathOf = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');

/** Un point sur `step` jours (le dernier toujours gardé) : courbes lisibles sur une longue période. */
function sample(days) {
  const step = days.length > 200 ? 7 : days.length > 100 ? 3 : 1;
  return days.filter((d, i) => (days.length - 1 - i) % step === 0);
}

function loadChart(allDays, start, end, phases, races) {
  const days = sample(allDays);
  const X = xScale(start, end);
  const mx = niceMax(Math.max(10, ...days.map(d => Math.max(d.ctl, d.atl)), ...allDays.map(d => d.ctl)));
  const y0 = 12;
  const y1 = 150;
  const Y = v => y1 - ((y1 - y0) * v) / mx;
  const tb = 190; // ligne zéro de la fraîcheur
  const tMax = Math.max(20, ...days.map(d => Math.abs(d.tsb)));
  const T = v => tb - (26 * v) / tMax;
  let svg = '';
  for (const p of phases) {
    const a = p.start < start ? start : p.start;
    const b = p.end > end ? end : p.end;
    if (a > b) continue;
    const t = phaseType(p.type);
    const xa = X(a);
    const xb = X(dateKeyAfter(b));
    svg += `<rect x="${xa}" y="${y0}" width="${Math.max(1, xb - xa)}" height="${y1 - y0}" fill="${t.color}" opacity=".1"><title>${esc(t.name)} · ${shortDate(p.start)} → ${shortDate(p.end)}</title></rect>`;
    svg += `<rect x="${xa}" y="${y1 + 3}" width="${Math.max(1, xb - xa - 1)}" height="4" rx="2" fill="${t.color}"/>`;
    if (xb - xa > 34) svg += `<text x="${xa + 3}" y="${y0 + 9}" class="an-svg-ph">${esc(t.short)}</text>`;
  }
  [0, mx / 2, mx].forEach(v => (svg += `<line x1="30" x2="${W - 6}" y1="${Y(v)}" y2="${Y(v)}" class="an-grid"/>${v ? `<text x="26" y="${Y(v) + 3}" text-anchor="end">${nf(v)}</text>` : ''}`));
  svg += `<line x1="30" x2="${W - 6}" y1="${tb}" y2="${tb}" class="an-grid"/><text x="26" y="${tb + 3}" text-anchor="end">0</text>`;
  if (days.length > 1) {
    const pts = days.map(d => [X(d.key), T(d.tsb)]);
    svg += `<path d="${pathOf([[pts[0][0], tb], ...pts, [pts[pts.length - 1][0], tb]])}Z" class="an-tsb"/>`;
    svg += `<path d="${pathOf(days.map(d => [X(d.key), Y(d.atl)]))}" class="an-atl"/>`;
    svg += `<path d="${pathOf(days.map(d => [X(d.key), Y(d.ctl)]))}" class="an-ctl"/>`;
    const peak = allDays.reduce((b, d) => (d.ctl > b.ctl ? d : b), allDays[0]);
    svg += `<circle cx="${X(peak.key)}" cy="${Y(peak.ctl)}" r="3.5" class="an-peak"/><text x="${X(peak.key)}" y="${Y(peak.ctl) - 7}" text-anchor="middle" class="an-svg-strong">${nf(peak.ctl)}</text>`;
  }
  for (const r of races) {
    if (r.date < start || r.date > end) continue;
    const a = racePriority(r.id) === 'A';
    svg += `<g class="an-race${a ? ' is-a' : ''}"><line x1="${X(r.date)}" x2="${X(r.date)}" y1="${y0}" y2="${y1}"/><circle cx="${X(r.date)}" cy="${y0}" r="${a ? 4 : 2.6}"/><title>${esc(r.name)} · ${shortDate(r.date)}</title></g>`;
  }
  svg += monthTicks(start, end, X, 214);
  return `<svg viewBox="0 0 ${W} 220" role="img" aria-label="Forme, fatigue et fraîcheur">${svg}</svg>`;
}

const dateKeyAfter = key => {
  const d = addDays(fromKey(key), 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function volumeChart(acts, start, end, unit) {
  const list = buckets(start, end, unit);
  const idx = new Map();
  list.forEach((b, i) => (b.fam = Object.fromEntries(FAMILIES.map(f => [f.id, 0]))));
  for (const a of acts) {
    const i = list.findIndex(b => b.start <= a.date && a.date <= b.end);
    if (i >= 0) list[i].fam[familyOf(a)] += a.duration / 3600;
  }
  idx.clear();
  const mx = niceMax(Math.max(1, ...list.map(b => Object.values(b.fam).reduce((s, v) => s + v, 0))));
  const x0 = 30;
  const y1 = 128;
  const bw = (W - 6 - x0) / list.length;
  const H = v => (118 * v) / mx;
  let svg = '';
  [0, mx / 2, mx].forEach(v => (svg += `<line x1="${x0}" x2="${W - 6}" y1="${y1 - H(v)}" y2="${y1 - H(v)}" class="an-grid"/><text x="${x0 - 4}" y="${y1 - H(v) + 3}" text-anchor="end">${nf(v, v % 1 ? 1 : 0)}h</text>`));
  const labelEvery = Math.ceil(list.length / 7);
  list.forEach((b, i) => {
    let y = y1;
    const total = Object.values(b.fam).reduce((s, v) => s + v, 0);
    const gap = bw > 6 ? 1 : 0.4;
    FAMILIES.forEach(f => {
      const h = H(b.fam[f.id]);
      if (h > 0) {
        svg += `<rect x="${x0 + i * bw + gap}" y="${y - h}" width="${Math.max(0.8, bw - 2 * gap)}" height="${h}" fill="${f.color}"/>`;
        y -= h;
      }
    });
    svg += `<rect x="${x0 + i * bw}" y="${y1 - 118}" width="${bw}" height="118" fill="transparent"><title>${unit === 'day' ? shortDate(b.start) : `Semaine du ${shortDate(b.start)}`} : ${nf(total, 1)} h</title></rect>`;
    if (i % labelEvery === 0) svg += `<text x="${x0 + i * bw + bw / 2}" y="${y1 + 13}" text-anchor="middle">${unit === 'day' ? fromKey(b.start).getDate() : shortDate(b.start)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} 145" role="img" aria-label="Heures d'entraînement par ${unit === 'day' ? 'jour' : 'semaine'} et par sport">${svg}</svg>`;
}

function restBars(days, start, end) {
  const unit = (fromKey(end) - fromKey(start)) / 864e5 > 62 ? 'month' : 'week';
  const list = buckets(start, end, unit)
    .map(b => {
      const ds = days.filter(d => d.key >= b.start && d.key <= b.end);
      return { ...b, n: ds.length, rest: ds.filter(d => !d.count).length };
    })
    .filter(b => b.n);
  const x0 = 4;
  const y1 = 86;
  const bw = (W - 8) / list.length;
  let svg = '';
  list.forEach((b, i) => {
    const perWeek = (b.rest / b.n) * 7;
    const h = Math.min(70, perWeek * 18);
    const cls = perWeek < 1 ? 'bad' : perWeek < 1.5 ? 'warn' : 'good';
    svg += `<rect x="${x0 + i * bw + bw * 0.18}" y="${y1 - h}" width="${bw * 0.64}" height="${Math.max(1, h)}" rx="3" class="an-fill-${cls}"><title>${b.rest} jour${b.rest > 1 ? 's' : ''} de repos sur ${b.n}</title></rect>`;
    if (bw > 16) svg += `<text x="${x0 + i * bw + bw / 2}" y="${y1 - h - 4}" text-anchor="middle" class="an-svg-strong">${nf(perWeek, 1)}</text>`;
    svg += `<text x="${x0 + i * bw + bw / 2}" y="${y1 + 12}" text-anchor="middle">${unit === 'month' ? formatKey(b.start, { month: 'short' }).slice(0, bw > 24 ? 5 : 1) : shortDate(b.start)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} 102" role="img" aria-label="Jours de repos par semaine">${svg}</svg>`;
}

function heatmap(days, start, end) {
  const weeks = buckets(start, end, 'week');
  const byKey = new Map(days.map(d => [d.key, d]));
  const loads = days.filter(d => d.count).map(d => d.load).sort((a, b) => a - b);
  const high = loads[Math.floor(loads.length * 0.9)] || 1;
  const names = ['L', '', 'M', '', 'V', '', 'D'];
  let html = '';
  for (let r = 0; r < 7; r++) {
    html += `<span class="an-heat__day">${names[r]}</span>`;
    for (const w of weeks) {
      const key = dateKeyAfterN(w.start, r);
      const d = byKey.get(key);
      if (!d || key < start || key > end) html += '<span class="an-heat__cell is-out"></span>';
      else if (!d.count) html += `<span class="an-heat__cell is-rest" title="${shortDate(key)} : repos"></span>`;
      else html += `<span class="an-heat__cell" style="--k:${Math.round(25 + 75 * Math.min(1, d.load / high))}%" title="${shortDate(key)} : ${hours(d.minutes)}, charge ${nf(d.load)}"></span>`;
    }
  }
  return `<div class="an-heat" style="--weeks:${weeks.length}">${html}</div>`;
}
const dateKeyAfterN = (key, n) => {
  let k = key;
  for (let i = 0; i < n; i++) k = dateKeyAfter(k);
  return k;
};

/** Nuage de points + moyenne glissante sur 28 jours, une couleur par série. */
function trendChart(seriesList, start, end, { decimals = 2, unit = '' } = {}) {
  const all = seriesList.flatMap(s => s.points);
  if (!all.length) return '';
  const vals = all.map(p => p.v).sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.03)];
  const hi = vals[Math.ceil(vals.length * 0.97) - 1];
  const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
  const vmin = lo - pad;
  const vmax = hi + pad;
  const X = xScale(start, end, 34);
  const y0 = 8;
  const y1 = 104;
  const Y = v => y1 - ((y1 - y0) * (Math.min(vmax, Math.max(vmin, v)) - vmin)) / (vmax - vmin);
  let svg = '';
  [vmin + (vmax - vmin) * 0.1, (vmin + vmax) / 2, vmax - (vmax - vmin) * 0.1].forEach(v => (svg += `<line x1="34" x2="${W - 6}" y1="${Y(v)}" y2="${Y(v)}" class="an-grid"/><text x="30" y="${Y(v) + 3}" text-anchor="end">${nf(v, decimals)}</text>`));
  for (const s of seriesList) {
    for (const p of s.points) svg += `<circle cx="${X(p.key)}" cy="${Y(p.v)}" r="2.2" fill="${s.color}" opacity=".35"><title>${shortDate(p.key)} · ${esc(p.label)} : ${nf(p.v, decimals)}${unit}</title></circle>`;
    const line = [];
    for (const p of s.points) {
      const from = dateKeyAfterN(p.key, 0);
      const win = s.points.filter(q => q.key <= from && (fromKey(from) - fromKey(q.key)) / 864e5 < 28);
      line.push([X(p.key), Y(win.reduce((n, q) => n + q.v, 0) / win.length)]);
    }
    if (line.length > 1) svg += `<path d="${pathOf(line)}" fill="none" stroke="${s.color}" stroke-width="2.2" stroke-linejoin="round"/>`;
  }
  svg += monthTicks(start, end, X, 120);
  return `<svg viewBox="0 0 ${W} 126" role="img" aria-label="Évolution">${svg}</svg>`;
}

/* ---------- Sections ---------- */
const card = (title, sub, body, extra = '') => `<section class="card an-card${extra}"><header><h2 class="card__title">${title}</h2>${sub ? `<p class="card__sub">${sub}</p>` : ''}</header>${body}</section>`;
const insight = html => `<p class="an-insight">${html}</p>`;
const legend = items => `<div class="an-legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>`;
const pill = (cls, text) => `<span class="an-pill an-pill--${cls}">${text}</span>`;

/** Temps, distance et D+ (filtrables par sport), puis repos et fraîcheur (tous sports). */
function kpis(acts, days, alert, s) {
  const present = FAMILIES.filter(f => acts.some(a => familyOf(a) === f.id));
  if (sport !== 'all' && !present.some(f => f.id === sport)) sport = 'all';
  const shown = sport === 'all' ? acts : acts.filter(a => familyOf(a) === sport);
  const sum = summarize(shown, days, s);
  const all = summarize(acts, days, s);
  const last = days[days.length - 1];
  const fr = freshness(last.tsb);
  const tile = (v, u, l, d, cls = '') => `<div class="an-kpi"><span class="an-kpi__v">${v}<small>${u}</small></span><span class="an-kpi__l">${l}</span><span class="an-kpi__d ${cls}">${d}</span></div>`;
  const chips = `<div class="an-chips" role="radiogroup" aria-label="Sport">${[{ id: 'all', name: 'Tous', color: '' }, ...present]
    .map(f => `<button type="button" role="radio" class="an-chip" data-sport="${f.id}" aria-checked="${sport === f.id}">${f.color ? `<i style="background:${f.color}"></i>` : ''}${esc(f.name)}</button>`)
    .join('')}</div>`;
  const weeks = days.length / 7 || 1;
  return `${chips}<div class="an-kpis">
    ${tile(nf(sum.minutes / 60), 'h', 'Temps', `${nf(sum.minutes / 60 / weeks, 1)} h/sem`)}
    ${tile(nf(sum.distance / 1000), 'km', 'Distance', `${nf(sum.distance / 1000 / weeks)} km/sem`)}
    ${tile(nf(sum.gain), 'm', 'Dénivelé positif', `${nf(sum.gain / weeks)} m/sem`)}
    ${tile(nf(sum.count), '', 'Séances', `${nf(sum.count / weeks, 1)} par semaine`)}
    ${tile(nf(all.restPerWeek, 1), 'j/sem', 'Repos moyen', `${all.rest} jour${all.rest > 1 ? 's' : ''} sur ${all.days}`, all.restPerWeek < 1 ? 'is-bad' : '')}
    ${tile(signed(Math.round(last.tsb)), '', `Fraîcheur au ${shortDate(last.key)}`, fr.text, `is-${fr.cls}`)}
  </div>${alert}`;
}

function streakAlert(days, s) {
  const list = streaks(days, s.streakAlert + 1);
  if (!list.length) return '';
  const longest = list.reduce((b, x) => (x.length > b.length ? x : b), list[0]);
  const ongoing = list.find(x => x.ongoing && x.end === days[days.length - 1].key);
  const lines = [];
  if (ongoing) lines.push(`<strong>${ongoing.length} jours d’affilée sans repos</strong> en ce moment (depuis le ${shortDate(ongoing.start)}).`);
  lines.push(`${list.length} série${list.length > 1 ? 's' : ''} de plus de ${s.streakAlert} jours sans repos sur la période, la plus longue : ${longest.length} jours (${shortDate(longest.start)} → ${shortDate(longest.end)}).`);
  return `<div class="an-alert" role="status">${lines.join(' ')}</div>`;
}

function loadSection(days, start, end, phases, races) {
  const first = days[0];
  const last = days[days.length - 1];
  const peak = days.reduce((b, d) => (d.ctl > b.ctl ? d : b), first);
  const change = first.ctl ? ((last.ctl - first.ctl) / first.ctl) * 100 : 0;
  const msg = `Forme ${nf(first.ctl)} → ${nf(last.ctl)} (${pct(Math.round(change))}) sur la période, pic à <strong>${nf(peak.ctl)}</strong> le ${shortDate(peak.key)}.` +
    (last.atl > last.ctl * 1.3 ? ' La fatigue dépasse nettement la forme : semaine de récupération conseillée.' : '');
  return card(
    'Forme, fatigue et fraîcheur',
    'Charge de chaque séance estimée depuis sa FC moyenne et sa durée',
    `${legend([['var(--an-ctl)', 'Forme (42 j)'], ['var(--an-atl)', 'Fatigue (7 j)'], ['var(--an-good)', 'Fraîcheur (forme − fatigue)']])}${loadChart(days, start, end, phases, races)}${insight(msg)}`
  );
}

function volumeSection(acts, sum, start, end) {
  const unit = (fromKey(end) - fromKey(start)) / 864e5 <= 31 ? 'day' : 'week';
  const used = FAMILIES.filter(f => sum.byFamily[f.id] > 0 && acts.some(a => familyOf(a) === f.id));
  return card(
    'Volume par sport',
    `Heures par ${unit === 'day' ? 'jour' : 'semaine'}`,
    `${legend(used.map(f => [f.color, `${f.name} · ${hours(sum.byFamily[f.id])}`]))}${volumeChart(acts, start, end, unit)}`
  );
}

function restSection(days, sum, start, end, s) {
  const worst = buckets(start, end, 'month')
    .map(b => {
      const ds = days.filter(d => d.key >= b.start && d.key <= b.end);
      return { b, n: ds.length, rest: ds.filter(d => !d.count).length };
    })
    .filter(x => x.n >= 14)
    .sort((a, b) => a.rest / a.n - b.rest / b.n)[0];
  const msg = worst && (worst.rest / worst.n) * 7 < 1
    ? `Mois le moins reposé : <strong>${formatKey(worst.b.start, { month: 'long', year: 'numeric' })}</strong>, ${worst.rest} jour${worst.rest > 1 ? 's' : ''} de repos sur ${worst.n}. Repère : au moins 1 jour par semaine.`
    : `En moyenne ${nf(sum.restPerWeek, 1)} jour${sum.restPerWeek >= 2 ? 's' : ''} de repos par semaine. Repère : au moins 1 jour par semaine.`;
  return card(
    'Repos',
    'Une case par jour, plus foncée quand la séance est plus dure ; cases en pointillé : repos',
    `${heatmap(days, start, end)}<p class="an-note">Jours de repos par semaine, en moyenne :</p>${restBars(days, start, end)}${insight(msg)}`
  );
}

function phaseVerdict(p, t, from, to) {
  const change = from.ctl ? ((to.ctl - from.ctl) / from.ctl) * 100 : 0;
  if (p.type === 'taper') return to.tsb >= 5 ? pill('good', `frais ${signed(Math.round(to.tsb))}`) : pill('warn', `frais ${signed(Math.round(to.tsb))}`);
  if (p.type === 'recovery' || p.type === 'transition') return pill('neutral', pct(Math.round(change)));
  return pill(change > 5 ? 'good' : change < -5 ? 'bad' : 'warn', change > -5 && change < 5 ? 'stable' : pct(Math.round(change)));
}

function phasesSection(all, acts, days, start, end, phases, s) {
  const lastKey = days[days.length - 1].key;
  const rows = phases
    .map(p => ({ p, a: p.start < start ? start : p.start, b: [p.end, end, lastKey].sort()[0] }))
    .filter(x => x.a <= x.b)
    .map(({ p, a, b }) => {
      const ds = days.filter(d => d.key >= a && d.key <= b);
      if (!ds.length) return '';
      const as = acts.filter(x => x.date >= a && x.date <= b);
      const sum = summarize(as, ds, s);
      const t = phaseType(p.type);
      const hard = sum.minutes ? (100 * sum.byZone.hard) / sum.minutes : 0;
      return `<tr><td><span class="an-ph"><i style="background:${t.color}"></i><span>${esc(t.short)}<small>${shortDate(p.start)} → ${shortDate(p.end)}</small></span></span></td><td>${nf(sum.hoursPerWeek, 1)}</td><td>${nf(sum.restPerWeek, 1)}</td><td>${nf(hard)} %</td><td>${nf(ds[0].ctl)} → ${nf(ds[ds.length - 1].ctl)}<span class="an-cell-pill">${phaseVerdict(p, t, ds[0], ds[ds.length - 1])}</span></td></tr>`;
    })
    .filter(Boolean);
  if (!rows.length) return card('Bilan des phases', '', '<p class="an-empty">Aucune phase sur cette période. Ajoute tes phases dans Saison (ou fais-les placer selon tes courses) pour comparer ce que chacune a produit.</p>');
  return card(
    'Bilan des phases',
    'Ce que chaque phase a produit : forme au début → à la fin',
    `<div class="an-table"><table><thead><tr><th>Phase</th><th>h/sem</th><th>Repos</th><th>Dur</th><th>Forme</th></tr></thead><tbody>${rows.join('')}</tbody></table></div><p class="an-note">h/sem et Repos : par semaine. Dur : part du temps en dur. Sous la forme : son évolution (affûtage : fraîcheur le dernier jour). Récupération et coupure : la baisse est normale.</p>`
  );
}

function efficiencySection(acts, start, end) {
  const pts = acts.filter(isFlatRun).map(a => ({ key: a.date, v: efficiency(a), label: `${km(a.distance)} à ${pace(a.speed)}, ${a.hr} bpm` }));
  if (pts.length < 3) return '';
  const first = pts.slice(0, Math.max(3, Math.round(pts.length / 4)));
  const last = pts.slice(-Math.max(3, Math.round(pts.length / 4)));
  const avg = l => l.reduce((n, p) => n + p.v, 0) / l.length;
  const change = ((avg(last) - avg(first)) / avg(first)) * 100;
  const best = pts.reduce((b, p) => (p.v > b.v ? p : b), pts[0]);
  return card(
    'Efficacité en course à pied',
    'Mètres parcourus par battement de cœur, sorties de plus de 4 km et moins de 25 m D+/km',
    `${trendChart([{ color: 'var(--an-run)', points: pts }], start, end, { decimals: 2, unit: ' m/bat.' })}${insight(`Plus haut = plus vite pour le même effort. ${change >= 0 ? 'En progrès' : 'En recul'} de <strong>${pct(Math.round(change))}</strong> entre le début et la fin de la période. Meilleure sortie : ${shortDate(best.key)} (${best.label}).`)}`
  );
}

function powerSection(acts, start, end) {
  const groups = [
    { name: 'Vélo', color: 'var(--an-bike)', test: a => familyOf(a) === 'bike' },
    { name: 'Course et trail', color: 'var(--an-run)', test: a => ['run', 'trail'].includes(familyOf(a)) }
  ]
    .map(g => ({ ...g, points: acts.filter(a => g.test(a) && a.power > 0 && a.hr > 0).map(a => ({ key: a.date, v: a.power / a.hr, label: `${a.power} W, ${a.hr} bpm` })) }))
    .filter(g => g.points.length >= 3);
  if (!groups.length) return '';
  const msgs = groups.map(g => {
    const n = Math.max(3, Math.round(g.points.length / 4));
    const avg = l => l.reduce((x, p) => x + p.v, 0) / l.length;
    const ch = ((avg(g.points.slice(-n)) - avg(g.points.slice(0, n))) / avg(g.points.slice(0, n))) * 100;
    return `${g.name} : ${pct(Math.round(ch))}`;
  });
  return card(
    'Puissance / FC',
    'Watts produits par battement de cœur (séances avec capteur de puissance)',
    `${legend(groups.map(g => [g.color, `${g.name} · ${g.points.length} séances`]))}${trendChart(groups, start, end, { decimals: 2, unit: ' W/bat.' })}${insight(`Plus haut = plus de puissance pour le même effort. Évolution sur la période : ${msgs.join(' · ')}.`)}`
  );
}

function recordsSection(acts, all) {
  const fams = FAMILIES.filter(f => !['gym', 'hike', 'other'].includes(f.id));
  const rows = [];
  for (const f of fams) {
    const r = records(acts, f.id);
    if (!r) continue;
    const ever = records(all, f.id);
    const star = (k, a) => (ever[k] && ever[k].t === a.t ? '<span class="an-star" title="Record absolu">★</span>' : '');
    const items = [
      ['Plus longue', km(r.distance.distance), r.distance, 'distance'],
      ['Plus de D+', `${nf(r.gain.gain)} m`, r.gain, 'gain'],
      ['Plus longue durée', duration(r.duration.duration), r.duration, 'duration']
    ];
    if (r.speed) items.push([f.id === 'run' || f.id === 'trail' ? 'Meilleure allure' : 'Plus rapide', f.id === 'run' || f.id === 'trail' ? pace(r.speed.speed) : `${nf(r.speed.speed * 3.6, 1)} km/h`, r.speed, 'speed']);
    rows.push(`<div class="an-rec"><h3><i style="background:${f.color}"></i>${f.name}</h3><dl>${items
      .filter(([, , a, k]) => (k === 'gain' ? a.gain > 0 : k === 'distance' ? a.distance > 0 : true))
      .map(([l, v, a, k]) => `<div><dt>${l}</dt><dd>${v}${star(k, a)}<small>${shortDate(a.date)}${a.title && a.title !== 'Untitled' ? ` · ${esc(a.title)}` : ''}</small></dd></div>`)
      .join('')}</dl></div>`);
  }
  if (!rows.length) return '';
  return card('Records', 'Meilleures séances de la période par sport ; ★ record absolu', rows.join(''));
}

function racesSection(days, start, end, acts) {
  const byKey = new Map(days.map(d => [d.key, d]));
  const list = state.races.filter(r => r.date >= start && r.date <= end && byKey.has(r.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (!list.length) return '';
  const rows = list.map(r => {
    const d = byKey.get(r.date);
    const fam = RACE_FAMILY[r.sport];
    const sameDay = acts.filter(a => a.date === r.date).sort((a, b) => b.duration - a.duration);
    const act = sameDay.find(a => familyOf(a) === fam) || sameDay[0];
    const fr = freshness(d.tsb);
    const prio = racePriority(r.id);
    const result = r.resultTime || (act ? duration(act.duration) : '—');
    const detail = act ? `${act.distance ? km(act.distance) : ''}${act.hr ? ` · ${act.hr} bpm` : ''}` : 'Aucune activité ce jour-là';
    return `<tr><td><span class="an-race-name">${esc(r.name)}${prio === 'A' ? pill('accent', 'Objectif') : ''}<small>${shortDate(r.date)} · ${detail}</small></span></td><td>${esc(result)}${r.resultRank ? `<small>${esc(r.resultRank)}</small>` : ''}</td><td>${nf(d.ctl)}</td><td>${pill(fr.cls, signed(Math.round(d.tsb)))}</td></tr>`;
  });
  const avg = list.reduce((n, r) => n + byKey.get(r.date).tsb, 0) / list.length;
  return card(
    'Le jour des courses',
    'Forme et fraîcheur le matin de chaque course',
    `<div class="an-table"><table><thead><tr><th>Course</th><th>Résultat</th><th>Forme</th><th>Fraîcheur</th></tr></thead><tbody>${rows.join('')}</tbody></table></div>${insight(`Fraîcheur moyenne le jour J : <strong>${signed(Math.round(avg))}</strong>. Repère : entre +5 et +25 pour une course objectif ; tes meilleurs résultats te diront ce qui te convient.`)}`
  );
}

/* ---------- Rendu ---------- */
function renderHead(list, range) {
  const info = importInfo();
  const last = list[list.length - 1];
  $('#analysisInfo').innerHTML = list.length
    ? `Dernière activité : ${formatKey(last.date, { day: 'numeric', month: 'short', year: 'numeric' })} · ${nf(list.length)} activités${info?.at ? ` · import du ${new Date(info.at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '')}` : ''}`
    : 'Aucune activité importée sur cet appareil.';
  const s = analysisSettings();
  $('#analysisHr').textContent = `FC ${s.hrMax} / ${s.hrRest}`;
  $$('#analysisPeriods [data-period]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.period === period)));
  $$('#analysisModes [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('#analysisPeriods').hidden = mode === 'plan';
  $('#analysisNav').hidden = !list.length || mode === 'plan';
  $('#analysisRange').textContent = range?.label || '';
  $('#analysisPrev').disabled = !range?.hasPrev;
  $('#analysisNext').disabled = !range?.hasNext;
}

export function renderAnalysis() {
  const list = getActivities();
  const body = $('#analysisBody');
  if (mode === 'plan') {
    renderHead(list, null);
    renderPlan(body, list);
    return;
  }
  if (!list.length) {
    renderHead(list, null);
    body.innerHTML = `<section class="card an-card an-start"><h2 class="card__title">Importer tes entraînements</h2>
      <ol><li>Dans RunGap : Activités › Exporter › format CSV (toutes les activités).</li><li>Touche « Importer l’export RunGap » ci-dessus et choisis le fichier.</li><li>À chaque mise à jour, redépose le fichier complet : seules les nouvelles activités sont ajoutées.</li></ol>
      <p class="an-note">Les activités restent sur cet appareil.</p></section>`;
    return;
  }
  const s = analysisSettings();
  const all = series();
  const phases = getPhases();
  let range = periodRange(period, offset, { phases, first: list[0].date });
  renderHead(list, range);
  const lastKey = all[all.length - 1].key;
  const start = range.start < all[0].key ? all[0].key : range.start;
  const end = range.end > lastKey ? lastKey : range.end;
  if (start > end) {
    body.innerHTML = '<p class="an-empty card">Aucune donnée sur cette période.</p>';
    return;
  }
  const days = all.filter(d => d.key >= start && d.key <= end);
  const acts = list.filter(a => a.date >= start && a.date <= end);
  const sum = summarize(acts, days, s);
  const races = state.races;
  body.innerHTML = [
    range.note ? `<p class="an-note">${esc(range.note)}</p>` : '',
    kpis(acts, days, streakAlert(days, s), s),
    loadSection(days, start, end, phases, races),
    volumeSection(sport === 'all' ? acts : acts.filter(a => familyOf(a) === sport), sum, start, end),
    restSection(days, sum, start, end, s),
    phasesSection(all, acts, days, start, end, phases, s),
    racesSection(days, start, end, acts),
    efficiencySection(acts, start, end),
    powerSection(acts, start, end),
    recordsSection(acts, list)
  ].join('');
}

/* ---------- Import et réglages ---------- */
async function onFile(e) {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  const btn = $('#analysisImport');
  btn.classList.add('is-loading');
  try {
    const text = await file.text();
    const res = mergeExport(text);
    memo = { list: null };
    toast(res.first ? `${nf(res.total)} activités importées` : res.added ? `${res.added} nouvelle${res.added > 1 ? 's' : ''} activité${res.added > 1 ? 's' : ''} ajoutée${res.added > 1 ? 's' : ''}` : 'Aucune nouvelle activité depuis le dernier import', { type: res.added ? 'success' : 'info' });
    offset = 0;
    renderAnalysis();
  } catch (error) {
    console.warn('[analyse] import', error);
    toastError(error?.message || 'Import impossible.');
  } finally {
    btn.classList.remove('is-loading');
  }
}

function openSettings() {
  const s = analysisSettings();
  const f = $('#analysisForm');
  f.hrMax.value = s.hrMax;
  f.hrRest.value = s.hrRest;
  f.streak.value = s.streakAlert;
  f.weeklyHours.value = s.weeklyHours ? String(s.weeklyHours).replace('.', ',') : '';
  $('#analysisFormError').textContent = '';
  openSheet('analysisSheet');
}

function onSettings(e) {
  e.preventDefault();
  const f = e.target;
  const hrMax = parseNumber(f.hrMax.value);
  const hrRest = parseNumber(f.hrRest.value);
  const streak = parseNumber(f.streak.value);
  const weekly = f.weeklyHours.value.trim() ? parseNumber(f.weeklyHours.value) : 0;
  const err = !(hrMax >= 120 && hrMax <= 230)
    ? 'FC max : entre 120 et 230.'
    : !(hrRest >= 30 && hrRest <= 100 && hrRest < hrMax - 40)
      ? 'FC de repos : entre 30 et 100, nettement sous la FC max.'
      : !(streak >= 3 && streak <= 30)
        ? 'Alerte : entre 3 et 30 jours.'
        : weekly !== 0 && !(weekly >= 1 && weekly <= 40)
          ? 'Volume de référence : entre 1 et 40 h, ou vide.'
          : '';
  if (err) {
    $('#analysisFormError').textContent = err;
    return;
  }
  state.objectives = { ...state.objectives, [ANALYSIS_KEY]: { hrMax: Math.round(hrMax), hrRest: Math.round(hrRest), streakAlert: Math.round(streak), weeklyHours: weekly ? Math.round(weekly * 2) / 2 : 0 } };
  if (commit('objectives') === false) return;
  closeSheet('analysisSheet');
  toast('Réglages de l’analyse enregistrés', { type: 'success' });
}

export function initAnalysis() {
  $('#analysisImport').addEventListener('click', () => $('#analysisFile').click());
  $('#analysisFile').addEventListener('change', onFile);
  $('#analysisHr').addEventListener('click', openSettings);
  $('#analysisForm').addEventListener('submit', onSettings);
  $('#analysisPeriods').addEventListener('click', e => {
    const p = e.target.closest('[data-period]')?.dataset.period;
    if (!p) return;
    period = p;
    offset = 0;
    write(PERIOD_KEY, p);
    renderAnalysis();
  });
  $('#analysisModes').addEventListener('click', e => {
    const m = e.target.closest('[data-mode]')?.dataset.mode;
    if (!m) return;
    mode = m;
    write(MODE_KEY, m);
    renderAnalysis();
  });
  $('#analysisBody').addEventListener('click', e => {
    const chip = e.target.closest('[data-sport]');
    if (chip) {
      sport = chip.dataset.sport;
      write(SPORT_KEY, sport);
      return renderAnalysis();
    }
    const week = e.target.closest('[data-plan-week], [data-week]');
    if (week) {
      const key = week.dataset.planWeek ?? week.dataset.week;
      if (!key) return;
      selectPlanWeek(key);
      return renderAnalysis();
    }
    if (e.target.closest('[data-action="planner"]')) openPlanner();
  });
  $('#analysisPrev').addEventListener('click', () => {
    offset++;
    renderAnalysis();
  });
  $('#analysisNext').addEventListener('click', () => {
    offset = Math.max(0, offset - 1);
    renderAnalysis();
  });
}
