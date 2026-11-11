/*
 * Forme par sport, sur 100 : 100 = ton meilleur niveau dans ce sport (2 dernières années).
 *
 * Trois groupes : Ski (ski de fond + ski-roue), Course & trail (la course à pied
 * sert la progression en trail), Vélo. Chaque groupe mélange deux familles d'éléments :
 *  - Vitesse (ce que tu sais faire aujourd'hui) : FTP, allure, vitesse en ski-roue,
 *    séances dures. Référence = ton meilleur sur 2 ans.
 *  - Endurance (ce que tu tiens) : volume, sortie longue, dénivelé. Référence = ton
 *    haut niveau habituel (8e décile des semaines pratiquées), pas une semaine
 *    exceptionnelle comme une cyclo de 9 h qui écraserait tout le reste de l'année.
 * Recettes :
 *  - Vélo : FTP 45 %, volume 30 %, sortie longue 15 %, séances dures 10 % ;
 *  - Course & trail : allure 35 %, séances de qualité 20 %, sortie longue 20 %,
 *    dénivelé 15 %, vitesse à effort égal 10 % ;
 *  - Ski : vitesse en ski-roue 25 %, moteur (vitesse en vélo et en course) 25 %,
 *    temps sur les skis 25 %, endurance tous sports 25 %.
 * Chaque élément = valeur actuelle / référence, plafonné à 100 ; un élément sans donnée
 * ne compte pas. « Prêt » à partir de 85.
 *
 * Calculé sur l'appareil à partir des activités Strava et des tests FTP, rien n'est enregistré.
 */
import { addDays, dateKey, fromKey, todayKey } from './dates.js';
import { analysisSettings, dailySeries, efficiency, familyOf, isFlatRun, zoneOf } from './training.js';
import { getActivities } from './activities.js';
import { state } from './store.js';

export const READY = 85;

const ENDURANCE = new Set(['run', 'trail', 'bike', 'ski', 'skiroll', 'hike']);
/* Séance de qualité : FC moyenne en zone dure, ou titre de fractionné (« 6 x 3’ », « 4x4 », « seuil »). */
const INTERVAL_TITLE = /(\d+\s*[x×]\s*\d+)|seuil|fractionn|vma|tempo|côtes?\b/i;

export const GROUPS = [
  {
    id: 'ski', name: 'Ski de fond', short: 'Ski', color: '#14b8a6', fams: ['ski', 'skiroll'],
    lead: 'En ski, ta vitesse en ski-roue et ton moteur (vélo, course) disent ton niveau ; le temps sur les skis et l’endurance générale disent ce que tu tiens.',
    parts: [
      { id: 'skiSpeed', name: 'Vitesse en ski-roue', w: 25, kind: 'speed' },
      { id: 'engine', name: 'Moteur (vélo et course)', w: 25, kind: 'speed' },
      { id: 'vol', name: 'Temps sur les skis', w: 25, kind: 'endu' },
      { id: 'endu', name: 'Endurance tous sports', w: 25, kind: 'endu' }
    ]
  },
  {
    id: 'course', name: 'Course & trail', short: 'Course & trail', color: '#f2a516', fams: ['run', 'trail'],
    lead: 'L’allure (dénivelé compris) et les séances de qualité font ta vitesse ; sortie longue et dénivelé font ton endurance de traileur.',
    parts: [
      { id: 'pace', name: 'Allure', w: 35, kind: 'speed' },
      { id: 'quality', name: 'Séances de qualité', w: 20, kind: 'speed' },
      { id: 'long', name: 'Sortie longue', w: 20, kind: 'endu' },
      { id: 'dplus', name: 'Dénivelé', w: 15, kind: 'endu' },
      { id: 'speed', name: 'Vitesse à effort égal', w: 10, kind: 'speed' }
    ]
  },
  {
    id: 'velo', name: 'Vélo', short: 'Vélo', color: '#3d82f6', fams: ['bike'],
    lead: 'En vélo, ta FTP dit ton niveau ; les heures et la sortie longue disent ton endurance.',
    parts: [
      { id: 'ftp', name: 'FTP', w: 45, kind: 'speed' },
      { id: 'vol', name: 'Volume', w: 30, kind: 'endu' },
      { id: 'long', name: 'Sortie longue', w: 15, kind: 'endu' },
      { id: 'hard', name: 'Séances dures', w: 10, kind: 'speed' }
    ]
  }
];
export const group = id => GROUPS.find(g => g.id === id) || null;
export const KINDS = { speed: 'Vitesse', endu: 'Endurance' };

/* Sport d'une course de Cadence -> groupe. */
const RACE_GROUP = { 'Course à pied': 'course', 'Trail': 'course', 'Cyclisme': 'velo', 'VTT': 'velo', 'Gravel': 'velo', 'Ski de fond': 'ski', 'Ski-roue': 'ski' };
export const raceGroup = race => RACE_GROUP[race?.sport] || null;

