/*
 * Fiche Strava de l'onglet Analyse : identifiants de l'application d'API,
 * connexion, synchronisation, déconnexion. L'import d'un fichier CSV (RunGap)
 * reste possible depuis cette fiche, en secours.
 */
import { $, esc } from '../core/utils.js';
import { getActivities, mergeActivities } from '../core/activities.js';
import { openSheet, closeSheet, confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { write } from '../services/storage.js';
import {
  authorize, disconnect, fetchActivities, handleRedirect, hasCredentials, isConnected,
  redirectUri, setCredentials, stravaConfig
} from '../services/strava.js';

const AUTO_EVERY = 60 * 60 * 1000;
let busy = false;
let lastAttempt = 0;
let changed = () => {};
let importFile = () => {};

const nf = n => n.toLocaleString('fr-FR');
const plural = (n, word) => `${nf(n)} ${word}${n > 1 ? 's' : ''}`;

/** Texte court de l'état de la synchronisation (ligne d'info de l'Analyse). */
export function stravaStatus() {
  const c = stravaConfig();
  if (!c.refresh) return '';
  if (!c.lastSync) return 'Strava connecté';
  const d = new Date(c.lastSync);
  const today = d.toDateString() === new Date().toDateString();
  return `Strava · synchro ${today ? `à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}` : `du ${d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }).replace('.', '')}`}`;
}

/** Libellé du bouton principal de l'Analyse. */
export const stravaButtonLabel = () => (isConnected() ? 'Synchroniser Strava' : 'Connecter Strava');

function setLoading(on) {
  $('#analysisImport')?.classList.toggle('is-loading', on);
  $('#stravaSync')?.classList.toggle('is-loading', on);
}

/**
 * Récupère les nouvelles activités Strava. Première fois (appareil vide) : tout l'historique.
 * @param {{silent?:boolean, full?:boolean}} [opts]
 */
export async function syncStrava({ silent = false, full = false } = {}) {
  if (busy || !isConnected()) return;
  busy = true;
  lastAttempt = Date.now();
  setLoading(true);
  try {
    const list = getActivities();
    const since = full || !list.length ? 0 : list[list.length - 1].t;
    const incoming = await fetchActivities(since);
    const res = mergeActivities(incoming);
    if (!silent || res.added) {
      toast(res.first ? `${plural(res.total, 'activité')} récupérée${res.total > 1 ? 's' : ''} depuis Strava` : res.added ? `${plural(res.added, 'nouvelle activité')} depuis Strava` : 'Déjà à jour avec Strava', { type: res.added ? 'success' : 'info' });
    }
  } catch (error) {
    console.warn('[strava] synchronisation', error);
    if (!silent || !isConnected()) toastError(error?.message || 'Synchronisation Strava impossible.');
  } finally {
    busy = false;
    setLoading(false);
    changed();
    if ($('#stravaSheet') && !$('#stravaSheet').hidden) renderSheet();
  }
}

/** Synchronisation discrète à l'ouverture de l'Analyse (au plus une fois par heure). */
export function maybeAutoSync() {
  if (!isConnected() || busy || !navigator.onLine) return;
  const due = () => Date.now() - Math.max(stravaConfig().lastSync || 0, lastAttempt) >= AUTO_EVERY;
  if (!due()) return;
  setTimeout(() => !busy && due() && syncStrava({ silent: true }), 300);
}

