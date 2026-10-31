/*
 * Vue Courses : le catalogue des cyclosportives et des courses de ski de fond.
 * Filtres (sport, région, recherche, présélection), une carte par épreuve avec
 * sa prochaine édition ; l'étoile présélectionne, « Ajouter » ouvre l'éditeur
 * de course pré-rempli (la date, souvent estimée, se vérifie avant d'enregistrer).
 */
import { $, esc, debounce, plural } from '../core/utils.js';
import { formatKey, fromKey, todayKey } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { readText, write } from '../services/storage.js';
import { icon } from '../ui/icons.js';
import { toast } from '../ui/toast.js';
import { CATALOG, CATALOG_REGIONS, CATALOG_SPORTS, nextEdition, seasonRaceFor, isPicked, withPick, prefillFor } from '../core/catalog.js';
import { openRaceEditor } from './races.js';

const FILTER_KEY = 'allure_catalog_filter';
let filter = { sport: 'all', region: '', q: '', mine: false };
let onOpenDay = () => {};

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const norm = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Épreuves à venir, avec leur prochaine édition et la course correspondante de la saison. */
function entries() {
  const t = todayKey();
  return CATALOG.map(c => {
    const edition = nextEdition(c, t);
    return edition ? { c, edition, inSeason: seasonRaceFor(c, edition), picked: isPicked(c.id) } : null;
  })
    .filter(Boolean)
    .sort((a, b) => a.edition.date.localeCompare(b.edition.date) || a.c.name.localeCompare(b.c.name, 'fr'));
}

function matches(e) {
  if (filter.sport !== 'all' && e.c.kind !== filter.sport) return false;
  if (filter.region && e.c.region !== filter.region) return false;
  if (filter.mine && !e.picked && !e.inSeason) return false;
  if (filter.q) {
    const q = norm(filter.q.trim());
    if (q && !norm(`${e.c.name} ${e.c.location}`).includes(q)) return false;
  }
  return true;
}

function cardHTML({ c, edition, inSeason, picked }) {
  const d = fromKey(edition.date);
  const sport = CATALOG_SPORTS.find(s => s.id === c.kind);
  const state = inSeason ? ' is-in' : picked ? ' is-picked' : '';
  return `<article class="cat-card${state}" data-id="${esc(c.id)}">
    <div class="cat-card__date"><strong>${d.getDate()}</strong><span>${esc(formatKey(edition.date, { month: 'short' }))}</span></div>
    <div class="cat-card__body">
      <h3 class="cat-card__name">${esc(c.name)}</h3>
      <p class="cat-card__meta"><span class="cat-sport cat-sport--${c.kind}">${esc(sport.name)}</span>${esc(c.location || '')}</p>
      ${c.distance ? `<p class="cat-card__dist">${esc(c.distance)}</p>` : ''}
      <div class="cat-card__foot">
        <span class="cat-date${edition.confirmed ? ' is-ok' : ''}">${edition.confirmed ? 'Date confirmée' : 'Date estimée'}</span>
        ${c.link ? `<a class="cat-link" href="${esc(c.link)}" target="_blank" rel="noopener">Site</a>` : ''}
        ${
          inSeason
            ? `<button type="button" class="cat-add is-in" data-act="open" data-key="${esc(inSeason.date)}">${icon('check', 15)}<span>Dans ma saison</span></button>`
            : `<button type="button" class="cat-add" data-act="add">${icon('plus', 15)}<span>Ajouter</span></button>`
        }
      </div>
    </div>
    <button type="button" class="cat-star" data-act="pick" aria-pressed="${picked}" aria-label="${picked ? 'Retirer de ma sélection' : 'Ajouter à ma sélection'}">${picked ? '★' : '☆'}</button>
  </article>`;
}

export function renderCatalog() {
  const all = entries();
  const list = all.filter(matches);
  const mineCount = all.filter(e => e.picked || e.inSeason).length;
  $('#catMine').setAttribute('aria-pressed', String(filter.mine));
  $('#catMineCount').textContent = mineCount;
  document.querySelectorAll('#catSports [data-sport]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.sport === filter.sport)));
  const regions = CATALOG_REGIONS.filter(r => filter.sport === 'all' || r.sport === filter.sport);
  if (filter.region && !regions.some(r => r.id === filter.region)) filter.region = '';
  const groups = filter.sport === 'all' ? CATALOG_SPORTS.map(s => [s, regions.filter(r => r.sport === s.id)]) : [[null, regions]];
  $('#catRegion').innerHTML =
    `<option value="">Toutes les régions</option>` +
    groups
      .map(([s, rs]) => {
        const opts = rs.map(r => `<option value="${esc(r.id)}"${r.id === filter.region ? ' selected' : ''}>${esc(r.label)}</option>`).join('');
        return s ? `<optgroup label="${esc(s.name)}">${opts}</optgroup>` : opts;
      })
      .join('');
  $('#catCount').textContent = `${list.length} ${plural(list.length, 'course')}`;

  if (!list.length) {
    $('#catalogBody').innerHTML = `<p class="zempty">${filter.mine ? 'Aucune course sélectionnée. Touchez l’étoile d’une course pour la garder ici.' : 'Aucune course ne correspond à ces filtres.'}</p>`;
    return;
  }
  let month = '';
  const html = [];
  list.forEach(e => {
    const m = e.edition.date.slice(0, 7);
    if (m !== month) {
      month = m;
      html.push(`<h2 class="cat-month">${esc(cap(formatKey(`${m}-01`, { month: 'long', year: 'numeric' })))}</h2>`);
    }
    html.push(cardHTML(e));
  });
  $('#catalogBody').innerHTML = html.join('');
}

function saveFilter() {
  write(FILTER_KEY, JSON.stringify({ sport: filter.sport, region: filter.region, mine: filter.mine }));
}

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const id = btn.closest('[data-id]')?.dataset.id;
  const c = CATALOG.find(x => x.id === id);
  if (!c) return;
  const act = btn.dataset.act;
  if (act === 'pick') {
    const on = !isPicked(id);
    state.objectives = withPick(id, on);
    if (commit('objectives') === false) return;
    toast(on ? 'Ajoutée à ma sélection' : 'Retirée de ma sélection');
  } else if (act === 'add') openRaceEditor(null, { prefill: prefillFor(c) });
  else if (act === 'open') onOpenDay(btn.dataset.key);
}

export function initCatalog({ openDay } = {}) {
  if (openDay) onOpenDay = openDay;
  try {
    const saved = JSON.parse(readText(FILTER_KEY, '{}'));
    if (['all', 'velo', 'ski'].includes(saved.sport)) filter.sport = saved.sport;
    if (typeof saved.region === 'string') filter.region = saved.region;
    filter.mine = saved.mine === true;
  } catch {
    /* filtre par défaut */
  }
  $('#catSports').addEventListener('click', e => {
    const b = e.target.closest('[data-sport]');
    if (!b) return;
    filter.sport = b.dataset.sport;
    saveFilter();
    renderCatalog();
  });
  $('#catRegion').addEventListener('change', e => {
    filter.region = e.target.value;
    saveFilter();
    renderCatalog();
  });
  $('#catMine').addEventListener('click', () => {
    filter.mine = !filter.mine;
    saveFilter();
    renderCatalog();
  });
  $('#catSearch').addEventListener(
    'input',
    debounce(e => {
      filter.q = e.target.value;
      renderCatalog();
    }, 120)
  );
  $('#catalogBody').addEventListener('click', onClick);
}
