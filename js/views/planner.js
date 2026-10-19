/*
 * Feuille « Phases automatiques » : choix des courses qui comptent (objectif,
 * préparation, ne compte pas), aperçu du plan calé sur les objectifs, puis
 * remplacement des phases futures après confirmation.
 */
import { $, esc } from '../core/utils.js';
import { formatKey, fromKey, todayKey } from '../core/dates.js';
import { state, commit } from '../core/store.js';
import { phaseType } from '../core/season.js';
import { PRIORITIES, applyPlan, planPhases, racePriority, withPriority } from '../core/planner.js';
import { openSheet, closeSheet, confirmDialog, isOpen } from '../ui/dialog.js';
import { toast } from '../ui/toast.js';

const short = key => formatKey(key, { day: 'numeric', month: 'short' });
const weeks = (a, b) => {
  const n = Math.round((fromKey(b) - fromKey(a)) / 864e5) + 1;
  return n % 7 === 0 ? `${n / 7} sem.` : n >= 7 ? `${(n / 7).toFixed(1).replace('.', ',')} sem.` : `${n} j`;
};

function renderPlanner() {
  const today = todayKey();
  const races = state.races.filter(r => r.date >= today).sort((a, b) => a.date.localeCompare(b.date));
  $('#planRaces').innerHTML = races.length
    ? races
        .map(r => {
          const p = racePriority(r.id);
          return `<div class="plan-race"><div class="plan-race__name"><strong>${esc(r.name)}</strong><span>${formatKey(r.date, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}${r.distance ? ` · ${esc(r.distance)} km` : ''}${r.elevation ? ` · ${esc(r.elevation)} m D+` : ''}</span></div>
          <div class="segmented plan-prio" role="radiogroup" aria-label="Importance de ${esc(r.name)}">${PRIORITIES.map(x => `<button type="button" role="radio" aria-checked="${p === x.id}" data-race="${esc(r.id)}" data-prio="${x.id}" title="${esc(x.hint)}">${x.name}</button>`).join('')}</div></div>`;
        })
        .join('')
    : '<p class="an-empty">Aucune course à venir. Ajoute tes courses (bouton Ajouter), puis reviens ici.</p>';

  const plan = planPhases(today);
  $('#planApply').disabled = !plan.length;
  if (!plan.length) {
    $('#planPreview').innerHTML = races.length ? '<p class="an-empty">Choisis au moins une course « Objectif » pour placer les phases.</p>' : '';
    return;
  }
  const start = plan[0].start;
  const end = plan[plan.length - 1].end;
  const span = (fromKey(end) - fromKey(start)) / 864e5 + 1;
  const bar = plan
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
  const rows = plan
    .map(p => {
      const t = phaseType(p.type);
      const race = state.races.find(r => r.id === p.race);
      return `<li><span class="plan-dot" style="background:${t.color}"></span><span class="plan-row__name">${esc(t.name)}<small>${p.type === 'taper' && race ? `jusqu’à ${esc(race.name)}` : ''}</small></span><span class="plan-row__dates">${short(p.start)} → ${short(p.end)}<small>${weeks(p.start, p.end)}</small></span></li>`;
    })
    .join('');
  $('#planPreview').innerHTML = `<p class="field__label">Plan proposé</p><div class="plan-bar">${bar}${marks}</div><ol class="plan-rows">${rows}</ol>
    <p class="settings-hint">Affûtage de 7 à 14 jours selon la distance et le D+, 6 semaines de spécifique (volume puis intensité), foncier avant, récupération après chaque objectif et coupure après le dernier.</p>`;
}

export function openPlanner() {
  renderPlanner();
  openSheet('planSheet', { focus: false });
}

async function onApply() {
  const plan = planPhases();
  if (!plan.length) return;
  const ok = await confirmDialog({
    title: 'Remplacer les phases à venir ?',
    message: 'Les phases à partir d’aujourd’hui sont remplacées par ce plan. Les phases passées sont conservées.',
    confirmLabel: 'Remplacer'
  });
  if (!ok) return;
  state.objectives = applyPlan(plan);
  if (commit('objectives') === false) return;
  closeSheet('planSheet');
  toast(`${plan.length} phases placées selon tes objectifs`, { type: 'success' });
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
}

/** Données modifiées ailleurs pendant que la feuille est ouverte. */
export const refreshPlanner = () => isOpen('planSheet') && renderPlanner();
