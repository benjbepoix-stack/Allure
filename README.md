# Cadence

_Anciennement **Allure** : le dépôt, les clés de stockage local (`allure_…`) et les données Firebase gardent ce nom, rien n'est à migrer._

App sport (PWA installable sur iPhone) : courses, phases d'entraînement et mesures (poids, FTP vélo, mensurations).

## Navigation
Barre du bas : **Aujourd'hui**, **Saison**, **Courses**, **Stats** et **Ajouter**. Suivi s'ouvre depuis le bas d'Aujourd'hui, l'Analyse détaillée (et la connexion Strava) depuis le bas de Stats. L'app s'ouvre toujours sur Aujourd'hui.

### Aujourd'hui
- **Prochaine course** (hors « Ne compte pas ») : J−, semaines, forme du sport de la course et progression nécessaire pour être prêt (85).
- **Forme par sport** (`js/core/form.js`) : sur 100, où 100 = ton meilleur niveau dans ce sport sur 2 ans. Trois groupes : Ski (ski de fond + ski-roue : temps sur les skis 50 %, endurance tous sports 30 %, séances dures 20 %), Course & trail (groupés : séances de qualité 35 %, dénivelé 25 %, sortie longue 20 %, vitesse à effort égal 20 %), Vélo (volume 60 %, sortie longue 25 %, séances dures 15 %). Volume et dénivelé sur 6 semaines, le reste sur 4. Toucher un sport ouvre le calcul détaillé. Fraîcheur du jour en mots (Reposé / Normal / Chargé).
- **Phases jusqu'à la prochaine course** seulement (bande proportionnelle + liste), « Voir jusqu'à … » / « Toute la saison » / « Réduire ».
- **Cette semaine** : phase en cours, conseil, séances Strava de la semaine.

### Stats
Version simple de l'Analyse (`js/views/stats.js`) : sport (Tout, Ski, Course & trail, Vélo) et période (4 semaines, 3 mois, 12 mois) ; temps, séances, distance et dénivelé comparés à la période précédente ; volume par semaine (par mois sur 12 mois) coloré par sport ; courbe de la forme sur 100 des 6 derniers mois.

Saison › Plan affiche les phases jusqu'à la prochaine course, au prochain objectif ou toute la saison, puis les courses à venir. Le mode « Pics » de l'Analyse est retiré (remplacé par la forme par sport).

### Saison
Deux affichages, choisis en haut : **Plan** (par défaut) et **Calendrier**.
- **Plan** (inspiré de Frive) : carte « Prochain objectif » (prochaine course A, sinon prochaine course : distance, D+, jours restants, début de la préparation et barre de progression ; la préparation part du début de la suite de phases qui mène à la course, sans remonter avant l'objectif précédent ni au-delà d'une récupération / transition, sinon 16 semaines avant) ; rappel des inscriptions ; « Mon plan » : une barre par semaine colorée par la phase (hauteur = charge du type de phase), course en point rouge (gros point = objectif), semaine en cours entourée, compteurs (semaine de préparation, phase en cours, courses inscrites) ; « Cette semaine » : sept jours colorés par phase avec le conseil de la phase ; « À venir » : courses et débuts de phase mois par mois (filtres d'inscription), puis « Terminées » (12 derniers mois).
- **Calendrier** : un mois en grille (‹ › ou glisser pour changer de mois), phases et courses du mois.
- Toucher un jour, une course ou la carte objectif ouvre la **fiche du jour** dans une feuille (course : J−, chiffres, inscription, Calendrier .ics, Modifier, Supprimer, résultat ; phase : semaine x sur y, conseil ; mesures du jour), avec ‹ › pour passer au jour suivant ; toucher une barre de « Mon plan », un numéro de semaine ou « Détail » ouvre la **fiche de la semaine**.

### Courses
Le catalogue de **toutes les cyclosportives** (123, reprises d'Échappée, `js/data/catalog-cyclo.js`) et de **toutes les courses de ski de fond** (24, reprises de Glisse, `js/data/catalog-ski.js`) : c'est ici que l'on choisit ses courses (les onglets Courses d'Échappée et de Glisse ont été retirés). Chaque épreuve affiche sa prochaine édition (date confirmée ou estimée), groupée par mois. Filtres : Tout / Vélo / Ski de fond, recherche (nom ou ville), région, **★ Ma sélection** (étoilées et déjà dans la saison).
- **☆** présélectionne une course (stocké dans `objectives.catalogPicks`, synchronisé).
- **Ajouter** ouvre l'éditeur de course pré-rempli (nom, sport, date, lieu, notes avec distances et site) : la date estimée se vérifie avant d'enregistrer. Une course déjà dans la saison (même nom à 60 jours près, ou même date) affiche « Dans ma saison » et ouvre sa fiche.
- Mise à jour annuelle : les deux fichiers sont des copies de `js/data/races.js` d'Échappée et de Glisse (même format `editions: [{ year, date, confirmed }]`).

Inscriptions : chaque course à venir a un état d'inscription, **À faire** (rouge, par défaut), **Incomplète** (ambre) ou **Complète** (vert), à choisir sur sa fiche du jour ou dans l'éditeur de course (champ « Inscription ») ; stocké dans `objectives.raceRegistration`. Les courses à venir portent un badge (À inscrire, Incomplète, Inscrit) ; dans « À venir », des puces filtrent la liste par état avec le nombre de courses ; un rappel « Inscriptions : x à faire · y incomplètes » en haut du Plan applique le filtre.

Types de phase : le menu « Phase » de l'éditeur (lien « Modifier la liste ») et ⚙︎ › Réglages ouvrent la liste des types : ajouter, renommer (nom et nom court), changer la couleur, la charge (hauteur des barres de l'année) et le conseil, classer dans « Préparation spécifique », réordonner ou retirer. Un type retiré qui sert encore à des phases est seulement masqué du menu : ces phases gardent leur nom et leur couleur.

