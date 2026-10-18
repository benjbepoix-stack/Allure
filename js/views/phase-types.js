/* Types de phase : liste modifiable (ajout, modification, ordre, retrait) et couleurs. */
import { $, esc, uid } from '../core/utils.js';
import { state, commit } from '../core/store.js';
import { rules, validate, showErrors, clearErrors, formValues } from '../core/validation.js';
import { PHASE_TYPES_KEY, allPhaseTypes, phaseTypes, getPhases, inkFor } from '../core/season.js';
import { openSheet, closeSheet, confirmDialog, isOpen } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const LOADS = [0.2, 0.4, 0.6, 0.8, 0.95];
const nearestLoad = v => LOADS.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
let onChange = () => {};

/* ---------- Couleurs : une règle .phase--<id> par type (feuille de style générée) ---------- */
export function applyPhaseColors() {
  let el = document.getElementById('phaseColors');
  if (!el) {
    el = document.createElement('style');
    el.id = 'phaseColors';
    document.head.appendChild(el);
  }
  el.textContent = allPhaseTypes()
    .map(t => {
      const sel = `.phase--${CSS.escape(t.id)}`;
      const light = t.light ? `\n:root[data-theme="light"] ${sel} { --ph: ${t.light}; }` : '';
      return `${sel} { --ph: ${t.color}; --ph-ink: ${inkFor(t.color)}; }${light}`;
    })
    .join('\n');
}

/** Enregistre la liste complète (types retirés compris, pour les phases existantes). */
function saveTypes(list, message) {
  state.objectives[PHASE_TYPES_KEY] = list.map(t => {
    const { light, ...rest } = t;
    return rest;
  });
  if (commit('objectives') === false) return false;
  applyPhaseColors();
  renderList();
  onChange();
  if (message) toast(message);
  return true;
}

/* ---------- Liste ---------- */
function renderList() {
  if (!isOpen('phaseTypesSheet')) return;
  const list = phaseTypes();
  $('#phaseTypeList').innerHTML = list.length
    ? list
        .map(
          (t, i) => `<div class="zphase phase--${esc(t.id)}" data-id="${esc(t.id)}">
      <button type="button" class="zphase__main" data-act="type-edit">
        <span class="phase-dot"></span><span class="zrow__body"><strong>${esc(t.name)}</strong><span>${esc(t.short)}${t.group === 'spec' ? ' · Préparation spécifique' : ''}</span></span>
      </button>
      <button type="button" class="icon-btn icon-btn--sm" data-act="type-up" aria-label="Monter" ${i === 0 ? 'disabled' : ''}>${icon('chevronUp', 16)}</button>
      <button type="button" class="icon-btn icon-btn--sm" data-act="type-down" aria-label="Descendre" ${i === list.length - 1 ? 'disabled' : ''}>${icon('chevronDown', 16)}</button>
      <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="type-delete" aria-label="Retirer de la liste">${icon('trash', 16)}</button>
    </div>`
        )
        .join('')
    : '<p class="zempty">Aucun type. Touchez Nouveau type pour en créer un.</p>';
}

export function openPhaseTypes() {
  openSheet('phaseTypesSheet', { focus: false });
  renderList();
}

/** Monte (dir −1) ou descend (dir 1) un type parmi les types affichés. */
function move(id, dir) {
  const all = allPhaseTypes().map(t => ({ ...t }));
  const shown = all.filter(t => !t.hidden);
  const i = shown.findIndex(t => t.id === id);
  const other = shown[i + dir];
  if (i < 0 || !other) return;
  const a = all.indexOf(shown[i]);
  const b = all.indexOf(other);
  [all[a], all[b]] = [all[b], all[a]];
  saveTypes(all);
}

