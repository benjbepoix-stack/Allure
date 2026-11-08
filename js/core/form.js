/*
 * Forme par sport, sur 100 : 100 = ton meilleur niveau dans ce sport (2 dernières années).
 *
 * Trois groupes : Ski (ski de fond + ski-roue), Course & trail (la course à pied
 * sert la progression en trail), Vélo. Chaque groupe a sa recette, pondérée selon
 * ce qui fait la forme dans ce sport :
 *  - Vélo : volume (h/sem sur 6 sem.) 60 %, sortie longue (4 sem.) 25 %, séances dures (4 sem.) 15 % ;
 *  - Course & trail : séances de qualité (4 sem.) 35 %, dénivelé (m/sem sur 6 sem.) 25 %,
 *    sortie longue (4 sem.) 20 %, vitesse à effort égal (m par battement, sorties plates) 20 % ;
 *  - Ski : temps sur les skis (h/sem sur 6 sem.) 50 %, endurance tous sports 30 %, séances dures 20 %.
 * Chaque élément = valeur actuelle / meilleure valeur atteinte (évaluée chaque semaine
 * sur 2 ans), plafonné à 100. « Prêt » à partir de 85.
 *
 * Calculé sur l'appareil à partir des activités Strava, rien n'est enregistré.
 */
import { addDays, dateKey, fromKey, todayKey } from './dates.js';
import { analysisSettings, dailySeries, efficiency, familyOf, isFlatRun, zoneOf } from './training.js';
import { getActivities } from './activities.js';

export const READY = 85;

const ENDURANCE = new Set(['run', 'trail', 'bike', 'ski', 'skiroll', 'hike']);
/* Séance de qualité : FC moyenne en zone dure, ou titre de fractionné (« 6 x 3’ », « 4x4 », « seuil »). */
const INTERVAL_TITLE = /(\d+\s*[x×]\s*\d+)|seuil|fractionn|vma|tempo|côtes?\b/i;

export const GROUPS = [
  {
    id: 'ski', name: 'Ski de fond', short: 'Ski', color: '#14b8a6', fams: ['ski', 'skiroll'],
    lead: 'En ski, c’est le temps passé sur les skis (ou ski-roues) qui fait la forme, porté par ton endurance générale.',
    parts: [
      { id: 'vol', name: 'Temps sur les skis', w: 50 },
      { id: 'endu', name: 'Endurance tous sports', w: 30 },
      { id: 'hardAll', name: 'Séances dures', w: 20 }
    ]
  },
  {
    id: 'course', name: 'Course & trail', short: 'Course & trail', color: '#f2a516', fams: ['run', 'trail'],
    lead: 'La course à pied sert ta progression en trail : les séances spécifiques et le dénivelé comptent plus que le volume.',
    parts: [
      { id: 'quality', name: 'Séances de qualité', w: 35 },
      { id: 'dplus', name: 'Dénivelé', w: 25 },
      { id: 'long', name: 'Sortie longue', w: 20 },
      { id: 'speed', name: 'Vitesse à effort égal', w: 20 }
    ]
  },
  {
    id: 'velo', name: 'Vélo', short: 'Vélo', color: '#3d82f6', fams: ['bike'],
    lead: 'En vélo, c’est le volume qui fait la forme : les heures et la sortie longue.',
    parts: [
      { id: 'vol', name: 'Volume', w: 60 },
      { id: 'long', name: 'Sortie longue', w: 25 },
      { id: 'hard', name: 'Séances dures', w: 15 }
    ]
  }
];
export const group = id => GROUPS.find(g => g.id === id) || null;

/* Sport d'une course de Cadence -> groupe. */
const RACE_GROUP = { 'Course à pied': 'course', 'Trail': 'course', 'Cyclisme': 'velo', 'VTT': 'velo', 'Gravel': 'velo', 'Ski de fond': 'ski', 'Ski-roue': 'ski' };
export const raceGroup = race => RACE_GROUP[race?.sport] || null;

const median = list => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/* Mesures d'un groupe pour la fenêtre se terminant le jour `end` (inclus). */
function measure(g, acts, end, s) {
  const d6 = dateKey(addDays(fromKey(end), -41));
  const d4 = dateKey(addDays(fromKey(end), -27));
  const in6 = acts.filter(a => a.date >= d6 && a.date <= end);
  const in4 = in6.filter(a => a.date >= d4);
  const mine6 = in6.filter(a => g.fams.includes(familyOf(a)));
  const mine4 = in4.filter(a => g.fams.includes(familyOf(a)));
  const isHard = a => zoneOf(a, s) === 'hard' || INTERVAL_TITLE.test(a.title || '');
  const flat = mine4.filter(isFlatRun).map(efficiency).filter(Boolean);
  return {
    vol: mine6.reduce((n, a) => n + a.duration, 0) / 3600 / 6,
    endu: in6.filter(a => ENDURANCE.has(familyOf(a))).reduce((n, a) => n + a.duration, 0) / 3600 / 6,
    long: mine4.reduce((m, a) => Math.max(m, a.duration / 3600), 0),
    hard: mine4.filter(isHard).length,
    hardAll: in4.filter(a => ENDURANCE.has(familyOf(a)) && isHard(a)).length,
    quality: mine4.filter(isHard).length,
    dplus: mine6.reduce((n, a) => n + (a.gain || 0), 0) / 6,
    speed: flat.length ? median(flat) : null
  };
}