function renderSheet() {
  const c = stravaConfig();
  const body = $('#stravaBody');
  if (isConnected()) {
    $('#stravaSub').textContent = 'Tes séances arrivent directement de Strava, tous sports.';
    body.innerHTML = `<div class="strava-account">
        <span class="strava-account__dot" aria-hidden="true"></span>
        <div><strong>${esc(c.athlete?.name || 'Compte Strava')}</strong><span>${esc(stravaStatus())} · ${plural(getActivities().length, 'activité')} sur l’appareil</span></div>
      </div>
      <button type="button" class="btn btn--primary btn--block" id="stravaSync"><span>Synchroniser maintenant</span></button>
      <button type="button" class="btn btn--soft btn--block" data-strava="full"><span>Reprendre tout l’historique</span></button>
      <p class="an-note">Synchronisation automatique à l’ouverture de l’Analyse, au plus une fois par heure.</p>
      <div class="strava-links">
        <button type="button" class="link-btn" data-strava="csv">Importer un fichier CSV</button>
        <button type="button" class="link-btn link-btn--danger" data-strava="logout">Déconnecter Strava</button>
      </div>`;
    return;
  }
  $('#stravaSub').textContent = 'Une seule fois : crée ton application d’API Strava, puis autorise Cadence.';
  body.innerHTML = `<ol class="strava-steps">
      <li>Sur <a href="https://www.strava.com/settings/api" target="_blank" rel="noopener">strava.com/settings/api</a>, crée une application (nom : Cadence, site : n’importe lequel).</li>
      <li>« Domaine du rappel d’autorisation » : <code class="strava-copy" data-copy="${esc(location.hostname)}">${esc(location.hostname)}</code></li>
      <li>Copie ici l’ID client et le secret client affichés par Strava.</li>
    </ol>
    <form class="form" id="stravaForm" novalidate>
      <div class="form-grid">
        <div class="field"><label class="field__label" for="s-id">ID client</label><input class="input" id="s-id" name="clientId" inputmode="numeric" autocomplete="off" value="${esc(c.clientId || '')}"></div>
        <div class="field"><label class="field__label" for="s-secret">Secret client</label><input class="input" id="s-secret" name="clientSecret" type="password" autocomplete="off" spellcheck="false" value="${esc(c.clientSecret || '')}"></div>
      </div>
      <p class="field-error" id="stravaError" role="alert"></p>
      <button type="submit" class="btn btn--strava btn--block"><span>Se connecter avec Strava</span></button>
      <p class="an-note">Identifiants et accès restent sur cet appareil. Retour : ${esc(redirectUri())}</p>
    </form>
    <div class="strava-links"><button type="button" class="link-btn" data-strava="csv">Importer un fichier CSV (RunGap)</button></div>`;
}

export function openStravaSheet() {
  renderSheet();
  openSheet('stravaSheet');
}

function onSubmit(e) {
  if (e.target.id !== 'stravaForm') return;
  e.preventDefault();
  const id = e.target.clientId.value.trim();
  const secret = e.target.clientSecret.value.trim();
  const err = !/^\d{3,10}$/.test(id) ? 'ID client : le nombre affiché par Strava.' : !/^[0-9a-z]{20,64}$/i.test(secret) ? 'Secret client : le code affiché par Strava (bouton « Afficher »).' : '';
  if (err) {
    $('#stravaError').textContent = err;
    return;
  }
  setCredentials(id, secret);
  // Retour sur l'Analyse après l'autorisation.
  write('allure_last_view', 'analysisView');
  authorize();
}

async function onClick(e) {
  const copy = e.target.closest('[data-copy]');
  if (copy) {
    navigator.clipboard?.writeText(copy.dataset.copy).then(() => toast('Copié', { type: 'info' }), () => {});
    return;
  }
  if (e.target.closest('#stravaSync')) return syncStrava();
  const act = e.target.closest('[data-strava]')?.dataset.strava;
  if (act === 'csv') {
    closeSheet('stravaSheet');
    return importFile();
  }
  if (act === 'full') return syncStrava({ full: true });
  if (act === 'logout') {
    const ok = await confirmDialog({ title: 'Déconnecter Strava ?', message: 'Les activités déjà récupérées restent sur l’appareil.', confirmLabel: 'Déconnecter', danger: true });
    if (!ok) return;
    await disconnect();
    renderSheet();
    changed();
    toast('Strava déconnecté', { type: 'info' });
  }
}

/**
 * @param {{onChange:()=>void, onImportFile:()=>void}} hooks
 */
export async function initStrava({ onChange, onImportFile }) {
  changed = onChange;
  importFile = onImportFile;
  $('#stravaBody').addEventListener('submit', onSubmit);
  $('#stravaBody').addEventListener('click', onClick);
  const back = await handleRedirect();
  if (!back) return;
  if (back.error) {
    toastError(back.error);
    openStravaSheet();
    return;
  }
  toast('Strava connecté', { type: 'success' });
  syncStrava();
}