const median = list => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return 0;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
/* Quantile (0..1) d'une liste. */
const quantile = (list, q) => {
  const s = [...list].sort((a, b) => a - b);
  if (!s.length) return 0;
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (i - lo);
};

/* Vitesse « à plat » d'une sortie : 100 m de D+ comptent comme 1 km de plus (m/s). */
const flatSpeed = a => (a.duration > 0 ? (a.distance + 10 * (a.gain || 0)) / a.duration : 0);

/* Tests FTP (Suivi), du plus ancien au plus récent. */
const ftpTests = () => (state.bodyMetrics?.ftp || []).filter(r => r.value > 0);
const FTP_FRESH = 180; // un test de plus de 6 mois ne dit plus ton niveau

/* Mesures d'un groupe pour la fenêtre se terminant le jour `end` (inclus). */
function measure(g, acts, end, s, ftp) {
  const d6 = dateKey(addDays(fromKey(end), -41));
  const d4 = dateKey(addDays(fromKey(end), -27));
  const in6 = acts.filter(a => a.date >= d6 && a.date <= end);
  const in4 = in6.filter(a => a.date >= d4);
  const mine6 = in6.filter(a => g.fams.includes(familyOf(a)));
  const mine4 = in4.filter(a => g.fams.includes(familyOf(a)));
  const isHard = a => zoneOf(a, s) === 'hard' || INTERVAL_TITLE.test(a.title || '');
  const flat = mine4.filter(isFlatRun).map(efficiency).filter(Boolean);
  const best = list => (list.length ? Math.max(...list) : null);
  let ftpNow = null;
  if (g.id === 'velo') {
    if (ftp.length) {
      // Dernier test avant `end`, s'il a moins de 6 mois.
      const fresh = dateKey(addDays(fromKey(end), -FTP_FRESH));
      const last = ftp.filter(r => r.date <= end).at(-1);
      ftpNow = last && last.date >= fresh ? last.value : null;
    } else {
      // Pas de test FTP : meilleure puissance moyenne d'une sortie d'au moins 40 min.
      ftpNow = best(mine6.filter(a => a.power > 0 && a.duration >= 2400).map(a => a.power));
    }
  }
  return {
    vol: mine6.reduce((n, a) => n + a.duration, 0) / 3600 / 6,
    endu: in6.filter(a => ENDURANCE.has(familyOf(a))).reduce((n, a) => n + a.duration, 0) / 3600 / 6,
    long: mine4.reduce((m, a) => Math.max(m, a.duration / 3600), 0),
    hard: mine4.filter(isHard).length,
    quality: mine4.filter(isHard).length,
    dplus: mine6.reduce((n, a) => n + (a.gain || 0), 0) / 6,
    speed: flat.length ? median(flat) : null,
    pace: best(mine6.filter(a => ['run', 'trail'].includes(familyOf(a)) && a.distance >= 5000).map(flatSpeed).filter(v => v > 1.5 && v < 7)),
    skiSpeed: best(mine6.filter(a => familyOf(a) === 'skiroll' && a.distance >= 8000).map(flatSpeed).filter(v => v > 2 && v < 10)),
    ftp: ftpNow
  };
}

/* Minimums de référence (évitent qu'une toute petite référence donne 100). */
const FLOOR = { vol: 1, endu: 2, long: 0.75, hard: 4, quality: 4, dplus: 150, speed: 0, pace: 0, skiSpeed: 0, ftp: 0, engine: 100 }; // séances dures : au moins 1 par semaine
const ENDU_Q = 0.8; // endurance : 8e décile des semaines pratiquées

