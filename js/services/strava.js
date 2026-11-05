/*
 * Connexion directe à Strava (remplace l'export CSV de RunGap).
 *
 * Strava n'accepte que le flux OAuth « code + secret » : l'app utilise donc
 * l'application d'API personnelle de l'athlète (Client ID + Client Secret créés
 * sur strava.com/settings/api). Ces identifiants et les jetons restent sur
 * l'appareil (clé allure_strava) : rien ne part dans Firebase.
 *
 * Synchronisation : /athlete/activities, 200 activités par page. La première
 * reprend tout l'historique ; les suivantes repartent de la dernière activité
 * connue (marge de 2 jours pour une séance envoyée en retard).
 */
import { readJSON, write } from './storage.js';

const KEY = 'allure_strava';
const STATE_KEY = 'allure_strava_state';
const AUTHORIZE = 'https://www.strava.com/oauth/authorize';
const TOKEN = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';
const SCOPE = 'read,activity:read_all';
const PER_PAGE = 200;
const MAX_PAGES = 40;
const OVERLAP = 2 * 86400;

/* Sport Strava (sport_type) -> nom d'activité de l'export RunGap, compris par l'analyse. */
const SPORT = {
  Run: 'Running',
  VirtualRun: 'Treadmill Running',
  TrailRun: 'Trail Running',
  Ride: 'Cycling',
  VirtualRide: 'Indoor Cycling',
  EBikeRide: 'Cycling',
  GravelRide: 'Gravel Cycling',
  MountainBikeRide: 'Mountain Biking',
  EMountainBikeRide: 'Mountain Biking',
  NordicSki: 'Cross Country Skiing',
  RollerSki: 'Roller Skiing',
  WeightTraining: 'Weight Training',
  Workout: 'Indoor Sport & Fitness',
  Crossfit: 'Indoor Sport & Fitness',
  HighIntensityIntervalTraining: 'Indoor Sport & Fitness',
  Pilates: 'Indoor Sport & Fitness',
  Yoga: 'Indoor Sport & Fitness',
  RockClimbing: 'Climbing',
  Hike: 'Hiking',
  Walk: 'Walking',
  Swim: 'Swimming'
};

export const stravaConfig = () => readJSON(KEY, {}) || {};
const saveConfig = patch => write(KEY, { ...stravaConfig(), ...patch });

/** Identifiants de l'application d'API saisis ? */
export const hasCredentials = () => {
  const c = stravaConfig();
  return Boolean(c.clientId && c.clientSecret);
};
/** Compte Strava autorisé sur cet appareil ? */
export const isConnected = () => Boolean(stravaConfig().refresh);

/** Adresse de retour après l'autorisation : l'app elle-même, sans paramètres. */
export const redirectUri = () => location.origin + location.pathname;

export function setCredentials(clientId, clientSecret) {
  saveConfig({ clientId: String(clientId).trim(), clientSecret: String(clientSecret).trim() });
}

/** Ouvre la page d'autorisation Strava (l'app revient ensuite avec ?code=…). */
export function authorize() {
  const { clientId } = stravaConfig();
  const state = Math.random().toString(36).slice(2, 12);
  write(STATE_KEY, state);
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state
  });
  location.assign(`${AUTHORIZE}?${q}`);
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = stravaConfig();
  let res;
  try {
    res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params })
    });
  } catch {
    throw new Error('Strava injoignable. Vérifie la connexion internet.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const bad = (data.errors || []).some(e => /client_id|client_secret/.test(`${e.field}${e.resource}`)) || res.status === 401;
    throw new Error(bad ? 'Client ID ou Client Secret refusé par Strava.' : data.message || `Strava a refusé la connexion (${res.status}).`);
  }
  return data;
}

function storeTokens(data) {
  const athlete = data.athlete ? { id: data.athlete.id, name: [data.athlete.firstname, data.athlete.lastname].filter(Boolean).join(' ') } : stravaConfig().athlete;
  saveConfig({ access: data.access_token, refresh: data.refresh_token, expiresAt: data.expires_at, athlete });
}

/**
 * Retour de Strava : échange le code contre les jetons et nettoie l'adresse.
 * @returns {Promise<null|{ok:true}|{error:string}>} null si l'adresse ne vient pas de Strava
 */
