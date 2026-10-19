/*
 * Activités importées depuis l'export CSV de RunGap (toutes les séances, tous sports).
 *
 * Le fichier est redéposé en entier à chaque mise à jour : seules les activités
 * plus récentes que la dernière déjà connue sont ajoutées (les plus anciennes
 * sont identiques). Les doublons (même séance envoyée par Suunto et Garmin,
 * départs à moins de 10 min) sont fusionnés.
 *
 * Stockage : sur l'appareil uniquement (clé allure_activities, ~100 Ko pour
 * 1 200 séances), en tableaux compacts. Le nœud Firebase partagé avec Carnet
 * n'accepte pas de nouvelle tranche, et le fichier complet peut être
 * réimporté sur n'importe quel appareil.
 */
import { readJSON, write } from '../services/storage.js';

const KEY = 'allure_activities';
const META_KEY = 'allure_activities_meta';
const DUPLICATE_GAP = 10 * 60 * 1000;

/* Colonnes de l'export RunGap utilisées (nom exact de l'en-tête). */
const COLS = {
  local: 'local time',
  utc: 'utc time',
  activity: 'activity',
  duration: 'duration(s)',
  distance: 'distance(m)',
  hr: 'avg heartrate',
  hrMax: 'max heartrate',
  power: 'avg power',
  gain: 'elevationgain(m)',
  minEle: 'min elevation(m)',
  speed: 'avg speed(m/s)',
  title: 'title',
  source: 'source'
};

/* Ordre des champs d'une activité stockée (tableau compact). */
const FIELDS = ['t', 'date', 'time', 'activity', 'duration', 'distance', 'hr', 'hrMax', 'power', 'gain', 'speed', 'title', 'minEle'];
/* Version du format stocké : un import d'un format plus ancien remplace tout (champ ajouté). */
const VERSION = 2;

let cache = null;

/** Découpe un CSV (champs entre guillemets, virgules et retours à la ligne dans les champs). */
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some(v => v !== '')) rows.push(row);
  return rows;
}

const num = v => {
  const n = Number(String(v ?? '').trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
};

/** « 2026-10-13 14:38:00 » (UTC) -> millisecondes ; NaN si invalide. */
const utcMs = v => Date.parse(String(v).trim().replace(' ', 'T') + 'Z');

/**
 * Lit le texte d'un export RunGap.
 * @returns {Array<object>} activités triées par date, doublons retirés
 * @throws {Error} si le fichier n'a pas les colonnes attendues
 */
export function readExport(text) {
  const rows = parseCSV(String(text).replace(/^﻿/, ''));
  const header = (rows.shift() || []).map(h => h.trim().toLowerCase());
  const at = {};
  for (const [k, name] of Object.entries(COLS)) at[k] = header.indexOf(name);
  if (at.utc < 0 || at.local < 0 || at.activity < 0 || at.duration < 0) {
    throw new Error('Ce fichier n’est pas un export RunGap (colonnes « local time », « utc time », « activity » introuvables).');
  }
  const get = (r, k) => (at[k] >= 0 ? r[at[k]] ?? '' : '');
  const list = [];
  for (const r of rows) {
    const t = utcMs(get(r, 'utc'));
    const local = get(r, 'local').trim();
    const duration = num(get(r, 'duration'));
    if (!Number.isFinite(t) || !/^\d{4}-\d{2}-\d{2}/.test(local) || !duration) continue;
    list.push({
      t,
      date: local.slice(0, 10),
      time: local.slice(11, 16),
      activity: get(r, 'activity').trim() || 'Autre',
      duration: Math.round(duration),
      distance: Math.round(num(get(r, 'distance'))),
      hr: Math.round(num(get(r, 'hr'))),
      hrMax: Math.round(num(get(r, 'hrMax'))),
      power: Math.round(num(get(r, 'power'))),
      gain: Math.round(num(get(r, 'gain'))),
      minEle: Math.round(num(get(r, 'minEle'))),
      speed: num(get(r, 'speed')),
      title: get(r, 'title').trim().slice(0, 80),
      source: get(r, 'source').trim()
    });
  }
  return dedupe(list);
}

/* Données présentes : la séance la plus complète est gardée parmi deux doublons. */
const richness = a => ['hr', 'hrMax', 'power', 'gain', 'speed', 'distance'].filter(k => a[k] > 0).length + (a.source === 'Suunto App' ? 0.5 : 0);

function dedupe(list) {
  const sorted = [...list].sort((a, b) => a.t - b.t);
  const out = [];
  for (const a of sorted) {
    const prev = out[out.length - 1];
    if (prev && a.t - prev.t < DUPLICATE_GAP) {
      if (richness(a) > richness(prev)) out[out.length - 1] = a;
      continue;
    }
    out.push(a);
  }
  return out.map(({ source, ...a }) => a);
}

const pack = a => FIELDS.map(k => a[k]);
const unpack = row => Object.fromEntries(FIELDS.map((k, i) => [k, row[i] ?? (k === 'title' || k === 'date' || k === 'time' || k === 'activity' ? '' : 0)]));

/** Activités enregistrées sur l'appareil, triées par date. */
export function getActivities() {
  if (!cache) {
    const raw = readJSON(KEY, []);
    cache = (Array.isArray(raw) ? raw : []).filter(Array.isArray).map(unpack).filter(a => Number.isFinite(a.t) && a.date);
    cache.sort((a, b) => a.t - b.t);
  }
  return cache;
}

/** Date et nombre de séances du dernier import. */
export const importInfo = () => readJSON(META_KEY, null);

function save(list) {
  if (!write(KEY, JSON.stringify(list.map(pack)))) throw new Error('Espace de stockage plein sur cet appareil.');
  cache = list;
}

/**
 * Ajoute les activités plus récentes que la dernière connue.
 * Premier import (ou appareil vide) : tout le fichier.
 * @returns {{added:number, total:number, first:boolean}}
 */
export function mergeExport(text) {
  const incoming = readExport(text);
  if (!incoming.length) throw new Error('Aucune activité trouvée dans ce fichier.');
  const outdated = importInfo()?.v !== VERSION;
  const current = outdated ? [] : getActivities();
  const last = current.length ? current[current.length - 1].t : -Infinity;
  const fresh = incoming.filter(a => a.t - last >= DUPLICATE_GAP);
  const list = current.concat(fresh);
  save(list);
  write(META_KEY, { at: Date.now(), added: fresh.length, total: list.length, v: VERSION });
  return { added: fresh.length, total: list.length, first: !current.length };
}

/** Oublie toutes les activités de l'appareil (autre compte connecté). */
export function clearActivities() {
  cache = [];
  write(KEY, '[]');
  write(META_KEY, 'null');
}