**Suivi** : courbes du poids et de la FTP, mensurations, historiques. **Analyse** : activités Strava. **Ajouter** : course, phase, poids, test FTP, mensurations ; avec la fiche d'un jour ouverte, la course ou la phase ajoutée prend cette date ; une course enregistrée depuis la Saison ouvre la fiche de son jour.
## Analyse (Strava)
Onglet **Analyse** : « Connecter Strava » récupère les activités directement depuis Strava (plus d'export RunGap). Strava n'accepte que le flux OAuth avec secret : on crée une fois son application d'API personnelle sur strava.com/settings/api (domaine de rappel = domaine de l'app), on saisit l'ID client et le secret client dans la fiche Strava, puis on autorise Cadence. La première synchronisation reprend tout l'historique (200 activités par requête) ; ensuite, seules les activités depuis la dernière connue (marge de 2 jours) sont demandées, automatiquement à l'ouverture de l'Analyse au plus une fois par heure, ou avec « Synchroniser Strava ». Les sports Strava (`sport_type`) sont convertis vers les noms de l'export RunGap (`js/services/strava.js`), donc toute l'analyse fonctionne pareil ; les doublons avec un ancien import (départs à moins de 10 min) sont fusionnés en gardant la séance la plus complète. Identifiants et jetons restent sur l'appareil (`allure_strava`), jamais dans Firebase.

Ancien import : la fiche Strava garde « Importer un fichier CSV » (export RunGap) en secours.

Trois affichages : **Bilan**, **Pics** (voir « Pics de forme ») et **Plan**. En Bilan, la période (menu, ‹ ›) et le sport (menu) restent collés sous l'en-tête au défilement.

Bilan, périodes : Mois, 3 mois, 6 mois, 12 mois, Année, Saison (groupe de phases qui se suivent, coupé après une phase de transition), avec ‹ › pour remonter dans le temps.
- Forme (42 j), fatigue (7 j) et fraîcheur : charge de chaque séance en TRIMP de Banister, estimée depuis la FC moyenne et la durée (l’export ne donne pas le temps par zone). Phases de Cadence en bandeaux, courses en repères.
- Temps, distance, D+ et séances filtrables par sport (puces au-dessus des chiffres ; le graphique de volume suit le filtre). Volume par sport (heures par jour ou par semaine).
- Ski de fond et ski-roue (tous deux « Cross Country Skiing » dans l’export) : ski de fond de novembre à avril si le point le plus bas de la sortie est à 700 m ou plus, ski-roue sinon. Un export importé avant cette règle est remplacé en entier au prochain import (altitude ajoutée).
- Repos : une case par jour, jours de repos par semaine, alerte au-delà de N jours d’affilée sans repos.
- Bilan des phases (h/sem, repos, part en dur, évolution de la forme), jour des courses (forme et fraîcheur le matin), efficacité en course (m par battement), puissance / FC, records (★ record absolu).
- Réglages (bouton « FC ») : FC max, FC de repos, seuil d’alerte, volume de référence du plan, stockés dans `objectives.analysis` (synchronisés).

