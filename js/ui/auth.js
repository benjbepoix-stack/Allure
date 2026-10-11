/*
 * Écran de connexion (repris de Ma Maison) : connexion, création de compte,
 * mot de passe oublié, ou « Continuer sans compte » (données de l'appareil,
 * sans synchronisation). Affiché seulement quand le service de connexion
 * répond « pas de compte » : jamais d'écran bloquant au démarrage.
 * « Continuer sans compte » est gardé pour la session de l'app (comme Carnet) :
 * un rechargement ne redemande pas ; au prochain lancement, l'écran revient.
 */
import { $ } from '../core/utils.js';
import { validate, rules } from '../core/validation.js';
import { signIn, signUp, resetPassword, describeAuthError } from '../services/firebase.js';

const NO_ACCOUNT_KEY = 'allure_no_account';

/** « Continuer sans compte » choisi pendant cette session de l'app. */
export function noAccountChosen() {
  try {
    return sessionStorage.getItem(NO_ACCOUNT_KEY) === '1';
  } catch {
    return false;
  }
}

/** Choix oublié (compte connecté). */
export function forgetNoAccount() {
  try {
    sessionStorage.removeItem(NO_ACCOUNT_KEY);
  } catch {
    /* navigation privée : sans importance */
  }
}

const TEXTS = {
  login: ['Connexion', 'Même compte que Mon Garage et Ma Maison.', 'Se connecter', 'Créer un compte'],
  signup: ['Créer mon compte', 'Un compte pour retrouver vos courses sur tous vos appareils.', 'Créer le compte', 'J’ai déjà un compte'],
  reset: ['Mot de passe oublié', 'Indiquez votre e-mail : vous recevrez un lien pour choisir un nouveau mot de passe.', 'Envoyer le lien', 'Retour à la connexion']
};
let mode = 'login';

function render() {
  [$('#authTitle').textContent, $('#authSub').textContent, $('#authSubmit').textContent, $('#authSwitch').textContent] = TEXTS[mode];
  $('#authPasswordField').hidden = mode === 'reset';
  $('#authForgot').hidden = mode !== 'login';
  $('#authPassword').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('#authError').textContent = '';
  $('#authError').classList.remove('is-success');
}

export const isAuthShown = () => !$('#authScreen').hidden;

export function showAuth() {
  mode = 'login';
  render();
  document.documentElement.classList.add('is-auth-open');
  $('#authScreen').hidden = false;
}

export function hideAuth() {
  document.documentElement.classList.remove('is-auth-open');
  $('#authScreen').hidden = true;
  $('#authPassword').value = '';
}

async function onSubmit(e) {
  e.preventDefault();
  const email = $('#authEmail').value.trim();
  const password = $('#authPassword').value;
  const err = $('#authError');
  const { valid, errors } = validate(
    { email, password },
    {
      email: [rules.required('L’e-mail'), v => (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? null : 'Adresse e-mail invalide.')],
      password: mode === 'reset' ? [] : [rules.required('Le mot de passe'), v => (v.length >= 6 ? null : '6 caractères minimum.')]
    }
  );
  err.classList.remove('is-success');
  if (!valid) {
    err.textContent = Object.values(errors)[0];
    return;
  }
  const btn = $('#authSubmit');
  btn.classList.add('is-loading');
  btn.disabled = true;
  err.textContent = '';
  try {
    if (mode === 'login') await signIn(email, password);
    else if (mode === 'signup') await signUp(email, password);
    else {
      await resetPassword(email);
      err.classList.add('is-success');
      err.textContent = 'E-mail envoyé. Pensez à vérifier vos courriers indésirables.';
    }
  } catch (error) {
    console.warn('[auth]', error);
    err.textContent = describeAuthError(error);
  } finally {
    btn.classList.remove('is-loading');
    btn.disabled = false;
  }
}

/** @param {{ onLocal: Function }} options « Continuer sans compte ». */
export function initAuth({ onLocal }) {
  $('#authForm').addEventListener('submit', onSubmit);
  $('#authSwitch').addEventListener('click', () => {
    mode = mode === 'login' ? 'signup' : 'login';
    render();
  });
  $('#authForgot').addEventListener('click', () => {
    mode = 'reset';
    render();
  });
  $('#authLocal').addEventListener('click', () => {
    try {
      sessionStorage.setItem(NO_ACCOUNT_KEY, '1');
    } catch {
      /* navigation privée : l'écran reviendra au rechargement */
    }
    hideAuth();
    onLocal();
  });
}
