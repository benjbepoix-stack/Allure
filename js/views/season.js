/* Saison : éditeur et suppression des phases d'entraînement (affichage dans la vue Zoom). */
import { $, esc, uid } from '../core/utils.js';
import { addDays, dateKey, formatKey, fromKey, todayKey } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { rules, validate, showErrors, clearErrors, formValues } from '../core/validation.js';
import { PHASES_KEY, phaseType, phaseTypes, isPhaseType, getPhases, overlapping } from '../core/season.js';
import { initPhaseTypes } from './phase-types.js';
import { openSheet, closeSheet, confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';

const shortDate = key => formatKey(key, { day: 'numeric', month: 'short' });

/* ---------- Éditeur ---------- */
/** Ouvre l'éditeur : phase existante (`id`) ou nouvelle phase, commençant le `start` si fourni. */
export function openPhaseEditor(id = null, { start: startAt = '' } = {}) {
  const phases = getPhases();
  const p = id ? phases.find(x => x.id === id) : null;
  if (id && !p) return toastError('Cette phase n’existe plus.');
  const form = $('#phaseForm');
  form.reset();
  clearErrors(form);
  form.elements.editId.value = p?.id || '';
  fillTypeSelect(p?.type);
  $('#phaseSheetTitle').textContent = p ? 'Modifier la phase' : 'Nouvelle phase';
  if (p) ['type', 'start', 'end', 'note'].forEach(k => (form.elements[k].value = p[k] || ''));
  else {
    // Par défaut : enchaîne après la dernière phase (ou aujourd'hui), sur 4 semaines.
    const last = phases[phases.length - 1];
    const start = startAt || (last && last.end >= todayKey() ? dateKey(addDays(fromKey(last.end), 1)) : todayKey());
    form.elements.type.value = phaseTypes()[0]?.id || '';
    form.elements.start.value = start;
    form.elements.end.value = dateKey(addDays(fromKey(start), 27));
  }
  updateAdvice();
  openSheet('phaseSheet');
}

function updateAdvice() {
  const type = $('#phaseForm').elements.type.value;
  $('#phaseAdvice').textContent = isPhaseType(type) ? phaseType(type).advice : '';
}

/**
 * Menu « Phase » : types de la liste dans leur ordre, les types consécutifs
 * « Préparation spécifique » regroupés ; `keep` (type de la phase modifiée)
 * reste proposé même s'il a été retiré de la liste.
 */
function fillTypeSelect(keep) {
  const select = $('#phaseForm').elements.type;
  const current = keep ?? select.value;
  const types = phaseTypes();
  if (current && !types.some(t => t.id === current) && isPhaseType(current)) types.push(phaseType(current));
  const option = t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`;
  let html = '';
  for (let i = 0; i < types.length; ) {
    if (types[i].group !== 'spec') html += option(types[i++]);
    else {
      let group = '';
      while (i < types.length && types[i].group === 'spec') group += option(types[i++]);
      html += `<optgroup label="Préparation spécifique">${group}</optgroup>`;
    }
  }
  select.innerHTML = html;
  if (current && types.some(t => t.id === current)) select.value = current;
}

const phaseSchema = {
  type: [v => (isPhaseType(v) ? null : 'Choisissez un type de phase.')],
  start: [rules.date({ required: true })],
  end: [rules.date({ required: true }), (v, all) => (v && all.start && v < all.start ? 'La fin doit être après le début.' : null)],
  note: [rules.maxLength(200)]
};

/** @returns {boolean} faux si l'enregistrement a été refusé (appareil jamais synchronisé). */
function savePhases(phases, message) {
  state.objectives[PHASES_KEY] = phases;
  if (commit('objectives') === false) return false;
  if (message) toast(message);
  return true;
}

function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const v = formValues(form);
  const { valid, errors } = validate(v, phaseSchema);
  if (!valid) return showErrors(form, errors);
  const clash = overlapping(v.start, v.end, v.editId);
  if (clash) return showErrors(form, { end: `Chevauche « ${phaseType(clash.type).name} » (${shortDate(clash.start)} → ${shortDate(clash.end)}).` });
  const phases = getPhases();
  const phase = { id: v.editId || uid(), type: v.type, start: v.start, end: v.end, note: v.note };
  const index = phases.findIndex(x => x.id === v.editId);
  if (index >= 0) phases[index] = phase;
  else phases.push(phase);
  phases.sort((a, b) => a.start.localeCompare(b.start));
  // La feuille ne se ferme qu'une fois la phase enregistrée (sinon la saisie serait perdue).
  if (savePhases(phases, index >= 0 ? 'Phase modifiée' : 'Phase ajoutée')) closeSheet('phaseSheet');
}

export async function deletePhase(id) {
  const phase = getPhases().find(p => p.id === id);
  if (!phase) return toastError('Cette phase n’existe plus.');
  const ok = await confirmDialog({ title: `Supprimer la phase « ${phaseType(phase.type).name} » ?`, message: `${shortDate(phase.start)} → ${shortDate(phase.end)}`, confirmLabel: 'Supprimer', danger: true });
  if (ok) savePhases(getPhases().filter(p => p.id !== id), 'Phase supprimée');
}

export function initSeason() {
  const form = $('#phaseForm');
  form.elements.type.addEventListener('change', updateAdvice);
  form.addEventListener('submit', onSubmit);
  // Liste des types modifiée pendant la saisie d'une phase : menu mis à jour, choix conservé.
  initPhaseTypes({ changed: () => { fillTypeSelect(); updateAdvice(); } });
  fillTypeSelect();
}
