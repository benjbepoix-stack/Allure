/* Saison : éditeur, liste (onglet Suivi) et suppression des phases d'entraînement. */
import { $, esc, uid } from '../core/utils.js';
import { addDays, dateKey, formatKey, fromKey, todayKey } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { rules, validate, showErrors, clearErrors, formValues } from '../core/validation.js';
import { PHASE_TYPES, PHASES_KEY, isPhaseType, getPhases, overlapping } from '../core/season.js';
import { openSheet, closeSheet, confirmDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { icon } from '../ui/icons.js';

const shortDate = key => formatKey(key, { day: 'numeric', month: 'short' });

/* ---------- Liste (onglet Suivi) ---------- */
function phaseRow(p, current) {
  const t = PHASE_TYPES[p.type];
  return `<div class="zphase phase--${p.type}">
    <button type="button" class="zphase__main" data-act="phase-edit" data-id="${esc(p.id)}">
      <span class="phase-dot"></span><span class="zrow__body"><strong>${esc(t.name)}${current ? ' · en cours' : ''}</strong><span>${shortDate(p.start)} → ${shortDate(p.end)}${p.note ? ` · ${esc(p.note)}` : ''}</span></span>
    </button>
    <button type="button" class="icon-btn icon-btn--sm" data-act="phase-edit" data-id="${esc(p.id)}" aria-label="Modifier la phase">${icon('edit', 16)}</button>
    <button type="button" class="icon-btn icon-btn--sm icon-btn--danger" data-act="phase-delete" data-id="${esc(p.id)}" aria-label="Supprimer la phase">${icon('trash', 16)}</button>
  </div>`;
}

/** Toutes les phases : en cours et à venir (chronologique), puis terminées (la plus récente d'abord). */
export function renderPhaseList(host = $('#phaseList')) {
  if (!host) return;
  const t = todayKey();
  const phases = getPhases();
  if (!phases.length) {
    host.innerHTML = '<p class="zempty">Aucune phase planifiée. Touchez Ajouter pour en créer une.</p>';
    return;
  }
  const next = phases.filter(p => p.end >= t);
  const past = phases.filter(p => p.end < t).reverse();
  host.innerHTML = [
    next.length ? `<h3 class="zsec">En cours et à venir</h3><div class="zlist">${next.map(p => phaseRow(p, p.start <= t)).join('')}</div>` : '',
    past.length ? `<h3 class="zsec">Terminées</h3><div class="zlist">${past.map(p => phaseRow(p, false)).join('')}</div>` : ''
  ].join('');
}

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
  $('#phaseSheetTitle').textContent = p ? 'Modifier la phase' : 'Nouvelle phase';
  if (p) ['type', 'start', 'end', 'note'].forEach(k => (form.elements[k].value = p[k] || ''));
  else {
    // Par défaut : enchaîne après la dernière phase (ou aujourd'hui), sur 4 semaines.
    const last = phases[phases.length - 1];
    const start = startAt || (last && last.end >= todayKey() ? dateKey(addDays(fromKey(last.end), 1)) : todayKey());
    form.elements.type.value = 'base';
    form.elements.start.value = start;
    form.elements.end.value = dateKey(addDays(fromKey(start), 27));
  }
  updateAdvice();
  openSheet('phaseSheet');
}

function updateAdvice() {
  const type = $('#phaseForm').elements.type.value;
  $('#phaseAdvice').textContent = isPhaseType(type) ? PHASE_TYPES[type].advice : '';
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
  if (clash) return showErrors(form, { end: `Chevauche « ${PHASE_TYPES[clash.type].name} » (${shortDate(clash.start)} → ${shortDate(clash.end)}).` });
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
  const ok = await confirmDialog({ title: `Supprimer la phase « ${PHASE_TYPES[phase.type].name} » ?`, message: `${shortDate(phase.start)} → ${shortDate(phase.end)}`, confirmLabel: 'Supprimer', danger: true });
  if (ok) savePhases(getPhases().filter(p => p.id !== id), 'Phase supprimée');
}

export function initSeason() {
  const form = $('#phaseForm');
  const option = ([k, t]) => `<option value="${k}">${esc(t.name)}</option>`;
  const types = Object.entries(PHASE_TYPES);
  const spec = types.filter(([, t]) => t.group === 'spec');
  form.elements.type.innerHTML = [
    ...types.filter(([k]) => k === 'base').map(option),
    `<optgroup label="Préparation spécifique">${spec.map(option).join('')}</optgroup>`,
    ...types.filter(([k, t]) => k !== 'base' && t.group !== 'spec').map(option)
  ].join('');
  form.elements.type.addEventListener('change', updateAdvice);
  form.addEventListener('submit', onSubmit);
  $('#metricsView').addEventListener('click', e => {
    const btn = e.target.closest('[data-act^="phase-"], [data-action="phase-add"]');
    if (!btn) return;
    if (btn.dataset.action === 'phase-add') return openPhaseEditor();
    if (btn.dataset.act === 'phase-edit') return openPhaseEditor(btn.dataset.id);
    if (btn.dataset.act === 'phase-delete') return deletePhase(btn.dataset.id);
  });
}