async function remove(id) {
  const all = allPhaseTypes().map(t => ({ ...t }));
  const type = all.find(t => t.id === id);
  if (!type) return;
  const used = getPhases().filter(p => p.type === id).length;
  if (phaseTypes().length <= 1) return toastError('Gardez au moins un type de phase.');
  const ok = await confirmDialog({
    title: `Retirer « ${type.name} » de la liste ?`,
    message: used ? `${used} phase${used > 1 ? 's' : ''} déjà planifiée${used > 1 ? 's' : ''} garde${used > 1 ? 'nt' : ''} ce type, sa couleur et son conseil.` : 'Ce type ne sera plus proposé.',
    confirmLabel: 'Retirer',
    danger: true
  });
  if (!ok) return;
  // Type encore utilisé : seulement masqué, pour que ses phases restent lisibles (et conservées).
  const next = used ? all.map(t => (t.id === id ? { ...t, hidden: true } : t)) : all.filter(t => t.id !== id);
  saveTypes(next, 'Type retiré de la liste');
}

/* ---------- Éditeur d'un type ---------- */
function openTypeEditor(id = null) {
  const t = id ? allPhaseTypes().find(x => x.id === id) : null;
  const form = $('#phaseTypeForm');
  form.reset();
  clearErrors(form);
  form.elements.editId.value = t?.id || '';
  $('#phaseTypeTitle').textContent = t ? 'Modifier le type' : 'Nouveau type';
  form.elements.name.value = t?.name || '';
  form.elements.short.value = t?.short || '';
  form.elements.color.value = t?.color || '#2f80ff';
  form.elements.load.value = String(nearestLoad(t?.load ?? 0.6));
  form.elements.spec.checked = t?.group === 'spec';
  form.elements.advice.value = t?.advice || '';
  openSheet('phaseTypeSheet');
}

const typeSchema = {
  name: [rules.required('Le nom'), rules.maxLength(60)],
  short: [rules.maxLength(20)],
  advice: [rules.maxLength(400)]
};

function onTypeSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const v = formValues(form);
  const { valid, errors } = validate(v, typeSchema);
  if (!valid) return showErrors(form, errors);
  const all = allPhaseTypes().map(t => ({ ...t }));
  if (all.some(t => !t.hidden && t.id !== v.editId && t.name.toLowerCase() === v.name.toLowerCase())) return showErrors(form, { name: 'Ce nom existe déjà.' });
  const index = all.findIndex(t => t.id === v.editId);
  const prev = all[index];
  const type = {
    id: prev?.id || `t${uid()}`,
    name: v.name,
    short: v.short || v.name.slice(0, 20),
    advice: v.advice,
    color: /^#[0-9a-f]{6}$/i.test(v.color) ? v.color.toLowerCase() : '#2f80ff',
    load: Number(v.load) || 0.6,
    ...(form.elements.spec.checked ? { group: 'spec' } : {})
  };
  // Charge inchangée dans le menu : la valeur d'origine (ex. 0,85) est conservée.
  if (prev && nearestLoad(prev.load) === type.load) type.load = prev.load;
  if (index >= 0) all[index] = type;
  else {
    // Nouveau type : placé après le dernier type affiché.
    const lastShown = all.map(t => !t.hidden).lastIndexOf(true);
    all.splice(lastShown + 1, 0, type);
  }
  if (saveTypes(all, index >= 0 ? 'Type modifié' : 'Type ajouté')) closeSheet('phaseTypeSheet');
}

/** `changed` : appelé après chaque modification de la liste (menu de l'éditeur de phase). */
export function initPhaseTypes({ changed } = {}) {
  if (changed) onChange = changed;
  applyPhaseColors();
  document.addEventListener('click', e => {
    if (e.target.closest('[data-action="phase-types"]')) openPhaseTypes();
  });
  $('#phaseTypesSheet').addEventListener('click', e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.closest('[data-id]')?.dataset.id;
    switch (btn.dataset.act) {
      case 'type-add': return openTypeEditor();
      case 'type-edit': return openTypeEditor(id);
      case 'type-up': return move(id, -1);
      case 'type-down': return move(id, 1);
      case 'type-delete': return remove(id);
    }
  });
  $('#phaseTypeForm').addEventListener('submit', onTypeSubmit);
}

/** Données reçues (autre appareil) : couleurs et liste à jour. */
export function refreshPhaseTypes() {
  applyPhaseColors();
  renderList();
}
