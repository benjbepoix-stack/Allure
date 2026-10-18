/*
 * Saison : phases d'entraînement planifiées et courses, jour par jour.
 *
 * Les phases sont stockées dans `state.objectives.seasonPhases` : le nœud
 * `objectives` accepte déjà du contenu libre dans les règles Firebase, ce qui
 * évite d'avoir à republier les règles (une clé inconnue serait refusée et
 * couperait la synchronisation).
 */
import { state } from './store.js';
import { asArray } from './schema.js';
import { combine, isDateKey } from './dates.js';
import { uid } from './utils.js';

export const PHASES_KEY = 'seasonPhases';
/** Liste des types de phase personnalisée (absente : liste d'origine). */
export const PHASE_TYPES_KEY = 'phaseTypes';

/**
 * Types de phase d'origine : nom, nom court, conseil, couleur (--ph) et charge
 * relative (hauteur des barres de l'année). `group: 'spec'` regroupe les variantes
 * de préparation spécifique dans le formulaire ; `light` : teinte plus soutenue
 * en thème clair. Le type historique `build` est conservé pour les phases déjà enregistrées.
 */
export const DEFAULT_PHASE_TYPES = [
  {
    id: 'base',
    name: 'Préparation générale (foncier)',
    short: 'Foncier',
    color: '#2f80ff',
    load: 0.5,
    advice: 'Volume en endurance fondamentale, sorties longues faciles, renforcement et technique. Peu d’intensité.'
  },
  {
    id: 'buildVolume',
    name: 'Spécifique volume',
    short: 'Spé volume',
    group: 'spec',
    color: '#5856f0',
    load: 0.85,
    advice: 'Augmenter progressivement la charge : sorties longues spécifiques (dénivelé, terrain, durée proche de la course), enchaînements sur deux jours. Intensité modérée (tempo, seuil long).'
  },
  {
    id: 'buildIntensity',
    name: 'Spécifique intensité',
    short: 'Spé intensité',
    group: 'spec',
    color: '#9b30d9',
    load: 0.95,
    advice: 'Volume stable ou en léger retrait, qualité en hausse : fractionné VO₂max, seuil, côtes, 2 séances dures par semaine maximum, bien encadrées de récupération.'
  },
  {
    id: 'buildRace',
    name: 'Spécifique allure course',
    short: 'Spé course',
    group: 'spec',
    color: '#c21fcf',
    load: 0.9,
    advice: 'Répétitions et simulations à l’allure cible, test du matériel et de la nutrition, sortie « répétition générale » 2 à 3 semaines avant la course.'
  },
  {
    id: 'build',
    name: 'Spécifique (mixte)',
    short: 'Spécifique',
    group: 'spec',
    color: '#7a3cf0',
    load: 0.9,
    advice: 'Séances au rythme de la course : seuil, fractionné, sorties longues spécifiques (dénivelé, allure cible), en alternant semaines de charge et d’assimilation.'
  },
  {
    id: 'taper',
    name: 'Affûtage',
    short: 'Affûtage',
    color: '#f5b400',
    light: '#e9a800',
    load: 0.6,
    advice: 'Volume réduit de 30 à 50 %, quelques rappels d’intensité courts. Priorité à la fraîcheur et au sommeil.'
  },
  {
    id: 'recovery',
    name: 'Récupération',
    short: 'Récup',
    color: '#10b981',
    light: '#0ea371',
    load: 0.3,
    advice: 'Après la course : séances courtes et faciles, récupération active, mobilité. Aucune intensité.'
  },
  {
    id: 'transition',
    name: 'Transition',
    short: 'Coupure',
    color: '#8b90a0',
    load: 0.2,
    advice: 'Coupure entre deux saisons : activités libres et plaisir, sans objectif chiffré.'
  }
];