export async function handleRedirect() {
  const q = new URLSearchParams(location.search);
  if (!q.has('code') && !q.has('error')) return null;
  const expected = readJSON(STATE_KEY, null);
  history.replaceState(null, '', redirectUri() + location.hash);
  write(STATE_KEY, 'null');
  if (q.get('state') !== expected && expected !== null) return { error: 'Réponse de Strava inattendue. Recommence la connexion.' };
  if (q.has('error')) return { error: 'Connexion à Strava annulée.' };
  if (!/activity:read/.test(q.get('scope') || '')) return { error: 'Autorise l’accès aux activités pour importer tes séances.' };
  if (!hasCredentials()) return { error: 'Identifiants Strava absents sur cet appareil : saisis-les à nouveau.' };
  try {
    storeTokens(await tokenRequest({ code: q.get('code'), grant_type: 'authorization_code' }));
    return { ok: true };
  } catch (error) {
    return { error: error.message };
  }
}

async function accessToken() {
  const c = stravaConfig();
  if (!c.refresh) throw new Error('Strava n’est pas connecté.');
  if (c.access && c.expiresAt * 1000 > Date.now() + 120000) return c.access;
  storeTokens(await tokenRequest({ refresh_token: c.refresh, grant_type: 'refresh_token' }));
  return stravaConfig().access;
}

async function api(path, params) {
  const token = await accessToken();
  let res;
  try {
    res = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new Error('Strava injoignable. Vérifie la connexion internet.');
  }
  if (res.status === 401) {
    saveConfig({ access: null, refresh: null });
    throw new Error('Accès Strava expiré ou retiré : reconnecte-toi.');
  }
  if (res.status === 429) throw new Error('Limite de requêtes Strava atteinte : réessaie dans 15 minutes.');
  if (!res.ok) throw new Error(`Strava a répondu ${res.status}.`);
  return res.json();
}

const round = (v, d = 0) => (Number.isFinite(v) && v > 0 ? Math.round(v * 10 ** d) / 10 ** d : 0);

/** Activité Strava (SummaryActivity) -> activité de l'analyse (même format que l'export RunGap). */
export function fromStrava(s) {
  const t = Date.parse(s.start_date);
  const local = String(s.start_date_local || '');
  const kind = s.sport_type || s.type || 'Autre';
  return {
    t,
    date: local.slice(0, 10),
    time: local.slice(11, 16),
    activity: SPORT[kind] || kind,
    duration: Math.round(s.moving_time || s.elapsed_time || 0),
    distance: Math.round(s.distance || 0),
    hr: round(s.average_heartrate),
    hrMax: round(s.max_heartrate),
    power: round(s.average_watts),
    gain: round(s.total_elevation_gain),
    minEle: round(s.elev_low),
    speed: round(s.average_speed, 2),
    title: String(s.name || '').trim().slice(0, 80)
  };
}

/**
 * Activités Strava depuis `sinceMs` (tout l'historique si absent).
 * @param {(n:number)=>void} [onProgress] nombre d'activités reçues
 */
export async function fetchActivities(sinceMs, onProgress) {
  const after = sinceMs ? Math.max(0, Math.floor(sinceMs / 1000) - OVERLAP) : 0;
  const out = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const batch = await api('/athlete/activities', { after, page, per_page: PER_PAGE });
    if (!Array.isArray(batch) || !batch.length) break;
    for (const s of batch) {
      const a = fromStrava(s);
      if (Number.isFinite(a.t) && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && a.duration > 0) out.push(a);
    }
    onProgress?.(out.length);
    if (batch.length < PER_PAGE) break;
  }
  saveConfig({ lastSync: Date.now() });
  return out;
}

/** Oublie le compte Strava de cet appareil (les identifiants de l'application restent). */
export async function disconnect() {
  const c = stravaConfig();
  if (c.access) {
    fetch('https://www.strava.com/oauth/deauthorize', { method: 'POST', headers: { Authorization: `Bearer ${c.access}` } }).catch(() => {});
  }
  saveConfig({ access: null, refresh: null, expiresAt: 0, athlete: null, lastSync: 0 });
}
