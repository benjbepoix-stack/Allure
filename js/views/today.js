/*
 * Aujourd'hui : tout ce qui compte sur un écran.
 *  - prochaine course (J−, forme du sport de la course, cible « prêt » 85) ;
 *  - forme par sport (Ski, Course & trail, Vélo), sur 100 = ton meilleur niveau ;
 *  - phases jusqu'à la prochaine course seulement, « Voir plus » pour aller plus loin ;
 *  - cette semaine : phase, conseil et séances faites.
 * Les phases et la ligne de temps sont aussi utilisées par la Saison (timelineHTML).
 */
import { $, esc, plural } from '../core/utils.js';
import { addDays, dateKey, formatDate, formatKey, fromKey, mondayOf, todayKey } from '../core/dates.js';
import { getPhases, phaseOn, phaseType } from '../core/season.js';
import { displayPhases } from '../core/phase-level.js';
import { racePriority } from '../core/planner.js';
import { getActivities } from '../core/activities.js';
import { family, familyOf } from '../core/training.js';
import { READY, formBySport, formStatus, freshness, group, raceGroup, valueLabel } from '../core/form.js';
import { isUpcoming, sortedRaces, fmtDist } from './races.js';
import { openSheet } from '../ui/dialog.js';
import { icon } from '../ui/icons.js';

const days = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
const short = key => formatKey(key, { day: 'numeric', month: 'short' });
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

let upto = 0; // 0 : jusqu'à la prochaine course ; n : n courses plus loin
let handlers = { openDay: () => {}, openView: () => {} };

/** Courses à venir qui comptent (hors « Ne compte pas »), dans l'ordre. */
export const upcomingRaces = () => sortedRaces().filter(r => isUpcoming(r) && racePriority(r.id) !== 'C');

/* ---------- Ligne de temps des phases (partagée avec la Saison) ---------- */
/** Phases (par type, morceaux consécutifs réunis) d'aujourd'hui jusqu'au jour `until`. */
function phasesUntil(until) {
  const t = todayKey();
  return displayPhases(getPhases(), 2).filter(p => p.end >= t && p.start <= until);
}

/** Bande proportionnelle + liste des phases jusqu'à `until`, courses intercalées. */
export function timelineHTML(until) {
  const t = todayKey();
  const list = phasesUntil(until);
  const races = upcomingRaces().filter(r => r.date <= until);
  if (!list.length) {
    return `<p class="td-empty">Aucune phase prévue d’ici là. <button type="button" class="link-btn" data-td="planner">Créer les phases automatiquement</button></p>`;
  }
  const a = list[0].start;
  const z = until > list.at(-1).end ? until : list.at(-1).end;
  const total = days(a, z) + 1;
  const segs = list
    .map(p => {
      const from = p.start < a ? a : p.start;
      const to = p.end > z ? z : p.end;
      return `<i style="width:${(((days(from, to) + 1) / total) * 100).toFixed(2)}%;background:${p.color}"></i>`;
    })
    .join('');
  const here = Math.max(0, Math.min(100, (days(a, t) / total) * 100));
  const marks = races.map(r => `<b class="td-strip__race${racePriority(r.id) === 'A' ? ' is-goal' : ''}" style="left:${((days(a, r.date) / total) * 100).toFixed(2)}%"></b>`).join('');
  const rows = [];
  for (const p of list) {
    const cur = p.start <= t && p.end >= t;
    const w = Math.max(1, Math.round((days(p.start, p.end) + 1) / 7));
    const wk = cur ? Math.floor(days(p.start, t) / 7) + 1 : 0;
    rows.push(`<button type="button" class="td-ph${cur ? ' is-now' : ''}" data-td="day" data-key="${cur ? t : p.start}">
      <span class="td-ph__c" style="background:${p.color}"></span>
      <span class="td-ph__t"><b>${esc(p.name)}</b><small>${short(p.start)} → ${short(p.end)} · ${w} sem.${cur ? ` · semaine ${wk} sur ${w}` : ''}</small></span>
      ${cur ? '<span class="td-ph__now">en cours</span>' : ''}
    </button>`);
    for (const r of races.filter(x => x.date >= p.start && x.date <= p.end)) rows.push(raceLine(r));
  }
  // Courses après la dernière phase listée.
  for (const r of races.filter(x => x.date > list.at(-1).end)) rows.push(raceLine(r));
  return `<div class="td-strip"><div class="td-strip__bar">${segs}</div>${marks}<span class="td-strip__here" style="left:${here.toFixed(2)}%"><em>auj.</em></span></div>
    <div class="td-strip__ends"><span>${short(a)}</span><span>${short(z)}</span></div>
    <div class="td-phases">${rows.join('')}</div>`;
}

