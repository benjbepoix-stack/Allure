/*
 * Indicateurs d'entraînement calculés à partir des activités importées :
 * charge (TRIMP de Banister, depuis la FC moyenne et la durée), forme (42 j),
 * fatigue (7 j), fraîcheur, repos, intensité, efficacité et records.
 *
 * L'export ne donne que la FC moyenne de chaque séance (pas le temps passé
 * dans chaque zone) : charge et intensité sont donc des estimations.
 */
import { state } from './store.js';
import { addDays, dateKey, fromKey, mondayOf, todayKey } from './dates.js';

/* Réglages de l'analyse, synchronisés avec le compte (objectives.analysis). */
export const ANALYSIS_KEY = 'analysis';
const DEFAULT_SETTINGS = { hrMax: 191, hrRest: 50, streakAlert: 7 };

export function analysisSettings() {
  const raw = state.objectives?.[ANALYSIS_KEY] || {};
  const int = (v, min, max, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= min && n <= max ? n : d;
  };
  const hrMax = int(raw.hrMax, 120, 230, DEFAULT_SETTINGS.hrMax);
  return {
    hrMax,
    hrRest: Math.min(int(raw.hrRest, 30, 100, DEFAULT_SETTINGS.hrRest), hrMax - 40),
    streakAlert: int(raw.streakAlert, 3, 30, DEFAULT_SETTINGS.streakAlert)
  };
}

/* ---------- Sports ---------- */
export const FAMILIES = [
  { id: 'run', name: 'Course à pied', color: '#ff6b4a' },
  { id: 'trail', name: 'Trail', color: '#f2a516' },
  { id: 'bike', name: 'Vélo', color: '#3d82f6' },
  { id: 'ski', name: 'Ski de fond', color: '#14b8a6' },
  { id: 'gym', name: 'Renfo', color: '#a95cf0' },
  { id: 'hike', name: 'Rando', color: '#7cbf3a' },
  { id: 'other', name: 'Autre', color: '#8b90a0' }
];
const FAMILY_OF = {
  'Running': 'run',
  'Treadmill Running': 'run',
  'Trail Running': 'trail',
  'Cycling': 'bike',
  'Road Cycling': 'bike',
  'Indoor Cycling': 'bike',
  'Mountain Biking': 'bike',
  'Gravel Cycling': 'bike',
  'Cross Country Skiing': 'ski',
  'Roller Skiing': 'ski',
  'Weight Training': 'gym',
  'Indoor Sport & Fitness': 'gym',
  'Climbing': 'gym',
  'Hiking': 'hike',
  'Walking': 'hike'
};
export const familyOf = a => FAMILY_OF[a.activity] || 'other';
export const family = id => FAMILIES.find(f => f.id === id) || FAMILIES[FAMILIES.length - 1];

/* Intensité supposée d'une séance sans FC (part de la FC de réserve). */
const NO_HR_RESERVE = { gym: 0.4, hike: 0.4, other: 0.45 };

/** Part de la FC de réserve (Karvonen) de la séance, entre 0 et 1. */
export function reserve(a, s = analysisSettings()) {
  if (!a.hr) return NO_HR_RESERVE[familyOf(a)] ?? 0.5;
  return Math.min(1, Math.max(0, (a.hr - s.hrRest) / (s.hrMax - s.hrRest)));
}

/** Charge de la séance (TRIMP de Banister). */
export function trimp(a, s) {
  const k = reserve(a, s);
  return (a.duration / 60) * k * 0.64 * Math.exp(1.92 * k);
}

/* Facile / modéré / dur, d'après la FC moyenne (part de la FC de réserve). */
export const ZONES = [
  { id: 'easy', name: 'Facile', color: '#2bbf7a' },
  { id: 'mid', name: 'Modéré', color: '#f2a516' },
  { id: 'hard', name: 'Dur', color: '#ff3b4a' }
];
export const zoneOf = (a, s) => {
  const k = reserve(a, s);
  return k < 0.65 ? 'easy' : k < 0.75 ? 'mid' : 'hard';
};

/* ---------- Série quotidienne : charge, forme, fatigue, fraîcheur ---------- */

