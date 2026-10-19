/*
 * Analyse › Plan : phase de la semaine choisie, volume cible semaine par semaine
 * (et réalisé), et liste des phases, modifiables à la main.
 */
import { esc } from '../core/utils.js';
import { addDays, dateKey, formatKey, fromKey, mondayOf, todayKey, daysUntil } from '../core/dates.js';
import { planHorizon, planWeek, referenceHours } from '../core/plan.js';
import { analysisSettings } from '../core/training.js';
import { getPhases, phaseType } from '../core/season.js';

const nf = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const dur = min => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${String(Math.round(min % 60)).padStart(2, '0')}` : ''}` : `${Math.round(min)} min`);
const short = key => formatKey(key, { day: 'numeric', month: 'short' });
const W = 340;

let weekKey = null; // lundi de la semaine affichée (null : semaine en cours)

/** Heures faites par semaine (lundi -> heures). */
function doneByWeek(activities) {
  const m = new Map();
  for (const a of activities) {
    const w = dateKey(mondayOf(fromKey(a.date)));
    m.set(w, (m.get(w) || 0) + a.duration / 3600);
  }
  return m;
}

function volumeChart(weeks, done, selected, today) {
  const n = weeks.length;
  const mx = Math.max(1, ...weeks.map(w => Math.max(w.target, done.get(w.monday) || 0))) * 1.1;
  const x0 = 26;
  const y1 = 120;
  const bw = (W - 4 - x0) / n;
  const H = v => (106 * v) / mx;
  const thisMonday = dateKey(mondayOf(fromKey(today)));
  let svg = '';
  const step = mx > 12 ? 5 : mx > 6 ? 2 : 1;
  for (let v = step; v < mx; v += step) svg += `<line x1="${x0}" x2="${W - 4}" y1="${y1 - H(v)}" y2="${y1 - H(v)}" class="an-grid"/><text x="${x0 - 4}" y="${y1 - H(v) + 3}" text-anchor="end">${v}h</text>`;
  weeks.forEach((w, i) => {
    const x = x0 + i * bw;
    const color = w.type.color;
    const h = H(w.target);
    const real = done.get(w.monday) || 0;
    const sel = w.monday === selected;
    svg += `<g class="pl-bar${sel ? ' is-sel' : ''}" data-week="${w.monday}">`;
    svg += `<rect x="${x + 1}" y="${y1 - h}" width="${bw - 2}" height="${h}" rx="2" fill="${color}" opacity="${sel ? 0.55 : 0.28}"/>`;
    if (w.monday <= thisMonday && real > 0) svg += `<rect x="${x + bw * 0.25}" y="${y1 - H(real)}" width="${bw * 0.5}" height="${H(real)}" rx="1.5" class="pl-done"/>`;
    svg += `<rect x="${x}" y="0" width="${bw}" height="${y1 + 18}" fill="transparent"><title>Semaine du ${short(w.monday)} · ${esc(w.type.short)} : cible ${nf(w.target, 1)} h${real ? `, fait ${nf(real, 1)} h` : ''}</title></rect></g>`;
    if (w.goal && w.goal.date >= w.monday && w.goal.date <= dateKey(addDays(fromKey(w.monday), 6))) svg += `<circle cx="${x + bw / 2}" cy="${y1 - h - 6}" r="3.5" class="pl-goal"/>`;
    if (w.monday === thisMonday) svg += `<text x="${x + bw / 2}" y="${y1 + 13}" text-anchor="middle" class="an-svg-strong">▲</text>`;
    else if (i % Math.ceil(n / 6) === 0) svg += `<text x="${x + bw / 2}" y="${y1 + 13}" text-anchor="middle">${short(w.monday)}</text>`;
  });
  return `<svg viewBox="0 0 ${W} 136" role="img" aria-label="Volume cible et réalisé par semaine">${svg}</svg>`;
}

