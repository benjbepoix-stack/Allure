# Allure

App sport (PWA installable sur iPhone) : courses, phases d'entraînement et mesures (poids, FTP vélo, mensurations).

## Navigation : Zoom
Un seul calendrier, quatre échelles, choisies en haut (**Année**, **Mois**, **Semaine**, **Jour**) ou d'un geste : écarter deux doigts plonge vers l'endroit touché, pincer recule (sur ordinateur : pincement du trackpad). Toucher un mois, une semaine (S…) ou un jour l'ouvre ; glisser à gauche / à droite (ou ‹ ›, ou glissement horizontal au trackpad) passe à l'année, au mois, à la semaine ou au jour suivant / précédent ; « Aujourd'hui » y revient.
- **Année** : le bilan (une barre par mois, colorée par les phases, un point par mois avec course ; courses, à venir, terminées, km, € d'inscriptions ; répartition par sport ; liste des courses avec résultat ou J−).
- **Mois** : phase en cours et prochaine course (mois courant), jours colorés par phase, course en noir, aujourd'hui entouré ; phases du mois (modifier, supprimer) et courses.
- **Semaine** : conseil de la phase, une ligne par jour.
- **Jour** : fiche de la course (J−, chiffres, notes, Calendrier .ics, Modifier, Supprimer ; résultat pour une course passée) et de la phase (semaine x sur y, conseil, Modifier, Supprimer), mesures du jour.

Barre du bas : **Saison** (le zoom), **Corps** (courbes du poids et de la FTP, mensurations, historiques) et **Ajouter** (course, phase, poids, test FTP, mensurations) : toute nouvelle mesure se saisit depuis Ajouter. Depuis l'échelle Jour, la course ou la phase ajoutée prend la date du jour affiché ; une course enregistrée s'ouvre sur son jour.
HTML / CSS / JavaScript purs (modules ES), sans build. Issue de la partie sport de **Carnet**.

## Compte
Allure utilise **le même compte que Mon Garage, Ma Maison, Carnet et Mon budget** (projet Firebase `test-e27e9`, connexion e-mail / mot de passe).
- Aucun écran bloquant au démarrage : l'app s'affiche tout de suite avec les données de l'appareil.
- Si aucun compte n'est connecté, l'écran de connexion s'affiche (connexion, « Mot de passe oublié ? », « Créer un compte »), avec **« Continuer sans compte »** : données sur l'appareil uniquement, sans synchronisation (pastille « Local »). Ce choix est gardé jusqu'à la fermeture de l'app (un rechargement ne redemande pas). Une saisie faite sans compte n'est jamais envoyée : à la connexion, les données du compte remplacent celles de l'appareil (comme dans Carnet).
- La session est partagée avec les autres apps ouvertes dans le même navigateur (même adresse) : connecté dans Mon Garage = connecté dans Allure. Sur iPhone, chaque app installée sur l'écran d'accueil a son propre stockage : une connexion par app, une seule fois.
- Changement de compte sur l'appareil : les données locales sont vidées avant la synchronisation.
- Firebase injoignable (hors ligne, bloqueur…) : pas d'écran, mode local comme avant.
- Bouton ⚙︎ › **Réglages** : compte connecté et « Se déconnecter » (ou « Se connecter » sans compte).

## Données partagées avec Carnet
Allure partage le nœud de Carnet **`users/<uid>/carnet`** et n'y lit / n'écrit que trois tranches :
- `races` : courses ;
- `objectives.seasonPhases` : phases de la saison ;
- `bodyMetrics` : poids, FTP, mensurations.

Les autres données (agenda, tâches, planning de la semaine, `garage_alerts`, `maison_alerts`, marqueur `migrated`…) appartiennent à Carnet et aux autres apps et ne sont jamais réécrites. Une course ou une phase créée dans Allure apparaît donc aussitôt dans le planning de Carnet.

### Reprise de l'ancienne base (automatique, une seule fois)
Au premier instantané du nœud après connexion :
1. le nœud porte le marqueur `migrated` → fonctionnement normal ;
2. sinon, Allure lit l'ancienne base publique de Carnet (`dashboard---projet`, nœud `app`, délai max 8 s) et copie dans le nouveau nœud **toutes les tranches de Carnet** (`dashboard`, `notes`, `theme`, `families`, `plans`, `objectives`, `races`, `bodyMetrics`) qui n'y sont pas déjà, avec `migrated: { from, at, by: 'allure' }` ; comme le fait Carnet, l'ancien thème par défaut `dark` de Carnet est transféré en `auto` ;
3. ancienne base vide ou injoignable → Allure n'amorce rien (il ne connaît pas les tranches de Carnet) : les modifications sont refusées avec le message « Ouvrez Carnet une fois pour transférer vos données. », et un nouvel essai a lieu au prochain instantané (dès que Carnet a migré le nœud) ou au retour dans l'app.

### Garde-fou d'écriture
Tant que cet appareil n'a pas reçu le nœud (migré) du compte connecté, l'état local peut être vide ou périmé : enregistrer une seule course écraserait la liste complète partagée avec Carnet. Les modifications sont donc refusées, sauf :
- nœud reçu (synchronisation active) ;
- sans compte (données de l'appareil uniquement) ;
- Firebase injoignable sur un appareil déjà synchronisé (rien n'est envoyé) ;
- compte déjà synchronisé sur cet appareil (clé `allure_synced_once` = uid du compte) : les modifications hors ligne sont envoyées à la reconnexion.

## Règles Firebase
Aucune règle à publier : le projet `test-e27e9` autorise déjà chaque compte à lire et écrire `users/<son uid>/…` (tout nouveau nœud y est couvert).
`database.rules.json` contient désormais le **verrou de l'ancienne base publique** `dashboard---projet` (`.read` / `.write` à `false`), identique à celui du dépôt Carnet : à publier dans la console Firebase de `dashboard---projet` une fois que Carnet et Allure ont migré les données sur tous les appareils. Ne jamais republier l'ancienne version de ce fichier (base lisible et modifiable par n'importe qui).

## Apparence
Style minimaliste (anthracite, cartes pleines), couleur **Braise** (dégradé orangé → rouge vif), également couleur des courses dans le calendrier ; chaque type de phase a sa propre teinte franche (bleu, indigo, violet, magenta, jaune, vert, gris). Bouton ⚙︎ › Réglages : thème **Auto** (suit le réglage clair / sombre de l'iPhone, par défaut), Sombre ou Clair, mémorisé sur l'appareil. Un ancien choix « Sombre » (ancien défaut) devient « Auto » une seule fois ; « Clair » est conservé. Le thème est appliqué avant le premier rendu (pas de flash).
Icône **Sommet** (`icon.svg`, déclinée en PNG).

## Structure
```
index.html          vue Zoom, Corps, barre du bas, connexion, feuilles de saisie et Réglages
css/                jetons, composants, vues, allure.css (style, palettes, connexion)
js/core/            store (3 tranches), schéma, saison, dates
js/services/        Firebase (compte, synchro par tranche, migration), stockage local
js/ui/              thème, connexion, modales, pastille de synchro, toasts
js/views/           zoom (calendrier 4 échelles), races et season (éditeurs), metrics (Corps)
js/features/        export calendrier .ics, mannequin des mensurations
```

## Test local
```
python3 -m http.server 8000
```
puis http://localhost:8000.
