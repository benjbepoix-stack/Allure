/*
 * Plan d'entraînement (à la manière de Frive) : pour chaque semaine, la phase
 * de Cadence qui la couvre, un volume cible, une semaine type (séances jour par
 * jour) et le détail des séances clés avec leurs cibles de FC (et de watts à
 * vélo si une FTP est enregistrée).
 *
 * Volume cible = volume de référence (réglage, ou moyenne hebdomadaire des
 * 12 derniers mois) × facteur de la phase, avec une semaine allégée sur quatre
 * en foncier et en spécifique.
 */
import { state } from './store.js';
import { addDays, dateKey, fromKey, mondayOf } from './dates.js';
import { getPhases, phaseOn, phaseType } from './season.js';
import { racePriority } from './planner.js';
import { RACE_FAMILY, analysisSettings, family, familyOf, isSnowMonth } from './training.js';

/* Volume de la phase par rapport au volume de référence. */
const FACTOR = { base: 1, buildVolume: 1.15, buildIntensity: 1, build: 1.05, buildRace: 0.95, taper: 0.65, recovery: 0.5, transition: 0.3 };
const LIGHT_WEEK = 0.7;
const CYCLED = new Set(['base', 'buildVolume', 'buildIntensity', 'build', 'buildRace']);

/*
 * Semaines types, du lundi au dimanche. Chaque séance : type, sport
 * (P : sport principal, S : sport secondaire, gym : renfo, free : libre) et part du volume de la semaine.
 */
const R = [];
const T = (kind, sport, share) => ({ kind, sport, share });
const WEEKS = {
  base: [R, [T('easy', 'P', 0.14)], [T('easy', 'S', 0.17), T('strength', 'gym', 0.07)], [T('skills', 'P', 0.12)], R, [T('long', 'P', 0.28)], [T('long', 'S', 0.22)]],
  buildVolume: [R, [T('threshold', 'P', 0.14)], [T('easy', 'S', 0.16), T('strength', 'gym', 0.06)], [T('easy', 'P', 0.12)], R, [T('longSpecific', 'P', 0.32)], [T('long', 'S', 0.2)]],
  buildIntensity: [R, [T('intervals', 'P', 0.15)], [T('easy', 'S', 0.17), T('strength', 'gym', 0.06)], [T('threshold', 'P', 0.14)], R, [T('longSpecific', 'P', 0.29)], [T('easy', 'S', 0.19)]],
  build: [R, [T('intervals', 'P', 0.15)], [T('easy', 'S', 0.17), T('strength', 'gym', 0.06)], [T('threshold', 'P', 0.13)], R, [T('longSpecific', 'P', 0.3)], [T('long', 'S', 0.19)]],
  buildRace: [R, [T('racePace', 'P', 0.17)], [T('easy', 'S', 0.18)], [T('intervals', 'P', 0.13)], R, [T('rehearsal', 'P', 0.32)], [T('easy', 'S', 0.2)]],
  taper: [R, [T('intervalsShort', 'P', 0.24)], [T('easy', 'S', 0.24)], R, [T('activation', 'P', 0.12)], [T('easy', 'P', 0.2)], [T('easy', 'S', 0.2)]],
  recovery: [R, [T('recovery', 'S', 0.25)], R, [T('recovery', 'P', 0.25)], R, [T('recovery', 'S', 0.3)], [T('mobility', 'gym', 0.2)]],
  transition: [R, R, [T('free', 'free', 0.35)], R, R, [T('free', 'free', 0.4)], [T('mobility', 'gym', 0.25)]]
};
const templateFor = type => WEEKS[type] || (phaseType(type).load >= 0.8 ? WEEKS.build : phaseType(type).load >= 0.45 ? WEEKS.base : WEEKS.recovery);

/* Zones en part de la FC de réserve (Karvonen) et en part de la FTP. */
const ZONE = {
  recovery: { hr: [0.5, 0.6], ftp: [0.45, 0.55] },
  easy: { hr: [0.6, 0.72], ftp: [0.56, 0.75] },
  tempo: { hr: [0.75, 0.82], ftp: [0.76, 0.87] },
  threshold: { hr: [0.82, 0.88], ftp: [0.88, 0.95] },
  vo2: { hr: [0.88, 0.95], ftp: [1.06, 1.2] }
};

const SPORT_WORD = { run: 'Course', trail: 'Trail', bike: 'Vélo', ski: 'Ski de fond', skiroll: 'Ski-roue', gym: 'Renfo', hike: 'Rando', other: 'Activité' };

