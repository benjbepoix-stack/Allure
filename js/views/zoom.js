/*
 * Vue Zoom : un seul calendrier, quatre échelles.
 * - Année : bilan (une barre par mois colorée par les phases, chiffres, sports, courses).
 * - Mois : jours colorés par phase, phases et courses du mois.
 * - Semaine : une ligne par jour.
 * - Jour : fiche de la course (calendrier, modifier, résultat) et de la phase (conseil).
 * On plonge en touchant un mois / une semaine / un jour, ou en écartant deux doigts ;
 * on recule en pinçant ou avec le sélecteur d'échelle.
 */
import { $, esc, parseNumber, round, plural } from '../core/utils.js';
import { addDays, dateKey, formatDate, formatKey, fromKey, mondayOf, todayKey } from '../core/dates.js';
import { state } from '../core/store.js';
import { MEASURE_FIELDS } from '../core/schema.js';
import { PHASE_TYPES, getPhases, phaseOn, racesOn } from '../core/season.js';
import { readText, write } from '../services/storage.js';
import { icon } from '../ui/icons.js';
import { PALETTE } from '../ui/charts.js';
import { sortedRaces, isUpcoming, sportFamily, fmtDist, wheelValue, zeroClass, raceAction, saveResult, wheelState } from './races.js';
import { openPhaseEditor, deletePhase } from './season.js';

export const LEVELS = ['Année', 'Mois', 'Semaine', 'Jour'];
const LEVEL_KEY = 'allure_zoom_level';
const HINTS = ['Glissez pour changer d’année', 'Glissez pour changer de mois', 'Glissez pour changer de semaine', 'Glissez pour changer de jour'];
const NAV_LABELS = [['Année précédente', 'Année suivante'], ['Mois précédent', 'Mois suivant'], ['Semaine précédente', 'Semaine suivante'], ['Jour précédent', 'Jour suivant']];
/* Charge relative d'un jour selon sa phase : hauteur des barres de l'année. */
const LOAD = { base: 0.5, buildVolume: 0.85, buildIntensity: 0.95, buildRace: 0.9, build: 0.9, taper: 0.6, recovery: 0.3, transition: 0.2 };

let level = 1;
let focus = todayKey();
let silentNext = false;

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
const shortDate = key => formatKey(key, { day: 'numeric', month: 'short' });
const yearOf = key => Number(key.slice(0, 4));
const monthOf = key => key.slice(0, 7);
const firstOfMonth = key => `${monthOf(key)}-01`;
const lastOfMonth = key => {
  const d = fromKey(firstOfMonth(key));
  return dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
};
const fmt1 = n => String(round(n, 1)).replace('.', ',');