Plan (inspiré de Frive) : phase de la semaine choisie (semaine x sur y, objectif et J−, cible et réalisé), volume cible par semaine (référence × facteur de la phase, une semaine sur quatre allégée en foncier et en spécifique ; réalisé superposé, toucher une barre affiche la semaine) et liste des phases en cours et à venir : toucher une phase ouvre sa fiche (dates, type, note, suppression), « Ajouter une phase » en crée une à la main.

Import : séparateur (virgule, point-virgule, tabulation) et encodage (UTF-8, UTF-16) détectés. Une erreur d'affichage d'une vue n'interrompt jamais la synchronisation ni l'import.

## Pics de forme (Analyse › Pics)
But : arriver au pic de forme le jour des courses objectifs, en reproduisant ce qui a précédé tes meilleurs pics (`js/core/peaks.js`, `js/views/peaks-view.js`).
- **Tes pics passés** : chaque course passée de la saison (sauf « Ne compte pas ») avec au moins 8 semaines d'activités avant elle : forme et fraîcheur le matin, forme rapportée au plus haut des 12 mois précédents, volume des semaines J−8 à J−2, progression de la forme, longueur et ampleur de l'affûtage, plus longue séance. Score = forme du jour / plus haut de l'année × facteur de fraîcheur (1 entre +5 et +25). Ressenti à saisir sur chaque course (« Au top », « Correct », « À oublier », dans `objectives.raceFeeling`) : les courses « Au top » deviennent la référence, sinon les 3 meilleurs scores (hors « À oublier »).
- **Ta recette** : médiane des pics de référence (forme et fraîcheur du jour J, heures par semaine, progression, plus longue séance, affûtage).
- **Prochain pic** : pour chaque objectif à venir (puces pour choisir), forme du jour → forme visée (celle de la recette, sinon 95 % du plus haut de l'année), fraîcheur visée, faisabilité. Le calcul cherche la plus petite progression hebdomadaire qui atteint la forme visée (plafonnée à 1,25 × celle de la recette, entre 3 et 7 par semaine), une semaine calendaire sur quatre allégée à 70 %, puis l'affûtage (durée de la recette, sinon 7 à 14 j selon la course) avec la réduction de volume qui donne la fraîcheur visée le matin de la course.
- **Projection** : forme et fraîcheur réelles des 12 dernières semaines, puis prévues en pointillé jusqu'à la course ; bande de fraîcheur idéale et période d'affûtage.
- **Semaine par semaine** : heures visées (charge convertie avec ta charge moyenne par heure des 120 derniers jours) et ce qui compte dans la semaine selon la phase.
- La carte « Prochain objectif » de la Saison affiche une ligne « Pic de forme » (forme du jour → visée, fraîcheur, Atteignable / Serré / Ambitieux) qui ouvre cet écran.
- Phases automatiques reprend la durée d'affûtage de la recette dès que deux pics au moins servent de référence.

## Niveau de détail des phases
Un sélecteur **Essentiel · Phases · Détail** (Saison › Mon plan et Phases du mois, Analyse › Bilan des phases et Plan) règle l'affichage partout (réglage de l'appareil, `allure_phase_level`, `js/core/phase-level.js`) :
- **Essentiel** (par défaut) : quatre grands blocs, Préparation générale, Spécifique, Affûtage, Récupération ; les phases qui se suivent dans un même bloc sont réunies ;
- **Phases** : chaque type de phase, morceaux consécutifs d'un même type réunis ;
- **Détail** : toutes les phases enregistrées, et les semaines allégées en barres plus claires dans « Mon plan ».
Les phases enregistrées ne changent pas : seul l'affichage les regroupe. Un bloc qui réunit plusieurs phases ouvre la fiche du jour (Saison) ou la phase en cours (Analyse) ; les boutons modifier / supprimer restent sur les phases seules.

