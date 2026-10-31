/* Service worker : chaque ouverture de l'app vérifie auprès du serveur si les fichiers
   ont changé (requête conditionnelle, très légère) ; la dernière version reçue sert
   de secours hors ligne. Les mises à jour publiées sont ainsi visibles dès la
   réouverture, sans mélange d'anciens et de nouveaux fichiers.

   À l'installation, l'app-shell (HTML/CSS/JS/icônes) est aussi pré-mis en cache :
   un tout premier lancement hors ligne (avant toute visite en ligne réussie)
   affiche donc l'app au lieu d'un écran blanc. */
const CACHE = 'allure-v23';

const PRECACHE_URLS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/base.css',
  './css/components.css',
  './css/tokens.css',
  './css/layout.css',
  './css/allure.css',
  './css/views/season.css',
  './css/views/zoom.css',
  './css/views/metrics.css',
  './css/views/races.css',
  './css/views/analysis.css',
  './css/views/saison.css',
  './css/views/catalog.css',
  './js/main.js',
  './js/ui/charts.js',
  './js/ui/toast.js',
  './js/ui/status.js',
  './js/ui/icons.js',
  './js/ui/theme.js',
  './js/ui/dialog.js',
  './js/ui/auth.js',
  './js/config/firebase-config.js',
  './js/services/storage.js',
  './js/services/firebase.js',
  './js/views/season.js',
  './js/views/phase-types.js',
  './js/views/races.js',
  './js/views/metrics.js',
  './js/views/zoom.js',
  './js/views/catalog.js',
  './js/core/catalog.js',
  './js/data/catalog-cyclo.js',
  './js/data/catalog-ski.js',
  './js/views/analysis.js',
  './js/views/planner.js',
  './js/core/activities.js',
  './js/core/training.js',
  './js/core/planner.js',
  './js/core/plan.js',
  './js/core/registration.js',
  './js/views/plan-view.js',
  './js/features/ics.js',
  './js/features/body-map.js',
  './js/features/persist.js',
  './js/features/calendar-prompt.js',
  './js/core/season.js',
  './js/core/store.js',
  './js/core/validation.js',
  './js/core/utils.js',
  './js/core/dates.js',
  './js/core/schema.js',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png'
];

async function precache() {
  const cache = await caches.open(CACHE);
  // addAll échouerait en bloc au premier fichier manquant ; on isole chaque échec
  // pour que le reste de l'app-shell reste disponible hors ligne.
  await Promise.all(
    PRECACHE_URLS.map(url => cache.add(url).catch(err => console.warn('[sw] précache échoué:', url, err)))
  );
}

self.addEventListener('install', e => {
  e.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  // Firebase, météo, polices… : non concernés.
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request, { cache: 'no-cache' })
      .then(res => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request).then(hit => hit || (e.request.mode === 'navigate' ? caches.match('./') : Response.error())))
  );
});
