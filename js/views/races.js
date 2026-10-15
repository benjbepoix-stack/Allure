/* Courses : éditeur, export calendrier, suppression et résultat (affichage dans la vue Zoom). */
import { $, esc, uid, parseNumber } from '../core/utils.js';
import { combine, parseDuration } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { RACE_SPORTS } from '../core/schema.js';
import { rules, validate, showErrors, clearErrors, formValues } from '../core/validation.js';
import { openSheet, closeSheet, confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { offerCalendar } from '../features/calendar-prompt.js';

let onSaved = () => {};

export const startOf = r => combine(r.date, r.time, '00:00');
export const isUpcoming = (r, now = new Date()) => startOf(r) > now;
export const sortedRaces = () => [...state.races].sort((a, b) => startOf(a) - startOf(b));

export function sportFamily(sport) {
  if (['Cyclisme', 'Gravel', 'VTT'].includes(sport)) return 'Vélo';
  if (['Ski de fond', 'Ski-roue'].includes(sport)) return 'Ski';
  return sport || 'Autre';
}

export const fmtDist = r => `${String(r.distance).replace('.', ',')} km`;

/* Durées saisies avec la roulette iOS (champ heure, 00:00 par défaut) et stockées en « 2h35 ». */
const pad2 = n => String(n).padStart(2, '0');
export function toWheel(value) {
  const m = parseDuration(value);
  return m > 0 && m < 1440 ? `${pad2(Math.floor(m / 60))}:${pad2(m % 60)}` : '';
}
export function fromWheel(value) {
  if (!value || value === '00:00') return '';
  const [h, m] = value.split(':').map(Number);
  return `${h}h${pad2(m)}`;
}
/** Valeur à enregistrer : la roulette, sinon l'ancienne valeur si elle n'était pas convertible (ex. « 26h »). */
export const durationValue = input =>
  fromWheel(input.value) || ((!input.value || input.value === '00:00') && input.dataset.orig && !toWheel(input.dataset.orig) ? input.dataset.orig : '');
/** La roulette part toujours de 00:00 ; 00:00 = non renseigné (affiché en grisé). */
export const wheelValue = v => toWheel(v) || '00:00';
export const zeroClass = v => (toWheel(v) ? '' : ' is-zero');

/** Course -> événement iCalendar. */
const toCalendarEvent = r => ({
  id: r.id,
  title: `🏁 ${r.name}`,
  date: r.date,
  time: r.time,
  durationMinutes: parseDuration(r.target) || 120,
  location: r.location,
  description: [
    `Sport : ${r.sport}`,
    r.distance ? `Distance : ${r.distance} km` : '',
    r.elevation ? `Dénivelé : ${r.elevation} m` : '',
    r.target ? `Objectif : ${r.target}` : '',
    r.notes
  ]
    .filter(Boolean)
    .join('\n'),
  alarmMinutes: r.time ? 60 : 0
});

/* ---------- Formulaire ---------- */
/** Ouvre l'éditeur : course existante (`id`) ou nouvelle course, à la date `date` si fournie. */
export function openRaceEditor(id = null, { date = '' } = {}) {
  const r = id ? state.races.find(x => x.id === id) : null;
  if (id && !r) return toastError('Cette course n’existe plus.');
  const form = $('#raceForm');
  form.reset();
  clearErrors(form);
  form.elements.editId.value = r?.id || '';
  $('#raceSheetTitle').textContent = r ? 'Modifier la course' : 'Nouvelle course';
  if (r) ['name', 'sport', 'date', 'time', 'location', 'distance', 'elevation', 'price', 'notes'].forEach(k => (form.elements[k].value = r[k] ?? ''));
  // Nouvelle course : sport de la dernière course saisie, un choix de moins à faire.
  else if (state.races.length) form.elements.sport.value = [...state.races].sort((a, b) => a.date.localeCompare(b.date)).at(-1).sport;
  if (!r && date) form.elements.date.value = date;
  form.elements.target.value = wheelValue(r?.target);
  form.elements.target.classList.toggle('is-zero', !toWheel(r?.target));
  form.elements.target.dataset.orig = r?.target || '';
  openSheet('raceSheet');
}

const raceSchema = {
  name: [rules.required('Le nom'), rules.maxLength(100)],
  sport: [rules.required('Le sport'), v => (RACE_SPORTS.includes(v) ? null : 'Sport invalide.')],
  date: [rules.date({ required: true })],
  time: [rules.time()],
  location: [rules.maxLength(100)],
  distance: [rules.number({ min: 0, max: 1000 })],
  elevation: [rules.number({ min: 0, max: 20000, integer: true })],
  price: [rules.number({ min: 0, max: 10000 })],
  target: [rules.maxLength(40)],
  notes: [rules.maxLength(2000)]
};

function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const v = formValues(form);
  const { valid, errors } = validate(v, raceSchema);
  if (!valid) return showErrors(form, errors);
  const numStr = x => (x === '' ? '' : String(parseNumber(x)));
  const existing = v.editId ? state.races.find(x => x.id === v.editId) : null;
  const race = {
    ...(existing || {}),
    id: existing?.id || uid(),
    name: v.name,
    sport: v.sport,
    date: v.date,
    time: v.time,
    location: v.location,
    distance: numStr(v.distance),
    elevation: numStr(v.elevation),
    price: numStr(v.price),
    target: durationValue(form.elements.target),
    notes: v.notes
  };
  if (existing) state.races[state.races.indexOf(existing)] = race;
  else state.races.push(race);
  if (commit('races') === false) return;
  closeSheet('raceSheet');
  toast(existing ? 'Course modifiée' : 'Course ajoutée');
  onSaved(race);
}

/** Calendrier, modification ou suppression d'une course. */
export async function raceAction(action, id) {
  const r = state.races.find(x => x.id === id);
  if (!r) return toastError('Cette course n’existe plus.');
  if (action === 'edit') openRaceEditor(id);
  else if (action === 'calendar') offerCalendar(toCalendarEvent(r), { heading: 'Ajouter la course au calendrier ?' });
  else if (action === 'delete') {
    if (await confirmDialog({ title: `Supprimer « ${r.name} » ?`, message: 'Cette action est définitive.', confirmLabel: 'Supprimer', danger: true })) {
      state.races = state.races.filter(x => x.id !== id);
      if (commit('races') === false) return;
      toast('Course supprimée');
    }
  }
}

/**
 * Résultat saisi sur une course passée (temps, classement, distance).
 * @returns {boolean} faux si l'enregistrement a été refusé.
 */
export function saveResult(input, id) {
  const field = input.dataset.result;
  const r = state.races.find(x => x.id === id);
  if (!field || !r) return false;
  r[field] = field === 'resultTime' ? durationValue(input) : input.value.trim().slice(0, 40);
  if (field === 'resultTime') input.dataset.orig = r[field];
  if (commit('races') === false) return false;
  toast('Résultat enregistré');
  return true;
}

/* Roulette : grisée tant qu'elle est sur 00:00. */
export function wheelState(e) {
  const input = e.target;
  if (input.matches?.('.input--wheel')) input.classList.toggle('is-zero', !input.value || input.value === '00:00');
}

export function initRaces({ saved } = {}) {
  if (saved) onSaved = saved;
  $('#raceForm').addEventListener('input', wheelState);
  $('#raceForm').addEventListener('submit', onSubmit);
  $('#raceSport').innerHTML = `<option value="" disabled selected>Choisir un sport</option>${RACE_SPORTS.map(s => `<option>${esc(s)}</option>`).join('')}`;
}
