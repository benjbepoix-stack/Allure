/*
 * Vue Saison : deux affichages.
 * - Plan (par défaut) : prochain objectif (J−, progression de la préparation),
 *   plan semaine par semaine coloré par les phases, cette semaine, puis tout
 *   ce qui arrive (courses et changements de phase) mois par mois.
 * - Calendrier : un mois en grille (glisser ou ‹ › pour changer de mois).
 * Toucher un jour, une semaine, une course ou une barre ouvre la fiche du jour
 * ou de la semaine dans une feuille (avec ‹ › pour passer au suivant).
 */
import { $, esc, round, plural } from '../core/utils.js';
import { addDays, dateKey, formatDate, formatKey, fromKey, mondayOf, todayKey } from '../core/dates.js';
import { state } from '../core/store.js';
import { MEASURE_FIELDS } from '../core/schema.js';
import { phaseType, getPhases, phaseOn, racesOn } from '../core/season.js';
import { racePriority } from '../core/planner.js';
import { readText, write } from '../services/storage.js';
import { icon } from '../ui/icons.js';
import { openSheet, isOpen } from '../ui/dialog.js';
import { REGISTRATIONS, countRegistrations, registrationName, registrationOf } from '../core/registration.js';
import { sortedRaces, isUpcoming, fmtDist, wheelValue, zeroClass, raceAction, saveResult, saveRegistration, wheelState } from './races.js';
import { openPhaseEditor, deletePhase } from './season.js';
import { openPlanner } from './planner.js';

const MODE_KEY = 'allure_saison_mode';

let mode = 'plan'; // 'plan' | 'cal'
let focus = todayKey(); // mois affiché par le calendrier
let sheet = { kind: 'day', key: todayKey() }; // fiche ouverte : jour ou semaine
let silentNext = false;
let regFilter = ''; // filtre des courses par état d'inscription ('' = toutes)
let onCatalog = () => {};

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const daysBetween = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 86400000);
const shortDate = key => formatKey(key, { day: 'numeric', month: 'short' });
const yearOf = key => Number(key.slice(0, 4));
const monthOf = key => key.slice(0, 7);
const firstOfMonth = key => `${monthOf(key)}-01`;
const lastOfMonth = key => {
  const d = fromKey(firstOfMonth(key));
  return dateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
};
const fmt1 = n => String(round(n, 1)).replace('.', ',');

function isoWeek(key) {
  const d = fromKey(key);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - y0) / 86400000 + 1) / 7);
}

/** « J−12 », « Aujourd’hui », « Demain ». */
function countdownLabel(key) {
  const n = daysBetween(todayKey(), key);
  if (n === 0) return 'Aujourd’hui';
  if (n === 1) return 'Demain';
  return `J−${n}`;
}

function weekInPhase(p, key) {
  const total = Math.max(1, Math.ceil((daysBetween(p.start, p.end) + 1) / 7));
  return [Math.min(total, Math.floor(daysBetween(p.start, key) / 7) + 1), total];
}

const monthTitle = key => cap(formatDate(fromKey(key), { month: 'long', year: 'numeric' }));

/* ---------- Lignes de course ---------- */
const regBadge = id => {
  const s = registrationOf(id);
  return `<span class="reg-badge reg--${s}"><i class="reg-dot"></i>${s === 'done' ? 'Inscrit' : s === 'partial' ? 'Incomplète' : 'À inscrire'}</span>`;
};

function raceRow(r, now, { day = false } = {}) {
  const past = !isUpcoming(r, now);
  const when = formatKey(r.date, day ? { day: 'numeric', month: 'short' } : { weekday: 'short', day: 'numeric' });
  const right = past ? (r.resultTime ? esc(r.resultTime) : '<span class="zmuted">Résultat ?</span>') : countdownLabel(r.date);
  return `<button type="button" class="zrow" data-go="day" data-key="${r.date}">
    <span class="zrow__flag">${icon('flag', 16)}</span>
    <span class="zrow__body"><strong>${esc(r.name)}</strong><span>${cap(when)} · ${esc(r.sport)}${r.distance !== '' ? ` · ${fmtDist(r)}` : ''}</span></span>
    ${past ? `<span class="zrow__end">${right}</span>` : `<span class="zrow__ends"><span class="zrow__end is-count">${right}</span>${regBadge(r.id)}</span>`}</button>`;
}

