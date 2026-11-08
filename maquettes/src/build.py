# Assemble chaque maquette en un seul fichier HTML autonome : python3 maquettes/src/build.py
import pathlib
src = pathlib.Path(__file__).parent
css = (src / 'shared.css').read_text()
js = (src / 'shared.js').read_text()
for name in ['a-aujourdhui', 'b-par-sport', 'c-feuille-de-route']:
    html = (src / f'{name}.html').read_text().replace('/*SHARED_CSS*/', css).replace('//SHARED_JS', js)
    (src.parent / f'{name}.html').write_text(html)
    print('ok', name)
