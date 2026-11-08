# Maquettes Cadence (novembre 2026)

Trois maquettes interactives autonomes, sans lien avec l'app (rien n'est chargé par `index.html`).

- `a-aujourdhui.html` : un écran « Aujourd'hui » (prochaine course, forme par sport, phases jusqu'à la course) + Saison + Courses.
- `b-par-sport.html` : une page par sport (jauge, recette du sport, prochaine course de ce sport) ; la barre du bas = les sports.
- `c-feuille-de-route.html` : une route d'aujourd'hui à la course choisie, verdict « en avance / dans les temps / en retard ».

Indicateur commun : **forme par sport sur 100, où 100 = ton meilleur niveau dans ce sport**, pondérée selon ce qui compte dans le sport (vélo : volume 60 %, sortie longue 25 %, intensité 15 % ; course : séances de qualité 50 %, vitesse à effort égal 30 %, régularité 20 % ; trail : D+ 40 %, sortie longue 30 %, côtes 30 % ; ski : ski + ski-roue 50 %, endurance tous sports 30 %, intensité 20 %). Zone « prêt » : 85 et plus.

Sources dans `src/` ; reconstruire avec `python3 maquettes/src/build.py`.
