/*
 * Synchronisation Firebase : compte (e-mail / mot de passe) + Realtime Database.
 *
 * - Le SDK est chargé dynamiquement : s'il est injoignable (hors ligne,
 *   bloqueur…), l'application continue en mode local, sans écran bloquant.
 * - Session conservée sur l'appareil et partagée avec les autres apps de la
 *   même adresse (Mon Garage, Ma Maison, Carnet, Mon budget).
 * - Données : users/<uid>/carnet, nœud partagé avec Carnet. Allure n'y écrit
 *   que ses tranches (races, objectives, bodyMetrics), regroupées (debounce)
 *   puis envoyées en un seul `update`.
 * - Migration unique depuis l'ancienne base publique de Carnet (voir `start`).
 * - Tant que le nœud n'est pas reçu (et migré), les modifications locales
 *   sont mises en attente et ne sont pas écrasées par le cloud.
 * - Sans compte : rien n'est envoyé, ni sur le moment ni à la connexion.
 * - L'état de connexion est exposé via `onStatus` :
 *   connecting | online | syncing | offline | local
 */
import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from '../config/firebase-config.js';

const SDK = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;
const LOAD_TIMEOUT = 12000;
const LEGACY_TIMEOUT = 8000;
const WRITE_DELAY = 250;
const NOTES_DELAY = 700;

/* Ancienne base publique de Carnet : lue une seule fois, pour la migration. */
const LEGACY_HOST = 'dashboard---projet-default-rtdb.europe-west1.firebasedatabase.app';
const LEGACY_URL = `https://${LEGACY_HOST}/app.json`;
/* Tranches de Carnet : toutes copiées à la migration, même celles qu'Allure n'utilise pas.
   garage_alerts, maison_alerts et migrated ne comptent pas comme des données de Carnet. */
const CARNET_SLICES = ['dashboard', 'notes', 'theme', 'families', 'plans', 'objectives', 'races', 'bodyMetrics'];

export const WAITING_MESSAGE = 'Ouvrez Carnet une fois pour transférer vos données.';

let authMod = null;
let dbMod = null;
let auth = null;
let db = null;
let user; // undefined : réponse du service de connexion attendue ; null : pas de compte
let rootRef = null;
let session = 0; // change à chaque compte : les réponses d'une session précédente sont ignorées
let latest = null; // dernier instantané reçu du nœud
let ready = false; // nœud reçu et migré : synchronisation active
let starting = false;
let waiting = false; // nœud non migré et ancienne base vide ou injoignable
let connected = null;
let fatal = null;
let inflight = 0;
let buffer = {};
let flushTimer = null;
let unsubscribeData = null;
let handlers = {
  onUser: () => {},
  onRemote: () => {},
  onReady: () => {},
  onWaiting: () => {},
  onStatus: () => {},
  onError: () => {},
  getSnapshot: () => ({})
};

const asObj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const hasCarnetData = v => CARNET_SLICES.some(s => asObj(v)[s] !== undefined && asObj(v)[s] !== null);

function emitStatus() {
  let status;
  let detail = fatal;
  if (fatal) status = 'local';
  else if (user === null) {
    status = 'local';
    detail = 'Sans compte : données de cet appareil uniquement.';
  } else if (waiting) {
    status = 'local';
    detail = WAITING_MESSAGE;
  } else if (connected === false) status = 'offline';
  else if (!ready) status = 'connecting';
  else if (inflight > 0 || Object.keys(buffer).length) status = 'syncing';
  else status = 'online';
  handlers.onStatus(status, detail);
}

const withTimeout = (promise, ms, message) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms))]);

function describeError(error) {
  const code = String(error?.code || error?.message || '');
  if (/configur/i.test(code)) return 'Synchronisation non configurée.';
  if (/permission/i.test(code)) return 'Accès refusé par les règles Firebase.';
  if (/timeout|délai/i.test(code)) return 'Firebase ne répond pas.';
  if (/fetch|import|network|load/i.test(code)) return 'Impossible de charger Firebase (connexion ?).';
  return 'Service de synchronisation indisponible.';
}

