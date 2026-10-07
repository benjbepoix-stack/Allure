/*
 * Store central : état en mémoire + persistance locale + diffusion des
 * changements. La synchronisation cloud est branchée via `setCloudSink`.
 * Les clés localStorage sont conservées à l'identique pour ne perdre
 * aucune donnée des versions précédentes.
 */
import { readJSON, write } from '../services/storage.js';
import { sameJSON } from './utils.js';
import { normalizeObjectives, normalizeRaces, normalizeBodyMetrics } from './schema.js';

/*
 * Allure partage la base Firebase de Carnet (nœud `app`) mais ne lit et
 * n'écrit QUE ses tranches : objectives (phases de saison), races, bodyMetrics.
 * Les autres tranches (agenda, tâches, planning…) appartiennent à Carnet et ne
 * sont jamais touchées ici. Le thème et la palette restent propres à l'appareil.
 */
const LOCAL_KEYS = {
  objectives: 'allure_objectives',
  races: 'allure_races',
  bodyMetrics: 'allure_body_metrics'
};
export const SLICES = Object.keys(LOCAL_KEYS);

export const state = {};
const listeners = new Set();
let cloudSink = null;

function normalizeSlice(slice, value) {
  switch (slice) {
    case 'objectives': return normalizeObjectives(value);
    case 'races': return normalizeRaces(value);
    case 'bodyMetrics': return normalizeBodyMetrics(value);
    default: return value;
  }
}

function persist(slice) {
  const value = state[slice];
  write(LOCAL_KEYS[slice], typeof value === 'string' ? value : JSON.stringify(value));
}

function notify(slices, source) {
  listeners.forEach(fn => {
    try {
      fn(slices, source);
    } catch (error) {
      console.error('[store] erreur dans un abonné', error);
    }
  });
}

/** Charge l'état depuis le localStorage. */
export function loadLocal() {
  state.objectives = normalizeObjectives(readJSON(LOCAL_KEYS.objectives, {}));
  state.races = normalizeRaces(readJSON(LOCAL_KEYS.races, []));
  state.bodyMetrics = normalizeBodyMetrics(readJSON(LOCAL_KEYS.bodyMetrics, null));
  SLICES.forEach(persist);
}

export const subscribe = fn => (listeners.add(fn), () => listeners.delete(fn));
export const setCloudSink = fn => (cloudSink = fn);

/*
 * Garde-fou d'écriture : sur un appareil qui n'a encore jamais reçu les
 * données du cloud, l'état local est vide. Enregistrer alors une tranche
 * (ex. une seule course) écraserait la liste complète dans la base partagée
 * avec Carnet. Tant que ce n'est pas le cas, les modifications sont annulées.
 */
let writeGuard = () => true;
export const setWriteGuard = fn => (writeGuard = fn);

/**
 * Valide une modification locale d'une ou plusieurs tranches d'état
 * (déjà mutées en place ou fournies dans `patch`).
 */
export function commit(slices, patch = {}) {
  const list = Array.isArray(slices) ? slices : [slices];
  if (!writeGuard()) {
    // Annule la mutation déjà faite en mémoire : on recharge l'état enregistré.
    loadLocal();
    notify(list, 'local');
    return false;
  }
  const payload = {};
  list.forEach(slice => {
    if (slice in patch) state[slice] = patch[slice];
    persist(slice);
    payload[slice] = state[slice];
  });
  cloudSink?.(payload);
  notify(list, 'local');
}

/** Applique des données distantes ; ignore les tranches inchangées (écho de nos propres écritures). */
export function applyRemote(cloud, skip = new Set()) {
  if (!cloud || typeof cloud !== 'object') return [];
  const changed = [];
  for (const slice of SLICES) {
    if (skip.has(slice)) continue;
    // Firebase supprime les nœuds vides : une tranche absente d'une base
    // initialisée signifie « vidée ailleurs ».
    const next = normalizeSlice(slice, slice in cloud ? cloud[slice] : null);
    if (sameJSON(next, state[slice])) continue;
    state[slice] = next;
    persist(slice);
    changed.push(slice);
  }
  if (changed.length) notify(changed, 'remote');
  return changed;
}

export const snapshot = () => Object.fromEntries(SLICES.map(s => [s, state[s]]));