/* ---------- Échelle Mois : la saison ---------- */
/** Rappel des inscriptions à finaliser (toutes les courses à venir). */
function regReminderHTML() {
  const upcoming = sortedRaces().filter(r => isUpcoming(r));
  const n = countRegistrations(upcoming);
  if (!n.todo && !n.partial) return '';
  const first = upcoming.find(r => registrationOf(r.id) !== 'done');
  const parts = [n.todo ? `${n.todo} à faire` : '', n.partial ? `${n.partial} ${plural(n.partial, 'incomplète')}` : ''].filter(Boolean).join(' · ');
  return `<button type="button" class="zreg" data-act="reg-open" data-key="${first.date}" data-reg="${n.todo ? 'todo' : 'partial'}">
    <span class="zreg__k">Inscriptions</span><span class="zreg__v">${parts}</span><span class="zreg__go" aria-hidden="true">›</span></button>`;
}

function monthHTML() {
  const t = todayKey();
  const phases = getPhases();
  const first = firstOfMonth(focus);
  const last = lastOfMonth(focus);
  const start = mondayOf(fromKey(first));
  const head = ['L', 'M', 'M', 'J', 'V', 'S', 'D'].map(d => `<span class="zcal__dh" aria-hidden="true">${d}</span>`).join('');
  const cells = [];
  for (let w = 0; w < 6; w++) {
    const monday = dateKey(addDays(start, w * 7));
    if (w > 0 && monday > last) break;
    cells.push(`<button type="button" class="zcal__wk" data-go="week" data-key="${monday}" aria-label="Semaine ${isoWeek(monday)}">S${isoWeek(monday)}</button>`);
    for (let i = 0; i < 7; i++) {
      const key = dateKey(addDays(fromKey(monday), i));
      const p = phaseOn(key, phases);
      const races = racesOn(key);
      const out = monthOf(key) !== monthOf(focus);
      const label = [formatKey(key, { weekday: 'long', day: 'numeric', month: 'long' }), p ? phaseType(p.type).name : '', ...races.map(r => `course : ${r.name}`)].filter(Boolean).join(', ');
      const cls = ['zcal__d', p ? `phase--${p.type}` : '', races.length ? 'is-race' : '', key === t ? 'is-today' : '', out ? 'is-out' : ''].filter(Boolean).join(' ');
      cells.push(`<button type="button" class="${cls}" data-go="day" data-key="${key}" aria-label="${esc(label)}">${fromKey(key).getDate()}</button>`);
    }
  }
  const inMonth = phases.filter(p => p.start <= last && p.end >= first);
  const phaseRows = inMonth
    .map(
      p => `<div class="zphase phase--${p.type}">
        <button type="button" class="zphase__main" data-go="day" data-key="${p.start < first ? first : p.start}">
          <span class="phase-dot"></span><span class="zrow__body"><strong>${esc(phaseType(p.type).name)}</strong><span>${shortDate(p.start)} → ${shortDate(p.end)}${p.note ? ` · ${esc(p.note)}` : ''}</span></span>
        </button>
        <button type="button" class="icon-btn icon-btn--sm" data-act="phase-edit" data-id="${esc(p.id)}" aria-label="Modifier la phase">${icon('edit', 16)}</button>
        <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="phase-delete" data-id="${esc(p.id)}" aria-label="Supprimer la phase">${icon('trash', 16)}</button>
      </div>`
    )
    .join('');
  const now = new Date();
  const races = sortedRaces().filter(r => monthOf(r.date) === monthOf(focus));
  return `<div class="zcal" role="group" aria-label="${esc(monthTitle(focus))}"><span></span>${head}${cells.join('')}</div>
    <h2 class="zsec">Phases du mois</h2>
    ${inMonth.length ? `<div class="zlist">${phaseRows}</div>` : '<p class="zempty">Aucune phase ce mois-ci. Touchez Ajouter pour en planifier une.</p>'}
    ${races.length ? `<h2 class="zsec">Courses</h2><div class="zlist">${[...races].reverse().map(r => raceRow(r, now)).join('')}</div>` : ''}`;
}