## Style
Style « Vivant » commun à Ma Maison, Mon Garage, Mon Budget et Carnet (`css/vivant.css`, chargé en dernier) : fond clair neutre (`#f5f5f3`, sombre `#121212`), cartes blanches arrondies (24 px) à ombre douce sans bordure, gros titres, barre du bas flottante, icônes en trait épais (2,2 px). Interface « encre » : boutons, carte objectif, carte « Prochain pic » et courses du calendrier en noir et blanc (graphite) ; la couleur est réservée aux données : phases (couleurs d'origine : bleu, indigo, violet, magenta, jaune, vert, gris), sports, zones et graphiques. Les jetons `--accent*`, `--gradient-accent` et `--hero-*` en tête de `vivant.css` suffisent pour changer d'accent. Les états restent en vert / ambre / rouge (inscription, fraîcheur).

## Phases automatiques
Ajouter › **Phases automatiques** (ou ⚙︎ › Réglages) : chaque course à venir est classée **Objectif**, **Préparation** (défaut) ou **Ne compte pas** (aussi dans la fiche de la course, champ « Importance » ; stocké dans `objectives.racePriority`). Seuls les objectifs placent les phases, à rebours : foncier, spécifique volume puis intensité (6 semaines), affûtage de 7 à 14 jours selon distance et D+ (≥ 60 km ou ≥ 2 500 m D+ : 14 j ; ≥ 21 km ou ≥ 1 000 m : 10 j), récupération après chaque objectif (raccourcie si le suivant est proche) et coupure de 2 semaines après le dernier. « Recalculer à partir du » (aujourd'hui par défaut) : les phases d'avant cette date ne changent pas. Les phases faites à la main (champ `origin: 'manual'` ; les anciennes sans `origin` sont manuelles sauf note « Auto · … ») qui touchent la période sont listées, cochées par défaut : une phase cochée reste telle quelle et le plan se place autour (bout de moins d'une semaine rattaché à la phase précédente), une décochée est recalculée. « Appliquer ce plan » (confirmation) : la phase en cours s'arrête la veille ou est prolongée si le plan commence par le même type.

HTML / CSS / JavaScript purs (modules ES), sans build. Issue de la partie sport de **Carnet**.

## Compte
Cadence utilise **le même compte que Mon Garage, Ma Maison, Carnet et Mon budget** (projet Firebase `test-e27e9`, connexion e-mail / mot de passe).
- Aucun écran bloquant au démarrage : l'app s'affiche tout de suite avec les données de l'appareil.
- Si aucun compte n'est connecté, l'écran de connexion s'affiche (connexion, « Mot de passe oublié ? », « Créer un compte »), avec **« Continuer sans compte »** : données sur l'appareil uniquement, sans synchronisation (pastille « Local »). Ce choix est gardé jusqu'à la fermeture de l'app (un rechargement ne redemande pas). Une saisie faite sans compte n'est jamais envoyée : à la connexion, les données du compte remplacent celles de l'appareil (comme dans Carnet).
- La session est partagée avec les autres apps ouvertes dans le même navigateur (même adresse) : connecté dans Mon Garage = connecté dans Cadence. Sur iPhone, chaque app installée sur l'écran d'accueil a son propre stockage : une connexion par app, une seule fois.
- Changement de compte sur l'appareil : les données locales sont vidées avant la synchronisation.
- Firebase injoignable (hors ligne, bloqueur…) : pas d'écran, mode local comme avant.
- Bouton ⚙︎ › **Réglages** : compte connecté et « Se déconnecter » (ou « Se connecter » sans compte).

## Données partagées avec Carnet
Cadence partage le nœud de Carnet **`users/<uid>/carnet`** et n'y lit / n'écrit que trois tranches :
- `races` : courses ;
- `objectives.seasonPhases` : phases de la saison ;
- `objectives.phaseTypes` : liste des types de phase, si elle a été modifiée (sinon la liste d'origine) ;
- `bodyMetrics` : poids, FTP, mensurations.

Les autres données (agenda, tâches, planning de la semaine, `garage_alerts`, `maison_alerts`, marqueur `migrated`…) appartiennent à Carnet et aux autres apps et ne sont jamais réécrites. Une course ou une phase créée dans Cadence apparaît donc aussitôt dans le planning de Carnet.

### Reprise de l'ancienne base (automatique, une seule fois)
Au premier instantané du nœud après connexion :
1. le nœud porte le marqueur `migrated` → fonctionnement normal ;
2. sinon, Cadence lit l'ancienne base publique de Carnet (`dashboard---projet`, nœud `app`, délai max 8 s) et copie dans le nouveau nœud **toutes les tranches de Carnet** (`dashboard`, `notes`, `theme`, `families`, `plans`, `objectives`, `races`, `bodyMetrics`) qui n'y sont pas déjà, avec `migrated: { from, at, by: 'allure' }` ; comme le fait Carnet, l'ancien thème par défaut `dark` de Carnet est transféré en `auto` ;
3. ancienne base vide ou injoignable → Cadence n'amorce rien (il ne connaît pas les tranches de Carnet) : les modifications sont refusées avec le message « Ouvrez Carnet une fois pour transférer vos données. », et un nouvel essai a lieu au prochain instantané (dès que Carnet a migré le nœud) ou au retour dans l'app.

### Garde-fou d'écriture
Tant que cet appareil n'a pas reçu le nœud (migré) du compte connecté, l'état local peut être vide ou périmé : enregistrer une seule course écraserait la liste complète partagée avec Carnet. Les modifications sont donc refusées, sauf :
- nœud reçu (synchronisation active) ;
- sans compte (données de l'appareil uniquement) ;
- Firebase injoignable sur un appareil déjà synchronisé (rien n'est envoyé) ;
- compte déjà synchronisé sur cet appareil (clé `allure_synced_once` = uid du compte) : les modifications hors ligne sont envoyées à la reconnexion.

## Règles Firebase
Aucune règle à publier : le projet `test-e27e9` autorise déjà chaque compte à lire et écrire `users/<son uid>/…` (tout nouveau nœud y est couvert).
`database.rules.json` contient désormais le **verrou de l'ancienne base publique** `dashboard---projet` (`.read` / `.write` à `false`), identique à celui du dépôt Carnet : à publier dans la console Firebase de `dashboard---projet` une fois que Carnet et Cadence ont migré les données sur tous les appareils. Ne jamais republier l'ancienne version de ce fichier (base lisible et modifiable par n'importe qui).

## Apparence
Style minimaliste (anthracite, cartes pleines), couleur **Encre** (graphite, noir et blanc), également couleur des courses dans le calendrier ; chaque type de phase a sa propre teinte franche (bleu, indigo, violet, magenta, jaune, vert, gris par défaut, modifiable). Bouton ⚙︎ › Réglages : thème **Auto** (suit le réglage clair / sombre de l'iPhone, par défaut), Sombre ou Clair, mémorisé sur l'appareil. Un ancien choix « Sombre » (ancien défaut) devient « Auto » une seule fois ; « Clair » est conservé. Le thème est appliqué avant le premier rendu (pas de flash).
Icône **Cadence** (`icon.svg`, déclinée en PNG ; aussi `logos/cadence.svg`) : au style des autres apps de l'écran d'accueil (Maison, Garage, Budget, Carnet) : fond blanc, pictogramme au trait épais arrondi en dégradé encre aux couleurs de l'app (#3a3a42 → #111114, comme les boutons). Pictogramme « Pouls » : une ligne de fréquence cardiaque. Les PNG sont pleins cadre (iOS et Android arrondissent eux-mêmes).

## Structure
```
index.html          Saison, Courses, Suivi, barre du bas, connexion, feuilles de saisie et Réglages
css/                jetons, composants, vues, allure.css (style, palettes, connexion)
js/core/            store (3 tranches), schéma, saison, dates, catalog (catalogue des courses)
js/data/            catalogue : cyclosportives (Échappée) et ski de fond (Glisse)
js/services/        Firebase (compte, synchro par tranche, migration), stockage local
js/ui/              thème, connexion, modales, pastille de synchro, toasts
js/views/           zoom (Saison : Plan, Calendrier, fiches), catalog (Courses), races, season et phase-types (éditeurs), metrics (Suivi)
js/features/        export calendrier .ics, mannequin des mensurations
```

## Test local
```
python3 -m http.server 8000
```
puis http://localhost:8000.
