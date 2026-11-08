/* Données communes aux trois maquettes.
 * Vélo, course, trail, ski-roue : chiffres réels tirés de Strava (juillet → 8 novembre 2026).
 * Références d'hiver (ski) et de trail long : estimées pour la maquette.
 * Score de forme d'un sport = 100 × (ce que tu fais maintenant / ce que tu faisais à ton meilleur niveau dans CE sport),
 * pondéré selon ce qui compte dans ce sport. Zone « prêt » : 85 et plus. */
const TODAY = '2026-11-08';

const SPORTS = {
  ski: {
    id: 'ski', name: 'Ski de fond', short: 'Ski', color: '#14b8a6', score: 35, delta: +6,
    ref: 'Janvier 2026, avant la Transju', target: 85,
    lead: 'En ski, c’est le temps passé sur les skis (ou ski-roues) qui fait la forme.',
    parts: [
      { k: 'Ski et ski-roue', w: 50, v: 15, now: '44 min / sem', best: '5 h / sem' },
      { k: 'Endurance tous sports', w: 30, v: 58, now: '4,6 h / sem', best: '8 h / sem' },
      { k: 'Intensité', w: 20, v: 50, now: '1 séance dure / 2 sem', best: '1 / sem' }
    ],
    hist: [10, 12, 12, 12, 13, 14, 14, 16, 18, 20, 22, 25, 28, 30, 32, 34, 35],
    advice: 'Passe à 2 sorties ski-roue par semaine, dont une longue (1 h 30).'
  },
  run: {
    id: 'run', name: 'Course à pied', short: 'Course', color: '#ff6b4a', score: 75, delta: +5,
    ref: 'Printemps 2026 (estimé)', target: 85,
    lead: 'En course, ce sont les séances spécifiques et la vitesse qui comptent, plus que le volume.',
    parts: [
      { k: 'Séances de qualité', w: 50, v: 75, now: '3 en 4 sem (5×2′, 4×3′, tempo)', best: '4 en 4 sem' },
      { k: 'Vitesse à effort égal', w: 30, v: 88, now: '4:15 /km en endurance', best: '4:00 /km' },
      { k: 'Régularité', w: 20, v: 55, now: '2,2 sorties / sem', best: '4 / sem' }
    ],
    hist: [40, 40, 42, 44, 46, 48, 50, 52, 55, 58, 62, 65, 68, 70, 72, 74, 75],
    advice: 'Garde une séance de qualité par semaine : tu es à 10 points du « prêt ».'
  },
  trail: {
    id: 'trail', name: 'Trail', short: 'Trail', color: '#f2a516', score: 55, delta: +3,
    ref: 'Saison trail 2025 (estimé)', target: 85,
    lead: 'En trail, le dénivelé et la sortie longue font la différence. 100 = ton meilleur niveau à toi, pas un chiffre absolu.',
    parts: [
      { k: 'Dénivelé', w: 40, v: 54, now: '430 m D+ / sem', best: '800 m / sem' },
      { k: 'Sortie longue', w: 30, v: 40, now: '59 min (3 nov.)', best: '2 h 30' },
      { k: 'Côtes et intensité', w: 30, v: 70, now: '4×3′ et 5×2′ en côte', best: '1 séance / sem' }
    ],
    hist: [20, 22, 25, 28, 30, 33, 36, 38, 41, 44, 47, 49, 51, 52, 53, 54, 55],
    advice: 'Allonge une sortie par semaine de 15 min jusqu’à 2 h.'
  },
  bike: {
    id: 'bike', name: 'Vélo', short: 'Vélo', color: '#3d82f6', score: 31, delta: -4,
    ref: 'Juillet 2026, avant l’Étape du Tour', target: 85,
    lead: 'En vélo, c’est le volume qui fait la forme : les heures et la sortie longue.',
    parts: [
      { k: 'Volume', w: 60, v: 26, now: '1,8 h / sem', best: '6,9 h / sem' },
      { k: 'Sortie longue', w: 25, v: 24, now: '1 h 36 (31 oct.)', best: '6 h 40' },
      { k: 'Intensité', w: 15, v: 60, now: '1 séance dure / 2 sem', best: '1 / sem' }
    ],
    hist: [92, 95, 88, 84, 80, 78, 74, 70, 64, 58, 52, 47, 42, 38, 35, 33, 31],
    advice: 'Normal en novembre : le vélo reviendra au printemps, rien à forcer.'
  }
};
const SPORT_ORDER = ['ski', 'run', 'trail', 'bike'];
const HIST_START = '2026-07-13'; // lundi de la 1re semaine de hist

