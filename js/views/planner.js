/*
 * Feuille « Phases automatiques » : choix des courses qui comptent (objectif,
 * préparation, ne compte pas), date de départ du recalcul, phases faites à la
 * main à garder, aperçu du résultat, puis application après confirmation.
 */
import { $, esc } from '../core/utils.js';
import { formatKey, fromKey, todayKey } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { phaseType } from '../core/season.js';
import { PRIORITIES, applyPlan, manualFrom, mergePlan, planPhases, racePriority, withPriority } from '../core/planner.js';
import { openSheet, closeSheet, confirmDialog, isOpen } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

const short = key => formatKey(key, { day: 'numeric', month: 'short' });
const weeks = (a, b) => {
  const n = Math.round((fromKey(b) - fromKey(a)) / 864e5) + 1;
  return n % 7 === 0 ? `${n / 7} sem.` : n >= 7 ? `${(n / 7).toFixed(1).replace('.', ',')} sem.` : `${n} j`;
};

const dropped = new Set(); // phases manuelles décochées (recalculées)

/** Date de départ choisie (jamais avant aujourd'hui). */
const fromDate = () => {
  const v = $('#planFrom').value;
  return v && v > todayKey() ? v : todayKey();
};
const keepIds = from => manualFrom(from).filter(p => !dropped.has(p.id)).map(p => p.id);

function renderKeep(from) {
  const list = manualFrom(from);
  $('#planKeep').innerHTML = list.length
    ? `<p class="field__label">Phases faites à la main à garder</p><ul class="plan-keep">${list
        .map(p => {
          const t = phaseType(p.type);
          return `<li><label><input type="checkbox" data-keep="${esc(p.id)}" ${dropped.has(p.id) ? '' : 'checked'}><span class="plan-dot" style="background:${t.color}"></span><span class="plan-row__name">${esc(t.name)}<small>${short(p.start)} → ${short(p.end)}${p.note ? ` · ${esc(p.note)}` : ''}</small></span></label></li>`;
        })
        .join('')}</ul><p class="settings-hint">Cochée : la phase reste telle quelle et le plan se place autour. Décochée : elle est recalculée.</p>`
    : '';
}

function renderPlanner() {
  const from = fromDate();
  const races = state.races.filter(r => r.date >= from).sort((a, b) => a.date.localeCompare(b.date));
  $('#planRaces').innerHTML = races.length
    ? races
        .map(r => {
          const p = racePriority(r.id);
          return `<div class="plan-race"><div class="plan-race__name"><strong>${esc(r.name)}</strong><span>${formatKey(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${r.distance ? ` · ${esc(r.distance)} km` : ''}${r.elevation ? ` · ${esc(r.elevation)} m D+` : ''}</span></div>
          <div class="segmented plan-prio" role="radiogroup" aria-label="Importance de ${esc(r.name)}">${PRIORITIES.map(x => `<button type="button" role="radio" aria-checked="${p === x.id}" data-race="${esc(r.id)}" data-prio="${x.id}" title="${esc(x.hint)}">${x.name}</button>`).join('')}</div></div>`;
        })
        .join('')
    : '<p class="an-empty">Aucune course à venir. Ajoute tes courses (bouton Ajouter), puis reviens ici.</p>';

  renderKeep(from);
  const plan = planPhases(from);
  $('#planApply').disabled = !plan.length;
  if (!plan.length) {
    $('#planPreview').innerHTML = races.length ? '<p class="an-empty">Choisis au moins une course « Objectif » pour placer les phases.</p>' : '';
    return;
  }
  const keep = keepIds(from);
  const result = mergePlan(plan, from, keep).filter(p => p.end >= from);
  const start = result[0].start;
  const end = result[result.length - 1].end;
  const span = (fromKey(end) - fromKey(start)) / 864e5 + 1;
  const bar = result
    .map(p => {
      const t = phaseType(p.type);
      const w = (((fromKey(p.end) - fromKey(p.start)) / 864e5 + 1) / span) * 100;
      return `<span style="width:${w}%;background:${t.color}" title="${esc(t.name)}"></span>`;
    })
    .join('');
  const goals = races.filter(r => racePriority(r.id) === 'A');
  const marks = goals
    .filter(r => r.date <= end)
    .map(r => `<i style="left:${(((fromKey(r.date) - fromKey(start)) / 864e5 + 0.5) / span) * 100}%" title="${esc(r.name)}"></i>`)
    .join('');
  const rows = result
    .map(p => {
      const t = phaseType(p.type);
      const kept = keep.includes(p.id);
      return `<li class="${kept ? 'is-kept' : ''}"><span class="plan-dot" style="background:${t.color}"></span><span class="plan-row__name">${esc(t.name)}<small>${kept ? 'gardée telle quelle' : ''}</small></span><span class="plan-row__dates">${short(p.start)} → ${short(p.end)}<small>${weeks(p.start, p.end)}</small></span></li>`;
    })
    .join('');
  $('#planPreview').innerHTML = `<p class="field__label">Résultat</p><div class="plan-bar">${bar}${marks}</div><ol class="plan-rows">${rows}</ol>
    <p class="settings-hint">Affûtage de 7 à 14 jours selon la distance et le D+, 6 semaines de spécifique (volume puis intensité), foncier avant, récupération après chaque objectif et coupure après le dernier.</p>`;
}

export function openPlanner() {
  dropped.clear();
  $('#planFrom').min = todayKey();
  $('#planFrom').value = todayKey();
  renderPlanner();
  openSheet('planSheet', { focus: false });
}

async function onApply() {
  const from = fromDate();
  const plan = planPhases(from);
  if (!plan.length) return;
  const keep = keepIds(from);
  const ok = await confirmDialog({
    title: 'Appliquer ce plan ?',
    message: `Les phases à partir du ${short(from)} sont recalculées${keep.length ? `, sauf ${keep.length} phase${keep.length > 1 ? 's' : ''} faite${keep.length > 1 ? 's' : ''} à la main` : ''}. Les phases d’avant ne changent pas.`,
    confirmLabel: 'Appliquer'
  });
  if (!ok) return;
  state.objectives = applyPlan(plan, from, keep);
  if (commit('objectives') === false) return;
  closeSheet('planSheet');
  toast('Phases mises à jour selon tes objectifs', { type: 'success' });
}

export function initPlanner() {
  $('#planRaces').addEventListener('click', e => {
    const b = e.target.closest('[data-prio]');
    if (!b) return;
    state.objectives = withPriority(b.dataset.race, b.dataset.prio);
    if (commit('objectives') === false) return;
    renderPlanner();
  });
  $('#planApply').addEventListener('click', onApply);
  $('#planFrom').addEventListener('change', renderPlanner);
  $('#planKeep').addEventListener('change', e => {
    const box = e.target.closest('[data-keep]');
    if (!box) return;
    if (box.checked) dropped.delete(box.dataset.keep);
    else dropped.add(box.dataset.keep);
    renderPlanner();
  });
}

/** Données modifiées ailleurs pendant que la feuille est ouverte. */
export const refreshPlanner = () => isOpen('planSheet') && renderPlanner();