/* Minimums de référence (évitent qu'une toute petite référence donne 100). */
const FLOOR = { vol: 1, endu: 2, long: 0.75, hard: 4, hardAll: 4, quality: 4, dplus: 150, speed: 0 }; // séances dures : au moins 1 par semaine

/* Texte d'une valeur. */
const hm = h => {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
};
export function valueLabel(id, v) {
  if (v == null) return '—';
  switch (id) {
    case 'vol': case 'endu': return `${hm(v)} / sem`;
    case 'long': return v ? hm(v) : 'aucune';
    case 'hard': case 'hardAll': case 'quality': return `${v} en 4 sem.`;
    case 'dplus': return `${Math.round(v).toLocaleString('fr-FR')} m / sem`;
    case 'speed': return `${v.toFixed(2).replace('.', ',')} m / battement`;
    default: return String(v);
  }
}

function scoreOf(g, m, ref) {
  let total = 0;
  let weight = 0;
  const parts = g.parts.map(p => {
    const now = m[p.id];
    const best = ref[p.id];
    const usable = now != null && best > 0;
    const v = usable ? Math.min(100, Math.round((100 * now) / best)) : null;
    if (usable) {
      total += p.w * v;
      weight += p.w;
    }
    return { ...p, now, best, v };
  });
  return { score: weight ? Math.round(total / weight) : 0, parts };
}

let memo = { key: '', value: null };

/**
 * Forme de chaque groupe pratiqué : { id, name, short, color, lead, score, delta (4 sem.),
 * parts: [{ id, name, w, now, best, v }], refDate }. Groupes sans séance depuis 2 ans : absents.
 */
export function formBySport(today = todayKey()) {
  const acts = getActivities();
  const s = analysisSettings();
  const key = `${acts.length}|${acts.at(-1)?.t}|${today}|${s.hrMax}|${s.hrRest}`;
  if (memo.key === key) return memo.value;
  const since = dateKey(addDays(fromKey(today), -730));
  const out = [];
  for (const g of GROUPS) {
    if (!acts.some(a => a.date >= since && g.fams.includes(familyOf(a)))) continue;
    // Références : meilleure valeur de chaque élément, évaluée chaque semaine sur 2 ans.
    const ref = { ...FLOOR };
    const refDate = {};
    for (let k = 0; k <= 104; k++) {
      const end = dateKey(addDays(fromKey(today), -7 * k));
      if (end < since) break;
      const m = measure(g, acts, end, s);
      for (const p of g.parts) {
        if (m[p.id] != null && m[p.id] > ref[p.id]) {
          ref[p.id] = m[p.id];
          refDate[p.id] = end;
        }
      }
    }
    if (ref.speed === 0) ref.speed = null;
    const now = scoreOf(g, measure(g, acts, today, s), ref);
    const before = scoreOf(g, measure(g, acts, dateKey(addDays(fromKey(today), -28)), s), ref);
    out.push({ ...g, score: now.score, delta: now.score - before.score, parts: now.parts, refDate, ref });
  }
  const value = out;
  memo = { key, value };
  return value;
}

/** Forme d'un groupe semaine par semaine (dimanche de chaque semaine), sur `weeks` semaines, avec les références d'aujourd'hui. */
export function formHistory(id, weeks = 26, today = todayKey()) {
  const f = formBySport(today).find(x => x.id === id);
  if (!f) return [];
  const acts = getActivities();
  const s = analysisSettings();
  const out = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const end = dateKey(addDays(fromKey(today), -7 * k));
    out.push({ key: end, score: scoreOf(f, measure(f, acts, end, s), f.ref).score });
  }
  return out;
}

export const formStatus = score => (score >= READY ? { id: 'ok', name: 'Prêt' } : score >= 50 ? { id: 'mid', name: 'En route' } : { id: 'low', name: 'En construction' });

/** Fraîcheur du matin (forme − fatigue) en mots. */
export function freshness(today = todayKey()) {
  const acts = getActivities();
  if (!acts.length) return null;
  const days = dailySeries(acts, analysisSettings(), today);
  const d = days.find(x => x.key === today) || days.at(-1);
  if (!d) return null;
  const tsb = d.tsb;
  if (tsb > 5) return { id: 'ok', name: 'Reposé', note: 'Charge des derniers jours plus basse que d’habitude : tu peux charger.' };
  if (tsb < -15) return { id: 'mid', name: 'Chargé', note: 'Grosse charge récente : garde une journée facile avant la prochaine séance dure.' };
  return { id: 'low', name: 'Normal', note: 'Charge habituelle : rien à changer.' };
}