/* Courses à venir. */
const RACES = [
  { id: 'fb', name: 'La Foulée Blanche', sport: 'ski', date: '2027-01-31', prio: 'B', place: 'Autrans', dist: '42 km skating', proj: 86, est: true },
  { id: 'tj', name: 'La Transjurassienne', sport: 'ski', date: '2027-02-14', prio: 'A', place: 'Lamoura → Mouthe', dist: '50 km classique', proj: 92 },
  { id: 'tr', name: 'Trail de printemps', sport: 'trail', date: '2027-05-09', prio: 'A', place: 'Besançon', dist: '25 km · 1 100 m D+', proj: 88, example: true },
  { id: 'et', name: 'L’Étape du Tour', sport: 'bike', date: '2027-07-11', prio: 'A', place: 'Alpes', dist: '≈ 170 km · 4 500 m D+', proj: 90, est: true }
];

/* Phases (blocs) jusqu’à l’Étape du Tour. race = id de la course qui clôt le bloc. */
const PHASES = [
  { b: 'prep', name: 'Reprise foncière', from: '2026-11-02', to: '2026-11-29', tip: 'Beaucoup d’endurance facile, tous sports. Une séance de qualité en course.', aim: 'Ski 35 → 45' },
  { b: 'prep', name: 'Volume ski', from: '2026-11-30', to: '2027-01-03', tip: 'Monte le temps sur les skis : 4 à 6 h / sem, une sortie longue de 2 h.', aim: 'Ski 45 → 70' },
  { b: 'spec', name: 'Spécifique ski', from: '2027-01-04', to: '2027-01-24', tip: 'Deux séances d’intensité (seuil, 4×6′) et une sortie de 2 h 30.', aim: 'Ski 70 → 84' },
  { b: 'taper', name: 'Affûtage', from: '2027-01-25', to: '2027-01-30', tip: 'Volume divisé par deux, quelques accélérations. Tu dois arriver reposé.', aim: 'Ski 86 · reposé', race: 'fb' },
  { b: 'rest', name: 'Récupération', from: '2027-02-01', to: '2027-02-05', tip: 'Facile et court. Dors.', aim: '' },
  { b: 'taper', name: 'Affûtage', from: '2027-02-06', to: '2027-02-13', tip: 'Une séance courte au rythme course, le reste facile.', aim: 'Ski 92 · reposé', race: 'tj' },
  { b: 'rest', name: 'Transition', from: '2027-02-15', to: '2027-02-28', tip: 'Coupe deux semaines, sports plaisir.', aim: '' },
  { b: 'prep', name: 'Foncier course', from: '2027-03-01', to: '2027-04-04', tip: 'Sorties longues vallonnées, D+ en hausse.', aim: 'Trail 50 → 72' },
  { b: 'spec', name: 'Spécifique trail', from: '2027-04-05', to: '2027-04-25', tip: 'Côtes, descente, sortie de 2 h 30 au profil de la course.', aim: 'Trail 72 → 86' },
  { b: 'taper', name: 'Affûtage', from: '2027-04-26', to: '2027-05-08', tip: 'Garde l’intensité, coupe le volume.', aim: 'Trail 88 · reposé', race: 'tr' },
  { b: 'rest', name: 'Récupération', from: '2027-05-09', to: '2027-05-23', tip: 'Récupère, puis reprends le vélo.', aim: '' },
  { b: 'prep', name: 'Volume vélo', from: '2027-05-24', to: '2027-06-20', tip: 'Le volume avant tout : 8 à 10 h / sem.', aim: 'Vélo 40 → 80' },
  { b: 'spec', name: 'Spécifique cols', from: '2027-06-21', to: '2027-07-04', tip: 'Longues ascensions au seuil, une sortie de 6 h.', aim: 'Vélo 80 → 88' },
  { b: 'taper', name: 'Affûtage', from: '2027-07-05', to: '2027-07-10', tip: 'Courtes sorties avec quelques efforts.', aim: 'Vélo 90 · reposé', race: 'et' }
];
const BLOCKS = {
  prep: { name: 'Préparation générale', short: 'Prépa', color: '#2f80ff' },
  spec: { name: 'Spécifique', short: 'Spécifique', color: '#7a3cf0' },
  taper: { name: 'Affûtage', short: 'Affûtage', color: '#e9a800' },
  rest: { name: 'Récupération', short: 'Récup', color: '#10b981' }
};

/* Cette semaine (9 → 15 nov.), en phase « Reprise foncière ». */
const WEEK = [
  { d: 'Mar', sport: 'run', t: 'Course · 6×3′ au seuil', m: '50 min', key: true },
  { d: 'Jeu', sport: 'ski', t: 'Ski-roue · endurance', m: '1 h 15', key: false },
  { d: 'Sam', sport: 'ski', t: 'Ski-roue · sortie longue', m: '1 h 45', key: true },
  { d: 'Dim', sport: 'trail', t: 'Trail vallonné', m: '1 h 20 · 400 m D+', key: true }
];
const FRESH = { label: 'Reposé', note: 'Charge des 7 derniers jours plus basse que d’habitude : tu peux charger.' };

