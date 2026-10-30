/*
 * Inscriptions : état de l'inscription de chaque course à venir
 * (à faire, incomplète, complète). Stocké dans objectives.raceRegistration
 * ({ idCourse: 'partial' | 'done' }) comme les priorités : le nœud objectives
 * accepte du contenu libre dans les règles Firebase, contrairement aux fiches
 * de course. Une course absente du nœud est « à faire ».
 */
import { state } from './store.js';

export const REGISTRATION_KEY = 'raceRegistration';
export const REGISTRATIONS = [
  { id: 'todo', name: 'À faire' },
  { id: 'partial', name: 'Incomplète' },
  { id: 'done', name: 'Complète' }
];
const DEFAULT_REGISTRATION = 'todo';

export const registrationOf = id => {
  const s = state.objectives?.[REGISTRATION_KEY]?.[id];
  return REGISTRATIONS.some(x => x.id === s) ? s : DEFAULT_REGISTRATION;
};
export const registrationName = s => (REGISTRATIONS.find(x => x.id === s) || REGISTRATIONS[0]).name;

/** Nouvelle valeur du nœud objectives avec l'état `s` pour la course `id`. */
export function withRegistration(id, s) {
  const map = { ...(state.objectives?.[REGISTRATION_KEY] || {}) };
  // Seules les courses encore présentes sont gardées.
  for (const k of Object.keys(map)) if (!state.races.some(r => r.id === k)) delete map[k];
  if (s === DEFAULT_REGISTRATION || !REGISTRATIONS.some(x => x.id === s)) delete map[id];
  else map[id] = s;
  return { ...state.objectives, [REGISTRATION_KEY]: map };
}

/** Nombre de courses par état : { todo, partial, done }. */
export function countRegistrations(races) {
  const n = { todo: 0, partial: 0, done: 0 };
  races.forEach(r => n[registrationOf(r.id)]++);
  return n;
}