/* Texte d'une valeur. */
const hm = h => {
  const m = Math.round(h * 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${String(m % 60).padStart(2, '0')}` : ''}`;
};
/* Allure (min/km) depuis une vitesse en m/s. */
const paceLabel = v => {
  const sec = Math.round(1000 / v);
  return `${Math.floor(sec / 60)}’${String(sec % 60).padStart(2, '0')} / km`;
};
export function valueLabel(id, v) {
  if (v == null) return '—';
  switch (id) {
    case 'vol': case 'endu': return `${hm(v)} / sem`;
    case 'long': return v ? hm(v) : 'aucune';
    case 'hard': case 'quality': return `${v} en 4 sem.`;
    case 'dplus': return `${Math.round(v).toLocaleString('fr-FR')} m / sem`;
    case 'speed': return `${v.toFixed(2).replace('.', ',')} m / battement`;
    case 'pace': return `${paceLabel(v)} (D+ compris)`;
    case 'skiSpeed': return `${(v * 3.6).toFixed(1).replace('.', ',')} km/h (D+ compris)`;
    case 'ftp': return `${Math.round(v)} W`;
    case 'engine': return `${Math.round(v)} / 100`;
    default: return String(v);
  }
}

function scoreOf(g, m, ref) {
  const sums = { all: [0, 0], speed: [0, 0], endu: [0, 0] };
  const parts = g.parts.map(p => {
    const now = m[p.id];
    const best = ref[p.id];
    const usable = now != null && best > 0;
    const v = usable ? Math.min(100, Math.round((100 * now) / best)) : null;
    if (usable) {
      for (const k of ['all', p.kind]) {
        sums[k][0] += p.w * v;
        sums[k][1] += p.w;
      }
    }
    return { ...p, now, best, v };
  });
  const avg = k => (sums[k][1] ? Math.round(sums[k][0] / sums[k][1]) : null);
  return { score: avg('all') || 0, speed: avg('speed'), endu: avg('endu'), parts };
}

/* Références d'un groupe : meilleure vitesse et haut niveau habituel d'endurance, évalués chaque semaine sur 2 ans. */
function refsOf(g, acts, today, s, ftp) {
  const since = dateKey(addDays(fromKey(today), -730));
  const ref = { ...FLOOR };
  const refDate = {};
  const weekly = Object.fromEntries(g.parts.map(p => [p.id, []]));
  for (let k = 0; k <= 104; k++) {
    const end = dateKey(addDays(fromKey(today), -7 * k));
    if (end < since) break;
    const m = measure(g, acts, end, s, ftp);
    for (const p of g.parts) {
      const v = m[p.id];
      if (v == null || !(v > 0)) continue;
      weekly[p.id].push(v);
      if (p.kind === 'speed' && v > ref[p.id]) {
        ref[p.id] = v;
        refDate[p.id] = end;
      }
    }
  }
  for (const p of g.parts) {
    if (p.kind !== 'endu' || !weekly[p.id].length) continue;
    ref[p.id] = Math.max(FLOOR[p.id], quantile(weekly[p.id], ENDU_Q));
  }
  // FTP : ton meilleur test des 2 dernières années (même s'il n'a pas été pris dans une semaine évaluée).
  if (g.id === 'velo' && ftp.length) {
    const top = ftp.filter(r => r.date >= since && r.date <= today).reduce((b, r) => (!b || r.value > b.value ? r : b), null);
    if (top) {
      ref.ftp = top.value;
      refDate.ftp = top.date;
    }
  }
  for (const id of ['speed', 'pace', 'skiSpeed', 'ftp']) if (ref[id] === 0) ref[id] = null;
  return { ref, refDate };
}

/* Mesures d'un groupe à la date `end`, avec le « moteur » (vitesse vélo + course) pour le ski. */
function measureAll(g, acts, end, s, ftp, refs) {
  const m = measure(g, acts, end, s, ftp);
  if (g.parts.some(p => p.id === 'engine')) {
    const vs = [];
    for (const [id, key] of [['velo', 'ftp'], ['course', 'pace']]) {
      const r = refs[id];
      if (!r?.ref[key]) continue;
      const other = group(id);
      const now = id === g.id ? m[key] : measure(other, acts, end, s, ftp)[key];
      if (now != null) vs.push(Math.min(100, (100 * now) / r.ref[key]));
    }
    m.engine = vs.length ? vs.reduce((a, b) => a + b, 0) / vs.length : null;
  }
  return m;
}

let memo = { key: '', value: null };

/**
 * Forme de chaque groupe pratiqué : { id, name, short, color, lead, score, speed, endu,
 * delta (4 sem.), parts: [{ id, name, w, kind, now, best, v }], refDate }.
 * Groupes sans séance depuis 2 ans : absents.
 */
export function formBySport(today = todayKey()) {
  const acts = getActivities();
  const s = analysisSettings();
  const ftp = ftpTests();
  const key = `${acts.length}|${acts.at(-1)?.t}|${today}|${s.hrMax}|${s.hrRest}|${ftp.map(r => `${r.date}:${r.value}`).join(',')}`;
  if (memo.key === key) return memo.value;
  const since = dateKey(addDays(fromKey(today), -730));
  const refs = Object.fromEntries(GROUPS.map(g => [g.id, refsOf(g, acts, today, s, ftp)]));
  const out = [];
  for (const g of GROUPS) {
    if (!acts.some(a => a.date >= since && g.fams.includes(familyOf(a)))) continue;
    const { ref, refDate } = refs[g.id];
    const parts = g.parts.map(p => (p.id === 'ftp' && !ftp.length ? { ...p, name: 'Puissance en sortie' } : p));
    const gg = { ...g, parts };
    const now = scoreOf(gg, measureAll(gg, acts, today, s, ftp, refs), ref);
    const before = scoreOf(gg, measureAll(gg, acts, dateKey(addDays(fromKey(today), -28)), s, ftp, refs), ref);
    out.push({ ...gg, score: now.score, speed: now.speed, endu: now.endu, delta: now.score - before.score, parts: now.parts, refDate, ref, refs });
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
  const ftp = ftpTests();
  const out = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const end = dateKey(addDays(fromKey(today), -7 * k));
    out.push({ key: end, score: scoreOf(f, measureAll(f, acts, end, s, ftp, f.refs), f.ref).score });
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