/* ---------- Échelle Semaine ---------- */
function weekHTML(focus) {
  const t = todayKey();
  const phases = getPhases();
  const monday = mondayOf(fromKey(focus));
  const rows = [];
  for (let i = 0; i < 7; i++) {
    const key = dateKey(addDays(monday, i));
    const p = phaseOn(key, phases);
    const races = racesOn(key);
    const d = fromKey(key);
    let body;
    if (races.length) {
      const r = races[0];
      body = `<span class="zday__block is-race"><strong>${icon('flag', 14)} ${esc(r.name)}${races.length > 1 ? ` +${races.length - 1}` : ''}</strong><span>${[r.time, r.distance !== '' ? fmtDist(r) : '', isUpcoming(r) ? countdownLabel(r.date) : r.resultTime].filter(Boolean).map(esc).join(' · ')}</span></span>`;
    } else if (p) {
      const [w, total] = weekInPhase(p, key);
      body = `<span class="zday__block phase--${p.type}"><strong>${esc(phaseType(p.type).short)}</strong><span>${key === p.start ? 'Début de la phase' : key === p.end ? 'Dernier jour de la phase' : `Semaine ${w} sur ${total}`}</span></span>`;
    } else body = `<span class="zday__block is-empty"><strong>Aucune phase</strong><span>Touchez pour ajouter</span></span>`;
    rows.push(`<button type="button" class="zday${key === t ? ' is-today' : ''}" data-go="day" data-key="${key}">
      <span class="zday__date"><span>${formatDate(d, { weekday: 'short' })}</span><strong>${d.getDate()}</strong></span>${body}</button>`);
  }
  const p = phaseOn(dateKey(addDays(monday, 3)), phases);
  return `${p ? `<p class="zadvice phase--${p.type}"><b>${esc(phaseType(p.type).short)}</b> · ${esc(phaseType(p.type).advice)}</p>` : ''}<div class="zweek">${rows.join('')}</div>`;
}

/* ---------- Échelle Jour ---------- */
function raceCardHTML(r, now) {
  const past = !isUpcoming(r, now);
  const stats = [
    r.distance !== '' ? ['Distance', fmtDist(r)] : null,
    r.elevation !== '' ? ['Dénivelé', `${r.elevation} m`] : null,
    r.target ? ['Objectif', r.target] : null,
    r.price !== '' ? ['Inscription', `${String(r.price).replace('.', ',')} €`] : null
  ].filter(Boolean);
  return `<article class="zrace" data-id="${esc(r.id)}">
    <div class="zrace__kicker">${[r.sport, r.time ? `départ ${r.time}` : '', r.location].filter(Boolean).map(esc).join(' · ')}</div>
    <div class="zrace__big">${past ? (r.resultTime ? esc(r.resultTime) : 'Terminée') : countdownLabel(r.date)}</div>
    <h2 class="zrace__name">${esc(r.name)}</h2>
    ${stats.length ? `<div class="zrace__stats">${stats.map(([l, v]) => `<div><span>${l}</span><strong>${esc(v)}</strong></div>`).join('')}</div>` : ''}
    ${r.notes ? `<p class="zrace__notes">${esc(r.notes)}</p>` : ''}
    ${
      past
        ? ''
        : `<div class="zrace__reg"><div class="zrace__reg-title">État de l’inscription</div><div class="segmented zregseg" role="radiogroup" aria-label="État de l’inscription">${REGISTRATIONS.map(
            x => `<button type="button" class="reg--${x.id}" role="radio" data-act="race-reg" data-id="${esc(r.id)}" data-reg="${x.id}" aria-checked="${registrationOf(r.id) === x.id}">${x.name}</button>`
          ).join('')}</div></div>`
    }
    ${
      past
        ? `<div class="race-result"><div class="race-result__title">Résultat</div><div class="race-result__grid">
        <label class="mini-field"><span>Temps réalisé</span><input class="input input--center input--wheel${zeroClass(r.resultTime)}" type="time" data-result="resultTime" data-orig="${esc(r.resultTime)}" value="${wheelValue(r.resultTime)}"></label>
        <label class="mini-field"><span>Classement</span><input class="input input--center" data-result="resultRank" maxlength="40" inputmode="numeric" value="${esc(r.resultRank)}"></label>
        <label class="mini-field"><span>Distance (km)</span><input class="input input--center" data-result="resultDistance" maxlength="40" inputmode="decimal" value="${esc(r.resultDistance)}"></label>
      </div></div>`
        : ''
    }
    <div class="zactions">
      ${past ? '' : `<button type="button" class="btn btn--soft btn--sm" data-act="race-calendar" data-id="${esc(r.id)}">${icon('calendarPlus', 16)}<span>Calendrier</span></button>`}
      <button type="button" class="btn btn--soft btn--sm" data-act="race-edit" data-id="${esc(r.id)}">${icon('edit', 16)}<span>Modifier</span></button>
      <button type="button" class="btn btn--soft btn--sm zdanger" data-act="race-delete" data-id="${esc(r.id)}">${icon('trash', 16)}<span>Supprimer</span></button>
    </div>
  </article>`;
}

