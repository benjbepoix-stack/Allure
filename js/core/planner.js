/*
 * Phases automatiques : la saison est découpée à rebours depuis chaque course
 * objectif (priorité A) pour arriver frais et au pic de forme le jour J.
 *
 *   … Foncier → Spé volume → Spé intensité → Affûtage (jour J) → Récupération …
 *
 * Les courses de préparation (B) et celles qui ne comptent pas (C) n'influent
 * pas sur les phases. Priorités stockées dans objectives.racePriority
 * ({ idCourse: 'A' | 'B' | 'C' }) : le nœud objectives accepte du contenu libre
 * dans les règles Firebase, contrairement aux fiches de course.
 */
import { state } from './store.js';
import { addDays, dateKey, fromKey, todayKey } from './dates.js';
import { parseNumber, uid } from './utils.js';
import { PHASES_KEY, getPhases, isManualPhase } from './season.js';

export const PRIORITY_KEY = 'racePriority';
export const PRIORITIES = [
  { id: 'A', name: 'Objectif', hint: 'Les phases sont calées sur cette course' },
  { id: 'B', name: 'Préparation', hint: 'Course d’entraînement, sans affûtage' },
  { id: 'C', name: 'Ne compte pas', hint: 'Ignorée pour les phases' }
];
const DEFAULT_PRIORITY = 'B';

export const racePriority = id => {
  const p = state.objectives?.[PRIORITY_KEY]?.[id];
  return p === 'A' || p === 'B' || p === 'C' ? p : DEFAULT_PRIORITY;
};

/** Nouvelle valeur du nœud objectives avec la priorité `p` pour la course `id`. */
export function withPriority(id, p) {
  const map = { ...(state.objectives?.[PRIORITY_KEY] || {}) };
  // Seules les courses encore présentes sont gardées.
  for (const k of Object.keys(map)) if (!state.races.some(r => r.id === k)) delete map[k];
  if (p === DEFAULT_PRIORITY) delete map[id];
  else map[id] = p;
  return { ...state.objectives, [PRIORITY_KEY]: map };
}

const days = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);
const plus = (key, n) => dateKey(addDays(fromKey(key), n));

/** Course longue (≥ 60 km ou ≥ 2 500 m D+), moyenne (≥ 21 km) ou courte. */
function size(race) {
  const km = parseNumber(race.distance) || 0;
  const dplus = parseNumber(race.elevation) || 0;
  return km >= 60 || dplus >= 2500 ? 'long' : km >= 21 || dplus >= 1000 ? 'mid' : 'short';
}
const TAPER = { long: 14, mid: 10, short: 7 };
const RECOVERY = { long: 14, mid: 7, short: 5 };
const SPECIFIC = 42; // 6 semaines de préparation spécifique
const MIN_BASE = 14;
const TRANSITION = 14;

/**
 * Phases proposées à partir de `from` (aujourd'hui par défaut) pour les courses
 * objectifs à venir.
 * @returns {Array<{type,start,end,note,race}>}
 */