/**
 * Une entrée par jour, du premier jour d'activité à `end` :
 * { key, load, minutes, count, ctl (forme), atl (fatigue), tsb (fraîcheur du matin) }.
 */
export function dailySeries(activities, s = analysisSettings(), end = todayKey()) {
  if (!activities.length) return [];
  const byDay = new Map();
  for (const a of activities) {
    const d = byDay.get(a.date) || { load: 0, minutes: 0, count: 0 };
    d.load += trimp(a, s);
    d.minutes += a.duration / 60;
    d.count++;
    byDay.set(a.date, d);
  }
  const lastKey = activities[activities.length - 1].date > end ? activities[activities.length - 1].date : end;
  const out = [];
  let ctl = 0;
  let atl = 0;
  for (let day = fromKey(activities[0].date); ; day = addDays(day, 1)) {
    const key = dateKey(day);
    const d = byDay.get(key) || { load: 0, minutes: 0, count: 0 };
    const tsb = ctl - atl; // fraîcheur du matin : forme et fatigue de la veille
    ctl += (d.load - ctl) / 42;
    atl += (d.load - atl) / 7;
    out.push({ key, ...d, ctl, atl, tsb });
    if (key >= lastKey) break;
  }
  return out;
}

/* ---------- Périodes ---------- */
export const PERIODS = [
  { id: 'month', label: 'Mois' },
  { id: '3m', label: '3 mois' },
  { id: '6m', label: '6 mois' },
  { id: '12m', label: '12 mois' },
  { id: 'year', label: 'Année' },
  { id: 'season', label: 'Saison' }
];