function dayHTML(focus) {
  const t = todayKey();
  const now = new Date();
  const races = racesOn(focus);
  const p = phaseOn(focus);
  let html = races.map(r => raceCardHTML(r, now)).join('');
  if (p) {
    const [w, total] = weekInPhase(p, focus);
    const left = daysBetween(focus, p.end);
    html += `<section class="phase-now phase--${p.type} zphase-card">
      <div class="phase-now__kicker">${focus === t ? 'Aujourd’hui · ' : ''}Semaine ${w} sur ${total}</div>
      <div class="phase-now__name">${esc(phaseType(p.type).name)}</div>
      <div class="phase-now__dates">${shortDate(p.start)} → ${shortDate(p.end)} · ${left === 0 ? 'dernier jour' : `encore ${left} ${plural(left, 'jour')}`}</div>
      <p class="phase-now__advice">${esc(phaseType(p.type).advice)}</p>
      ${p.note ? `<p class="phase-now__note">${esc(p.note)}</p>` : ''}
      <div class="zactions">
        <button type="button" class="btn btn--soft btn--sm" data-act="phase-edit" data-id="${esc(p.id)}">${icon('edit', 16)}<span>Modifier la phase</span></button>
        <button type="button" class="btn btn--soft btn--sm zdanger" data-act="phase-delete" data-id="${esc(p.id)}">${icon('trash', 16)}<span>Supprimer</span></button>
      </div>
    </section>`;
  } else {
    html += `<section class="phase-now phase-now--empty zphase-card">
      <div class="phase-now__kicker">${focus === t ? 'Aujourd’hui' : 'Phase'}</div>
      <div class="phase-now__name">Aucune phase ce jour-là</div>
      <div class="zactions"><button type="button" class="btn btn--soft btn--sm" data-act="phase-add">${icon('plus', 16)}<span>Planifier une phase à partir d’ici</span></button></div>
    </section>`;
  }
  const bm = state.bodyMetrics;
  const w = bm.weight.find(x => x.date === focus);
  const f = bm.ftp.find(x => x.date === focus);
  const m = bm.measurements.find(x => x.date === focus);
  const measures = [w ? `Poids ${fmt1(w.value)} kg` : '', f ? `FTP ${Math.round(f.value)} W` : '', m ? MEASURE_FIELDS.filter(([k]) => m[k] !== null).map(([k, l]) => `${l} ${fmt1(m[k])}`).join(' · ') : ''].filter(Boolean);
  if (measures.length) html += `<div class="zcard"><span class="zcard__k">Mesures du jour</span><p>${measures.map(esc).join('<br>')}</p></div>`;
  if (!races.length) {
    const next = sortedRaces().find(r => r.date > focus && isUpcoming(r, now));
    if (next) html += `<div class="zlist zlist--next">${raceRow(next, now, { day: true })}</div>`;
  }
  return html;
}


/* ---------- Plan : prochain objectif ---------- */
/** Prochain objectif (course A à venir), sinon prochaine course. */
function nextGoal() {
  const upcoming = sortedRaces().filter(r => isUpcoming(r));
  return upcoming.find(r => racePriority(r.id) === 'A') || upcoming[0] || null;
}

/**
 * Début de la préparation d'une course : début de la suite de phases qui y mène
 * (sans remonter avant l'objectif précédent), sinon 16 semaines avant.
 */
function prepStart(race) {
  const phases = getPhases();
  const prevGoal = sortedRaces()
    .filter(r => r.date < race.date && r.id !== race.id && racePriority(r.id) === 'A')
    .at(-1);
  const floor = prevGoal ? dateKey(addDays(fromKey(prevGoal.date), 1)) : '';
  let p = phaseOn(race.date, phases) || [...phases].reverse().find(x => x.end < race.date && daysBetween(x.end, race.date) <= 7);
  if (!p) return dateKey(addDays(fromKey(race.date), -112));
  let start = p.start;
  for (;;) {
    const prev = phases.filter(x => x.end < start && daysBetween(x.end, start) <= 1).at(-1);
    if (!prev || prev.type === 'transition' || prev.type === 'recovery' || (floor && prev.end < floor)) break;
    start = prev.start;
  }
  if (floor && start < floor) start = floor;
  return start;
}