export function describeAuthError(error) {
  const map = {
    'auth/invalid-email': 'Adresse e-mail invalide.',
    'auth/invalid-credential': 'E-mail ou mot de passe incorrect.',
    'auth/wrong-password': 'E-mail ou mot de passe incorrect.',
    'auth/user-not-found': 'Aucun compte avec cette adresse e-mail.',
    'auth/missing-password': 'Indiquez votre mot de passe.',
    'auth/email-already-in-use': 'Cette adresse possède déjà un compte : utilisez « Se connecter ».',
    'auth/weak-password': 'Le mot de passe doit contenir au moins 6 caractères.',
    'auth/operation-not-allowed': 'La connexion e-mail / mot de passe n’est pas activée dans Firebase (Authentication → Sign-in method).',
    'auth/network-request-failed': 'Connexion Internet indisponible.',
    'auth/too-many-requests': 'Trop de tentatives. Réessayez dans quelques minutes.'
  };
  return map[error?.code] || 'Une erreur est survenue. Réessayez.';
}

function goLocal(error) {
  fatal = describeError(error);
  ready = false;
  console.warn('[firebase] passage en mode local :', error);
  emitStatus();
}

/** Supprime les `undefined` (refusés par Firebase) via un aller-retour JSON. */
const clean = value => JSON.parse(JSON.stringify(value));

/* ---------- Écritures ---------- */
function flush() {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!ready || fatal || !rootRef || !Object.keys(buffer).length) return emitStatus();
  const payload = clean(buffer);
  const token = session;
  buffer = {};
  inflight++;
  emitStatus();
  dbMod
    .update(rootRef, payload)
    .catch(error => {
      console.error('[firebase] écriture refusée', error);
      // Écriture d'un compte précédent (déconnexion entre-temps) : sans effet sur le compte actuel.
      if (token !== session) return;
      handlers.onError(describeError(error));
      if (/permission/i.test(String(error?.code))) goLocal(error);
    })
    .finally(() => {
      inflight--;
      emitStatus();
    });
}

/** Met en file une écriture partielle ({ tranche: valeur }). */
export function pushCloud(payload) {
  // Sans compte : rien à envoyer, ni maintenant ni plus tard (les données du compte priment à la connexion, comme Carnet).
  if (user === null) return;
  Object.assign(buffer, payload);
  if (fatal) return;
  const onlyNotes = Object.keys(buffer).every(k => k === 'notes');
  clearTimeout(flushTimer);
  flushTimer = setTimeout(flush, onlyNotes ? NOTES_DELAY : WRITE_DELAY);
  emitStatus();
}

/** Tranches modifiées localement et pas encore envoyées. */
export const pendingSlices = () => new Set(Object.keys(buffer));

/** Force l'envoi immédiat (ex. : l'app passe en arrière-plan). */
export const flushNow = () => flushTimer && flush();

/** Abandonne les écritures en attente (changement de compte, modifications faites sans ce compte). */
export function clearPending() {
  clearTimeout(flushTimer);
  flushTimer = null;
  buffer = {};
  emitStatus();
}

/** Attend que toutes les écritures soient confirmées par le serveur (max `ms`). */
export async function waitForSync(ms = 6000) {
  flushNow();
  const start = Date.now();
  while ((inflight > 0 || (ready && Object.keys(buffer).length)) && Date.now() - start < ms) {
    await new Promise(r => setTimeout(r, 120));
  }
  return !fatal && ready && inflight === 0;
}

export const isCloudAvailable = () => ready && !fatal;
export const isOnline = () => ready && !fatal && connected === true;
export const currentUser = () => user || null;
const isConfigured = () => Boolean(FIREBASE_CONFIG?.apiKey && FIREBASE_CONFIG?.databaseURL);

/**
 * État de la synchronisation (garde-fou d'écriture) :
 * local (Firebase injoignable : rien n'est envoyé), signedOut (sans compte),
 * ready (nœud reçu), waiting (nœud à migrer depuis Carnet), pending (compte ou nœud attendu).
 */
export function cloudState() {
  if (fatal) return 'local';
  if (user === null) return 'signedOut';
  if (ready) return 'ready';
  if (waiting) return 'waiting';
  return 'pending';
}