/* ---------- Outils ---------- */
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const toD = k => new Date(k + 'T12:00:00');
const days = (a, b) => Math.round((toD(b) - toD(a)) / 864e5);
const fmt = k => { const d = toD(k); return d.getDate() + ' ' + MOIS[d.getMonth()]; };
const fmtRange = (a, b) => fmt(a) + ' → ' + fmt(b);
const weeks = (a, b) => Math.max(1, Math.round((days(a, b) + 1) / 7));
const status = s => (s >= 85 ? { t: 'Prêt', c: 'ok' } : s >= 50 ? { t: 'En route', c: 'mid' } : { t: 'En construction', c: 'low' });
const race = id => RACES.find(r => r.id === id);
const nextRace = (sport) => RACES.find(r => r.date > TODAY && (!sport || r.sport === sport));
const nextGoal = () => RACES.find(r => r.date > TODAY && r.prio === 'A');
/* Phases depuis aujourd’hui jusqu’à la course `rid` incluse. */
function phasesUntil(rid) {
  const r = race(rid);
  return PHASES.filter(p => p.to >= TODAY && p.from <= r.date);
}
const currentPhase = () => PHASES.find(p => p.from <= TODAY && p.to >= TODAY);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Petite courbe : historique (plein) + projection (pointillé) jusqu’à `projTo` points de plus vers `projVal`. */
function sparkSVG(hist, color, { w = 320, h = 110, proj = 0, projVal = 0, band = true } = {}) {
  const n = hist.length + proj;
  const x = i => 8 + (i * (w - 16)) / (n - 1);
  const y = v => h - 18 - ((h - 30) * v) / 100;
  let pts = hist.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  let projPts = '';
  if (proj) {
    const last = hist[hist.length - 1];
    const arr = [];
    for (let k = 0; k <= proj; k++) {
      const t = k / proj;
      const v = last + (projVal - last) * (1 - Math.pow(1 - t, 1.6));
      arr.push(`${x(hist.length - 1 + k).toFixed(1)},${y(v).toFixed(1)}`);
    }
    projPts = arr.join(' ');
  }
  const lx = x(hist.length - 1), ly = y(hist[hist.length - 1]);
  const area = `${x(0)},${y(0)} ${pts} ${lx},${y(0)}`;
  return `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="Évolution de la forme">
    ${band ? `<rect x="0" y="${y(100)}" width="${w}" height="${y(85) - y(100)}" fill="var(--ok-soft)"/>
    <text x="${w - 6}" y="${y(100) + 11}" text-anchor="end" class="spark-l">Zone prêt · 85+</text>` : ''}
    <line x1="0" x2="${w}" y1="${y(50)}" y2="${y(50)}" stroke="var(--line)" stroke-dasharray="2 4"/>
    <text x="4" y="${y(50) - 4}" class="spark-l">50</text>
    <polygon points="${area}" fill="${color}" opacity=".12"/>
    <polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
    ${proj ? `<polyline points="${projPts}" fill="none" stroke="${color}" stroke-width="2.2" stroke-dasharray="4 5" stroke-linecap="round"/>` : ''}
    <circle cx="${lx}" cy="${ly}" r="5" fill="${color}" stroke="var(--card)" stroke-width="2.5"/>
    <text x="8" y="${h - 3}" class="spark-l">juil.</text>
    <text x="${lx}" y="${h - 3}" text-anchor="middle" class="spark-l">auj.</text>
    ${proj ? `<text x="${w - 8}" y="${h - 3}" text-anchor="end" class="spark-l">course</text>` : ''}
  </svg>`;
}

/* Feuille (bottom sheet) commune. */
function openSheet(html) {
  let s = document.getElementById('sheet');
  if (!s) {
    s = document.createElement('div');
    s.id = 'sheet';
    s.innerHTML = '<div class="sheet-bg" data-close></div><div class="sheet-panel" role="dialog" aria-modal="true"><button class="sheet-x" data-close aria-label="Fermer">×</button><div class="sheet-body"></div></div>';
    document.querySelector('.phone').appendChild(s);
    s.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  }
  s.querySelector('.sheet-body').innerHTML = html;
  s.classList.add('open');
}
function closeSheet() { document.getElementById('sheet')?.classList.remove('open'); }