/* Bibliothèque de séances types : titre, contenu selon le sport, zone. */
const SESSIONS = {
  easy: { title: 'Endurance', zone: 'easy', text: () => 'Allure facile, aisance respiratoire : on peut parler pendant tout l’effort.' },
  long: { title: 'Sortie longue', zone: 'easy', text: f => (f === 'bike' ? 'Sortie longue régulière, cadence souple, alimentation toutes les 45 min.' : 'Sortie longue en endurance, hydratation et alimentation comme en course.') },
  skills: {
    title: 'Endurance + technique',
    zone: 'easy',
    text: f => ({ trail: 'Endurance avec 15 min de technique de descente et 6 lignes droites.', run: 'Endurance + 6 × 20 s de lignes droites rapides, récupération complète.', bike: 'Endurance + 6 × 1 min en vélocité (> 100 tr/min).', ski: 'Endurance + éducatifs : poussée sur un bâton, équilibre sur un ski.', skiroll: 'Endurance + éducatifs : un pas, deux temps, sans bâtons sur le plat.' }[f] || 'Endurance avec quelques éducatifs techniques.')
  },
  threshold: {
    title: 'Seuil',
    zone: 'threshold',
    text: f => ({ bike: '2 × 20 min au seuil (Sweet Spot), récupération 5 min.', trail: '3 × 10 min au seuil en côte régulière, récupération 3 min en descente.', run: '3 × 10 min au seuil, récupération 2 min trottinée.', ski: '3 × 10 min au seuil en skating, récupération 3 min.', skiroll: '3 × 10 min au seuil en skating, récupération 3 min.' }[f] || '3 × 10 min au seuil, récupération 3 min.')
  },
  intervals: {
    title: 'Fractionné VO₂max',
    zone: 'vo2',
    text: f => ({ bike: '5 × 4 min à PMA, récupération 4 min facile.', trail: '8 × 2 min en côte à 90-95 % de la FC max, récupération en descente.', run: '10 × 400 m ou 6 × 1000 m, récupération égale à l’effort.', ski: '6 × 3 min en montée, récupération 2 min.', skiroll: '6 × 3 min en montée (double poussée ou skating), récupération 2 min.' }[f] || '6 × 3 min intenses, récupération 2 min.')
  },
  intervalsShort: { title: 'Rappel d’intensité', zone: 'vo2', text: () => '5 × 1 min vif, récupération 1 min 30 : on garde le rythme sans se fatiguer.' },
  longSpecific: {
    title: 'Sortie longue spécifique',
    zone: 'easy',
    text: f => ({ trail: 'Sortie longue vallonnée, D+ proche de celui de la course, terrain et matériel de course.', bike: 'Sortie longue avec 2 × 20 min au tempo dans les cols.', run: 'Sortie longue avec les 20 dernières min à allure course.', ski: 'Sortie longue avec 3 × 10 min à allure course.', skiroll: 'Sortie longue avec 3 × 10 min à allure course.' }[f] || 'Sortie longue au plus près des conditions de course.')
  },
  racePace: { title: 'Allure course', zone: 'tempo', text: () => '3 × 15 min à l’allure visée le jour J, récupération 3 min.' },
  rehearsal: { title: 'Répétition générale', zone: 'tempo', text: () => 'Sortie longue dans les conditions de la course : horaire, matériel, ravitaillement testés.' },
  activation: { title: 'Activation', zone: 'easy', text: () => '30 min faciles + 3 accélérations de 20 s : réveiller les jambes avant la course.' },
  recovery: { title: 'Récupération active', zone: 'recovery', text: () => 'Très facile et court, sans aucune intensité.' },
  strength: { title: 'Renforcement', zone: null, text: () => 'Gainage, squats, fentes, mollets, chaise : 3 séries, sans charge lourde.' },
  mobility: { title: 'Mobilité', zone: null, text: () => 'Étirements, mobilité des hanches et des chevilles, rouleau.' },
  free: { title: 'Activité libre', zone: 'easy', text: () => 'Le sport de ton choix, au plaisir, sans montre ni objectif.' }
};

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

/** Prochain objectif (course A) à partir de `key`, sinon prochaine course. */
function nextGoal(key) {
  const future = state.races.filter(r => r.date >= key).sort((a, b) => a.date.localeCompare(b.date));
  return future.find(r => racePriority(r.id) === 'A') || null;
}

