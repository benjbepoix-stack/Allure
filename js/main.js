/* Point d'entrée d'Cadence : état, vues (Saison en zoom, Suivi), ajout, réglages, compte et synchronisation. */
import { $, $$, debounce } from './core/utils.js';
import { formatKey, todayKey } from './core/dates.js';
import { loadLocal, subscribe, applyRemote, setCloudSink, setWriteGuard, snapshot, resetLocal } from './core/store.js';
import { initCloud, pushCloud, flushNow, clearPending, cloudState, currentUser, signOutUser, retryMigration, WAITING_MESSAGE } from './services/firebase.js';
import { readText, write } from './services/storage.js';
import { initDialogs, openSheet, closeSheet, confirmDialog } from './ui/dialog.js';
import { initTheme, themeChoice, setThemeChoice } from './ui/theme.js';
import { initAuth, showAuth, hideAuth, isAuthShown, noAccountChosen, forgetNoAccount } from './ui/auth.js';
import { renderStatus } from './ui/status.js';
import { toast, toastError } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { initCalendarPrompt } from './features/calendar-prompt.js';
import { initRaces, openRaceEditor } from './views/races.js';
import { initSeason, openPhaseEditor } from './views/season.js';
import { refreshPhaseTypes } from './views/phase-types.js';
import { initMetrics, renderMetrics, openMeasureSheet, openValueSheet } from './views/metrics.js';
import { initZoom, renderZoom, zoomContextDay, showDay } from './views/zoom.js';
import { initAnalysis, renderAnalysis } from './views/analysis.js';
import { initPlanner, openPlanner, refreshPlanner } from './views/planner.js';
import { clearActivities } from './core/activities.js';
import { state } from './core/store.js';

const VIEWS = {
  zoomView: { title: 'Saison', show: renderZoom, slices: ['objectives', 'races', 'bodyMetrics'] },
  metricsView: { title: 'Suivi', show: renderMetrics, slices: ['bodyMetrics'] },
  analysisView: { title: 'Analyse', show: renderAnalysis, slices: ['objectives', 'races'] }
};
const VIEW_KEY = 'allure_last_view';
// uid du compte dont le nœud (migré) a déjà été reçu sur cet appareil ('1' : ancienne base publique).
const SYNCED_KEY = 'allure_synced_once';
// Dernier compte connecté sur cet appareil (changement de compte : données locales vidées).
const LAST_UID = 'allure_last_uid';
let currentView = 'zoomView';

