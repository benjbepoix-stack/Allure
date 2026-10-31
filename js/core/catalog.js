/*
 * Catalogue des courses : toutes les cyclosportives (reprises d'Échappée) et
 * toutes les courses de ski de fond (reprises de Glisse), au même endroit.
 * C'est ici que l'on choisit ses courses : une étoile les présélectionne,
 * « Ajouter » les place dans la saison (liste `races`, partagée avec Carnet).
 *
 * La présélection est stockée dans objectives.catalogPicks ({ idCatalogue: true }) :
 * le nœud objectives accepte du contenu libre dans les règles Firebase, comme
 * racePriority et raceRegistration. Les fiches de course ne portent aucune clé de plus.
 *
 * Les fichiers de données (js/data/catalog-cyclo.js, js/data/catalog-ski.js) sont
 * les copies de js/data/races.js d'Échappée et de Glisse : même format, même mise à
 * jour annuelle (voir le README).
 */
import { RACES as CYCLO, RACE_GROUPS as CYCLO_GROUPS } from '../data/catalog-cyclo.js';
import { RACES as SKI, RACE_GROUPS as SKI_GROUPS } from '../data/catalog-ski.js';
import { state } from './store.js';
import { fromKey, todayKey } from './dates.js';

export const PICKS_KEY = 'catalogPicks';

export const CATALOG_SPORTS = [
  { id: 'velo', name: 'Vélo', sport: 'Cyclisme' },
  { id: 'ski', name: 'Ski de fond', sport: 'Ski de fond' }
];

/** Régions de chaque sport (identifiants préfixés : « alpes-nord » existe dans les deux listes). */
export const CATALOG_REGIONS = [
  ...CYCLO_GROUPS.map(g => ({ id: `velo:${g.id}`, sport: 'velo', label: g.label })),
  ...SKI_GROUPS.map(g => ({ id: `ski:${g.id}`, sport: 'ski', label: g.label }))
];

const withKind = (list, kind) =>
  list.map(r => ({
    ...r,
    id: `${kind}:${r.id}`,
    kind,
    region: `${kind}:${r.group}`,
    sport: CATALOG_SPORTS.find(s => s.id === kind).sport,
    editions: [...(r.editions || [])].sort((a, b) => a.date.localeCompare(b.date))
  }));

export const CATALOG = [...withKind(CYCLO, 'velo'), ...withKind(SKI, 'ski')];

/** Prochaine édition (date du jour ou plus tard), sinon null : la course n'est plus proposée. */
export function nextEdition(race, from = todayKey()) {
  return race.editions.find(e => e.date >= from) || null;
}

const norm = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’']/g, ' ')
    .toLowerCase()
    .replace(/\b(la|le|les|l|de|du|des|d)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const daysApart = (a, b) => Math.abs(fromKey(a) - fromKey(b)) / 86400000;

/**
 * Course de la saison qui correspond à cette épreuve du catalogue : même nom
 * (sans accents ni articles), ou même date avec un nom qui contient l'autre.
 * La date peut avoir été corrigée à l'ajout (date estimée) : 60 jours d'écart au plus.
 */
export function seasonRaceFor(c, edition = nextEdition(c)) {
  if (!edition) return null;
  const n = norm(c.name);
  return (
    state.races.find(r => {
      const rn = norm(r.name);
      if (!rn) return false;
      const near = daysApart(r.date, edition.date) <= 60;
      if (rn === n && near) return true;
      return r.date === edition.date && (rn.includes(n) || n.includes(rn));
    }) || null
  );
}

export const picks = () => state.objectives?.[PICKS_KEY] || {};
export const isPicked = id => Boolean(picks()[id]);

/** Nouvelle valeur du nœud objectives avec l'épreuve `id` présélectionnée ou non. */
export function withPick(id, on) {
  const map = { ...picks() };
  for (const k of Object.keys(map)) if (!CATALOG.some(c => c.id === k)) delete map[k];
  if (on) map[id] = true;
  else delete map[id];
  return { ...state.objectives, [PICKS_KEY]: map };
}

/** Champs pré-remplis de l'éditeur de course pour cette épreuve. */
export function prefillFor(c, edition = nextEdition(c)) {
  const lines = [c.distance ? `Distances : ${c.distance}` : '', edition && !edition.confirmed ? `Date estimée (${c.period})` : '', c.link || ''];
  return {
    name: c.name.slice(0, 100),
    sport: c.sport,
    date: edition?.date || '',
    location: (c.location || '').slice(0, 100),
    notes: lines.filter(Boolean).join('\n')
  };
}
