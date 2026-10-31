/*
 * Courses populaires de ski de fond : Massif du Jura (France + Suisse),
 * Vosges, Alpes du Nord et Massif Central (France entière hors Alpes du
 * Sud et Pyrénées). Sélection curatée et mise à jour à la main (pas de
 * flux en direct).
 *
 * Chaque course porte deux éditions estimées : l'édition « en cours »
 * (saison à venir) et la « suivante ». La plupart des dates précises ne
 * sont pas encore publiées début octobre 2026 (elles sortent en général
 * fin octobre/novembre pour la saison en cours, et ne sont jamais
 * publiées aussi loin à l'avance pour la saison suivante) : `date` est
 * une estimation à vérifier et corriger avant d'ajouter la course au
 * planning — le champ reste modifiable. `confirmed` indique si la date
 * de CETTE édition est officiellement annoncée.
 *
 * Mise à jour annuelle : voir le README (section « Onglet Courses »).
 */
export const RACE_GROUPS = [
  { id: 'jura', label: 'Massif du Jura' },
  { id: 'vosges', label: 'Vosges' },
  { id: 'alpes-nord', label: 'Alpes du Nord' },
  { id: 'massif-central', label: 'Massif Central' }
];

export const RACES = [
  // --- Massif du Jura (France + Suisse) ---
  {
    id: 'transjurassienne',
    name: 'La Transjurassienne (Transju’Classic)',
    group: 'jura',
    location: 'Lamoura → Les Rousses (Jura)',
    period: '13–14 février 2027 (confirmé — nouveau parcours unique de 50 km)',
    editions: [{ year: 2027, date: '2027-02-13', confirmed: true }, { year: 2028, date: '2028-02-12', confirmed: false }],
    distance: 'Classique le 13/02, skating le 14/02 — détail des distances 2027 non finalisé',
    notes: 'Classique le 13 février, skating le 14. Nouveau tracé permanent de 50 km à partir de 2027.',
    circuit: 'Marathon Ski Tour',
    link: 'https://www.latransju.com/'
  },
  {
    id: 'belles-combes',
    name: 'Les Belles Combes',
    group: 'jura',
    location: 'Les Moussières (Jura)',
    period: 'Mi-décembre, date non confirmée (édition précédente ~19–20 décembre)',
    editions: [{ year: 2027, date: '2026-12-19', confirmed: false }, { year: 2028, date: '2027-12-18', confirmed: false }],
    distance: '15, 30 km (+ Marathon Ski Tour FFS associé : 15 / 23 / 42 km)',
    notes: '',
    circuit: 'Marathon Ski Tour',
    link: 'https://www.ski-massif-jurassien.com/'
  },
  {
    id: 'risouxloppet',
    name: 'La Risouxloppet',
    group: 'jura',
    location: 'Chaux-Neuve (Doubs)',
    period: 'Fin décembre, date non confirmée (généralement ~27 décembre)',
    editions: [{ year: 2027, date: '2026-12-27', confirmed: false }, { year: 2028, date: '2027-12-26', confirmed: false }],
    distance: '12,5 et 25 km, skating',
    notes: '',
    link: 'https://www.nordicmag.info/'
  },
  {
    id: 'ronde-des-cimes',
    name: 'La Ronde des Cîmes',
    group: 'jura',
    location: 'Les Fourgs (Doubs)',
    period: 'Début janvier, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-01-10', confirmed: false }, { year: 2028, date: '2028-01-09', confirmed: false }],
    distance: '10 et 30 km, skating',
    notes: '⚠️ Sensible à l’enneigement : déjà annulée certaines années.',
    link: 'https://www.ski-massif-jurassien.com/'
  },
  {
    id: 'envolee-nordique',
    name: 'L’Envolée Nordique',
    group: 'jura',
    location: 'Chapelle-des-Bois (Doubs)',
    period: 'Fin janvier, date 2027 non annoncée (généralement ~24–25 janvier)',
    editions: [{ year: 2027, date: '2027-01-24', confirmed: false }, { year: 2028, date: '2028-01-23', confirmed: false }],
    distance: '25 et 42 km, skating',
    notes: '',
    link: 'https://www.envoleenordique.com/'
  },
  {
    id: 'marathon-des-neiges',
    name: 'Le Marathon des Neiges',
    group: 'jura',
    location: 'Nanchez — Plateau du Grandvaux (Jura)',
    period: 'Début février, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-02-06', confirmed: false }, { year: 2028, date: '2028-02-05', confirmed: false }],
    distance: '15 et 30 km, skating',
    notes: '⚠️ Édition 2026 annulée faute de neige.',
    link: 'https://www.ski-massif-jurassien.com/'
  },
  {
    id: 'marathon-du-turchet',
    name: 'Le Marathon du Turchet',
    group: 'jura',
    location: 'Les Pontets (Doubs)',
    period: 'Mi-février, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-02-14', confirmed: false }, { year: 2028, date: '2028-02-13', confirmed: false }],
    distance: '15 et 30 km',
    notes: '',
    link: 'https://www.ski-massif-jurassien.com/'
  },
  {
    id: 'traversee-du-massacre',
    name: 'La Traversée du Massacre',
    group: 'jura',
    location: 'Prémanon (Jura)',
    period: 'Début mars, date 2027 non annoncée (généralement ~1er mars)',
    editions: [{ year: 2027, date: '2027-03-01', confirmed: false }, { year: 2028, date: '2028-02-29', confirmed: false }],
    distance: '21 et 42 km, skating',
    notes: 'Faisait partie du Marathon Ski Tour jusqu’à la saison 2024-2025 ; absente du circuit 2025-2026.',
    link: 'https://www.ski-massif-jurassien.com/'
  },
  {
    id: 'franches-nordique',
    name: 'La Franches Nordique (Swiss Loppet)',
    group: 'jura',
    location: 'Les Breuleux / Saignelégier (Jura suisse)',
    period: '21 février 2027 (calendrier Swiss Loppet)',
    editions: [{ year: 2027, date: '2027-02-21', confirmed: true }, { year: 2028, date: '2028-02-20', confirmed: false }],
    distance: '25 km, skating',
    notes: '⚠️ Déjà annulée certaines années faute de neige.',
    link: 'https://www.swiss-ski.ch/fr/events/swiss-loppet/'
  },
  {
    id: 'siberienne',
    name: 'La Sibérienne',
    group: 'jura',
    location: 'La Brévine (Neuchâtel, Jura suisse)',
    period: 'Fin février, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-02-27', confirmed: false }, { year: 2028, date: '2028-02-26', confirmed: false }],
    distance: '15 et 30 km, skating (classique pour les jeunes)',
    notes: '',
    link: 'https://www.mso.swiss/fr/events/785-la-siberienne'
  },

  // --- Vosges ---
  {
    id: 'trace-vosgienne',
    name: 'La Trace Vosgienne',
    group: 'vosges',
    location: 'La Bresse — La Tenine (Vosges)',
    period: 'Vendredi soir fin janvier (course nocturne), date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-01-29', confirmed: false }, { year: 2028, date: '2028-01-28', confirmed: false }],
    distance: 'Format nocturne (distances précises à confirmer sur le site)',
    notes: 'Course historique (créée en 1979) passée en format nocturne depuis 2026.',
    link: 'https://www.tracevosgienne.fr/'
  },
  {
    id: 'lac-blanc-3h',
    name: 'Les 3 Heures du Lac Blanc',
    group: 'vosges',
    location: 'Lac Blanc — Orbey (Haut-Rhin)',
    period: 'Samedi 16 janvier 2027 (confirmé), 13h30–16h30',
    editions: [{ year: 2027, date: '2027-01-16', confirmed: true }, { year: 2028, date: '2028-01-15', confirmed: false }],
    distance: 'Relais par équipes de 2, le plus de tours en 3h, skating uniquement',
    notes: '',
    link: 'https://www.lac-blanc.com/en/winter/calendar-events-ski-resort-vosges/race-nordic-ski-3-hours/'
  },

  // --- Alpes du Nord ---
  {
    id: 'foulee-blanche',
    name: 'La Foulée Blanche',
    group: 'alpes-nord',
    location: 'Autrans-Méaudre en Vercors (Isère)',
    period: 'Dernier dimanche de janvier, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-01-31', confirmed: false }, { year: 2028, date: '2028-01-30', confirmed: false }],
    distance: '42 km (marathon) + formats courts (10 et 21 km selon les années)',
    notes: 'Une des plus anciennes courses populaires françaises.',
    circuit: 'Marathon Ski Tour',
    link: 'https://www.lafouleeblanche.com/'
  },
  {
    id: 'savoyarde',
    name: 'La Savoyarde (Marathon international de ski nordique)',
    group: 'alpes-nord',
    location: 'La Féclaz, massif des Bauges (Savoie)',
    period: 'Dimanche 7 février 2027 (confirmé)',
    editions: [{ year: 2027, date: '2027-02-07', confirmed: true }, { year: 2028, date: '2028-02-06', confirmed: false }],
    distance: '42 km (skating), formats plus courts certaines années',
    notes: '⚠️ Déjà annulée certaines années faute de neige.',
    circuit: 'Marathon Ski Tour',
    link: 'https://www.grandchambery.fr/tous-les-evenements/la-savoyarde-marathon-international-ski-nordique'
  },
  {
    id: 'grand-bec',
    name: 'Marathon du Grand Bec',
    group: 'alpes-nord',
    location: 'Champagny-en-Vanoise (Savoie)',
    period: '4e dimanche de février, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-02-21', confirmed: false }, { year: 2028, date: '2028-02-20', confirmed: false }],
    distance: '42 / 21 / 10 / 5 / 3 / 1,5 km, classique et skating selon distances',
    notes: 'Déjà annulée une année faute de neige.',
    circuit: 'Marathon Ski Tour',
    link: 'https://www.marathondugrandbec.com/'
  },
  {
    id: 'marathon-glieres',
    name: 'Marathon des Glières',
    group: 'alpes-nord',
    location: 'Plateau des Glières (Haute-Savoie)',
    period: 'Mi-mars, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-03-14', confirmed: false }, { year: 2028, date: '2028-03-12', confirmed: false }],
    distance: '42 km (Marathon), 21 km (Grand Plateau), 12 km (Petit Plateau), skating',
    notes: '',
    circuit: 'Marathon Ski Tour',
    link: 'https://www.marathondesglieres.com/'
  },
  {
    id: 'etoile-saisies',
    name: 'Étoile des Saisies',
    group: 'alpes-nord',
    location: 'Les Saisies (Savoie)',
    period: 'Dimanche 28 mars 2027 (confirmé), course de clôture de saison',
    editions: [{ year: 2027, date: '2027-03-28', confirmed: true }, { year: 2028, date: '2028-03-26', confirmed: false }],
    distance: '42 km (format marathon) + distances courtes',
    notes: '',
    circuit: 'Marathon Ski Tour',
    link: 'https://www.lessaisies.com/evenements/hiver-2026-27/'
  },
  {
    id: 'marathon-bessans',
    name: 'Marathon international de Bessans',
    group: 'alpes-nord',
    location: 'Plateau de Bessans, Haute-Maurienne (Savoie)',
    period: 'Samedi 9 et dimanche 10 janvier 2027 (confirmé)',
    editions: [{ year: 2027, date: '2027-01-09', confirmed: true }, { year: 2028, date: '2028-01-08', confirmed: false }],
    distance: 'Samedi classique (15/30 km), dimanche skating (2,5/5/10/23/42 km) + distances « fun »',
    notes: 'Deux jours, deux styles.',
    circuit: 'Marathon Ski Tour',
    link: 'http://www.marathondebessans.com/'
  },
  {
    id: 'alpe-huez-ski',
    name: 'Alpe d’Huez Ski Marathon',
    group: 'alpes-nord',
    location: 'Alpe d’Huez (Isère)',
    period: 'Fin décembre / tout début janvier, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-01-02', confirmed: false }, { year: 2028, date: '2028-01-01', confirmed: false }],
    distance: '30 km, 10 km + courses jeunes (3,5 et 5 km)',
    notes: '⚠️ Course d’ouverture de saison, sensible à l’enneigement : déjà annulée certaines années (ex. 2025).',
    link: 'https://www.seealpedhuez.com/events/ski-du-fond-marathon-720397'
  },

  // --- Massif Central ---
  {
    id: 'marathon-forez',
    name: 'Marathon du Forez',
    group: 'massif-central',
    location: 'Col des Pradeaux, Monts du Forez (Puy-de-Dôme/Loire)',
    period: '1er dimanche de février, date 2027 non annoncée',
    editions: [{ year: 2027, date: '2027-01-31', confirmed: false }, { year: 2028, date: '2028-01-30', confirmed: false }],
    distance: '42 km (marathon), 21 km (Essor), 7,5 et 2 km (jeunes), skating',
    notes: '',
    link: 'https://www.cretesduforez.com/'
  }
];