function switchView(id, { scroll = true } = {}) {
  if (!VIEWS[id]) id = 'zoomView';
  currentView = id;
  $$('.view').forEach(v => (v.hidden = v.id !== id));
  $$('[data-view]').forEach(b => {
    const active = b.dataset.view === id;
    b.classList.toggle('is-active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('#headerTitle').textContent = VIEWS[id].title;
  document.title = `${VIEWS[id].title} · Cadence`;
  VIEWS[id].show();
  write(VIEW_KEY, id);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onStateChange(slices) {
  if (slices.includes('objectives')) refreshPhaseTypes();
  if (slices.includes('objectives') || slices.includes('races')) refreshPlanner();
  const view = VIEWS[currentView];
  if (view.slices.some(s => slices.includes(s))) view.show();
}

/* ---------- Réglages : thème (propre à l'appareil) et compte ---------- */
function renderThemeSwitch() {
  $$('[data-theme-pick]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themePick === themeChoice())));
}

function renderAccount() {
  const user = currentUser();
  const state = cloudState();
  $('#accountLine').textContent = user
    ? `Connecté : ${user.email}${state === 'waiting' ? `. ${WAITING_MESSAGE}` : ''}`
    : state === 'signedOut'
      ? 'Sans compte : données de cet appareil uniquement, sans synchronisation.'
      : state === 'local'
        ? 'Synchronisation indisponible : données enregistrées sur cet appareil.'
        : 'Connexion…';
  $('#logoutBtn').hidden = !user;
  $('#loginBtn').hidden = Boolean(user) || state !== 'signedOut';
}

function initSettings() {
  initTheme();
  $('#settingsBtn').addEventListener('click', () => {
    renderThemeSwitch();
    renderAccount();
    openSheet('settingsSheet', { focus: false });
  });
  $('#themeSwitch').addEventListener('click', e => {
    const t = e.target.closest('[data-theme-pick]')?.dataset.themePick;
    if (!t) return;
    setThemeChoice(t);
    renderThemeSwitch();
  });
  $('#settingsSheet').addEventListener('click', e => {
    if (!e.target.closest('[data-action="planner"]')) return;
    closeSheet('settingsSheet');
    openPlanner();
  });
  $('#loginBtn').addEventListener('click', () => {
    closeSheet('settingsSheet');
    showAuth();
  });
  $('#logoutBtn').addEventListener('click', async () => {
    if (!currentUser()) return;
    const ok = await confirmDialog({ title: 'Se déconnecter ?', message: 'Vos données restent enregistrées dans votre compte.', confirmLabel: 'Se déconnecter' });
    if (!ok) return;
    closeSheet('settingsSheet');
    try {
      await signOutUser();
    } catch (error) {
      console.warn('[auth] déconnexion', error);
      toastError('Déconnexion impossible. Réessayez.');
    }
  });
}

/* ---------- Compte ---------- */
function onUser(user) {
  if (user) {
    const last = readText(LAST_UID, '');
    if (last && last !== user.uid) {
      // Autre compte que le précédent sur cet appareil : on repart d'une base vide.
      clearPending();
      resetLocal();
      clearActivities();
    } else if (readText(SYNCED_KEY, '') !== user.uid) {
      // Modifications faites sans ce compte (appareil jamais synchronisé avec lui) : jamais envoyées.
      clearPending();
    }
    write(LAST_UID, user.uid);
    forgetNoAccount();
    hideAuth();
  } else if (!noAccountChosen()) showAuth(); // sauf si « Continuer sans compte » a déjà été choisi
  renderAccount();
}

/*
 * Garde-fou d'écriture : tant que cet appareil n'a pas reçu le nœud du compte
 * (migré depuis l'ancienne base), l'état local peut être vide ou périmé ;
 * enregistrer une tranche (ex. une seule course) écraserait alors la liste
 * complète partagée avec Carnet. Les modifications sont donc refusées, sauf :
 * - nœud reçu (synchronisation active) ;
 * - sans compte : données de l'appareil uniquement, jamais envoyées (le compte prime à la connexion) ;
 * - Firebase injoignable : rien n'est envoyé, appareil déjà synchronisé une fois ;
 * - compte déjà synchronisé sur cet appareil : envoi à la reconnexion.
 */
function canWrite() {
  const state = cloudState();
  const synced = readText(SYNCED_KEY, '');
  if (state === 'ready' || state === 'signedOut') return true;
  if (state === 'local') {
    if (synced) return true;
  } else if (state === 'pending') {
    const uid = currentUser()?.uid || readText(LAST_UID, '');
    if (uid && synced === uid) return true;
  }
  toastError(state === 'waiting' ? WAITING_MESSAGE : 'Connexion à vos données en cours… Réessayez dans un instant.');
  return false;
}

/* ---------- Ajouter : course, phase, poids, FTP, mensurations ---------- */
const fmtNum = (n, d) => Number(n).toFixed(d).replace('.', ',');

function openAdd() {
  const day = currentView === 'zoomView' ? zoomContextDay() : '';
  const dayLabel = day ? formatKey(day, { weekday: 'long', day: 'numeric', month: 'long' }) : '';
  $('#addSub').textContent = day ? `Pour le ${dayLabel}` : '';
  $('#addRaceSub').textContent = day ? `Le ${dayLabel}` : 'Nom, sport, date, distance';
  $('#addPhaseSub').textContent = day ? `À partir du ${dayLabel}` : 'Enchaîne après la dernière phase';
  const w = state.bodyMetrics.weight.at(-1);
  const f = state.bodyMetrics.ftp.at(-1);
  $('#addWeightSub').textContent = w ? `Dernier : ${fmtNum(w.value, 1)} kg` : 'Mesure du jour';
  $('#addFtpSub').textContent = f ? `Dernier : ${fmtNum(f.value, 0)} W` : 'Puissance seuil vélo';
  $('#addSheet').dataset.day = day;
  openSheet('addSheet', { focus: false });
}

function onAddPick(e) {
  const kind = e.target.closest('[data-add]')?.dataset.add;
  if (!kind) return;
  const day = $('#addSheet').dataset.day || '';
  closeSheet('addSheet');
  if (kind === 'race') return openRaceEditor(null, { date: day });
  if (kind === 'phase') return openPhaseEditor(null, { start: day });
  if (kind === 'plan') return openPlanner();
  if (kind === 'measure') return openMeasureSheet();
  // Poids et FTP : feuille de saisie, date du jour affiché si elle n'est pas dans le futur.
  openValueSheet(kind, day && day <= todayKey() ? day : todayKey());
}

function initGlobalErrors() {
  let last = 0;
  const report = error => {
    console.error(error);
    if (Date.now() - last < 4000) return;
    last = Date.now();
    toastError('Une erreur inattendue est survenue. Vos données sont conservées.');
  };
  window.addEventListener('error', e => report(e.error || e.message));
  window.addEventListener('unhandledrejection', e => report(e.reason));
}

function init() {
  initGlobalErrors();
  loadLocal();
  $$('[data-icon]').forEach(el => (el.innerHTML = icon(el.dataset.icon, Number(el.dataset.size) || 22)));
  initSettings();
  initAuth({ onLocal: () => toast('Sans compte : données de cet appareil uniquement', { type: 'info' }) });

  initDialogs();
  initCalendarPrompt();
  initRaces({ saved: race => currentView === 'zoomView' && showDay(race.date) });
  initSeason();
  initMetrics();
  initZoom();
  initAnalysis();
  initPlanner();
  $('#addBtn').addEventListener('click', openAdd);
  $('#addList').addEventListener('click', onAddPick);
  subscribe(onStateChange);

  $$('[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  switchView(readText(VIEW_KEY, 'zoomView'), { scroll: false });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
    else {
      VIEWS[currentView].show();
      retryMigration();
    }
  });
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('resize', debounce(() => currentView === 'metricsView' && renderMetrics(), 150));

  setWriteGuard(canWrite);
  setCloudSink(pushCloud);
  initCloud({
    onUser,
    onRemote: applyRemote,
    onReady: uid => {
      write(SYNCED_KEY, uid);
      renderAccount();
    },
    onWaiting: () => {
      if (!isAuthShown()) toast(WAITING_MESSAGE, { type: 'info', duration: 6000 });
    },
    onStatus: (status, detail) => {
      renderStatus(status, detail);
      if (status === 'local') renderAccount();
    },
    onError: message => toastError(`Synchronisation : ${message}`),
    getSnapshot: snapshot
  });

  document.documentElement.classList.add('is-ready');

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (hadController) location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(error => console.warn('[sw] enregistrement impossible', error));
  }
}

init();