/** Sport principal et secondaire d'une semaine. */
function sportsFor(monday, activities) {
  const goal = nextGoal(monday);
  let main = goal ? RACE_FAMILY[goal.sport] : null;
  // Recent practice: hours per sport over the last 8 weeks.
  const from = dateKey(addDays(fromKey(monday), -56));
  const hours = {};
  for (const a of activities) {
    if (a.date < from || a.date >= monday) continue;
    const f = familyOf(a);
    if (['gym', 'hike', 'other'].includes(f)) continue;
    hours[f] = (hours[f] || 0) + a.duration;
  }
  const ranked = Object.keys(hours).sort((a, b) => hours[b] - hours[a]);
  if (!main || main === 'gym') main = ranked[0] || 'run';
  if (main === 'ski' || main === 'skiroll') main = isSnowMonth(dateKey(addDays(fromKey(monday), 3))) ? 'ski' : 'skiroll';
  const second = ranked.find(f => f !== main && !(['ski', 'skiroll'].includes(f) && ['ski', 'skiroll'].includes(main))) || (main === 'bike' ? 'run' : 'bike');
  return { main, second, goal };
}

/** Cible de FC (bpm) et de puissance (W) d'une zone. */
function targets(zone, fam, s) {
  if (!zone) return '';
  const z = ZONE[zone];
  const bpm = v => Math.round(s.hrRest + v * (s.hrMax - s.hrRest));
  let out = `${bpm(z.hr[0])}–${bpm(z.hr[1])} bpm`;
  const ftp = state.bodyMetrics?.ftp?.at(-1)?.value;
  if (fam === 'bike' && ftp) out += ` · ${Math.round(ftp * z.ftp[0])}–${Math.round(ftp * z.ftp[1])} W`;
  return out;
}

const round5 = m => Math.max(20, Math.round(m / 5) * 5);

/**
 * Semaine du plan commençant le lundi `monday` (AAAA-MM-JJ).
 * @returns {null | {monday, phase, type, index, count, target, light, main, second, goal, days:[{key, sessions:[…], race}]}}
 */
export function planWeek(monday, activities, ref) {
  const phases = getPhases();
  const mid = dateKey(addDays(fromKey(monday), 3));
  const phase = phaseOn(mid, phases) || phaseOn(monday, phases) || phaseOn(dateKey(addDays(fromKey(monday), 6)), phases);
  if (!phase) return null;
  const s = analysisSettings();
  const first = mondayOf(fromKey(phase.start));
  const index = Math.round((fromKey(monday) - first) / (7 * 864e5));
  const count = Math.round((mondayOf(fromKey(phase.end)) - first) / (7 * 864e5)) + 1;
  const t = phaseType(phase.type);
  const light = CYCLED.has(phase.type) && count >= 4 && index % 4 === 3;
  const target = ref * (FACTOR[phase.type] ?? 0.3 + t.load * 0.8) * (light ? LIGHT_WEEK : 1);
  const { main, second, goal } = sportsFor(monday, activities);
  const famOf = sp => (sp === 'P' ? main : sp === 'S' ? second : sp);
  const template = templateFor(phase.type);
  let raceSeen = false;
  const days = template.map((list, i) => {
    const key = dateKey(addDays(fromKey(monday), i));
    const race = state.races.find(r => r.date === key && racePriority(r.id) !== 'C');
    if (race && racePriority(race.id) === 'A') raceSeen = true;
    const p = phaseOn(key, phases);
    if (race) return { key, race, sessions: [] };
    // Après un objectif dans la semaine, ou hors de toute phase : repos.
    if (raceSeen || !p) return { key, sessions: [] };
    const sessions = list.map(x => {
      const def = SESSIONS[x.kind];
      const fam = famOf(x.sport);
      const minutes = round5(target * 60 * x.share);
      return { kind: x.kind, fam, title: def.title, minutes, sport: fam === 'free' ? '' : SPORT_WORD[fam] || '', text: def.text(fam), target: targets(def.zone, fam, s), color: fam === 'free' ? '' : family(fam).color };
    });
    return { key, sessions };
  });
  return { monday, phase, type: t, index, count, target, light, main, second, goal, days };
}

/** Lundis des semaines couvertes par des phases, de `from` jusqu'à la fin de la dernière phase (max `max` semaines). */
export function planHorizon(fromMonday, max = 30) {
  const phases = getPhases();
  const last = phases.reduce((m, p) => (p.end > m ? p.end : m), '');
  const out = [];
  for (let d = fromKey(fromMonday); dateKey(d) <= last && out.length < max; d = addDays(d, 7)) out.push(dateKey(d));
  return out;
}
