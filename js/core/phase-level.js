/*
 * Niveau de détail des phases (réglage propre à l'appareil, partagé par la
 * Saison et l'Analyse) :
 *   1 · Essentiel : quatre grands blocs (préparation générale, spécifique,
 *       affûtage, récupération), les phases qui se suivent dans un même bloc
 *       sont réunies ;
 *   2 · Phases : chaque type de phase, les morceaux consécutifs d'un même type
 *       réunis (un plan recalculé découpe parfois une phase en deux) ;
 *   3 · Détail : toutes les phases telles qu'enregistrées, avec les semaines
 *       allégées du plan.
 * Les phases enregistrées ne changent jamais : seul l'affichage les regroupe.
 */
import { readText, write } from '../services/storage.js';
import { fromKey } from './dates.js';
import { phaseType } from './season.js';

const KEY = 'allure_phase_level';

export const LEVELS = [
  { id: 1, name: 'Essentiel', hint: 'Les grands blocs de la saison' },
  { id: 2, name: 'Phases', hint: 'Chaque type de phase' },
  { id: 3, name: 'Détail', hint: 'Toutes les phases et les semaines allégées' }
];

/* Grands blocs : nom, nom court et couleur (celle du type de phase principal du bloc). */
export const BLOCKS = {
  prep: { id: 'prep', name: 'Préparation générale', short: 'Prépa', color: '#2f80ff' },
  spec: { id: 'spec', name: 'Préparation spécifique', short: 'Spécifique', color: '#7a3cf0' },
  taper: { id: 'taper', name: 'Affûtage', short: 'Affûtage', color: '#f5b400', light: '#e9a800' },
  rest: { id: 'rest', name: 'Récupération', short: 'Récup', color: '#10b981', light: '#0ea371' }
};

export function phaseLevel() {
  const n = Number(readText(KEY, '1'));
  return n === 2 || n === 3 ? n : 1;
}
export const setPhaseLevel = n => write(KEY, String(n === 2 || n === 3 ? n : 1));

/** Bloc d'un type de phase (types ajoutés à la main : d'après leur groupe et leur charge). */
export function blockOf(typeId) {
  if (typeId === 'taper') return 'taper';
  if (typeId === 'recovery' || typeId === 'transition') return 'rest';
  if (typeId === 'base') return 'prep';
  const t = phaseType(typeId);
  if (t.group === 'spec' || /^build/.test(typeId)) return 'spec';
  return t.load >= 0.75 ? 'spec' : t.load <= 0.35 ? 'rest' : 'prep';
}

const gapDays = (a, b) => Math.round((fromKey(b) - fromKey(a)) / 864e5);

/**
 * Phases à afficher au niveau `level` : { id, type, key, cls, name, short, color,
 * start, end, note, members } ; `members` = phases enregistrées réunies.
 */
export function displayPhases(phases, level = phaseLevel()) {
  const look = p => {
    if (level === 1) {
      const b = BLOCKS[blockOf(p.type)];
      return { key: b.id, cls: `phase--blk-${b.id}`, name: b.name, short: b.short, color: b.color };
    }
    const t = phaseType(p.type);
    return { key: level === 2 ? p.type : p.id, cls: `phase--${p.type}`, name: t.name, short: t.short, color: t.color };
  };
  const out = [];
  for (const p of phases) {
    const l = look(p);
    const last = out[out.length - 1];
    if (level < 3 && last && last.key === l.key && gapDays(last.end, p.start) <= 1) {
      if (p.end > last.end) last.end = p.end;
      last.members.push(p);
      if (level === 1) last.note = '';
      continue;
    }
    out.push({ id: p.id, type: p.type, ...l, start: p.start, end: p.end, note: level === 1 ? '' : p.note, members: [p] });
  }
  return out;
}

/** Élément affiché couvrant le jour `key`. */
export const displayOn = (key, list) => list.find(p => p.start <= key && key <= p.end) || null;

/** Règles CSS des blocs (ajoutées à la feuille des couleurs de phase). */
export const blockColorCSS = inkFor =>
  Object.values(BLOCKS)
    .map(b => `.phase--blk-${b.id} { --ph: ${b.color}; --ph-ink: ${inkFor(b.color)}; }${b.light ? `\n:root[data-theme="light"] .phase--blk-${b.id} { --ph: ${b.light}; }` : ''}`)
    .join('\n');

/** Sélecteur de niveau (boutons radio) ; `attr` = attribut data portant le niveau. */
export const levelSwitchHTML = (level = phaseLevel()) =>
  `<div class="segmented lvl" role="radiogroup" aria-label="Niveau de détail des phases">${LEVELS.map(
    l => `<button type="button" role="radio" data-phase-level="${l.id}" aria-checked="${l.id === level}" title="${l.hint}">${l.name}</button>`
  ).join('')}</div>`;