export function planPhases(from = todayKey()) {
  const goals = state.races.filter(r => r.date >= from && racePriority(r.id) === 'A').sort((a, b) => a.date.localeCompare(b.date));
  const out = [];
  let cursor = from; // premier jour libre
  const push = (type, start, end, race) => start <= end && out.push({ type, start, end, note: `Auto · ${race.name}`.slice(0, 200), race: race.id });

  goals.forEach((race, i) => {
    if (race.date < cursor) return; // deux objectifs le même jour ou trop proches : le premier suffit
    const sz = size(race);
    const free = days(cursor, race.date) + 1; // jours jusqu'au jour J inclus
    let taper = Math.min(TAPER[sz], free);
    let rest = free - taper;
    let spec = 0;
    let base = 0;
    if (rest >= MIN_BASE + SPECIFIC) {
      spec = SPECIFIC;
      base = rest - SPECIFIC;
    } else if (rest > 0) {
      spec = rest; // pas assez de temps pour un foncier : tout en spécifique
    }
    let d = cursor;
    if (base) {
      push('base', d, plus(d, base - 1), race);
      d = plus(d, base);
    }
    if (spec >= 28) {
      const half = Math.round(spec / 2 / 7) * 7 || Math.floor(spec / 2);
      push('buildVolume', d, plus(d, half - 1), race);
      push('buildIntensity', plus(d, half), plus(d, spec - 1), race);
    } else if (spec >= 7) push('build', d, plus(d, spec - 1), race);
    else if (spec > 0) taper += spec; // moins d'une semaine : rattachée à l'affûtage
    d = plus(d, spec >= 7 ? spec : 0);
    push('taper', d, race.date, race);

    // Récupération, raccourcie si l'objectif suivant est proche (son affûtage doit tenir).
    const next = goals.slice(i + 1).find(r => r.date > race.date);
    let rec = RECOVERY[sz];
    if (next) rec = Math.max(0, Math.min(rec, Math.floor((days(race.date, next.date) - TAPER[size(next)]) / 2)));
    if (rec) push('recovery', plus(race.date, 1), plus(race.date, rec), race);
    cursor = plus(race.date, rec + 1);
    if (!next) push('transition', cursor, plus(cursor, TRANSITION - 1), race);
  });
  return out;
}

/** Morceaux de `p` hors de toutes les phases `fixed` (une phase gardée peut couper une phase du plan en deux). */
function around(p, fixed) {
  let parts = [p];
  for (const f of fixed) {
    parts = parts.flatMap(x => {
      if (f.end < x.start || f.start > x.end) return [x];
      const out = [];
      if (x.start < f.start) out.push({ ...x, end: plus(f.start, -1), cut: true });
      if (x.end > f.end) out.push({ ...x, start: plus(f.end, 1), cut: true });
      return out;
    });
  }
  return parts;
}

/* Bout de phase de moins d'une semaine laissé par une coupure : rattaché à la phase qui le précède. */
function absorbScraps(list) {
  const out = [];
  for (const { cut, ...p } of list) {
    const prev = out[out.length - 1];
    if (cut && days(p.start, p.end) < 6 && prev && plus(prev.end, 1) === p.start) prev.end = p.end;
    else out.push(p);
  }
  return out;
}

/** Phases manuelles qui seraient touchées par un recalcul à partir de `from`. */
export const manualFrom = (from = todayKey()) => getPhases().filter(p => p.end >= from && isManualPhase(p));

/**
 * Phases après application du plan à partir de `from` : les phases passées
 * restent, celle en cours s'arrête la veille de `from` (ou est prolongée si le
 * plan commence par le même type), les phases manuelles de `keep` (ids) restent
 * telles quelles et le plan se place autour ; les autres phases futures sont remplacées.
 * @returns {Array} phases (triées)
 */
export function mergePlan(plan, from = todayKey(), keep = []) {
  const kept = [];
  const fixed = getPhases().filter(p => p.end >= from && keep.includes(p.id));
  const next = absorbScraps(plan.flatMap(p => around({ type: p.type, start: p.start, end: p.end, note: p.note, origin: 'auto' }, fixed))).map(p => ({
    id: uid(),
    ...p
  }));
  for (const p of getPhases()) {
    if (p.end < from) kept.push(p);
    else if (keep.includes(p.id)) continue;
    else if (p.start < from) {
      const piece = around({ ...p, end: plus(from, -1) }, fixed);
      if (next[0] && next[0].type === p.type && next[0].start === from && !fixed.some(f => f.start < from)) {
        next[0] = { ...next[0], id: p.id, start: p.start, note: p.note || next[0].note, origin: p.origin };
      } else kept.push(...piece);
    }
  }
  return [...kept, ...fixed, ...next].sort((a, b) => a.start.localeCompare(b.start));
}

/** Nouvelle valeur du nœud objectives après application du plan (voir `mergePlan`). */
export const applyPlan = (plan, from = todayKey(), keep = []) => ({ ...state.objectives, [PHASES_KEY]: mergePlan(plan, from, keep) });