function heroHTML() {
  const r = nextGoal();
  if (!r) {
    return `<section class="shero shero--empty">
      <span class="shero__pill">Prochain objectif</span>
      <h2 class="shero__name">Aucune course à venir</h2>
      <p class="shero__meta">Choisis tes cyclosportives et tes courses de ski de fond dans l’onglet Courses.</p>
      <button type="button" class="btn shero__btn" data-act="catalog">${icon('flag', 16)}<span>Choisir mes courses</span></button>
    </section>`;
  }
  const t = todayKey();
  const start = prepStart(r);
  const total = Math.max(1, daysBetween(start, r.date));
  const done = Math.min(total, Math.max(0, daysBetween(start, t)));
  const left = daysBetween(t, r.date);
  const goal = racePriority(r.id) === 'A';
  const meta = [r.distance !== '' ? fmtDist(r) : '', r.elevation !== '' ? `${Number(r.elevation).toLocaleString('fr-FR')} m` : '', r.sport].filter(Boolean);
  return `<button type="button" class="shero" data-go="day" data-key="${r.date}">
    <span class="shero__top"><span class="shero__pill">${goal ? 'Prochain objectif' : 'Prochaine course'}</span>${regBadge(r.id)}</span>
    <span class="shero__main">
      <span class="shero__id"><strong class="shero__name">${esc(r.name)}</strong><span class="shero__meta">${meta.map(esc).join(' · ')}</span></span>
      <span class="shero__count"><strong>${left === 0 ? 'J' : left}</strong><span>${left === 0 ? 'Aujourd’hui' : plural(left, 'jour')}</span></span>
    </span>
    <span class="shero__dates"><span>Début : ${shortDate(start)}</span><span>${goal ? 'Objectif' : 'Course'} : ${shortDate(r.date)}</span></span>
    <span class="shero__bar" role="progressbar" aria-label="Préparation" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round((done / total) * 100)}"><i style="width:${Math.max(2, (done / total) * 100)}%"></i></span>
  </button>`;
}

/* ---------- Plan : semaines colorées par phase ---------- */
function planHTML() {
  const t = todayKey();
  const phases = getPhases();
  const goal = nextGoal();
  const thisMonday = mondayOf(fromKey(t));
  const goalStart = goal ? fromKey(prepStart(goal)) : null;
  // De 2 à 12 semaines avant aujourd'hui (début de la préparation), jusqu'à la dernière course ou phase planifiée.
  let from = goalStart && goalStart < thisMonday ? mondayOf(goalStart) : addDays(thisMonday, -14);
  if (daysBetween(dateKey(from), dateKey(thisMonday)) > 84) from = addDays(thisMonday, -84);
  if (daysBetween(dateKey(from), dateKey(thisMonday)) < 14) from = addDays(thisMonday, -14);
  const horizon = dateKey(addDays(thisMonday, 364));
  const ends = [dateKey(addDays(thisMonday, 8 * 7)), ...sortedRaces().filter(r => r.date >= t && r.date <= horizon).map(r => r.date), ...phases.filter(p => p.end >= t && p.start <= horizon).map(p => (p.end > horizon ? horizon : p.end))];
  const last = ends.sort().at(-1);
  const n = Math.min(52, Math.max(10, Math.ceil((daysBetween(dateKey(from), last) + 1) / 7)));
  const weeks = [];
  for (let i = 0; i < n; i++) {
    const monday = dateKey(addDays(from, i * 7));
    const sunday = dateKey(addDays(from, i * 7 + 6));
    const p = phaseOn(dateKey(addDays(from, i * 7 + 3)), phases);
    const races = state.races.filter(r => r.date >= monday && r.date <= sunday);
    weeks.push({ monday, sunday, p, races, goal: races.some(r => racePriority(r.id) === 'A'), now: t >= monday && t <= sunday, past: sunday < t });
  }
  // Libellés de phase au-dessus des groupes de semaines (assez larges pour être lus).
  const labels = [];
  weeks.forEach((w, i) => {
    if (!w.p || (i > 0 && weeks[i - 1].p?.id === w.p.id)) return;
    let j = i;
    while (j + 1 < n && weeks[j + 1].p?.id === w.p.id) j++;
    if ((j - i + 1) / n >= 0.09) labels.push(`<span class="splan__ph phase--${w.p.type}" style="left:${(i / n) * 100}%">${esc(phaseType(w.p.type).short)}</span>`);
  });
  const bars = weeks
    .map(w => {
      const h = w.p ? Math.max(14, Math.round(phaseType(w.p.type).load * 100)) : 8;
      const label = [`Semaine du ${shortDate(w.monday)}`, w.p ? phaseType(w.p.type).name : 'aucune phase', ...w.races.map(r => `course : ${r.name}`)].join(', ');
      return `<button type="button" class="splan__w${w.now ? ' is-now' : ''}${w.past ? ' is-past' : ''}" data-go="week" data-key="${w.monday}" aria-label="${esc(label)}">
        ${w.races.length ? `<span class="splan__race${w.goal ? ' is-goal' : ''}"></span>` : ''}
        <span class="splan__bar ${w.p ? `phase--${w.p.type}` : 'is-empty'}" style="height:${h}%"></span></button>`;
    })
    .join('');
  const step = n > 30 ? 2 : 1;
  let lastMonth = -1;
  let shown = 0;
  const months = weeks
    .map((w, i) => {
      const d = fromKey(w.monday);
      const m = d.getMonth();
      if (m === lastMonth) return '';
      lastMonth = m;
      if (shown++ % step) return '';
      return `<span style="left:${(i / n) * 100}%">${formatDate(d, { month: 'short' })}</span>`;
    })
    .join('');

  // Compteurs : semaine de préparation, phase en cours, inscriptions.
  const cur = phaseOn(t, phases);
  const upcoming = sortedRaces().filter(r => isUpcoming(r));
  const reg = countRegistrations(upcoming);
  const prepWeeks = goal ? Math.max(1, Math.ceil(daysBetween(prepStart(goal), goal.date) / 7)) : 0;
  const prepNow = goal ? Math.min(prepWeeks, Math.max(0, Math.floor(daysBetween(prepStart(goal), t) / 7) + 1)) : 0;
  const stats = [
    goal ? ['Semaine', `${prepNow}<small>/${prepWeeks}</small>`] : ['Semaine', `${isoWeek(t)}`],
    ['Phase', cur ? `<i class="phase-dot phase--${cur.type}"></i>${esc(phaseType(cur.type).short)}` : '—'],
    ['Inscrit', `${reg.done}<small>/${upcoming.length}</small>`]
  ]
    .map(([l, v]) => `<div class="sstat"><span>${l}</span><strong>${v}</strong></div>`)
    .join('');

  return `<section class="scard">
    <header class="scard__head"><h2>Mon plan</h2><button type="button" class="link-btn" data-act="planner">Phases auto</button></header>
    <div class="splan" style="--n:${n}">
      <div class="splan__labels">${labels.join('')}</div>
      <div class="splan__bars" role="group" aria-label="Semaines de la saison">${bars}</div>
      <div class="splan__months" aria-hidden="true">${months}</div>
    </div>
    <div class="sstats">${stats}</div>
  </section>`;
}