const addMonths = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, 1, 12);
/** Même jour du mois, `n` mois plus tôt / tard (borné à la fin du mois). */
function shiftMonths(date, n) {
  const d = addMonths(date, n);
  d.setDate(Math.min(date.getDate(), new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d;
}

/**
 * Saisons : groupes de phases qui se suivent (moins de 3 semaines d'écart),
 * coupés après chaque phase de transition (coupure entre deux saisons).
 */
export function seasons(phases) {
  const out = [];
  let cur = null;
  for (const p of phases) {
    const gap = cur ? (fromKey(p.start) - fromKey(cur.end)) / 864e5 : Infinity;
    if (!cur || gap > 21 || cur.closed) {
      cur = { start: p.start, end: p.end, closed: false };
      out.push(cur);
    }
    if (p.end > cur.end) cur.end = p.end;
    if (p.type === 'transition') cur.closed = true;
  }
  return out.map(({ start, end }) => ({ start, end }));
}

/**
 * Intervalle [start, end] de la période `kind`, `offset` périodes avant la période actuelle.
 * @returns {{start:string, end:string, label:string, hasPrev:boolean, hasNext:boolean, note?:string}}
 */
export function periodRange(kind, offset, { phases = [], first = '' } = {}) {
  const today = fromKey(todayKey());
  const fmtM = (d, year = true) => d.toLocaleDateString('fr-FR', { month: 'short', ...(year ? { year: 'numeric' } : {}) }).replace('.', '');
  let start;
  let end;
  let label;
  if (kind === 'month') {
    start = addMonths(today, -offset);
    end = addDays(addMonths(start, 1), -1);
    label = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
  } else if (kind === 'year') {
    start = new Date(today.getFullYear() - offset, 0, 1, 12);
    end = new Date(today.getFullYear() - offset, 11, 31, 12);
    label = String(start.getFullYear());
  } else if (kind === 'season') {
    const list = seasons(phases).filter(x => x.start <= dateKey(today));
    if (list.length) {
      const i = Math.max(0, list.length - 1 - offset);
      const sn = list[i];
      return {
        start: sn.start,
        end: sn.end,
        label: `Saison ${fmtM(fromKey(sn.start))} → ${fmtM(fromKey(sn.end))}`,
        hasPrev: i > 0,
        hasNext: i < list.length - 1
      };
    }
    // Aucune phase : 12 derniers mois.
    return { ...periodRange('12m', offset, { first }), note: 'Aucune phase dans Saison : 12 derniers mois affichés.' };
  } else {
    const months = { '3m': 3, '6m': 6, '12m': 12 }[kind] || 12;
    end = shiftMonths(today, -months * offset);
    start = addDays(shiftMonths(end, -months), 1);
    label = `${start.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', ...(start.getFullYear() !== end.getFullYear() ? { year: 'numeric' } : {}) })} → ${end.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' })}`.replaceAll('.', '');
  }
  return { start: dateKey(start), end: dateKey(end), label, hasPrev: !first || dateKey(start) > first, hasNext: offset > 0 };
}

/* ---------- Agrégats d'une période ---------- */

const median = list => {
  const s = [...list].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
};

/** Séries de jours consécutifs sans repos (≥ `min` jours) dans [start, end]. */
export function streaks(days, min = 1) {
  const out = [];
  let cur = null;
  for (const d of days) {
    if (d.count) {
      if (!cur) cur = { start: d.key, end: d.key, length: 0 };
      cur.end = d.key;
      cur.length++;
    } else if (cur) {
      out.push(cur);
      cur = null;
    }
  }
  if (cur) out.push({ ...cur, ongoing: true });
  return out.filter(x => x.length >= min);
}

/** Groupes (jour, semaine ou mois) couvrant [start, end]. */
export function buckets(start, end, unit) {
  const out = [];
  let d = fromKey(start);
  const last = fromKey(end);
  if (unit === 'week') d = mondayOf(d);
  if (unit === 'month') d = new Date(d.getFullYear(), d.getMonth(), 1, 12);
  while (d <= last) {
    const next = unit === 'day' ? addDays(d, 1) : unit === 'week' ? addDays(d, 7) : new Date(d.getFullYear(), d.getMonth() + 1, 1, 12);
    out.push({ start: dateKey(d), end: dateKey(addDays(next, -1)) });
    d = next;
  }
  return out;
}

/** Vitesse rapportée à la FC (mètres par battement) ; sorties de course plutôt plates de plus de 4 km. */
export const efficiency = a => (a.hr && a.speed ? (a.speed * 60) / a.hr : 0);
export const isFlatRun = a => ['run', 'trail'].includes(familyOf(a)) && a.distance >= 4000 && a.hr > 0 && a.gain / (a.distance / 1000) <= 25;

/** Records d'un sport dans une liste d'activités. */
export function records(list, fam) {
  const of = list.filter(a => familyOf(a) === fam);
  if (!of.length) return null;
  const max = (arr, f) => arr.reduce((b, a) => (f(a) > f(b) ? a : b), arr[0]);
  const rec = { distance: max(of, a => a.distance), duration: max(of, a => a.duration), gain: max(of, a => a.gain) };
  const minDist = { run: 5000, trail: 10000, bike: 30000, ski: 10000 }[fam];
  const fast = minDist ? of.filter(a => a.distance >= minDist && a.speed > 0) : [];
  if (fast.length) rec.speed = max(fast, a => a.speed);
  return rec;
}

/** Statistiques d'un intervalle de jours de la série quotidienne. */
export function summarize(activities, days, s) {
  const total = { minutes: 0, count: 0, distance: 0, gain: 0, load: 0 };
  const byFamily = Object.fromEntries(FAMILIES.map(f => [f.id, 0]));
  const byZone = { easy: 0, mid: 0, hard: 0 };
  for (const a of activities) {
    total.minutes += a.duration / 60;
    total.count++;
    total.distance += a.distance;
    total.gain += a.gain;
    byFamily[familyOf(a)] += a.duration / 60;
    byZone[zoneOf(a, s)] += a.duration / 60;
  }
  total.load = days.reduce((n, d) => n + d.load, 0);
  const rest = days.filter(d => !d.count).length;
  const weeks = days.length / 7;
  return {
    ...total,
    byFamily,
    byZone,
    days: days.length,
    rest,
    restPerWeek: weeks ? rest / weeks : 0,
    hoursPerWeek: weeks ? total.minutes / 60 / weeks : 0,
    medianLoad: median(days.filter(d => d.count).map(d => d.load))
  };
}
