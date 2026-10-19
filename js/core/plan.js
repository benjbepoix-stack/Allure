/*
 * Plan d'entraînement (à la manière de Frive) : pour chaque semaine, la phase
 * de Cadence qui la couvre et un volume cible.
 *
 * Volume cible = volume de référence (réglage, ou moyenne hebdomadaire des
 * 12 derniers mois) × facteur de la phase, avec une semaine allégée sur quatre
 * en foncier et en spécifique.
 */
import { state } from './store.js';
import { addDays, dateKey, fromKey, mondayOf } from './dates.js';
import { getPhases, phaseOn, phaseType } from './season.js';
import { racePriority } from './planner.js';
import { analysisSettings } from './training.js';

/* Volume de la phase par rapport au volume de référence. */
const FACTOR = { base: 1, buildVolume: 1.15, buildIntensity: 1, build: 1.05, buildRace: 0.95, taper: 0.65, recovery: 0.5, transition: 0.3 };
const LIGHT_WEEK = 0.7;
const CYCLED = new Set(['base', 'buildVolume', 'buildIntensity', 'build', 'buildRace']);

/** Volume de référence (h/sem) : réglage, sinon moyenne des semaines actives des 12 derniers mois. */
export function referenceHours(activities, today) {
  const s = analysisSettings();
  if (s.weeklyHours) return s.weeklyHours;
  const from = dateKey(addDays(fromKey(today), -364));
  const weeks = new Map();
  for (const a of activities) {
    if (a.date < from || a.date > today) continue;
    const w = dateKey(mondayOf(fromKey(a.date)));
    weeks.set(w, (weeks.get(w) || 0) + a.duration / 3600);
  }
  const list = [...weeks.values()].filter(h => h >= 1);
  return list.length ? Math.round((list.reduce((a, b) => a + b, 0) / list.length) * 2) / 2 : 6;
}

/** Prochain objectif (course A) à partir de `key`. */
function nextGoal(key) {
  const future = state.races.filter(r => r.date >= key).sort((a, b) => a.date.localeCompare(b.date));
  return future.find(r => racePriority(r.id) === 'A') || null;
}

/**
 * Semaine du plan commençant le lundi `monday` (AAAA-MM-JJ).
 * @returns {null | {monday, phase, type, index, count, target, light, goal}}
 */
export function planWeek(monday, ref) {
  const phases = getPhases();
  const mid = dateKey(addDays(fromKey(monday), 3));
  const phase = phaseOn(mid, phases) || phaseOn(monday, phases) || phaseOn(dateKey(addDays(fromKey(monday), 6)), phases);
  if (!phase) return null;
  const first = mondayOf(fromKey(phase.start));
  const index = Math.round((fromKey(monday) - first) / (7 * 864e5));
  const count = Math.round((mondayOf(fromKey(phase.end)) - first) / (7 * 864e5)) + 1;
  const t = phaseType(phase.type);
  const light = CYCLED.has(phase.type) && count >= 4 && index % 4 === 3;
  const target = ref * (FACTOR[phase.type] ?? 0.3 + t.load * 0.8) * (light ? LIGHT_WEEK : 1);
  return { monday, phase, type: t, index, count, target, light, goal: nextGoal(monday) };
}

/** Lundis des semaines couvertes par des phases, de `from` jusqu'à la fin de la dernière phase (max `max` semaines). */
export function planHorizon(fromMonday, max = 30) {
  const phases = getPhases();
  const last = phases.reduce((m, p) => (p.end > m ? p.end : m), '');
  const out = [];
  for (let d = fromKey(fromMonday); dateKey(d) <= last && out.length < max; d = addDays(d, 7)) out.push(dateKey(d));
  return out;
}
