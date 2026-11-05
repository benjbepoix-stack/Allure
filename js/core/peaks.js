/*
 * Pics de forme : ce qui a précédé tes meilleures courses, et comment
 * reproduire ce pic pour les prochains objectifs.
 *
 * 1. Chaque course passée (sauf « Ne compte pas ») est analysée à partir de la
 *    série quotidienne forme / fatigue / fraîcheur (TRIMP de Banister) :
 *    forme et fraîcheur le matin, forme par rapport au plus haut des 12 mois
 *    précédents, volume et progression des 6 semaines de préparation
 *    (J−56 → J−15), longueur et ampleur de l'affûtage, plus longue séance.
 * 2. Score du pic = forme du jour / plus haut de l'année × facteur de fraîcheur
 *    (1 entre +5 et +25). Le ressenti saisi (« Au top », « Correct », « À
 *    oublier », stocké dans objectives.raceFeeling) prime : les courses « Au
 *    top » forment la référence, sinon les 3 meilleurs scores.
 * 3. Recette = médiane de ces pics. Plan vers l'objectif : progression de la
 *    forme semaine par semaine (plafonnée), une semaine allégée sur quatre,
 *    affûtage de la durée de la recette, réduction de volume choisie pour
 *    arriver à la fraîcheur de la recette ; projection jour par jour.
 *
 * Tout est calculé sur l'appareil, rien n'est enregistré à part le ressenti.
 */
import { state } from './store.js';
import { addDays, dateKey, fromKey, mondayOf, todayKey } from './dates.js';
import { clamp, parseNumber } from './utils.js';
import { analysisSettings, dailySeries, trimp, zoneOf } from './training.js';
import { racePriority } from './planner.js';
import { getActivities } from './activities.js';
import { getPhases, phaseOn } from './season.js';

export const FEELING_KEY = 'raceFeeling';
export const FEELINGS = [
  { id: 'good', name: 'Au top' },
  { id: 'ok', name: 'Correct' },
  { id: 'bad', name: 'À oublier' }
];

export function raceFeeling(id) {
  const f = state.objectives?.[FEELING_KEY]?.[id];
  return FEELINGS.some(x => x.id === f) ? f : '';
}

/** Nouvelle valeur du nœud objectives avec le ressenti `f` (même valeur : retiré). */
export function withFeeling(id, f) {
  const map = { ...(state.objectives?.[FEELING_KEY] || {}) };
  for (const k of Object.keys(map)) if (!state.races.some(r => r.id === k)) delete map[k];
  if (!f || map[id] === f) delete map[id];
  else map[id] = f;
  return { ...state.objectives, [FEELING_KEY]: map };
}

/* Fraîcheur visée le jour J : entre +5 et +25. */
export const SWEET = { min: 5, max: 25 };
export const freshFactor = tsb => (tsb >= SWEET.min && tsb <= SWEET.max ? 1 : Math.max(0.3, 1 - (tsb < SWEET.min ? SWEET.min - tsb : tsb - SWEET.max) / 40));

const sum = (list, f = x => x) => list.reduce((n, x) => n + f(x), 0);
const avg = (list, f) => (list.length ? sum(list, f) / list.length : 0);
const median = list => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const between = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);

/** Course longue (≥ 60 km ou ≥ 2 500 m D+), moyenne (≥ 21 km ou ≥ 1 000 m) ou courte. */
export function raceSize(race) {
  const km = parseNumber(race.distance) || 0;
  const dplus = parseNumber(race.elevation) || 0;
  return km >= 60 || dplus >= 2500 ? 'long' : km >= 21 || dplus >= 1000 ? 'mid' : 'short';
}
const DEFAULT_TAPER = { long: 14, mid: 10, short: 7 };