function isoWeek(key) {
  const d = fromKey(key);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

/** « J−12 », « Aujourd’hui », « Demain ». */
function countdownLabel(key) {
  const n = daysBetween(todayKey(), key);
  if (n === 0) return 'Aujourd’hui';
  if (n === 1) return 'Demain';
  return `J−${n}`;
}

function weekInPhase(p, key) {
  const total = Math.max(1, Math.ceil((daysBetween(p.start, p.end) + 1) / 7));
  return [Math.min(total, Math.floor(daysBetween(p.start, key) / 7) + 1), total];
}

export function zoomTitle() {
  const d = fromKey(focus);
  if (level === 0) return String(d.getFullYear());
  if (level === 1) return cap(formatDate(d, { month: 'long', year: 'numeric' }));
  if (level === 2) return `Semaine ${isoWeek(focus)}`;
  return cap(formatDate(d, { weekday: 'short', day: 'numeric', month: 'short' }));
}

/** La période affichée contient-elle aujourd'hui ? */
function showsToday() {
  const t = todayKey();
  if (level === 0) return yearOf(t) === yearOf(focus);
  if (level === 1) return monthOf(t) === monthOf(focus);
  if (level === 2) return dateKey(mondayOf(fromKey(t))) === dateKey(mondayOf(fromKey(focus)));
  return t === focus;
}

/* ---------- Échelle Année : le bilan ---------- */
function yearHTML() {
  const y = yearOf(focus);
  const phases = getPhases();
  const t = todayKey();
  const bars = [];
  for (let m = 0; m < 12; m++) {
    const first = new Date(y, m, 1, 12);
    const count = new Date(y, m + 1, 0).getDate();
    const seg = {};
    let load = 0;
    for (let d = 0; d < count; d++) {
      const p = phaseOn(dateKey(addDays(first, d)), phases);
      if (!p) continue;
      seg[p.type] = (seg[p.type] || 0) + 1;
      load += LOAD[p.type] || 0.5;
    }
    const key = dateKey(first);
    const races = state.races.filter(r => monthOf(r.date) === monthOf(key));
    const h = Math.max(6, Math.round((load / count) * 100));
    const label = [cap(formatDate(first, { month: 'long' })), ...Object.keys(seg).map(k => PHASE_TYPES[k].short), races.length ? `${races.length} ${plural(races.length, 'course')}` : ''].filter(Boolean).join(', ');
    bars.push(`<button type="button" class="zbar${monthOf(t) === monthOf(key) ? ' is-now' : ''}" data-go="month" data-key="${key}" aria-label="${esc(label)}">
      <span class="zbar__fill" style="height:${h}%">${Object.entries(seg).map(([k, n]) => `<i class="phase--${k}" style="flex:${n}"></i>`).join('')}</span>
      ${races.length ? '<span class="zbar__race"></span>' : ''}</button>`);
  }
  const months = Array.from({ length: 12 }, (_, m) => `<span>${formatDate(new Date(y, m, 1), { month: 'narrow' })}</span>`).join('');

  const now = new Date();
  const list = sortedRaces().filter(r => yearOf(r.date) === y);
  const upcoming = list.filter(r => isUpcoming(r, now)).length;
  const km = list.reduce((s, r) => s + (parseNumber(r.distance) || 0), 0);
  const cost = list.reduce((s, r) => s + (parseNumber(r.price) || 0), 0);
  const stats = [
    [list.length, plural(list.length, 'course')],
    [upcoming, 'à venir'],
    [list.length - upcoming, plural(list.length - upcoming, 'terminée')],
    [`${round(km, 0).toLocaleString('fr-FR')} km`, 'distance'],
    [`${round(cost, 2).toLocaleString('fr-FR')} €`, 'inscriptions']
  ].map(([v, l]) => `<div class="stat"><strong>${esc(v)}</strong><span>${l}</span></div>`).join('');

  const counts = {};
  list.forEach(r => (counts[sportFamily(r.sport)] = (counts[sportFamily(r.sport)] || 0) + 1));
  const sports = Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
  const sportsHTML = sports.length
    ? `<div class="zsports" aria-hidden="true">${sports.map(([, n], i) => `<i style="flex:${n};background:${PALETTE[i % PALETTE.length]}"></i>`).join('')}</div>
       <div class="zlegend">${sports.map(([k, n], i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(k)} ${n}</span>`).join('')}</div>`
    : '';

  return `<div class="zyear" role="group" aria-label="Mois de ${y}">${bars.join('')}</div><div class="zyear__months" aria-hidden="true">${months}</div>
    <h2 class="zsec">Bilan ${y}</h2>
    <div class="stats-grid zstats">${stats}</div>
    ${sportsHTML}
    <h2 class="zsec">Courses ${y}</h2>
    ${list.length ? `<div class="zlist">${[...list].reverse().map(r => raceRow(r, now, { day: true })).join('')}</div>` : '<p class="zempty">Aucune course cette année. Touchez Ajouter pour en programmer une.</p>'}`;
}

function raceRow(r, now, { day = false } = {}) {
  const past = !isUpcoming(r, now);
  const when = formatKey(r.date, day ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' });
  const right = past ? (r.resultTime ? esc(r.resultTime) : '<span class="zmuted">Résultat ?</span>') : countdownLabel(r.date);
  return `<button type="button" class="zrow" data-go="day" data-key="${r.date}">
    <span class="zrow__flag">${icon('flag', 16)}</span>
    <span class="zrow__body"><strong>${esc(r.name)}</strong><span>${cap(when)} · ${esc(r.sport)}${r.distance !== '' ? ` · ${fmtDist(r)}` : ''}</span></span>
    <span class="zrow__end${past ? '' : ' is-count'}">${right}</span></button>`;
}

/* ---------- Échelle Mois : la saison ---------- */
function nowCardHTML() {
  const t = todayKey();
  const p = phaseOn(t);
  const next = sortedRaces().find(r => isUpcoming(r));
  if (!p && !next) return '';
  const phase = p
    ? (() => {
        const [w, total] = weekInPhase(p, t);
        return `<span class="znow__kicker">Aujourd’hui · semaine ${w} sur ${total}</span><strong>${esc(PHASE_TYPES[p.type].name)}</strong>`;
      })()
    : `<span class="znow__kicker">Aujourd’hui</span><strong>Aucune phase en cours</strong>`;
  return `<button type="button" class="znow ${p ? `phase--${p.type}` : ''}" data-go="day" data-key="${t}">
    <span class="znow__phase">${phase}</span>
    ${next ? `<span class="znow__race">${icon('flag', 14)} ${esc(next.name)} · <b>${countdownLabel(next.date)}</b></span>` : ''}
  </button>`;
}

function monthHTML() {
  const t = todayKey();
  const phases = getPhases();
  const first = firstOfMonth(focus);
  const last = lastOfMonth(focus);
  const start = mondayOf(fromKey(first));
  const head = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="zcal__dh" aria-hidden="true">${d}</span>`).join('');
  const cells = [];
  for (let w = 0; w < 6; w++) {
    const monday = dateKey(addDays(start, w * 7));
    if (w > 0 && monday > last) break;
    cells.push(`<button type="button" class="zcal__wk" data-go="week" data-key="${monday}" aria-label="Semaine ${isoWeek(monday)}">S${isoWeek(monday)}</button>`);
    for (let i = 0; i < 7; i++) {
      const key = dateKey(addDays(fromKey(monday), i));
      const p = phaseOn(key, phases);
      const races = racesOn(key);
      const out = monthOf(key) !== monthOf(focus);
      const label = [formatKey(key, { weekday: 'long', day: 'numeric', month: 'long' }), p ? PHASE_TYPES[p.type].name : '', ...races.map(r => `course : ${r.name}`)].filter(Boolean).join(', ');
      const cls = ['zcal__d', p ? `phase--${p.type}` : '', races.length ? 'is-race' : '', key === t ? 'is-today' : '', out ? 'is-out' : ''].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="${cls}" data-go="day" data-key="${key}" aria-label="${esc(label)}">${fromKey(key).getDate()}</button>`);
    }
  }
  const inMonth = phases.filter(p => p.start <= last && p.end >= first);
  const phaseRows = inMonth
    .map(
      p => `<div class="zphase phase--${p.type}">
        <button type="button" class="zphase__main" data-go="day" data-key="${p.start < first ? first : p.start}">
          <span class="phase-dot"></span><span class="zrow__body"><strong>${esc(PHASE_TYPES[p.type].name)}</strong><span>${shortDate(p.start)} → ${shortDate(p.end)}${p.note ? ` · ${esc(p.note)}` : ''}</span></span>
        </button>
        <button type="button" class="icon-btn icon-btn--sm" data-act="phase-edit" data-id="${esc(p.id)}" aria-label="Modifier la phase">${icon('edit', 16)}</button>
        <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="phase-delete" data-id="${esc(p.id)}" aria-label="Supprimer la phase">${icon('trash', 16)}</button>
      </div>`
    )
    .join('');
  const now = new Date();
  const races = sortedRaces().filter(r => monthOf(r.date) === monthOf(focus));
  return `${monthOf(t) === monthOf(focus) ? nowCardHTML() : ''}
    <div class="zcal" role="group" aria-label="${esc(zoomTitle())}"><span></span>${head}${cells.join('')}</div>
    <h2 class="zsec">Phases du mois</h2>
    ${inMonth.length ? `<div class="zlist">${phaseRows}</div>` : '<p class="zempty">Aucune phase ce mois-ci. Touchez Ajouter pour en planifier une.</p>'}
    ${races.length ? `<h2 class="zsec">Courses</h2><div class="zlist">${[...races].reverse().map(r => raceRow(r, now)).join('')}</div>` : ''}`;
}

/* ---------- Échelle Semaine ---------- */
function weekHTML() {
  const t = todayKey();
  const phases = getPhases();
  const monday = mondayOf(fromKey(focus));
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const key = dateKey(addDays(monday, i));
    const p = phaseOn(key, phases);
    const races = racesOn(key);
    const d = fromKey(key);
    let body;
    if (races.length) {
      const r = races[0];
      body = `<span class="zday__block is-race"><strong>${icon('flag', 14)} ${esc(r.name)}${races.length > 1 ? ` +${races.length - 1}` : ''}</strong><span>${[r.time, r.distance !== '' ? fmtDist(r) : '', isUpcoming(r) ? countdownLabel(r.date) : r.resultTime].filter(Boolean).map(esc).join(' · ')}</span></span>`;
    } else if (p) {
      const [w, total] = weekInPhase(p, key);
      body = `<span class="zday__block phase--${p.type}"><strong>${esc(PHASE_TYPES[p.type].short)}</strong><span>${key === p.start ? 'Début de la phase' : key === p.end ? 'Dernier jour de la phase' : `Semaine ${w} sur ${total}`}</span></span>`;
    } else body = `<span class="zday__block is-empty"><strong>Aucune phase</strong><span>Touchez pour ajouter</span></span>`;
    rows.push(`<button type="button" class="zday${key === t ? ' is-today' : ''}" data-go="day" data-key="${key}">
      <span class="zday__date"><span>${formatDate(d, { weekday: 'short' })}</span><strong>${d.getDate()}</strong></span>${body}</button>`);
  }
  const p = phaseOn(dateKey(addDays(monday, 3)), phases);
  return `${p ? `<p class="zadvice phase--${p.type}"><b>${esc(PHASE_TYPES[p.type].short)}</b> · ${esc(PHASE_TYPES[p.type].advice)}</p>` : ''}<div class="zweek">${rows.join('')}</div>`;
}

/* ---------- Échelle Jour ---------- */
function raceCardHTML(r, now) {
  const past = !isUpcoming(r, now);
  const stats = [
    r.distance !== '' ? ['Distance', fmtDist(r)] : null,
    r.elevation !== '' ? ['Dénivelé', `${r.elevation} m`] : null,
    r.target ? ['Objectif', r.target] : null,
    r.price !== '' ? ['Inscription', `${String(r.price).replace('.', ',')} €`] : null
  ].filter(Boolean);
  return `<article class="zrace" data-id="${esc(r.id)}">
    <div class="zrace__kicker">${[r.sport, r.time ? `départ ${r.time}` : '', r.location].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="zrace__big">${past ? (r.resultTime ? esc(r.resultTime) : 'Terminée') : countdownLabel(r.date)}</div>
    <h2 class="zrace__name">${esc(r.name)}</h2>
    ${stats.length ? `<div class="zrace__stats">${stats.map(([l, v]) => `<div><span>${l}</span><strong>${esc(v)}</strong></div>`).join('')}</div>` : ''}
    ${r.notes ? `<p class="zrace__notes">${esc(r.notes)}</p>` : ''}
    ${
      past
        ? `<div class="race-result"><div class="race-result__title">Résultat</div><div class="race-result__grid">
        <label class="mini-field"><span>Temps réalisé</span><input class="input input--center input--wheel${zeroClass(r.resultTime)}" type="time" data-result="resultTime" data-orig="${esc(r.resultTime)}" value="${wheelValue(r.resultTime)}"></label>
        <label class="mini-field"><span>Classement</span><input class="input input--center" data-result="resultRank" maxlength="40" inputmode="numeric" value="${esc(r.resultRank)}"></label>
        <label class="mini-field"><span>Distance (km)</span><input class="input input--center" data-result="resultDistance" maxlength="40" inputmode="decimal" value="${esc(r.resultDistance)}"></label>
      </div></div>`
        : ''
    }
    <div class="zactions">
      ${past ? '' : `<button type="button" class="btn btn--soft btn--sm" data-act="race-calendar" data-id="${esc(r.id)}">${icon('calendarPlus', 16)}<span>Calendrier</span></button>`}
      <button type="button" class="btn btn--soft btn--sm" data-act="race-edit" data-id="${esc(r.id)}">${icon('edit', 16)}<span>Modifier</span></button>
      <button type="button" class="btn btn--soft btn--sm zdanger" data-act="race-delete" data-id="${esc(r.id)}">${icon('trash', 16)}<span>Supprimer</span></button>
    </div>
  </article>`;
}

function dayHTML() {
  const t = todayKey();
  const now = new Date();
  const races = racesOn(focus);
  const p = phaseOn(focus);
  let html = races.map(r => raceCardHTML(r, now)).join('');
  if (p) {
    const [w, total] = weekInPhase(p, focus);
    const left = daysBetween(focus, p.end);
    html += `<section class="phase-now phase--${p.type} zphase-card">
      <div class="phase-now__kicker">${focus === t ? 'Aujourd’hui · ' : ''}Semaine ${w} sur ${total}</div>
      <div class="phase-now__name">${esc(PHASE_TYPES[p.type].name)}</div>
      <div class="phase-now__dates">${shortDate(p.start)} → ${shortDate(p.end)} · ${left === 0 ? 'dernier jour' : `encore ${left} ${plural(left, 'jour')}`}</div>
      <p class="phase-now__advice">${esc(PHASE_TYPES[p.type].advice)}</p>
      ${p.note ? `<p class="phase-now__note">${esc(p.note)}</p>` : ''}
      <div class="zactions">
        <button type="button" class="btn btn--soft btn--sm" data-act="phase-edit" data-id="${esc(p.id)}">${icon('edit', 16)}<span>Modifier la phase</span></button>
        <button type="button" class="btn btn--soft btn--sm zdanger" data-act="phase-delete" data-id="${esc(p.id)}">${icon('trash', 16)}<span>Supprimer</span></button>
      </div>
    </section>`;
  } else {
    html += `<section class="phase-now phase-now--empty zphase-card">
      <div class="phase-now__kicker">${focus === t ? 'Aujourd’hui' : 'Phase'}</div>
      <div class="phase-now__name">Aucune phase ce jour-là</div>
      <div class="zactions"><button type="button" class="btn btn--soft btn--sm" data-act="phase-add">${icon('plus', 16)}<span>Planifier une phase à partir d’ici</span></button></div>
    </section>`;
  }
  const bm = state.bodyMetrics;
  const w = bm.weight.find(x => x.date === focus);
  const f = bm.ftp.find(x => x.date === focus);
  const m = bm.measurements.find(x => x.date === focus);
  const measures = [w ? `Poids ${fmt1(w.value)} kg` : '', f ? `FTP ${Math.round(f.value)} W` : '', m ? MEASURE_FIELDS.filter(([k]) => m[k] !== null).map(([k, l]) => `${l} ${fmt1(m[k])}`).join(' · ') : ''].filter(Boolean);
  if (measures.length) html += `<div class="zcard"><span class="zcard__k">Mesures du jour</span><p>${measures.map(esc).join('<br>')}</p></div>`;
  if (!races.length) {
    const next = sortedRaces().find(r => r.date > focus && isUpcoming(r, now));
    if (next) html += `<div class="zlist zlist--next">${raceRow(next, now, { day: true })}</div>`;
  }
  return html;
}

/* ---------- Rendu et transitions ---------- */
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderZoom({ dir = 0, origin = null, slide = 0 } = {}) {
  if (silentNext) {
    silentNext = false;
    return;
  }
  const body = $('#zoomBody');
  if (!body) return;
  body.innerHTML = [yearHTML, monthHTML, weekHTML, dayHTML][level]();
  const title = zoomTitle();
  $('#headerTitle').textContent = title;
  document.title = `${title} · Cadence`;
  document.querySelectorAll('#zoomLevels [data-level]').forEach(b => b.setAttribute('aria-checked', String(Number(b.dataset.level) === level)));
  $('#zoomHint').textContent = HINTS[level];
  $('#zoomToday').hidden = showsToday();
  $('#zoomPrev').setAttribute('aria-label', NAV_LABELS[level][0]);
  $('#zoomNext').setAttribute('aria-label', NAV_LABELS[level][1]);
  if (slide) {
    body.style.transform = '';
    body.classList.remove('is-zoom-in', 'is-zoom-out', 'is-slide-next', 'is-slide-prev', 'is-fade');
    void body.offsetWidth;
    body.classList.add(reduceMotion() ? 'is-fade' : slide > 0 ? 'is-slide-next' : 'is-slide-prev');
    return;
  }
  if (!dir) return;
  if (origin) {
    const r = body.getBoundingClientRect();
    const o = origin.getBoundingClientRect();
    body.style.transformOrigin = `${o.left - r.left + o.width / 2}px ${o.top - r.top + o.height / 2}px`;
  } else body.style.transformOrigin = '50% 20%';
  body.classList.remove('is-zoom-in', 'is-zoom-out');
  void body.offsetWidth;
  body.classList.add(reduceMotion() ? 'is-fade' : dir > 0 ? 'is-zoom-in' : 'is-zoom-out');
}

function setLevel(next, origin = null) {
  next = Math.max(0, Math.min(3, next));
  if (next === level) return;
  const dir = next > level ? 1 : -1;
  level = next;
  write(LEVEL_KEY, String(level));
  renderZoom({ dir, origin });
  if (dir) window.scrollTo({ top: 0, behavior: reduceMotion() ? 'auto' : 'smooth' });
}

function shift(n) {
  const d = fromKey(focus);
  if (level === 0) focus = dateKey(new Date(d.getFullYear() + n, d.getMonth(), 1, 12));
  else if (level === 1) focus = dateKey(new Date(d.getFullYear(), d.getMonth() + n, 1, 12));
  else focus = dateKey(addDays(d, n * (level === 2 ? 7 : 1)));
  // En revenant sur la période en cours, on se recale sur aujourd'hui.
  if (level < 3 && showsTodayFor(focus)) focus = todayKey();
  renderZoom({ slide: n });
}

function showsTodayFor(key) {
  const t = todayKey();
  if (level === 0) return yearOf(t) === yearOf(key);
  if (level === 1) return monthOf(t) === monthOf(key);
  if (level === 2) return dateKey(mondayOf(fromKey(t))) === dateKey(mondayOf(fromKey(key)));
  return false;
}

/** Plonge vers l'élément touché (mois, semaine, jour). */
function dive(el) {
  const key = el.dataset.key;
  const target = { month: 1, week: 2, day: 3 }[el.dataset.go];
  if (!key || target === undefined) return;
  focus = target < 3 && showsTodayAt(key, target) ? todayKey() : key;
  if (target === level) renderZoom();
  else setLevel(target, el);
}

function showsTodayAt(key, lvl) {
  const t = todayKey();
  if (lvl === 1) return monthOf(t) === monthOf(key);
  if (lvl === 2) return dateKey(mondayOf(fromKey(t))) === dateKey(mondayOf(fromKey(key)));
  return false;
}

/** Date proposée aux formulaires d'ajout : le jour affiché, sinon rien (valeurs par défaut). */
export const zoomContextDay = () => (level === 3 ? focus : '');

/** Affiche le jour d'une course ou d'une phase qui vient d'être enregistrée. */
export function showDay(key) {
  if (!key) return;
  focus = key;
  if (level === 3) renderZoom();
  else setLevel(3);
}

/* ---------- Gestes : pincer pour reculer, écarter pour plonger ---------- */
function bindPinch(body) {
  const under = (x, y) => document.elementFromPoint(x, y)?.closest('#zoomBody [data-go]');
  const zoomIn = (x, y) => {
    const el = level < 3 ? under(x, y) : null;
    if (el && { month: 1, week: 2, day: 3 }[el.dataset.go] > level) dive(el);
    else setLevel(level + 1);
  };
  // Trackpad (Chrome, Firefox, Edge) : le pincement arrive comme une molette avec Ctrl.
  let acc = 0;
  let lock = 0;
  body.addEventListener(
    'wheel',
    e => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      if (Date.now() < lock) return;
      acc += e.deltaY;
      if (Math.abs(acc) < 30) return;
      if (acc < 0) zoomIn(e.clientX, e.clientY);
      else setLevel(level - 1);
      acc = 0;
      lock = Date.now() + 450;
    },
    { passive: false }
  );
  // Safari (iPhone, iPad, Mac) : événements gesture*.
  let gesture = null;
  body.addEventListener('gesturestart', e => {
    e.preventDefault();
    gesture = { x: e.clientX, y: e.clientY, done: false };
  });
  body.addEventListener('gesturechange', e => {
    e.preventDefault();
    if (!gesture || gesture.done) return;
    if (e.scale > 1.25) {
      gesture.done = true;
      zoomIn(gesture.x, gesture.y);
    } else if (e.scale < 0.8) {
      gesture.done = true;
      setLevel(level - 1);
    }
  });
  body.addEventListener('gestureend', e => {
    e.preventDefault();
    gesture = null;
  });
  // Autres écrans tactiles : deux doigts.
  let start = 0;
  let center = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  body.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 2) return;
      start = dist(e.touches);
      center = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
    },
    { passive: true }
  );
  body.addEventListener(
    'touchmove',
    e => {
      if (e.touches.length !== 2 || !start) return;
      e.preventDefault();
      const ratio = dist(e.touches) / start;
      if (ratio > 1.25) {
        start = 0;
        zoomIn(center.x, center.y);
      } else if (ratio < 0.8) {
        start = 0;
        setLevel(level - 1);
      }
    },
    { passive: false }
  );
  body.addEventListener('touchend', () => (start = 0));
}

/* ---------- Glisser à gauche / à droite : période suivante / précédente ---------- */
function bindSwipe(body) {
  // Doigt : le contenu suit le doigt, puis on change de période au-delà d'un seuil.
  let s = null;
  body.addEventListener(
    'touchstart',
    e => {
      if (e.touches.length !== 1 || e.target.closest('input, textarea, select')) {
        s = null;
        return;
      }
      s = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), axis: null, dx: 0 };
    },
    { passive: true }
  );
  body.addEventListener(
    'touchmove',
    e => {
      if (!s || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (s.axis !== 'x') return;
      e.preventDefault();
      s.dx = dx;
      if (!reduceMotion()) body.style.transform = `translateX(${dx}px)`;
    },
    { passive: false }
  );
  const end = () => {
    if (!s) return;
    const { axis, dx, t } = s;
    s = null;
    if (axis !== 'x') return;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - t) > 0.5;
    if (Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30)) shift(dx < 0 ? 1 : -1);
    else {
      body.style.transition = 'transform 220ms var(--ease)';
      body.style.transform = '';
      setTimeout(() => (body.style.transition = ''), 240);
    }
  };
  body.addEventListener('touchend', end);
  body.addEventListener('touchcancel', end);
  // Trackpad : glissement horizontal à deux doigts.
  let acc = 0;
  let lock = 0;
  body.addEventListener(
    'wheel',
    e => {
      if (e.ctrlKey || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      e.preventDefault();
      if (Date.now() < lock) return;
      acc += e.deltaX;
      if (Math.abs(acc) < 60) return;
      shift(acc > 0 ? 1 : -1);
      acc = 0;
      lock = Date.now() + 600;
    },
    { passive: false }
  );
}

export function initZoom() {
  const saved = Number(readText(LEVEL_KEY, '1'));
  level = Number.isInteger(saved) && saved >= 0 && saved <= 3 ? saved : 1;
  const body = $('#zoomBody');
  body.addEventListener('animationend', () => body.classList.remove('is-zoom-in', 'is-zoom-out', 'is-slide-next', 'is-slide-prev', 'is-fade'));
  body.addEventListener('click', e => {
    const act = e.target.closest('[data-act]');
    if (act) {
      const { id } = act.dataset;
      switch (act.dataset.act) {
        case 'race-calendar': return raceAction('calendar', id);
        case 'race-edit': return raceAction('edit', id);
        case 'race-delete': return raceAction('delete', id);
        case 'phase-edit': return openPhaseEditor(id);
        case 'phase-delete': return deletePhase(id);
        case 'phase-add': return openPhaseEditor(null, { start: focus });
      }
      return;
    }
    const go = e.target.closest('[data-go]');
    if (go) dive(go);
  });
  body.addEventListener('input', wheelState);
  body.addEventListener('change', e => {
    const input = e.target.closest('[data-result]');
    const id = input?.closest('[data-id]')?.dataset.id;
    if (!input || !id) return;
    silentNext = true; // pas de re-rendu : on garde la saisie en cours
    if (!saveResult(input, id)) {
      silentNext = false;
      renderZoom();
    }
  });
  $('#zoomLevels').addEventListener('click', e => {
    const b = e.target.closest('[data-level]');
    if (b) setLevel(Number(b.dataset.level));
  });
  $('#zoomPrev').addEventListener('click', () => shift(-1));
  $('#zoomNext').addEventListener('click', () => shift(1));
  $('#zoomToday').addEventListener('click', () => {
    focus = todayKey();
    renderZoom({ dir: 1 });
  });
  bindPinch(body);
  bindSwipe(body);
}