function raceLine(r) {
  return `<button type="button" class="td-race" data-td="day" data-key="${r.date}">${icon('flag', 16)}<b>${esc(r.name)}</b><small>${short(r.date)}</small></button>`;
}

/* ---------- Cartes ---------- */
function heroHTML(r, forms) {
  if (!r) {
    return `<section class="td-hero td-hero--empty"><span class="td-hero__eyebrow">Prochaine course</span><h2>Aucune course à venir</h2>
      <p>Choisis tes courses dans l’onglet Courses.</p><button type="button" class="btn td-hero__btn" data-td="view" data-view="catalogView">${icon('flag', 16)}<span>Choisir mes courses</span></button></section>`;
  }
  const t = todayKey();
  const left = days(t, r.date);
  const g = group(raceGroup(r));
  const f = g && forms.find(x => x.id === g.id);
  const meta = [r.distance !== '' ? fmtDist(r) : '', r.elevation !== '' ? `${Number(r.elevation).toLocaleString('fr-FR')} m D+` : '', r.location].filter(Boolean);
  const weeks = Math.max(1, Math.round(left / 7));
  const need = f ? Math.max(0, Math.ceil((READY - f.score) / weeks)) : 0;
  const formHTML = f
    ? `<span class="td-hero__f">Forme ${esc(g.short.toLowerCase())}<b>${f.score}<small> / 100</small></b>${f.score >= READY ? 'prêt' : `+${need} / sem. pour être prêt`}</span>`
    : '';
  const bar = f
    ? `<span class="td-hero__track"><i style="width:${f.score}%;background:${g.color}"></i><span class="td-hero__goal" style="left:${READY}%"></span></span>
       <span class="td-hero__legend"><span>auj. ${f.score}</span><span>prêt à ${READY}</span></span>`
    : '';
  return `<button type="button" class="td-hero" data-td="day" data-key="${r.date}">
    <span class="td-hero__eyebrow">Prochaine course · ${racePriority(r.id) === 'A' ? 'objectif' : 'préparation'}</span>
    <span class="td-hero__id"><strong>${esc(r.name)}</strong><span>${esc(cap(formatKey(r.date, { weekday: 'long', day: 'numeric', month: 'long' })))}${meta.length ? ` · ${meta.map(esc).join(' · ')}` : ''}</span></span>
    <span class="td-hero__big"><span class="td-hero__j">${left === 0 ? 'Jour J' : `J−${left}`}<small>${left >= 14 ? `${weeks} sem.` : plural(left, 'jour')}</small></span>${formHTML}</span>
    ${bar}
  </button>`;
}