/* ---------- Analyse des courses passées ---------- */
function analyzeRace(r, days, index, acts, s) {
  const i = index.get(r.date);
  if (i === undefined || i < 56) return null; // 8 semaines de données au moins
  const d = days[i];
  let yearMax = 0;
  for (let k = Math.max(0, i - 365); k <= i; k++) yearMax = Math.max(yearMax, days[k].ctl);
  const build = days.slice(i - 56, i - 14);
  const buildLoad = avg(build, x => x.load);
  let maxWeek = 0;
  for (let w = 2; w < 8; w++) maxWeek = Math.max(maxWeek, sum(days.slice(i - 7 * (w + 1), i - 7 * w), x => x.minutes) / 60);
  // Affûtage : jours depuis la dernière semaine glissante encore à 90 % de la charge de préparation.
  let taperDays = 21;
  for (let k = i - 1; k >= i - 21; k--) {
    if (avg(days.slice(k - 6, k + 1), x => x.load) >= 0.9 * buildLoad) {
      taperDays = i - 1 - k;
      break;
    }
  }
  const from = days[i - 56].key;
  const before = acts.filter(a => a.date >= from && a.date < r.date);
  const minutes = sum(before, a => a.duration / 60);
  const hard = sum(before.filter(a => zoneOf(a, s) === 'hard'), a => a.duration / 60);
  return {
    race: r,
    date: r.date,
    ctl: d.ctl,
    tsb: d.tsb,
    yearMax,
    buildHours: sum(build, x => x.minutes) / 60 / 6,
    maxWeek,
    ramp: (days[i - 14].ctl - days[i - 56].ctl) / 6,
    taperDays,
    cut: buildLoad > 0 ? clamp(1 - avg(days.slice(i - 7, i), x => x.load) / buildLoad, -1, 1) : 0,
    longest: before.length ? Math.max(...before.map(a => a.duration)) / 3600 : 0,
    hardShare: minutes ? hard / minutes : 0,
    score: yearMax > 0 ? Math.round(100 * Math.min(1, d.ctl / yearMax) * freshFactor(d.tsb)) : 0,
    feeling: raceFeeling(r.id),
    priority: racePriority(r.id)
  };
}

