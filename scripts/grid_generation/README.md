# Générateur de mots fléchés

Génère des grilles de mots fléchés **entièrement pavées** (chaque case est soit
une case-indice, soit une lettre — pas de case noire) à partir d'un
dictionnaire JSON `{word, hint_str, complexity}`.

## Architecture : hors-ligne lent / temps réel rapide

C'est le point important pour une génération côté serveur. Deux constats
mesurés sur ce projet :

- **Chercher** un squelette remplissable est lent et très variable : de 1 à
  400+ essais selon la chance, et certains tirages échouent complètement.
- **Re-remplir** un squelette déjà éprouvé avec d'autres mots réussit ~100 %
  du temps, en ~1 ms.

On paie donc la recherche **une seule fois hors-ligne**, et le serveur ne fait
plus que du remplissage.

```
   HORS-LIGNE (une fois, ~2-5 min)          TEMPS REEL (par requete, ~1 ms)
   ┌──────────────────────────┐             ┌──────────────────────────┐
   │ --build-bank N           │  banc de    │ generate_from_bank()     │
   │ cherche N squelettes     │ ──────────► │ prend un squelette,      │
   │ 100% paves et remplis    │  squelettes │ le remplit avec d'autres │
   └──────────────────────────┘   (JSON)    │ mots                     │
                                            └──────────────────────────┘
```

### 1. Construire le banc (hors-ligne)

```bash
python generate_grid_v2.py ../datasets/mots_fleches_enriched_v4_hints.json \
    --build-bank 80 --bank-file banks/skeletons_8x8.json \
    --max-isolated 3 --max-dead-clues 7
```

Ne conserve que les squelettes **entièrement pavés et prouvés remplissables** —
le temps réel n'a donc jamais besoin de réparation par cases noires.

### 2. Générer une grille (temps réel)

```bash
python generate_grid_v2.py ../datasets/mots_fleches_enriched_v4_hints.json \
    --from-bank --bank-file banks/skeletons_8x8.json
```

### 3. Intégration serveur

```python
# --- au demarrage, UNE fois (~5 ms) ---
words   = load_dictionary("../datasets/mots_fleches_enriched_v4_hints.json")
index   = build_word_index(words)          # index inverse, immuable
bank    = load_skeleton_bank("banks/skeletons_8x8.json")

# --- par requete (~1 ms) ---
cells, words_out, metrics = generate_from_bank(bank, words, rng, index=index)
```

`index` et `bank` sont immuables : à construire une seule fois et à partager
entre toutes les requêtes. Les reconstruire à chaque appel annule tout le gain.

Performances mesurées (8x8, mono-thread, banc de 5 squelettes) :

| | |
|---|---|
| démarrage (dico + index + banc) | 5 ms, une seule fois |
| médiane par grille | 1,0 ms |
| p95 / p99 | 21,6 ms / 38,3 ms |
| débit | ~243 grilles/s |

## Mode recherche directe (sans banc)

Comportement historique, utile pour explorer/déboguer une nouvelle taille de
grille. Lent et à latence imprévisible — **à éviter côté serveur**.

```bash
python generate_grid_v2.py dico.json --attempts 200 --rows 8 --cols 8
```

## Comment ça marche

1. **Squelette** — parcours case par case ; chaque case devient indice ou
   lettre. Une suite ne peut se refermer que sur une longueur pour laquelle le
   dictionnaire a des mots (et pas trop de suites de la même longueur, voir
   `length_capacity`).
2. **Slots** — extraction des suites de longueur ≥ 2 à remplir.
3. **Remplissage** — backtracking avec :
   - **`WordIndex`** : index inversé `(longueur, position, lettre) → mots`,
     donc les candidats se trouvent par intersection d'ensembles. Le balayage
     linéaire précédent représentait ~85 % du temps total.
   - **MRV** : on remplit toujours la case la plus contrainte d'abord, en ne
     comparant que des *tailles* d'ensembles ; la liste de candidats n'est
     construite que pour le slot retenu.
   - **Forward checking** : un choix qui laisse un slot voisin sans candidat
     est écarté immédiatement.

## Qualité des grilles

Deux mesures, calculées sur le seul squelette (donc filtrées **avant** le
remplissage, qui est l'étape coûteuse) :

- **Trous** (`--max-dead-clues`) — cases-indices qui n'introduisent aucun mot.
  N'ayant pas de définition à afficher, elles apparaissent comme des cases
  neutres dans l'app.
- **Mots isolés** (`--max-isolated`) — mots ne croisant aucun autre mot. Ils se
  résolvent sans aucune aide du reste de la grille.

Le générateur produit structurellement **2 à 5 mots isolés** par squelette
8x8 : `--max-isolated 0` ne renvoie jamais rien. Le banc actuel est filtré à
3 max, ce qui donne en moyenne 2,9 isolés et 5,7 trous (9 % de la grille),
contre 4 et ~10 sans filtre.

## Contraintes du dictionnaire

Une grille pavée croise les mots dans les **deux** sens : chaque lettre d'un
mot court peut être imposée par un mot perpendiculaire. Ce qui compte n'est
donc pas le nombre total de mots, mais la **couverture (position, lettre)**.

- Les **mots de 2 lettres** sont indispensables (ils permettent au squelette de
  refermer ses suites) — les interdire rend la génération *impossible*, pas
  plus facile.
- En français, aucun mot de 2 lettres ne se termine par
  `b g j k m p q v w y` : ces motifs sont hors d'atteinte, inutile de les
  chercher. Mieux vaut du volume sur les terminaisons viables
  (`a e i o u n s r t l f h x c d`).
- Les longueurs les moins fournies dominent les blocages. Un fichier avec
  seulement ~10 mots de 3 lettres met la génération à genoux, même avec des
  centaines de mots par ailleurs.

`length_capacity()` limite volontairement le nombre de suites créées par
longueur bien en dessous du stock brut, précisément parce que les contraintes
de croisement rendent une partie du stock inutilisable à une position donnée.