/* ---------- Plan : cette semaine ---------- */
function thisWeekHTML() {
  const t = todayKey();
  const phases = getPhases();
  const monday = mondayOf(fromKey(t));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const key = dateKey(addDays(monday, i));
    const p = phaseOn(key, phases);
    const races = racesOn(key);
    const d = fromKey(key);
    const label = [formatKey(key, { weekday: 'long', day: 'numeric', month: 'long' }), p ? phaseType(p.type).name : '', ...races.map(r => `course : ${r.name}`)].filter(Boolean).join(', ');
    days.push(`<button type="button" class="sday${key === t ? ' is-today' : ''}${key < t ? ' is-past' : ''}${races.length ? ' is-race' : ''}${p ? ` phase--${p.type}` : ''}" data-go="day" data-key="${key}" aria-label="${esc(label)}">
      <span>${formatDate(d, { weekday: 'narrow' })}</span><strong>${d.getDate()}</strong><i></i></button>`);
  }
  const p = phaseOn(t, phases);
  let advice = '';
  if (p) {
    const [w, total] = weekInPhase(p, t);
    advice = `<p class="sadvice phase--${p.type}"><b>${esc(phaseType(p.type).short)} · semaine ${w} sur ${total}</b>${esc(phaseType(p.type).advice)}</p>`;
  }
  return `<section class="scard">
    <header class="scard__head"><h2>Cette semaine</h2><button type="button" class="link-btn" data-go="week" data-key="${dateKey(monday)}">Détail</button></header>
    <div class="sweek">${days.join('')}</div>
    ${advice}
  </section>`;
}