/** Courses passées analysées, la plus récente en premier (24 derniers mois). */
export function pastPeaks(acts, days, s = analysisSettings(), today = todayKey()) {
  if (!days.length) return [];
  const index = new Map(days.map((d, i) => [d.key, i]));
  const since = dateKey(addDays(fromKey(today), -730));
  // Une seule course par jour : la plus importante (A, puis B).
  const byDay = new Map();
  for (const r of state.races) {
    if (r.date >= today || r.date < since || racePriority(r.id) === 'C') continue;
    const cur = byDay.get(r.date);
    if (!cur || racePriority(r.id) < racePriority(cur.id)) byDay.set(r.date, r);
  }
  return [...byDay.values()]
    .map(r => analyzeRace(r, days, index, acts, s))
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Pics de référence : les courses « Au top », sinon les 3 meilleurs scores (hors « À oublier »). */
export function bestPeaks(peaks) {
  const good = peaks.filter(p => p.feeling === 'good');
  const pool = good.length ? good : peaks.filter(p => p.feeling !== 'bad');
  return [...pool].sort((a, b) => b.score - a.score).slice(0, good.length ? 5 : 3);
}

/** Recette : médiane des pics de référence (null sans pic). */
export function recipeOf(best) {
  if (!best.length) return null;
  const m = f => median(best.map(f));
  return {
    count: best.length,
    names: best.map(p => p.race.name),
    fromFeeling: best.every(p => p.feeling === 'good'),
    ctl: m(p => p.ctl),
    tsb: m(p => p.tsb),
    buildHours: m(p => p.buildHours),
    maxWeek: m(p => p.maxWeek),
    ramp: m(p => p.ramp),
    taperDays: Math.round(m(p => p.taperDays)),
    cut: m(p => p.cut),
    longest: m(p => p.longest),
    hardShare: m(p => p.hardShare)
  };
}

/** Charge (TRIMP) moyenne par heure d'entraînement sur les 120 derniers jours. */
export function loadPerHour(acts, s, today = todayKey()) {
  const from = dateKey(addDays(fromKey(today), -120));
  const recent = acts.filter(a => a.date >= from && a.date <= today);
  const h = sum(recent, a => a.duration) / 3600;
  return h >= 5 ? sum(recent, a => trimp(a, s)) / h : 50;
}

/* ---------- Plan vers un objectif ---------- */
/* Simule forme et fatigue jour par jour à partir de l'état du soir `start`. */
function simulate(start, loads) {
  let { ctl, atl } = start;
  return loads.map(l => {
    const tsb = ctl - atl; // fraîcheur du matin
    ctl += (l.load - ctl) / 42;
    atl += (l.load - atl) / 7;
    return { ...l, ctl, atl, tsb };
  });
}

/**
 * Plan pour arriver au pic le jour de la course `goal`.
 * @returns {null | {goal, left, target, targetTsb, ramp, maxRamp, taperDays, cut, reach, tsb, status, weeks, days, lph, recipe}}
 */
export function peakPlan(goal, { acts, days, s, recipe, today = todayKey() }) {
  if (!goal || !days.length) return null;
  const left = between(today, goal.date); // jours avant la course
  if (left < 3) return null;
  const last = days[days.length - 1].key === today ? days[days.length - 1] : days.find(d => d.key === today) || days[days.length - 1];
  let yearMax = 0;
  for (const d of days.slice(-365)) yearMax = Math.max(yearMax, d.ctl);
  const lph = loadPerHour(acts, s, today);
  const target = Math.max(recipe ? recipe.ctl : yearMax * 0.95, 1);
  const targetTsb = clamp(Math.round(recipe ? recipe.tsb : 12), SWEET.min + 3, SWEET.max - 5);
  const taperDays = Math.min(left - 1, clamp(recipe?.taperDays >= 4 ? recipe.taperDays : DEFAULT_TAPER[raceSize(goal)], 5, 21));
  const maxRamp = clamp(recipe && recipe.ramp > 0 ? recipe.ramp * 1.25 : 4, 3, 7);
  const buildDays = left - 1 - taperDays; // préparation, puis affûtage jusqu'à la veille
  const day = d => dateKey(addDays(fromKey(today), d));
  const firstMonday = mondayOf(fromKey(today));

  /* Préparation : charge du jour = forme + 6 × progression hebdomadaire voulue ; la 4e, la 8e… semaine
     calendaire à 70 %. Affûtage : réduction choisie pour arriver à la fraîcheur visée le matin de la course. */
  const run = ramp => {
    const build = [];
    let ctl = last.ctl;
    for (let d = 1; d <= buildDays; d++) {
      const w = Math.round((mondayOf(addDays(fromKey(today), d)) - firstMonday) / (7 * 864e5));
      const light = buildDays >= 28 && w % 4 === 3;
      const load = Math.max(0, (ctl + 6 * ramp) * (light ? 0.7 : 1));
      ctl += (load - ctl) / 42;
      build.push({ key: day(d), load, kind: light ? 'light' : 'build' });
    }
    const base = build.length ? avg(build.slice(-14), x => x.load) : Math.max(last.ctl, 1);
    let best = null;
    for (let cut = 0.2; cut <= 0.71; cut += 0.05) {
      const taper = Array.from({ length: taperDays }, (_, k) => ({ key: day(buildDays + k + 1), load: base * (1 - cut) * (k >= taperDays - 2 ? 0.6 : 1), kind: 'taper' }));
      const sim = simulate(last, [...build, ...taper]);
      const end = sim[sim.length - 1];
      const tsb = end.ctl - end.atl; // matin de la course
      if (!best || Math.abs(tsb - targetTsb) < Math.abs(best.tsb - targetTsb)) best = { cut, sim, tsb, reach: end.ctl };
    }
    return best;
  };
  // Plus petite progression qui atteint la forme visée (pas de 0,1), plafonnée à `maxRamp`.
  let ramp = maxRamp;
  let best = run(maxRamp);
  const need = best.reach >= target ? null : maxRamp + 1; // au-delà du plafond
  if (best.reach >= target) {
    for (let r = -3; r <= maxRamp; r = Math.round((r + 0.1) * 10) / 10) {
      const b = run(r);
      if (b.reach >= target * 0.995) {
        ramp = r;
        best = b;
        break;
      }
    }
  }
  const raceDay = { key: goal.date, load: 0, kind: 'race' };
  const sim = [...best.sim, { ...raceDay, ctl: best.reach, atl: best.reach - best.tsb, tsb: best.tsb }];
  const needRamp = need ?? ramp;

  // Semaines (lundi → dimanche) : heures cibles, type, phase de la saison.
  const phases = getPhases();
  const byWeek = new Map();
  for (const d of sim) {
    const monday = dateKey(mondayOf(fromKey(d.key)));
    const w = byWeek.get(monday) || { monday, load: 0, days: 0, kinds: new Set(), race: false, end: null };
    w.load += d.load;
    w.days++;
    w.kinds.add(d.kind);
    if (d.kind === 'race') w.race = true;
    w.end = d;
    byWeek.set(monday, w);
  }
  const weeks = [...byWeek.values()].map(w => {
    const kind = w.race ? 'race' : w.kinds.has('taper') ? 'taper' : w.kinds.has('light') ? 'light' : 'build';
    const phase = phaseOn(dateKey(addDays(fromKey(w.monday), 3)), phases);
    return { monday: w.monday, hours: w.load / lph, partial: w.days < 7, kind, phase, ctl: w.end.ctl, tsb: w.end.ctl - w.end.atl };
  });
  const status = best.reach >= target * 0.99 ? (ramp > maxRamp * 0.8 ? 'tight' : 'ok') : best.reach >= target * 0.9 ? 'tight' : 'short';
  return { goal, left, now: last, target, targetTsb, ramp, need: needRamp, maxRamp, taperDays, cut: best.cut, reach: best.reach, tsb: best.tsb, status, weeks, days: sim, lph, recipe, yearMax };
}

/* ---------- Contexte (mémorisé) ---------- */
let memo = { key: '', value: null };

/** Activités, série, pics passés, pics de référence et recette. */
export function peakContext() {
  const acts = getActivities();
  const s = analysisSettings();
  const today = todayKey();
  const key = [acts.length, acts[acts.length - 1]?.t, JSON.stringify(s), today, JSON.stringify(state.objectives?.[FEELING_KEY] || {}), JSON.stringify(state.objectives?.racePriority || {}), state.races.map(r => r.id + r.date).join()].join('|');
  if (memo.key === key && memo.value) return memo.value;
  const days = acts.length ? dailySeries(acts, s) : [];
  const peaks = pastPeaks(acts, days, s, today);
  const best = bestPeaks(peaks);
  const value = { acts, s, days, peaks, best, recipe: recipeOf(best), today };
  memo = { key, value };
  return value;
}

/** Courses objectifs à venir (A), sinon la prochaine course. */
export function upcomingGoals(today = todayKey()) {
  const future = state.races.filter(r => r.date > today).sort((a, b) => a.date.localeCompare(b.date));
  const goals = future.filter(r => racePriority(r.id) === 'A');
  return goals.length ? goals : future.slice(0, 1);
}

/** Durée d'affûtage tirée des meilleurs pics (au moins deux), sinon null. */
export function recipeTaperDays() {
  try {
    const { recipe } = peakContext();
    return recipe && recipe.count >= 2 && recipe.taperDays >= 4 ? clamp(recipe.taperDays, 5, 21) : null;
  } catch {
    return null;
  }
}