/* Phases en cours et à venir, chacune modifiable (dates, type, note). */
function phasesCard(phases, today) {
  const list = phases.filter(p => p.end >= today);
  const rows = list
    .map(p => {
      const t = phaseType(p.type);
      const weeks = Math.round((fromKey(p.end) - fromKey(p.start)) / (7 * 864e5) + 1 / 7);
      return `<li><button type="button" class="pl-phase" data-edit-phase="${esc(p.id)}" style="--ph:${t.color}">
        <i></i><span><strong>${esc(t.name)}</strong><small>${short(p.start)} → ${short(p.end)} · ${weeks} sem.${p.note ? ` · ${esc(p.note)}` : ''}</small></span><span class="pl-phase__e">Modifier</span></button></li>`;
    })
    .join('');
  return `<section class="card an-card"><header><h2 class="card__title">Phases</h2><p class="card__sub">Touche une phase pour changer ses dates, son type ou la supprimer</p></header>
    <ul class="pl-phases">${rows}</ul>
    <div class="pl-actions"><button type="button" class="btn btn--sm" data-action="add-phase">Ajouter une phase</button><button type="button" class="btn btn--sm" data-action="planner">Phases automatiques</button></div></section>`;
}

/** Rendu de la partie Plan dans `host`. */
export function renderPlan(host, activities) {
  const today = todayKey();
  const thisMonday = dateKey(mondayOf(fromKey(today)));
  const phases = getPhases();
  const current = phases.find(p => p.start <= today && today <= p.end);
  const upcoming = phases.find(p => p.start > today);
  if (!current && !upcoming) {
    host.innerHTML = `<section class="card an-card an-start"><h2 class="card__title">Aucune phase à venir</h2>
      <p class="an-note">Le plan s’appuie sur tes phases. Place-les automatiquement selon tes courses objectifs, ou ajoute-les à la main.</p>
      <div class="pl-actions"><button type="button" class="btn btn--primary btn--sm" data-action="planner">Phases automatiques</button><button type="button" class="btn btn--sm" data-action="add-phase">Ajouter une phase</button></div></section>`;
    return;
  }
  const ref = referenceHours(activities, today);
  const firstMonday = dateKey(mondayOf(fromKey((current || upcoming).start)));
  const weeks = planHorizon(firstMonday, 40)
    .map(m => planWeek(m, ref))
    .filter(Boolean);
  if (!weeks.length) {
    host.innerHTML = '<p class="an-empty card">Aucune semaine de plan.</p>';
    return;
  }
  const defaultWeek = weeks.find(w => w.monday === thisMonday) ? thisMonday : weeks[0].monday;
  if (!weekKey || !weeks.some(w => w.monday === weekKey)) weekKey = defaultWeek;
  const week = weeks.find(w => w.monday === weekKey);
  const done = doneByWeek(activities);
  const real = done.get(week.monday) || 0;
  const goal = week.goal;
  const days = goal ? daysUntil(goal.date) : null;
  const s = analysisSettings();

  host.innerHTML = `
    <section class="card an-card pl-hero" style="--ph:${week.type.color}">
      <span class="pl-hero__k">Semaine du ${short(week.monday)} · ${week.index + 1} sur ${week.count}${week.light ? ' · semaine allégée' : ''}</span>
      <h2 class="pl-hero__t">${esc(week.type.name)}</h2>
      <p class="pl-hero__m">${short(week.phase.start)} → ${short(week.phase.end)}${goal ? ` · objectif <strong>${esc(goal.name)}</strong>${days !== null && days >= 0 ? ` J−${days}` : ''}` : ''}</p>
      <p class="pl-hero__m">Cible ${dur(week.target * 60)}${real ? ` · fait ${dur(real * 60)}` : ''}</p>
      ${week.type.advice ? `<p class="pl-hero__a">${esc(week.type.advice)}</p>` : ''}
      <button type="button" class="btn btn--sm pl-hero__b" data-edit-phase="${esc(week.phase.id)}">Modifier cette phase</button>
    </section>

    <section class="card an-card"><header><h2 class="card__title">Volume</h2><p class="card__sub">Cible par semaine (barre claire) et réalisé (barre pleine) ; touche une semaine pour l’afficher</p></header>
      ${volumeChart(weeks, done, week.monday, today)}
      <p class="an-note">Référence : ${nf(ref, 1)} h/sem (${s.weeklyHours ? 'réglage' : 'moyenne de tes 12 derniers mois'}), modulée selon la phase, une semaine sur quatre allégée.</p>
    </section>
    ${phasesCard(phases, today)}`;
}

/** Semaine choisie dans le graphique ou avec ‹ ›. */
export function selectPlanWeek(monday) {
  if (monday) weekKey = monday;
}