/* ---------- Plan : à venir, mois par mois ---------- */
function upcomingHTML() {
  const t = todayKey();
  const now = new Date();
  const phases = getPhases();
  const horizon = dateKey(addDays(fromKey(t), 365));
  const upcoming = sortedRaces().filter(r => isUpcoming(r, now) && r.date <= horizon);
  const n = countRegistrations(upcoming);
  const filter = upcoming.length ? regFilter : '';
  const races = filter ? upcoming.filter(r => registrationOf(r.id) === filter) : upcoming;
  const items = [
    ...races.map(r => ({ date: r.date, html: raceRow(r, now, { day: true }) })),
    ...(filter
      ? []
      : phases
          .filter(p => p.start > t && p.start <= horizon)
          .map(p => ({
            date: p.start,
            html: `<button type="button" class="srow-phase phase--${p.type}" data-go="day" data-key="${p.start}"><i class="phase-dot"></i><span><b>${esc(phaseType(p.type).name)}</b> · ${shortDate(p.start)} → ${shortDate(p.end)}</span></button>`
          })))
  ].sort((a, b) => a.date.localeCompare(b.date) || (a.html.startsWith('<button type="button" class="srow-phase') ? -1 : 1));
  const chip = (id, label, count) =>
    `<button type="button" class="chip-btn${id ? ` reg--${id}` : ''}" data-act="reg-filter" data-reg="${id}" aria-pressed="${filter === id}">${label}<b>${count}</b></button>`;
  const chips = upcoming.length ? `<div class="zregs" role="group" aria-label="Filtrer par inscription">${chip('', 'Toutes', upcoming.length)}${REGISTRATIONS.map(x => chip(x.id, x.name, n[x.id])).join('')}</div>` : '';
  let month = '';
  const rows = items
    .map(it => {
      const m = monthOf(it.date);
      const headHTML = m !== month ? `<h3 class="smonth">${esc(monthTitle(`${m}-01`))}</h3>` : '';
      month = m;
      return headHTML + it.html;
    })
    .join('');
  const empty = filter
    ? `<p class="zempty">Aucune course à venir avec l’inscription « ${esc(registrationName(filter).toLowerCase())} ».</p>`
    : '<p class="zempty">Rien de prévu. Ajoute tes courses depuis l’onglet Courses.</p>';
  // Courses terminées des 12 derniers mois, la plus récente en premier.
  const since = dateKey(addDays(fromKey(t), -365));
  const past = sortedRaces().filter(r => !isUpcoming(r, now) && r.date >= since).reverse();
  return `<h2 class="zsec" id="saisonUpcoming">À venir</h2>${chips}<div class="zlist">${rows || empty}</div>
    ${past.length ? `<h2 class="zsec">Terminées</h2><div class="zlist">${past.map(r => raceRow(r, now, { day: true })).join('')}</div>` : ''}`;
}

/* ---------- Rendu ---------- */
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function renderZoom({ slide = 0 } = {}) {
  if (silentNext) {
    silentNext = false;
    return;
  }
  const body = $('#zoomBody');
  if (!body) return;
  document.querySelectorAll('#saisonModes [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === mode)));
  $('#calNav').hidden = mode !== 'cal';
  if (mode === 'plan') body.innerHTML = heroHTML() + regReminderHTML() + planHTML() + thisWeekHTML() + upcomingHTML();
  else {
    body.innerHTML = monthHTML();
    $('#calTitle').textContent = monthTitle(focus);
    $('#zoomToday').hidden = monthOf(focus) === monthOf(todayKey());
  }
  $('#headerTitle').textContent = 'Saison';
  if (isOpen('daySheet')) renderSheet();
  if (slide) {
    body.style.transform = '';
    body.classList.remove('is-slide-next', 'is-slide-prev', 'is-fade');
    void body.offsetWidth;
    body.classList.add(reduceMotion() ? 'is-fade' : slide > 0 ? 'is-slide-next' : 'is-slide-prev');
  }
}

function setMode(next) {
  if (next === mode) return;
  mode = next;
  write(MODE_KEY, mode);
  renderZoom();
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function shift(n) {
  if (mode !== 'cal') return;
  const d = fromKey(focus);
  focus = dateKey(new Date(d.getFullYear(), d.getMonth() + n, 1, 12));
  if (monthOf(focus) === monthOf(todayKey())) focus = todayKey();
  renderZoom({ slide: n });
}

/* ---------- Fiche du jour / de la semaine ---------- */
function renderSheet() {
  const { kind, key } = sheet;
  if (kind === 'week') {
    const monday = mondayOf(fromKey(key));
    const sunday = addDays(monday, 6);
    $('#dayTitle').textContent = `${formatDate(monday, { day: 'numeric', month: 'short' })} – ${formatDate(sunday, { day: 'numeric', month: 'short' })}`;
    $('#dayBody').innerHTML = weekHTML(key);
  } else {
    $('#dayTitle').textContent = cap(formatKey(key, { weekday: 'long', day: 'numeric', month: 'long' }));
    $('#dayBody').innerHTML = dayHTML(key);
  }
  $('#dayPrev').setAttribute('aria-label', kind === 'week' ? 'Semaine précédente' : 'Jour précédent');
  $('#dayNext').setAttribute('aria-label', kind === 'week' ? 'Semaine suivante' : 'Jour suivant');
}

function openDetail(kind, key) {
  sheet = { kind, key };
  renderSheet();
  $('#dayBody').scrollTop = 0;
  openSheet('daySheet', { focus: false });
}

/** Date proposée aux formulaires d'ajout : le jour de la fiche ouverte, sinon rien. */
export const zoomContextDay = () => (isOpen('daySheet') && sheet.kind === 'day' ? sheet.key : '');

/** Affiche le jour d'une course ou d'une phase qui vient d'être enregistrée. */
export function showDay(key) {
  if (!key) return;
  if (isOpen('daySheet')) {
    sheet = { kind: 'day', key };
    renderSheet();
  } else openDetail('day', key);
}

/* ---------- Glisser à gauche / à droite : mois suivant / précédent (calendrier) ---------- */
function bindSwipe(body) {
  let s = null;
  body.addEventListener(
    'touchstart',
    e => {
      if (mode !== 'cal' || e.touches.length !== 1 || e.target.closest('input, textarea, select')) {
        s = null;
        return;
      }
      s = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), axis: null, dx: 0 };
    },
    { passive: true }
  );
  body.addEventListener(
    'touchmove',
    e => {
      if (!s || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      if (!s.axis && Math.hypot(dx, dy) > 10) s.axis = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'x' : 'y';
      if (s.axis !== 'x') return;
      e.preventDefault();
      s.dx = dx;
      if (!reduceMotion()) body.style.transform = `translateX(${dx}px)`;
    },
    { passive: false }
  );
  const end = () => {
    if (!s) return;
    const { axis, dx, t } = s;
    s = null;
    if (axis !== 'x') return;
    const fast = Math.abs(dx) / Math.max(1, Date.now() - t) > 0.5;
    if (Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30)) shift(dx < 0 ? 1 : -1);
    else {
      body.style.transition = 'transform 220ms var(--ease)';
      body.style.transform = '';
      setTimeout(() => (body.style.transition = ''), 240);
    }
  };
  body.addEventListener('touchend', end);
  body.addEventListener('touchcancel', end);
}

