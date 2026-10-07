# Allure

App sport (PWA installable sur iPhone) : **Courses**, **Saison** (phases d'entraînement) et **Mesures** (poids, FTP vélo, mensurations).
HTML / CSS / JavaScript purs (modules ES), sans build. Issue de la partie sport de **Carnet**.

## Données partagées avec Carnet
Allure utilise **la même base Firebase que Carnet** (nœud `app`) et ne lit / n'écrit que trois tranches :
- `races` : courses ;
- `objectives.seasonPhases` : phases de la saison ;
- `bodyMetrics` : poids, FTP, mensurations.

Les autres données (agenda, tâches, planning de la semaine…) appartiennent à Carnet et ne sont jamais touchées. Une course ou une phase créée dans Allure apparaît donc aussitôt dans le planning de Carnet. Aucune règle Firebase à republier.

Garde-fou : un appareil qui n'a encore jamais reçu les données du cloud ne peut rien enregistrer (sinon une liste vide écraserait les données de Carnet). Après la première synchronisation, l'app fonctionne aussi hors ligne.

## Apparence
Style minimaliste (anthracite, cartes pleines, un accent en dégradé). Bouton ⚙︎ : 4 palettes (Aurore, Lagon, Braise, Menthe) et thème sombre / clair, mémorisés sur l'appareil.
Icône : propositions dans `logos/` (`planche.png`) ; `icon.svg` = icône retenue.

## Structure
```
index.html          3 onglets + feuilles de saisie
css/                jetons, composants, vues, allure.css (style et palettes)
js/core/            store (3 tranches), schéma, saison, dates
js/services/        Firebase (synchro par tranche), stockage local
js/views/           races, season, metrics
js/features/        export calendrier .ics, mannequin des mensurations
```

## Test local
```
python3 -m http.server 8000
```
puis http://localhost:8000.
