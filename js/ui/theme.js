/*
 * Thème Auto / Sombre / Clair (choix propre à l'appareil).
 * Auto (défaut) suit le réglage clair / sombre du système ; `data-theme`
 * vaut toujours « dark » ou « light » (le CSS ne connaît que ces deux valeurs).
 */
import { $ } from '../core/utils.js';
import { readText, write } from '../services/storage.js';

const KEY = 'allure_theme';
const AUTO_MIGRATED = 'allure_theme_auto_v1';
const THEME_COLORS = { dark: '#16171c', light: '#f4f4f7' };
const lightMedia = window.matchMedia?.('(prefers-color-scheme: light)');

/** Choix enregistré : auto, dark ou light. */
export function themeChoice() {
  const t = readText(KEY, 'auto');
  return t === 'dark' || t === 'light' ? t : 'auto';
}

const resolve = choice => (choice === 'auto' ? (lightMedia?.matches ? 'light' : 'dark') : choice);

export function applyTheme(choice, { animate = false } = {}) {
  const root = document.documentElement;
  const theme = resolve(choice);
  if (animate && root.dataset.theme !== theme) {
    root.classList.add('theme-transition');
    setTimeout(() => root.classList.remove('theme-transition'), 450);
  }
  root.dataset.theme = theme;
  $('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function setThemeChoice(choice) {
  write(KEY, choice);
  applyTheme(choice, { animate: true });
}

export function initTheme() {
  // Migration unique : « dark » était le thème par défaut, il devient « auto ».
  if (readText(AUTO_MIGRATED, '') !== '1') {
    if (readText(KEY, '') === 'dark') write(KEY, 'auto');
    write(AUTO_MIGRATED, '1');
  }
  applyTheme(themeChoice());
  // Auto : suit les changements du système (passage clair / sombre automatique de l'iPhone).
  lightMedia?.addEventListener?.('change', () => themeChoice() === 'auto' && applyTheme('auto', { animate: true }));
}