/** Clics dans la Saison et dans la fiche : actions et ouverture d'un jour / d'une semaine. */
function onClick(e) {
  const act = e.target.closest('[data-act]');
  if (act) {
    const { id } = act.dataset;
    switch (act.dataset.act) {
      case 'race-calendar': return raceAction('calendar', id);
      case 'race-edit': return raceAction('edit', id);
      case 'race-delete': return raceAction('delete', id);
      case 'phase-edit': return openPhaseEditor(id);
      case 'phase-delete': return deletePhase(id);
      case 'phase-add': return openPhaseEditor(null, { start: sheet.key });
      case 'race-reg': return saveRegistration(id, act.dataset.reg);
      case 'catalog': return onCatalog();
      case 'planner': return openPlanner();
      case 'reg-filter':
        regFilter = act.dataset.reg;
        return renderZoom();
      case 'reg-open':
        regFilter = act.dataset.reg;
        renderZoom();
        return $('#saisonUpcoming')?.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
    return;
  }
  const go = e.target.closest('[data-go]');
  if (!go?.dataset.key) return;
  if (go.dataset.go === 'week') openDetail('week', go.dataset.key);
  else if (go.dataset.go === 'day') {
    if (isOpen('daySheet')) {
      sheet = { kind: 'day', key: go.dataset.key };
      renderSheet();
      $('#dayBody').scrollTop = 0;
    } else openDetail('day', go.dataset.key);
  }
}

function onResultChange(e) {
  const input = e.target.closest('[data-result]');
  const id = input?.closest('[data-id]')?.dataset.id;
  if (!input || !id) return;
  silentNext = true; // pas de re-rendu : on garde la saisie en cours
  if (!saveResult(input, id)) {
    silentNext = false;
    renderZoom();
  }
}

export function initZoom({ openCatalog } = {}) {
  if (openCatalog) onCatalog = openCatalog;
  mode = readText(MODE_KEY, 'plan') === 'cal' ? 'cal' : 'plan';
  const body = $('#zoomBody');
  body.addEventListener('animationend', () => body.classList.remove('is-slide-next', 'is-slide-prev', 'is-fade'));
  body.addEventListener('click', onClick);
  $('#dayBody').addEventListener('click', onClick);
  $('#dayBody').addEventListener('input', wheelState);
  $('#dayBody').addEventListener('change', onResultChange);
  $('#saisonModes').addEventListener('click', e => {
    const b = e.target.closest('[data-mode]');
    if (b) setMode(b.dataset.mode);
  });
  $('#zoomPrev').addEventListener('click', () => shift(-1));
  $('#zoomNext').addEventListener('click', () => shift(1));
  $('#zoomToday').addEventListener('click', () => {
    focus = todayKey();
    renderZoom({ slide: -1 });
  });
  const step = n => {
    const d = fromKey(sheet.key);
    sheet = { ...sheet, key: dateKey(addDays(d, n * (sheet.kind === 'week' ? 7 : 1))) };
    renderSheet();
  };
  $('#dayPrev').addEventListener('click', () => step(-1));
  $('#dayNext').addEventListener('click', () => step(1));
  bindSwipe(body);
}