function formHTML(forms, fresh) {
  if (!forms.length) {
    return `<section class="card td-card"><h2 class="td-h">Ta forme par sport</h2>
      <p class="td-muted">Connecte Strava pour calculer ta forme en ski, course & trail et vélo, par rapport à ton meilleur niveau.</p>
      <button type="button" class="btn btn--primary btn--sm" data-td="view" data-view="analysisView">Connecter Strava</button></section>`;
  }
  const rows = forms
    .map(f => `<button type="button" class="td-sport" data-td="sport" data-id="${f.id}" aria-label="${esc(f.name)} : ${f.score} sur 100, ${formStatus(f.score).name}">
      <span class="td-sport__n"><i style="background:${f.color}"></i>${esc(f.short)}</span>
      <span class="td-sport__m"><span class="td-meter"><i style="width:${f.score}%;background:${f.color}"></i></span></span>
      <span class="td-sport__s">${f.score}</span></button>`)
    .join('');
  return `<section class="card td-card">
    <div class="td-row"><h2 class="td-h">Ta forme par sport</h2><span class="td-pill">100 = ton meilleur</span></div>
    <div class="td-sports">${rows}</div>
    <p class="td-legend"><span><i></i>Prêt à partir de ${READY}</span><span>Touche un sport pour voir le calcul</span></p>
    ${fresh ? `<p class="td-fresh"><span class="td-pill td-pill--${fresh.id}">${fresh.name}</span><span>${esc(fresh.note)}</span></p>` : ''}
  </section>`;
}

function phasesCardHTML(races) {
  if (!races.length) {
    const t = todayKey();
    return `<section class="card td-card"><h2 class="td-h">Mes phases</h2>${timelineHTML(dateKey(addDays(fromKey(t), 56)))}</section>`;
  }
  const i = Math.min(upto, races.length - 1);
  const target = races[i];
  const last = i === races.length - 1;
  const title = i === 0 ? `Jusqu’à ${target.name}` : last && races.length > 2 ? 'Toute la saison' : `Jusqu’à ${target.name}`;
  const btns = [];
  if (!last) btns.push(`<button type="button" class="btn btn--soft btn--sm" data-td="more" data-n="${i + 1}">Voir jusqu’à ${esc(races[i + 1].name)}</button>`);
  if (i + 1 < races.length - 1) btns.push(`<button type="button" class="btn btn--soft btn--sm" data-td="more" data-n="${races.length - 1}">Toute la saison</button>`);
  if (i > 0) btns.push(`<button type="button" class="btn btn--soft btn--sm" data-td="more" data-n="0">Réduire</button>`);
  const weeks = Math.max(1, Math.round(days(todayKey(), target.date) / 7));
  return `<section class="card td-card">
    <div class="td-row"><h2 class="td-h">${esc(title)}</h2><span class="td-pill">${weeks} sem.</span></div>
    ${timelineHTML(target.date)}
    <div class="td-more">${btns.join('')}</div>
  </section>`;
}

function weekHTML() {
  const t = todayKey();
  const monday = dateKey(mondayOf(fromKey(t)));
  const p = phaseOn(t);
  const acts = getActivities().filter(a => a.date >= monday && a.date <= t);
  const hours = acts.reduce((n, a) => n + a.duration, 0) / 3600;
  const hm = s => {
    const m = Math.round(s / 60);
    return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
  };
  let advice = '';
  if (p) {
    const total = Math.max(1, Math.round((days(p.start, p.end) + 1) / 7));
    const w = Math.min(total, Math.floor(days(p.start, t) / 7) + 1);
    advice = `<p class="td-advice"><b>${esc(phaseType(p.type).name)} · semaine ${w} sur ${total}</b>${esc(phaseType(p.type).advice)}</p>`;
  }
  const rows = acts
    .slice()
    .reverse()
    .map(a => {
      const f = family(familyOf(a));
      return `<div class="td-act"><span class="td-act__d">${esc(cap(formatDate(fromKey(a.date), { weekday: 'short' })))}</span><i style="background:${f.color}"></i>
        <span class="td-act__t">${esc(a.title || f.name)}</span><small>${hm(a.duration)}${a.gain ? ` · ${Math.round(a.gain)} m D+` : ''}</small></div>`;
    })
    .join('');
  return `<section class="card td-card">
    <div class="td-row"><h2 class="td-h">Cette semaine</h2><span class="td-muted td-small">${acts.length ? `${String(Math.round(hours * 10) / 10).replace('.', ',')} h · ${acts.length} ${plural(acts.length, 'séance')}` : 'aucune séance'}</span></div>
    ${advice}
    ${rows ? `<div class="td-acts">${rows}</div>` : ''}
  </section>`;
}

