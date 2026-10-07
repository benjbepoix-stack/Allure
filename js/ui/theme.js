/* Thème clair / sombre (choix propre à l'appareil). */
import { $ } from '../core/utils.js';

const THEME_COLORS = { dark: '#16171c', light: '#f4f4f7' };

export function applyTheme(theme, { animate = false } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    setTimeout(() => root.classList.remove('theme-transition'), 450);
  }
  root.dataset.theme = theme;
  $('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
