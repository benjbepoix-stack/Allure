/* Saison : éditeur et suppression des phases d'entraînement (affichage dans la vue Zoom). */
import { $, esc, uid } from '../core/utils.js';
import { addDays, dateKey, formatKey, fromKey, todayKey } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { rules, validate, showErrors, clearErrors, formValues } from '../core/validation.js';
import { PHASES_KEY, phaseType, phaseTypes, isPhaseType, getPhases } from '../core/season.js';
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
  $('#phaseDelete').hidden = !p;
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

/**
 * Place `phase` parmi `others` : les phases chevauchées sont raccourcies, retirées si
 * entièrement recouvertes, ou coupées en deux si `phase` tombe en leur milieu.
 */
function fitAround(others, phase) {
  const before = key => dateKey(addDays(fromKey(key), -1));
  const after = key => dateKey(addDays(fromKey(key), 1));
  const out = [phase];
  for (const p of others) {
    if (p.end < phase.start || p.start > phase.end) out.push(p);
    else {
      if (p.start < phase.start) out.push({ ...p, end: before(phase.start) });
      if (p.end > phase.end) out.push({ ...p, id: p.start < phase.start ? uid() : p.id, start: after(phase.end) });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

async function onSubmit(e) {
  e.preventDefault();
  const form = e.currentTarget;
  const v = formValues(form);
  const { valid, errors } = validate(v, phaseSchema);
  if (!valid) return showErrors(form, errors);
  const phase = { id: v.editId || uid(), type: v.type, start: v.start, end: v.end, note: v.note, origin: 'manual' };
  const clashes = getPhases().filter(p => p.id !== phase.id && p.start <= phase.end && phase.start <= p.end);
  if (clashes.length) {
    const names = clashes.map(c => `« ${phaseType(c.type).name} » (${shortDate(c.start)} → ${shortDate(c.end)})`).join(', ');
    const ok = await confirmDialog({
      title: 'Ajuster les phases voisines ?',
      message: `Ces dates chevauchent ${names}. Elles seront raccourcies (ou retirées si entièrement recouvertes).`,
      confirmLabel: 'Ajuster'
    });
    if (!ok) return showErrors(form, { end: `Chevauche ${names}.` });
  }
  const phases = fitAround(getPhases().filter(p => p.id !== phase.id), phase);
  const edited = Boolean(v.editId && getPhases().some(p => p.id === v.editId));
  // La feuille ne se ferme qu'une fois la phase enregistrée (sinon la saisie serait perdue).
  if (savePhases(phases, edited ? 'Phase modifiée' : 'Phase ajoutée')) closeSheet('phaseSheet');
}

export async function deletePhase(id) {
  const phase = getPhases().find(p => p.id === id);
  if (!phase) return toastError('Cette phase n’existe plus.');
  const ok = await confirmDialog({ title: `Supprimer la phase « ${phaseType(phase.type).name} » ?`, message: `${shortDate(phase.start)} → ${shortDate(phase.end)}`, confirmLabel: 'Supprimer', danger: true });
  return ok && savePhases(getPhases().filter(p => p.id !== id), 'Phase supprimée');
}

export function initSeason() {
  const form = $('#phaseForm');
  form.elements.type.addEventListener('change', updateAdvice);
  form.addEventListener('submit', onSubmit);
  $('#phaseDelete').addEventListener('click', async () => {
    if (await deletePhase(form.elements.editId.value)) closeSheet('phaseSheet');
  });
  // Liste des types modifiée pendant la saisie d'une phase : menu mis à jour, choix conservé.
  initPhaseTypes({ changed: () => { fillTypeSelect(); updateAdvice(); } });
  fillTypeSelect();
}