/* Explication d’un score de sport (utilisée par les 3 maquettes). */
function sportSheet(id) {
  const s = SPORTS[id];
  const st = status(s.score);
  return `<p class="eyebrow" style="color:${s.color}">${s.name}</p>
  <h2 class="sheet-title">${s.score}<small> / 100</small> <span class="pill ${st.c}">${st.t}</span></h2>
  <p class="muted">${esc(s.lead)}</p>
  <div class="recipe">${s.parts.map(p => `
    <div class="recipe-row">
      <div class="recipe-top"><b>${p.k}</b><span class="muted">compte pour ${p.w} %</span></div>
      <div class="meter"><i style="width:${p.v}%;background:${s.color}"></i></div>
      <div class="recipe-bot"><span>Maintenant : ${p.now}</span><span>À ton meilleur : ${p.best}</span></div>
    </div>`).join('')}
  </div>
  <p class="note">100 = ton meilleur niveau dans ce sport (${esc(s.ref)}). Chaque sport a sa propre échelle : 55 en trail et 75 en course veulent dire « 55 % et 75 % de toi au mieux ».</p>
  <p class="advice">${esc(s.advice)}</p>`;
}

function raceSheet(id) {
  const r = race(id), s = SPORTS[r.sport];
  const left = days(TODAY, r.date);
  return `<p class="eyebrow" style="color:${s.color}">${s.name} · ${r.prio === 'A' ? 'Objectif' : 'Préparation'}</p>
  <h2 class="sheet-title">${esc(r.name)}</h2>
  <p class="muted">${fmt(r.date)} 2027${r.est ? ' (date estimée)' : ''} · ${esc(r.place)} · ${esc(r.dist)}${r.example ? ' · course d’exemple' : ''}</p>
  <div class="kv"><div><span>Dans</span><b>${left} jours</b></div><div><span>Forme ${s.short.toLowerCase()} auj.</span><b>${s.score}</b></div><div><span>Prévue le jour J</span><b>${r.proj}</b></div></div>
  <p class="note">En suivant les phases prévues, ta forme ${s.short.toLowerCase()} passe de ${s.score} à ${r.proj} : ${r.proj >= 85 ? 'tu arrives dans la zone « prêt ».' : 'un peu juste.'}</p>`;
}

/* Bande proportionnelle des phases jusqu’à une course, avec « Tu es ici ». */
function phaseStrip(list) {
  const a = list[0].from < TODAY ? list[0].from : list[0].from;
  const z = list[list.length - 1].to;
  const total = days(a, z) + 1;
  const segs = list.map(p => {
    const w = ((days(p.from, p.to) + 1) / total) * 100;
    return `<i style="width:${w}%;background:${BLOCKS[p.b].color}" title="${esc(p.name)}"></i>`;
  }).join('');
  const here = Math.max(0, Math.min(100, (days(a, TODAY) / total) * 100));
  return `<div class="strip"><div class="strip-bar">${segs}</div><span class="strip-here" style="left:${here}%"><em>auj.</em></span></div>
  <div class="strip-ends"><span>${fmt(a)}</span><span>${fmt(z)}</span></div>`;
}
function phaseRows(list) {
  return list.map(p => {
    const cur = p.from <= TODAY && p.to >= TODAY;
    const r = p.race ? race(p.race) : null;
    return `<button class="ph-row${cur ? ' cur' : ''}" data-phase="${PHASES.indexOf(p)}">
      <span class="ph-c" style="background:${BLOCKS[p.b].color}"></span>
      <span class="ph-t"><b>${esc(p.name)}</b><small>${fmtRange(p.from, p.to)} · ${weeks(p.from, p.to)} sem${cur ? ' · en cours' : ''}</small></span>
      ${p.aim ? `<span class="ph-aim">${esc(p.aim)}</span>` : ''}
    </button>${r ? `<div class="ph-race" data-race="${r.id}"><svg class="flag" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg><b>${esc(r.name)}</b><small>${fmt(r.date)}</small></div>` : ''}`;
  }).join('');
}
function phaseSheet(i) {
  const p = PHASES[i], bl = BLOCKS[p.b];
  const cur = p.from <= TODAY && p.to >= TODAY;
  const wk = cur ? Math.floor(days(p.from, TODAY) / 7) + 1 : 0;
  return `<p class="eyebrow" style="color:${bl.color}">${bl.name}</p>
  <h2 class="sheet-title">${esc(p.name)}</h2>
  <p class="muted">${fmtRange(p.from, p.to)} · ${weeks(p.from, p.to)} semaine${weeks(p.from, p.to) > 1 ? 's' : ''}${cur ? ` · semaine ${wk} sur ${weeks(p.from, p.to)}` : ''}</p>
  <p class="advice">${esc(p.tip)}</p>
  ${p.aim ? `<p class="note">Objectif de forme : ${esc(p.aim)}</p>` : ''}`;
}
