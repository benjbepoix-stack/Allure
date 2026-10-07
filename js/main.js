/* Point d'entrée d'Allure : état, vues (Courses, Saison, Mesures), apparence et synchronisation. */
import { $, $$, debounce } from './core/utils.js';
import { formatKey } from './core/dates.js';
import { state, loadLocal, subscribe, applyRemote, setCloudSink, setWriteGuard, snapshot } from './core/store.js';
import { initCloud, pushCloud, flushNow, isCloudAvailable } from './services/firebase.js';
import { readText, write } from './services/storage.js';
import { initDialogs, openSheet } from './ui/dialog.js';
import { applyTheme, applyPalette, PALETTES } from './ui/theme.js';
import { renderStatus } from './ui/status.js';
import { toast, toastError } from './ui/toast.js';
import { icon } from './ui/icons.js';
import { initCalendarPrompt } from './features/calendar-prompt.js';
import { initRaces, renderRaces, tickCountdowns } from './views/races.js';
import { initSeason, renderSeason } from './views/season.js';
import { initMetrics, renderMetrics } from './views/metrics.js';
import { PHASE_TYPES, phaseOn, racesOn } from './core/season.js';

const VIEWS = {
  raceView: { title: 'Courses', show: renderRaces, slices: ['races'] },
  seasonView: { title: 'Saison', show: renderSeason, slices: ['objectives', 'races'] },
  metricsView: { title: 'Mesures', show: renderMetrics, slices: ['bodyMetrics'] }
};
const VIEW_KEY = 'allure_last_view';
const SYNCED_KEY = 'allure_synced_once';
let currentView = 'raceView';

function switchView(id, { scroll = true } = {}) {
  if (!VIEWS[id]) id = 'raceView';
  currentView = id;
  $$('.view').forEach(v => (v.hidden = v.id !== id));
  $$('[data-view]').forEach(b => {
    const active = b.dataset.view === id;
    b.classList.toggle('is-active', active);
    if (active) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  $('#headerTitle').textContent = VIEWS[id].title;
  document.title = `${VIEWS[id].title} · Allure`;
  VIEWS[id].show();
  write(VIEW_KEY, id);
  if (scroll) window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onStateChange(slices) {
  const view = VIEWS[currentView];
  if (view.slices.some(s => slices.includes(s))) view.show();
}

/* ---------- Apparence (propre à l'appareil) ---------- */
const theme = () => (readText('allure_theme', 'dark') === 'light' ? 'light' : 'dark');
const palette = () => (PALETTES[readText('allure_palette', '')] ? readText('allure_palette', '') : 'aurore');

function renderStyleSheet() {
  $('#paletteGrid').innerHTML = Object.entries(PALETTES)
    .map(
      ([id, p]) => `<button type="button" class="palette ${id === palette() ? 'is-active' : ''}" data-palette-pick="${id}" aria-pressed="${id === palette()}">
        <span class="palette__swatch" style="background:${p.gradient}"></span><span class="palette__name">${p.name}</span><span class="palette__hint">${p.hint}</span></button>`
    )
    .join('');
  $$('[data-theme-pick]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.themePick === theme())));
}

function initAppearance() {
  applyTheme(theme());
  applyPalette(palette());
  $('#settingsBtn').addEventListener('click', () => {
    renderStyleSheet();
    openSheet('styleSheet', { focus: false });
  });
  $('#styleSheet').addEventListener('click', e => {
    const p = e.target.closest('[data-palette-pick]')?.dataset.palettePick;
    const t = e.target.closest('[data-theme-pick]')?.dataset.themePick;
    if (p) {
      write('allure_palette', p);
      applyPalette(p);
    }
    if (t) {
      write('allure_theme', t);
      applyTheme(t, { animate: true });
    }
    if (p || t) renderStyleSheet();
  });
}

/* Saison : un appui sur un jour du calendrier en donne le détail. */
function describeDay(key) {
  const p = phaseOn(key);
  const races = racesOn(key);
  const parts = [formatKey(key, { weekday: 'long', day: 'numeric', month: 'long' }), p ? PHASE_TYPES[p.type].name : 'Pas de phase', ...races.map(r => `🏁 ${r.name}`)];
  toast(parts.join(' · '));
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
  initAppearance();

  initDialogs();
  initCalendarPrompt();
  initRaces();
  initSeason({ gotoDay: describeDay });
  initMetrics();
  subscribe(onStateChange);

  $$('[data-view]').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
  switchView(readText(VIEW_KEY, 'raceView'), { scroll: false });

  setInterval(() => currentView === 'raceView' && tickCountdowns(), 30000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
    else VIEWS[currentView].show();
  });
  window.addEventListener('pagehide', flushNow);
  window.addEventListener('resize', debounce(() => currentView === 'metricsView' && renderMetrics(), 150));

  // Écriture autorisée seulement si cet appareil a déjà reçu les données partagées.
  setWriteGuard(() => {
    if (isCloudAvailable() || readText(SYNCED_KEY, '') === '1') return true;
    toastError('Connexion à vos données en cours… Réessayez dans un instant.');
    return false;
  });
  setCloudSink(pushCloud);
  initCloud({
    onRemote: (cloud, skip) => {
      write(SYNCED_KEY, '1');
      return applyRemote(cloud, skip);
    },
    onStatus: renderStatus,
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
