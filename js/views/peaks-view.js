/*
 * Analyse › Pics : arriver au pic de forme le jour des courses objectifs.
 * - Prochain pic : forme du jour → forme visée, fraîcheur visée, faisabilité ;
 *   choix de l'objectif quand il y en a plusieurs.
 * - Projection : forme et fraîcheur réelles (12 dernières semaines) puis
 *   prévues jusqu'à la course si le plan est suivi.
 * - Semaine par semaine : heures visées et ce qui compte dans la semaine.
 * - Ta recette : ce qui a précédé tes meilleurs pics (médiane).
 * - Tes pics passés : forme, fraîcheur et score de chaque course, ressenti à
 *   saisir (les courses « Au top » deviennent la référence).
 */
import { esc } from '../core/utils.js';
import { state, commit } from '../core/store.js';
import { addDays, dateKey, formatKey, fromKey, mondayOf } from '../core/dates.js';
import { FEELINGS, SWEET, peakContext, peakPlan, upcomingGoals, withFeeling } from '../core/peaks.js';
import { racePriority } from '../core/planner.js';
import { phaseType } from '../core/season.js';
import { blockOf, BLOCKS, phaseLevel } from '../core/phase-level.js';

const W = 340;
const nf = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = n => `${n > 0 ? '+' : n < 0 ? '−' : ''}${nf(Math.abs(n))}`;
const short = key => formatKey(key, { day: 'numeric', month: 'short' });
const hours = h => (h >= 10 ? `${nf(h)} h` : `${nf(h, 1)} h`).replace(',0 h', ' h');
const dur = h => {
  const m = Math.round(h * 60);
  return m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}` : `${m} min`;
};
const pct = x => `${nf(Math.round(x * 100))}\u202f%`;

let goalId = null; // objectif choisi (null : le prochain)

/* ---------- Ligne « pic de forme » sous la carte objectif de la Saison ---------- */
export function peakHeroLine(race) {
  try {
    const ctx = peakContext();
    if (!ctx.acts.length) return '';
    const plan = peakPlan(race, ctx);
    if (!plan) return '';
    const st = { ok: 'Atteignable', tight: 'Serré', short: 'Ambitieux' }[plan.status];
    return `<button type="button" class="speak" data-act="peaks">
      <span class="speak__k">Pic de forme</span>
      <span class="speak__v">Forme ${nf(plan.now.ctl)} → <b>${nf(plan.target)}</b> · fraîcheur ${signed(plan.targetTsb)} le jour J</span>
      <span class="speak__st is-${plan.status}">${st}</span><span class="speak__go" aria-hidden="true">›</span></button>`;
  } catch (error) {
    console.warn('[pics] ligne objectif', error);
    return '';
  }
}

/* ---------- Graphique : réel puis projection ---------- */
function projectionChart(ctx, plan) {
  const from = dateKey(addDays(fromKey(ctx.today), -84));
  const real = ctx.days.filter(d => d.key >= from && d.key <= ctx.today);
  const proj = [{ key: plan.now.key, ctl: plan.now.ctl, tsb: plan.now.ctl - plan.now.atl }, ...plan.days];
  const end = dateKey(addDays(fromKey(plan.goal.date), 2));
  const t0 = fromKey(real.length ? real[0].key : ctx.today).getTime();
  const span = Math.max(1, (fromKey(end).getTime() - t0) / 864e5);
  const x0 = 28;
  const x1 = W - 8;
  const X = key => x0 + ((x1 - x0) * (fromKey(key).getTime() - t0)) / 864e5 / span;
  const mx = Math.max(10, plan.target, plan.reach, ...real.map(d => d.ctl)) * 1.15;
  const y0 = 14;
  const y1 = 130;
  const Y = v => y1 - ((y1 - y0) * v) / mx;
  const tb = 172;
  const tMax = Math.max(25, ...real.map(d => Math.abs(d.tsb)), ...plan.days.map(d => Math.abs(d.tsb)));
  const T = v => tb - (24 * v) / tMax;
  const path = pts => pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
  let svg = '';
  // Affûtage : bande dorée ; zone de fraîcheur idéale sous la ligne zéro.
  const taperStart = plan.days.find(d => d.kind === 'taper')?.key;
  if (taperStart) svg += `<rect x="${X(taperStart)}" y="${y0}" width="${Math.max(2, X(plan.goal.date) - X(taperStart))}" height="${tb + 26 - y0}" class="pk-taper"/>`;
  svg += `<rect x="${x0}" y="${T(SWEET.max)}" width="${x1 - x0}" height="${T(SWEET.min) - T(SWEET.max)}" class="pk-sweet"/>`;
  [0, Math.round(mx / 2), Math.round(mx / 1.15)].forEach(v => (svg += `<line x1="${x0}" x2="${x1}" y1="${Y(v)}" y2="${Y(v)}" class="an-grid"/>${v ? `<text x="${x0 - 4}" y="${Y(v) + 3}" text-anchor="end">${v}</text>` : ''}`));
  svg += `<line x1="${x0}" x2="${x1}" y1="${tb}" y2="${tb}" class="an-grid"/><text x="${x0 - 4}" y="${tb + 3}" text-anchor="end">0</text>`;
  // Forme visée.
  svg += `<line x1="${x0}" x2="${x1}" y1="${Y(plan.target)}" y2="${Y(plan.target)}" class="pk-target"/><text x="${x0 + 2}" y="${Y(plan.target) - 4}" class="pk-label">visée ${nf(plan.target)}</text>`;
  if (real.length > 1) {
    svg += `<path d="${path(real.map(d => [X(d.key), T(d.tsb)]))}" class="pk-tsb"/>`;
    svg += `<path d="${path(real.map(d => [X(d.key), Y(d.ctl)]))}" class="pk-ctl"/>`;
  }
  svg += `<path d="${path(proj.map(d => [X(d.key), T(d.tsb)]))}" class="pk-tsb is-proj"/>`;
  svg += `<path d="${path(proj.map(d => [X(d.key), Y(d.ctl)]))}" class="pk-ctl is-proj"/>`;
  // Aujourd'hui, course, pics passés visibles.
  svg += `<line x1="${X(ctx.today)}" x2="${X(ctx.today)}" y1="${y0}" y2="${tb + 24}" class="pk-today"/><text x="${X(ctx.today) + 3}" y="${y0 + 2}" class="an-svg-strong">auj.</text>`;
  const rx = X(plan.goal.date);
  svg += `<circle cx="${rx}" cy="${Y(plan.reach)}" r="5" class="pk-race"/><text x="${rx - 4}" y="${Y(plan.reach) - 9}" text-anchor="end" class="an-svg-strong">${nf(plan.reach)}</text>`;
  svg += `<circle cx="${rx}" cy="${T(plan.tsb)}" r="4" class="pk-race pk-race--tsb"/><text x="${rx - 6}" y="${T(plan.tsb) - 6}" text-anchor="end" class="an-svg-strong">${signed(Math.round(plan.tsb))}</text>`;
  ctx.peaks
    .filter(p => p.date >= from)
    .forEach(p => (svg += `<circle cx="${X(p.date)}" cy="${Y(p.ctl)}" r="3.5" class="pk-past"><title>${esc(p.race.name)} · forme ${nf(p.ctl)}</title></circle>`));
  // Repères de mois.
  for (let d = new Date(fromKey(from).getFullYear(), fromKey(from).getMonth() + 1, 1, 12); dateKey(d) <= end; d = new Date(d.getFullYear(), d.getMonth() + 1, 1, 12)) {
    svg += `<text x="${X(dateKey(d))}" y="${tb + 36}" text-anchor="middle">${formatKey(dateKey(d), { month: 'short' })}</text>`;
  }
  return `<svg viewBox="0 0 ${W} 214" role="img" aria-label="Forme et fraîcheur : réel puis prévu jusqu’à la course">${svg}</svg>`;
}

/* ---------- Semaine par semaine ---------- */
function weekFocus(w, plan) {
  const r = plan.recipe;
  const long = r?.longest >= 1 ? `sortie longue jusqu’à ${dur(r.longest)}` : 'une sortie longue';
  if (w.kind === 'race') return 'Semaine de course : séances courtes avec quelques accélérations, repos ou déblocage la veille.';
  if (w.kind === 'taper') return `Affûtage : volume −${pct(plan.cut)}, deux rappels courts à l’allure course, sommeil.`;
  if (w.kind === 'light') return 'Semaine allégée (−30 %) : assimiler la charge, pas d’intensité longue.';
  const t = w.phase?.type;
  if (t === 'base') return `Endurance, ${long}, renfo.`;
  if (t === 'buildVolume') return `Volume spécifique : ${long}, enchaînement sur deux jours.`;
  if (t === 'buildIntensity' || t === 'buildRace' || t === 'build') return `Deux séances dures (seuil, VO₂max) + ${long}.`;
  if (t === 'recovery' || t === 'transition') return 'Récupération : court et facile.';
  return `Charge en hausse : ${long}${r?.hardShare ? `, environ ${pct(r.hardShare)} du temps en dur` : ''}.`;
}

function weeksCard(plan, today) {
  const max = Math.max(1, ...plan.weeks.map(w => w.hours));
  const thisMonday = dateKey(mondayOf(fromKey(today)));
  const level = phaseLevel();
  const rows = plan.weeks
    .map(w => {
      const kind = { build: 'Charge', light: 'Allégée', taper: 'Affûtage', race: 'Course' }[w.kind];
      let ph = '';
      if (w.phase) {
        const name = level === 1 ? BLOCKS[blockOf(w.phase.type)].short : phaseType(w.phase.type).short;
        ph = `<span class="pk-wk__ph ${level === 1 ? `phase--blk-${blockOf(w.phase.type)}` : `phase--${w.phase.type}`}"><i class="phase-dot"></i>${esc(name)}</span>`;
      }
      return `<li class="pk-wk is-${w.kind}${w.monday === thisMonday ? ' is-now' : ''}">
        <div class="pk-wk__head"><strong>${w.monday === thisMonday ? 'Cette semaine' : `Sem. du ${short(w.monday)}`}</strong>${ph}<span class="pk-wk__kind">${kind}</span></div>
        <div class="pk-wk__bar"><i style="width:${Math.max(4, (w.hours / max) * 100)}%"></i><b>${w.partial && w.monday === thisMonday ? `${hours(w.hours)} d’ici dimanche` : hours(w.hours)}</b></div>
        <p>${esc(weekFocus(w, plan))}</p></li>`;
    })
    .join('');
  return `<section class="card an-card"><header><h2 class="card__title">Semaine par semaine</h2><p class="card__sub">Heures visées pour suivre la courbe, d’après ta charge moyenne par heure (${nf(plan.lph)} par heure)</p></header><ol class="pk-weeks">${rows}</ol></section>`;
}

/* ---------- Recette ---------- */
function recipeCard(ctx) {
  const r = ctx.recipe;
  if (!r) {
    return `<section class="card an-card"><header><h2 class="card__title">Ta recette de pic</h2></header>
      <p class="an-note">Aucune course passée à analyser pour l’instant. Les courses de ta saison (avec au moins 8 semaines d’activités Strava avant) servent de référence : ajoute-les dans Saison, même terminées. En attendant, la forme visée est 95 % de ton plus haut des 12 derniers mois.</p></section>`;
  }
  const tile = (v, l, d = '') => `<div class="pk-tile"><strong>${v}</strong><span>${l}</span>${d ? `<small>${d}</small>` : ''}</div>`;
  return `<section class="card an-card"><header><h2 class="card__title">Ta recette de pic</h2><p class="card__sub">Médiane de ${r.count > 1 ? `tes ${r.count} meilleurs pics` : 'ton meilleur pic'} : ${r.names.map(esc).join(', ')}${r.fromFeeling ? ' (courses « Au top »)' : ''}</p></header>
    <div class="pk-tiles">
      ${tile(nf(r.ctl), 'Forme le jour J', 'charge des 42 derniers jours')}
      ${tile(signed(Math.round(r.tsb)), 'Fraîcheur le jour J', 'forme − fatigue, le matin')}
      ${tile(hours(r.buildHours), 'Par semaine', `de J−8 à J−2 sem., pic ${hours(r.maxWeek)}`)}
      ${tile(`${r.ramp >= 0 ? '+' : '−'}${nf(Math.abs(r.ramp), 1)}`, 'Forme par semaine', 'progression en préparation')}
      ${tile(dur(r.longest), 'Plus longue séance', 'dans les 8 semaines')}
      ${tile(`${r.taperDays} j`, 'Affûtage', r.cut > 0.05 ? `dernière semaine −${pct(r.cut)}` : 'sans vraie baisse de volume')}
    </div>
    <p class="an-note">Phases automatiques reprend cette durée d’affûtage dès que deux pics au moins servent de référence.</p></section>`;
}

/* ---------- Pics passés ---------- */
function pastCard(ctx) {
  if (!ctx.peaks.length) return '';
  const best = new Set(ctx.best.map(p => p.race.id));
  const rows = ctx.peaks
    .map(p => {
      const fr = p.tsb >= SWEET.min && p.tsb <= SWEET.max ? 'good' : p.tsb < -10 ? 'bad' : 'warn';
      return `<li class="pk-past-row${best.has(p.race.id) ? ' is-best' : ''}">
        <div class="pk-past-row__top"><span class="pk-past-row__name"><strong>${esc(p.race.name)}</strong><small>${formatKey(p.date, { day: 'numeric', month: 'short', year: 'numeric' })}${p.priority === 'A' ? ' · objectif' : ''}${best.has(p.race.id) ? ' · référence' : ''}</small></span>
          <span class="pk-score" style="--v:${p.score}"><b>${p.score}</b></span></div>
        <div class="pk-past-row__nums"><span>Forme <b>${nf(p.ctl)}</b> <small>/ ${nf(p.yearMax)} max</small></span><span class="an-pill an-pill--${fr}">fraîcheur ${signed(Math.round(p.tsb))}</span><span>${hours(p.buildHours)}/sem</span><span>affûtage ${p.taperDays} j</span></div>
        <div class="segmented pk-feel" role="radiogroup" aria-label="Ressenti sur ${esc(p.race.name)}">${FEELINGS.map(f => `<button type="button" role="radio" data-feeling="${f.id}" data-race="${esc(p.race.id)}" aria-checked="${p.feeling === f.id}">${f.name}</button>`).join('')}</div>
      </li>`;
    })
    .join('');
  return `<section class="card an-card"><header><h2 class="card__title">Tes pics passés</h2><p class="card__sub">Score : forme du jour rapportée à ton plus haut de l’année, réduite si la fraîcheur sort de +5 à +25. Ton ressenti prime : les courses « Au top » deviennent la référence.</p></header><ul class="pk-past-list">${rows}</ul></section>`;
}

/* ---------- Rendu ---------- */
export function renderPeaks(host) {
  const ctx = peakContext();
  if (!ctx.acts.length) {
    host.innerHTML = `<section class="card an-card an-start"><h2 class="card__title">Pics de forme</h2><p class="an-note">Connecte Strava (bouton en haut) : tes séances servent à repérer tes pics de forme passés et à calculer le chemin jusqu’à tes prochains objectifs.</p></section>`;
    return;
  }
  const goals = upcomingGoals(ctx.today).slice(0, 6);
  if (goalId && !goals.some(g => g.id === goalId)) goalId = null;
  const goal = goals.find(g => g.id === goalId) || goals[0] || null;
  const plan = goal ? peakPlan(goal, ctx) : null;
  let head;
  if (!goal) {
    head = `<section class="card an-card pk-hero pk-hero--empty"><span class="pk-hero__k">Prochain pic</span><h2 class="pk-hero__t">Aucune course à venir</h2><p class="pk-hero__m">Choisis tes courses dans l’onglet Courses et classe tes objectifs (Phases automatiques) : le plan pour arriver au pic s’affiche ici.</p></section>`;
  } else if (!plan) {
    head = `<section class="card an-card pk-hero"><span class="pk-hero__k">${esc(goal.name)}</span><h2 class="pk-hero__t">C’est maintenant</h2><p class="pk-hero__m">Moins de 3 jours avant la course : repos, sommeil et quelques accélérations courtes.</p></section>`;
  } else {
    const msg = {
      ok: `En gagnant <b>${plan.ramp >= 0 ? '+' : '−'}${nf(Math.abs(plan.ramp), 1)}</b> de forme par semaine, tu arrives à ${nf(plan.reach)} le jour J : c’est atteignable.`,
      tight: `Ça se joue : vise <b>+${nf(plan.ramp, 1)}</b> de forme par semaine (sans dépasser +${nf(plan.maxRamp, 1)}) pour arriver à ${nf(plan.reach)}.`,
      short: `Objectif ambitieux : au rythme sûr de +${nf(plan.maxRamp, 1)} par semaine, tu arriverais à ${nf(plan.reach)} sur ${nf(plan.target)}. Mieux vaut arriver frais que trop chargé.`
    }[plan.status];
    const chips = goals.length > 1
      ? `<div class="pk-goals" role="radiogroup" aria-label="Objectif">${goals.map(g => `<button type="button" role="radio" class="chip-btn" data-peak-goal="${esc(g.id)}" aria-checked="${g.id === goal.id}">${esc(g.name)} <small>${short(g.date)}</small></button>`).join('')}</div>`
      : '';
    head = `${chips}<section class="card an-card pk-hero">
      <span class="pk-hero__k">${racePriority(goal.id) === 'A' ? 'Prochain pic' : 'Prochaine course'} · J−${plan.left}</span>
      <h2 class="pk-hero__t">${esc(goal.name)}</h2>
      <div class="pk-hero__nums">
        <div><span>Aujourd’hui</span><strong>${nf(plan.now.ctl)}</strong></div>
        <div><span>Visée</span><strong>${nf(plan.target)}</strong></div>
        <div><span>Fraîcheur J</span><strong>${signed(plan.targetTsb)}</strong></div>
      </div>
      <p class="pk-hero__m">${msg}</p>
      <p class="pk-hero__m">Affûtage de ${plan.taperDays} jours à partir du ${short(dateKey(addDays(fromKey(goal.date), -plan.taperDays)))}, volume −${pct(plan.cut)}.</p>
    </section>
    <section class="card an-card"><header><h2 class="card__title">Projection</h2><p class="card__sub">Forme (haut) et fraîcheur (bas) : réel, puis prévu en pointillé si tu suis le plan</p></header>
      <div class="an-legend"><span><i style="background:var(--an-ctl)"></i>Forme</span><span><i style="background:var(--an-tsb)"></i>Fraîcheur</span><span><i class="pk-leg-sweet"></i>Fraîcheur idéale (+5 à +25)</span><span><i class="pk-leg-taper"></i>Affûtage</span></div>
      ${projectionChart(ctx, plan)}</section>
    ${weeksCard(plan, ctx.today)}`;
  }
  host.innerHTML = head + recipeCard(ctx) + pastCard(ctx);
}

/** Clic dans la vue Pics : true si traité (la vue doit être redessinée). */
export function onPeaksClick(e) {
  const g = e.target.closest('[data-peak-goal]');
  if (g) {
    goalId = g.dataset.peakGoal;
    return true;
  }
  const f = e.target.closest('[data-feeling]');
  if (f) {
    state.objectives = withFeeling(f.dataset.race, f.dataset.feeling);
    commit('objectives');
    return true;
  }
  return false;
}