const TYPE_ID = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR = /^#[0-9a-f]{6}$/i;
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Type normalisé, ou null si inutilisable. */
function normalizeType(raw, fallback = {}) {
  if (!raw || typeof raw !== 'object' || !TYPE_ID.test(raw.id)) return null;
  const name = text(raw.name, 60) || fallback.name;
  if (!name) return null;
  const load = Number(raw.load);
  return {
    id: raw.id,
    name,
    short: text(raw.short, 20) || fallback.short || name.slice(0, 20),
    advice: typeof raw.advice === 'string' ? raw.advice.trim().slice(0, 400) : fallback.advice || '',
    color: COLOR.test(raw.color) ? raw.color.toLowerCase() : fallback.color || '#8b90a0',
    load: Number.isFinite(load) && load >= 0 && load <= 1 ? load : fallback.load ?? 0.5,
    ...(raw.group === 'spec' ? { group: 'spec' } : {}),
    ...(raw.hidden === true ? { hidden: true } : {}),
    ...(fallback.light && (raw.color || fallback.color).toLowerCase() === fallback.color ? { light: fallback.light } : {})
  };
}

/**
 * Tous les types connus, dans l'ordre choisi : la liste enregistrée, puis les types
 * d'origine qui n'y figurent plus (masqués). Un type retiré de la liste reste ainsi
 * lisible pour les phases déjà enregistrées (et celles créées dans Carnet), qui ne
 * sont jamais perdues.
 */
let memo = { stored: null, list: null };
export function allPhaseTypes() {
  const stored = state.objectives?.[PHASE_TYPES_KEY];
  if (memo.list && memo.stored === stored) return memo.list;
  memo = { stored, list: buildTypes(stored) };
  return memo.list;
}

function buildTypes(stored) {
  const defaults = new Map(DEFAULT_PHASE_TYPES.map(t => [t.id, t]));
  const rows = asArray(stored);
  if (!rows.length) return DEFAULT_PHASE_TYPES.map(t => ({ ...t }));
  const seen = new Set();
  const list = [];
  rows.forEach(raw => {
    const t = normalizeType(raw, defaults.get(raw?.id));
    if (t && !seen.has(t.id)) {
      seen.add(t.id);
      list.push(t);
    }
  });
  DEFAULT_PHASE_TYPES.forEach(t => !seen.has(t.id) && list.push({ ...t, hidden: true }));
  return list;
}

/** Types proposés dans le formulaire (hors types retirés de la liste). */
export const phaseTypes = () => allPhaseTypes().filter(t => !t.hidden);

const UNKNOWN = { id: '', name: 'Phase', short: 'Phase', advice: '', color: '#8b90a0', load: 0.5 };
/** Type d'identifiant `id` (même retiré de la liste). */
export const phaseType = id => allPhaseTypes().find(t => t.id === id) || { ...UNKNOWN, id };
export const isPhaseType = v => allPhaseTypes().some(t => t.id === v);

/** Couleur du texte posé sur un aplat de couleur `hex` (noir sur les teintes claires). */
export function inkFor(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#2a1f00' : '#fff';
}

/** Phases normalisées (valeurs invalides ignorées), triées par date de début. */
export function normalizePhases(raw) {
  return asArray(raw)
    .filter(p => p && typeof p === 'object')
    .map(p => ({
      id: typeof p.id === 'string' && p.id ? p.id : uid(),
      type: p.type,
      start: p.start,
      end: p.end,
      note: typeof p.note === 'string' ? p.note.slice(0, 200) : ''
    }))
    .filter(p => isPhaseType(p.type) && isDateKey(p.start) && isDateKey(p.end) && p.end >= p.start)
    .sort((a, b) => a.start.localeCompare(b.start));
}

export const getPhases = () => normalizePhases(state.objectives?.[PHASES_KEY]);

/** Phase couvrant le jour `key` (AAAA-MM-JJ), sinon null. */
export const phaseOn = (key, phases = getPhases()) => phases.find(p => p.start <= key && key <= p.end) || null;

/** Courses d'un jour donné, triées par heure. */
export const racesOn = key =>
  state.races.filter(r => r.date === key).sort((a, b) => (combine(a.date, a.time, '00:00') ?? 0) - (combine(b.date, b.time, '00:00') ?? 0));

/** Phase qui chevauche l'intervalle [start, end] (hors `ignoreId`). */
export const overlapping = (start, end, ignoreId, phases = getPhases()) => phases.find(p => p.id !== ignoreId && p.start <= end && start <= p.end) || null;