/* ---------- Migration depuis l'ancienne base publique ---------- */
async function readLegacy() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), LEGACY_TIMEOUT);
  try {
    const res = await fetch(LEGACY_URL, { signal: ctrl.signal, cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch (error) {
    console.warn('[firebase] ancienne base injoignable', error);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function wait() {
  const first = !waiting;
  waiting = true;
  emitStatus();
  if (first) handlers.onWaiting();
}

function goReady(node) {
  waiting = false;
  if (hasCarnetData(node)) handlers.onRemote(node, pendingSlices());
  // Nœud migré sans données de Carnet : celles de l'appareil deviennent la référence.
  else Object.assign(buffer, handlers.getSnapshot(), buffer);
  ready = true;
  handlers.onReady(user.uid);
  flush();
}

/*
 * Premier instantané du nœud :
 * - marqueur `migrated` présent → fonctionnement normal ;
 * - sinon, copie de l'ancienne base (toutes les tranches de Carnet absentes du nœud)
 *   + marqueur, puis application comme données distantes ;
 * - ancienne base vide ou injoignable → rien n'est amorcé (Allure ne connaît pas les
 *   tranches de Carnet) : écritures bloquées, nouvel essai au prochain instantané.
 */
async function start(token) {
  starting = true;
  try {
    let node = asObj(latest);
    if (!node.migrated) {
      const legacy = await readLegacy();
      if (token !== session) return;
      node = asObj(latest); // une autre app a pu écrire pendant la lecture
      if (!node.migrated) {
        if (!hasCarnetData(legacy)) return wait();
        const payload = {};
        // Les tranches déjà présentes (écrites entre-temps par une autre app) sont conservées.
        CARNET_SLICES.forEach(s => {
          if (legacy[s] !== undefined && legacy[s] !== null && !(s in node)) payload[s] = legacy[s];
        });
        // Comme Carnet : son ancien thème par défaut « dark » devient « auto » (sinon Carnet le lirait comme un choix « Sombre »).
        if (payload.theme === 'dark') payload.theme = 'auto';
        payload.migrated = { from: LEGACY_HOST, at: Date.now(), by: 'allure' };
        await dbMod.update(rootRef, payload);
        if (token !== session) return;
        node = asObj(latest).migrated ? asObj(latest) : { ...node, ...payload };
      }
    }
    if (!ready) goReady(node);
  } catch (error) {
    if (token !== session) return;
    console.warn('[firebase] migration impossible', error);
    wait();
  } finally {
    if (token === session) starting = false;
  }
}

/** Nouvel essai de migration (ex. : retour au premier plan) tant que le nœud n'est pas migré. */
export function retryMigration() {
  if (waiting && !starting && !ready && rootRef && !fatal) start(session);
}

/* ---------- Données du compte ---------- */
function stop() {
  unsubscribeData?.();
  unsubscribeData = null;
  session++;
  rootRef = null;
  latest = null;
  ready = false;
  starting = false;
  waiting = false;
}

function listen(u) {
  stop();
  // Accès refusé pendant la session précédente (ex. : mot de passe changé ailleurs) : nouvel essai pour ce compte.
  fatal = null;
  const token = session;
  rootRef = dbMod.ref(db, `users/${u.uid}/carnet`);
  unsubscribeData = dbMod.onValue(
    rootRef,
    snap => {
      if (token !== session) return;
      latest = snap.val();
      if (ready) {
        if (latest && typeof latest === 'object') handlers.onRemote(latest, pendingSlices());
        return;
      }
      if (!starting) start(token);
    },
    error => token === session && goLocal(error)
  );
}

/* ---------- Initialisation ---------- */
export async function initCloud(options) {
  handlers = { ...handlers, ...options };
  if (!isConfigured()) return goLocal(new Error('non configuré'));
  emitStatus();
  try {
    const [appMod, authModule, dbModule] = await withTimeout(
      Promise.all([import(`${SDK}/firebase-app.js`), import(`${SDK}/firebase-auth.js`), import(`${SDK}/firebase-database.js`)]),
      LOAD_TIMEOUT,
      'timeout chargement SDK'
    );
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    authMod = authModule;
    dbMod = dbModule;
    auth = authMod.getAuth(app);
    db = dbMod.getDatabase(app);
    await authMod.setPersistence(auth, authMod.browserLocalPersistence).catch(() => {});

    dbMod.onValue(dbMod.ref(db, '.info/connected'), snap => {
      connected = snap.val() === true;
      emitStatus();
    });

    authMod.onAuthStateChanged(auth, u => {
      user = u || null;
      // Déconnexion : les modifications non envoyées restent sur l'appareil, sans synchronisation.
      if (!u) clearPending();
      // onUser d'abord : l'app peut purger les données d'un autre compte avant la synchro.
      handlers.onUser(user);
      if (u) listen(u);
      else stop();
      emitStatus();
    });
  } catch (error) {
    goLocal(error);
  }
}

export async function signIn(email, password) {
  return authMod.signInWithEmailAndPassword(auth, email, password);
}
export async function signUp(email, password) {
  return authMod.createUserWithEmailAndPassword(auth, email, password);
}
export async function resetPassword(email) {
  return authMod.sendPasswordResetEmail(auth, email);
}
export async function signOutUser() {
  await waitForSync(3000);
  return authMod.signOut(auth);
}
