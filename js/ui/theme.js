/* Thème clair / sombre et palette d'accent (choix propres à l'appareil). */
import { $ } from '../core/utils.js';

const THEME_COLORS = { dark: '#16171c', light: '#f4f4f7' };

/** Palettes proposées : le dégradé sert aux boutons, graphiques et à l'icône. */
export const PALETTES = {
  aurore: { name: 'Aurore', hint: 'Violet → orange', gradient: 'linear-gradient(135deg, #7b5cff, #ff4f9a 55%, #ff9f43)' },
  lagon: { name: 'Lagon', hint: 'Cyan → indigo', gradient: 'linear-gradient(135deg, #36d6ff, #5b6cff)' },
  braise: { name: 'Braise', hint: 'Rouge → ambre', gradient: 'linear-gradient(135deg, #ff4d5e, #ffb340)' },
  menthe: { name: 'Menthe', hint: 'Vert → turquoise', gradient: 'linear-gradient(135deg, #2ee6a8, #1fb9d6)' }
};

export function applyTheme(theme, { animate = false } = {}) {
  const root = document.documentElement;
  if (animate) {
    root.classList.add('theme-transition');
    setTimeout(() => root.classList.remove('theme-transition'), 450);
  }
  root.dataset.theme = theme;
  $('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}

export function applyPalette(id) {
  document.documentElement.dataset.palette = PALETTES[id] ? id : 'aurore';
}