function moreHTML() {
  return `<section class="td-links">
    <button type="button" class="td-link" data-td="view" data-view="metricsView">${icon('body', 18)}<span><b>Suivi</b><small>Poids, FTP, mensurations</small></span>${icon('chevronRight', 16)}</button>
  </section>`;
}

/* ---------- Fiche d'un sport ---------- */
function sportSheet(id) {
  const f = formBySport().find(x => x.id === id);
  if (!f) return;
  const st = formStatus(f.score);
  const refMonth = Object.values(f.refDate).sort().at(-1);
  $('#formTitle').textContent = f.name;
  $('#formBody').innerHTML = `
    <div class="td-score"><strong>${f.score}<small> / 100</small></strong><span class="td-pill td-pill--${st.id}">${st.name}</span>
      <span class="td-muted td-small">${f.delta > 0 ? '+' : ''}${f.delta} en 4 semaines</span></div>
    <p class="td-muted">${esc(f.lead)}</p>
    <div class="td-weights">${f.parts.map((p, i) => `<span style="flex:${p.w};background:${f.color};opacity:${[1, 0.75, 0.55, 0.4][i]}">${p.w} %</span>`).join('')}</div>
    <div class="td-recipe">${f.parts
      .map(
        (p, i) => `<div class="td-recipe__row">
        <div class="td-recipe__top"><b>${esc(p.name)}</b><span class="td-muted">${p.v == null ? 'pas de donnée' : `${p.v} / 100`} · compte pour ${p.w} %</span></div>
        <span class="td-meter"><i style="width:${p.v || 0}%;background:${f.color};opacity:${[1, 0.75, 0.55, 0.4][i]}"></i></span>
        <div class="td-recipe__bot"><span>Maintenant : ${valueLabel(p.id, p.now)}</span><span>Ton meilleur : ${valueLabel(p.id, p.best)}</span></div>
      </div>`
      )
      .join('')}</div>
    <p class="td-note">100 = ton meilleur niveau dans ce sport sur les 2 dernières années${refMonth ? ` (le plus récent : ${formatKey(refMonth, { month: 'long', year: 'numeric' })})` : ''}. Chaque sport a sa propre échelle : 60 en course & trail veut dire « 60 % de toi au mieux », pas un chiffre absolu.</p>`;
  openSheet('formSheet', { focus: false });
}

/* ---------- Rendu ---------- */
export function renderToday() {
  const body = $('#todayBody');
  if (!body) return;
  const t = todayKey();
  const races = upcomingRaces();
  let forms = [];
  let fresh = null;
  try {
    forms = formBySport(t);
    fresh = freshness(t);
  } catch (error) {
    console.error('[forme]', error);
  }
  body.innerHTML = `<p class="td-date">${esc(cap(formatKey(t, { weekday: 'long', day: 'numeric', month: 'long' })))}</p>
    ${heroHTML(races[0], forms)}${formHTML(forms, fresh)}${phasesCardHTML(races)}${weekHTML()}${moreHTML()}`;
}

function onClick(e) {
  const b = e.target.closest('[data-td]');
  if (!b) return;
  switch (b.dataset.td) {
    case 'day': return handlers.openDay(b.dataset.key);
    case 'sport': return sportSheet(b.dataset.id);
    case 'more':
      upto = Number(b.dataset.n) || 0;
      return renderToday();
    case 'view': return handlers.openView(b.dataset.view);
    case 'planner': return handlers.openPlanner?.();
  }
}

export function initToday(h) {
  handlers = { ...handlers, ...h };
  $('#todayBody').addEventListener('click', onClick);
}
