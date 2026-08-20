#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
V3 — Générateur de grilles de mots fléchés ENTIÈREMENT PAVÉES

Contrairement à la V2 (mots-croisés à cases noires, avec indices posés à la
place de ces cases noires — modèle qui interdit tout contact perpendiculaire
non voulu entre mots, donc plafonne très bas la densité), la V3 construit
d'abord un squelette où CHAQUE case de la grille est soit indice, soit
lettre : il n'existe pas de case "morte". Toute suite de lettres consécutives
(horizontale ou verticale, longueur >= 2) est ensuite remplie par un vrai mot
du dictionnaire, en résolvant les contraintes de croisement comme un vrai
mot-croisé (pattern déjà fixé par les mots perpendiculaires).

Principe :
  1. Squelette : parcours case par case (ordre ligne-major). Le choix
     indice/lettre est quasi-libre — fermer une suite courte (case-indice)
     n'est jamais invalide — sauf deux contraintes dures :
       - une suite ne peut jamais commencer en colonne 0 (horizontal) ou
         ligne 0 (vertical) sans case-indice disponible avant elle ;
       - une suite ne dépasse jamais la longueur maximale utilisable.
     La longueur visée de chaque suite est tirée au sort en pondérant par
     la distribution réelle des longueurs de mots du dictionnaire fourni,
     pour que le remplissage qui suit ait des mots disponibles.
  2. Extraction des "slots" (positions + longueurs des mots à remplir).
  3. Remplissage par backtracking classique (mots les plus longs — donc
     les plus contraints — en premier), qui respecte les lettres déjà
     fixées par les croisements perpendiculaires.
  4. Plusieurs essais sont effectués, le meilleur (le plus de mots, le
     moins de cases-indices "mortes" sans mot associé) est conservé.

Entrée JSON :
[
  {
    "word": "orage",
    "hint_str": "Colère du ciel",
    "complexity": 3
  }
]

Sorties :
    grid.json
    grid.txt

Exemples :
    python generate_grid_v2.py words.json
    python generate_grid_v2.py words.json --attempts 200 --seed 42
"""

import argparse
import json
import random
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from collections import defaultdict


WORD_RE = re.compile(r"^[a-zàâäæçéèêëîïôöœùûüÿñ]+$")


@dataclass(frozen=True)
class Word:
    word: str
    hint: str
    complexity: int


# Types de flèches, au sens des vraies grilles de mots fléchés.
#
# Droites — l'indice est collé au mot, dans son axe :
#   "right"      →   indice à GAUCHE,     mot horizontal
#   "down"       ↓   indice AU-DESSUS,    mot vertical
#
# Coudées — l'indice est collé au mot, mais perpendiculairement à sa lecture.
# Elles servent à libérer les bords : sans elles, la colonne 0 ne peut jamais
# démarrer un mot horizontal (aucune case à sa gauche pour l'indice) et la
# ligne 0 jamais un mot vertical.
#   "down_right" ↳   indice AU-DESSUS,    mot horizontal
#   "right_down" ⤵   indice à GAUCHE,     mot vertical
ARROW_RIGHT = "right"
ARROW_DOWN = "down"
ARROW_DOWN_RIGHT = "down_right"
ARROW_RIGHT_DOWN = "right_down"

# Position de l'indice relativement à la PREMIÈRE LETTRE du mot.
_CLUE_OFFSET = {
    ARROW_RIGHT: (0, -1),
    ARROW_RIGHT_DOWN: (0, -1),
    ARROW_DOWN: (-1, 0),
    ARROW_DOWN_RIGHT: (-1, 0),
}


@dataclass(frozen=True)
class Slot:
    row: int
    col: int
    direction: str  # 'H' ou 'V'
    length: int
    arrow: str = ARROW_RIGHT

    def cells(self):
        dr, dc = (0, 1) if self.direction == "H" else (1, 0)
        return [(self.row + i * dr, self.col + i * dc) for i in range(self.length)]

    def clue_pos(self):
        dr, dc = _CLUE_OFFSET[self.arrow]
        return (self.row + dr, self.col + dc)


# ============================================================
# DICTIONNAIRE
# ============================================================

def normalize_word(value):
    s = str(value or "").strip().lower()
    s = s.replace("’", "").replace("'", "")
    s = s.replace("-", "").replace(" ", "")
    return s


def load_dictionary(path):
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)

    if isinstance(data, dict):
        for key in ("words", "entries", "dictionary", "data"):
            if isinstance(data.get(key), list):
                data = data[key]
                break

    if not isinstance(data, list):
        raise RuntimeError("Le JSON doit être un tableau d'objets.")

    result = []
    seen = set()

    for item in data:
        if not isinstance(item, dict):
            continue

        raw = item.get("word")
        hint = str(item.get("hint_str") or "").strip()

        if not raw or not hint:
            continue

        word = normalize_word(raw)

        # Minimum 2 : une suite d'une seule lettre n'a jamais besoin de mot
        # dans ce modèle (voir generate_skeleton), donc une entrée à 1
        # caractère ne serait jamais utilisée de toute façon.
        if not 2 <= len(word) <= 12:
            continue

        if not WORD_RE.fullmatch(word):
            continue

        if word in seen:
            continue

        try:
            complexity = int(item.get("complexity", 3))
        except Exception:
            complexity = 3

        result.append(
            Word(
                word=word,
                hint=hint[:15],
                complexity=max(1, min(5, complexity)),
            )
        )
        seen.add(word)

    return result


# ============================================================
# SQUELETTE (case-par-case, sans retour arrière : fermer une
# suite via une case-indice n'est jamais invalide, donc aucun
# blocage possible — un seul passage suffit)
# ============================================================

def word_length_weights(words, max_len):
    weights = defaultdict(int)
    for w in words:
        if 2 <= len(w.word) <= max_len:
            weights[len(w.word)] += 1
    return dict(weights)


def length_capacity(length, length_weights):
    # Une longueur peu fournie (ex. une dizaine de mots de 2 lettres) laisse
    # presque aucune marge pour le remplissage : même quand la demande
    # totale reste sous l'offre totale, les contraintes de croisement
    # (lettres déjà fixées par les mots perpendiculaires) ont de bonnes
    # chances de rendre un mot du stock incompatible avec une case précise.
    # On réserve donc une marge bien plus large pour les longueurs rares.
    # Utilisée à la fois pendant la construction du squelette (can_clue) et
    # en filet de sécurité final dans generate_best — même formule des deux
    # côtés, sinon une suite peut passer la vérification finale alors
    # qu'elle a dépassé la marge visée pendant la construction (ex. fin
    # naturelle en bord de grille, qui échappe au comptage can_clue).
    w = length_weights.get(length, 0)
    if w < 20:
        return max(0, w // 3)
    return max(1, int(w * 0.65))


def generate_skeleton(rows, cols, rng, length_weights, max_len):
    """Renvoie une matrice rows x cols de booléens : True = lettre,
    False = case-indice.

    Règle clé : une suite ne peut JAMAIS se refermer (case-indice) sur une
    longueur pour laquelle le dictionnaire n'a aucun mot — sauf longueur 1,
    qui ne représente pas un mot et n'a donc besoin d'aucun indice. Sans
    cette règle, un conflit ligne/colonne peut tronquer une suite pile sur
    une longueur non disponible (ex. aucun mot de 2 lettres dans le
    dictionnaire) : la case résultante ne serait alors jamais remplissable.

    Une suite est également plafonnée à 1 case ("forced short") si elle
    commence bord gauche/haut (aucune case pour un indice avant elle) OU
    s'il ne reste structurellement pas assez de colonnes/lignes avant le
    bord droit/bas pour atteindre ne serait-ce que la longueur viable la
    plus courte : sans ce second cas, une suite peut se retrouver tronquée
    pile sur une longueur non disponible en topant le bord de la grille —
    can_clue ne le détecte pas puisqu'aucune case-indice n'est posée quand
    la suite s'arrête simplement faute de place.
    """

    viable = {L for L, n in length_weights.items() if n > 0 and 2 <= L <= max_len}
    min_viable = min(viable) if viable else max_len + 1
    total_weight = sum(length_weights.get(L, 0) for L in viable) or 1

    # Combien de suites peuvent encore se refermer sur chaque longueur avant
    # d'épuiser les mots disponibles. Sans ce compteur, une longueur presque
    # vide (ex. un seul mot de 2 lettres) reste "viable" en théorie mais se
    # retrouve réclamée par bien plus de suites que de mots existants — même
    # avec une faible probabilité par case, le nombre de cases suffit à
    # garantir la collision sur toute la grille.
    closed_count = defaultdict(int)
    capacity = lambda length: length_capacity(length, length_weights)

    def close_bias(length):
        # Probabilité de préférer refermer ici plutôt que continuer, une
        # fois la longueur déjà viable — pondérée par la disponibilité
        # réelle de mots de cette longueur, pour une distribution naturelle.
        w = length_weights.get(length, 0)
        base = min(0.8, 0.22 + 0.55 * (w / total_weight) * len(viable))
        return base * 0.3 if w < 20 else base

    roles = [[False] * cols for _ in range(rows)]
    h_start = [None] * rows
    h_short = [False] * rows  # cette ligne a une suite ouverte plafonnée à 1 case
    v_start = [None] * cols
    v_short = [False] * cols

    for r in range(rows):
        for c in range(cols):
            h_open = h_start[r] is not None
            v_open = v_start[c] is not None

            h_len_before = (c - h_start[r]) if h_open else 0
            v_len_before = (r - v_start[c]) if v_open else 0

            if r == 0 and c == 0:
                # Le coin : une lettre y serait forcément orpheline (h ET v
                # y sont structurellement bloqués à longueur 1, faute de
                # case pour un indice avant la case (0,-1) ou (-1,0)).
                roles[r][c] = False
                h_start[r] = None
                v_start[c] = None
                continue

            can_letter = True
            if h_open:
                if h_short[r] and h_len_before >= 1:
                    can_letter = False
                elif (h_len_before + 1) > max_len:
                    can_letter = False
            if can_letter and v_open:
                if v_short[c] and v_len_before >= 1:
                    can_letter = False
                elif (v_len_before + 1) > max_len:
                    can_letter = False

            # Une seule case peut refermer une suite H ET une suite V en même
            # temps ; si les deux visent la même longueur, elles consomment
            # 2 mots de ce pool en un seul geste — il faut vérifier la
            # capacité combinée, pas chaque direction isolément (sinon les
            # deux passent le test contre le même compte "avant" et le
            # dépassent ensemble).
            needed = defaultdict(int)
            if h_open and not h_short[r] and h_len_before != 1:
                if h_len_before not in viable:
                    needed = None
                else:
                    needed[h_len_before] += 1
            if needed is not None and v_open and not v_short[c] and v_len_before != 1:
                if v_len_before not in viable:
                    needed = None
                else:
                    needed[v_len_before] += 1

            # Marge de sécurité : viser moins que le stock brut. Même quand
            # demande <= offre en tout, les contraintes de croisement (lettres
            # déjà fixées par les mots perpendiculaires) peuvent rendre
            # certains mots du stock incompatibles avec une case précise —
            # surtout pour les longueurs peu fournies (ex. 10 mots de 2
            # lettres) où il n'y a presque aucune marge de manœuvre pour le
            # remplissage. Réserver de la place réduit le risque d'ériger
            # une grille tout juste à la limite puis irrémplissable.
            can_clue = needed is not None and all(
                closed_count[length] + count <= capacity(length)
                for length, count in needed.items()
            )

            if can_letter and can_clue:
                if not h_open and not v_open:
                    bias = 0.28  # nouvelle suite : on préfère plutôt continuer que l'isoler à 1 case
                else:
                    bias = 1.0
                    if h_open:
                        if h_len_before == 1:
                            bias = min(bias, 0.04)  # longueur 1 : pas encore un mot, pousse à continuer
                        elif h_len_before in viable:
                            bias = min(bias, close_bias(h_len_before))
                    if v_open:
                        if v_len_before == 1:
                            bias = min(bias, 0.04)
                        elif v_len_before in viable:
                            bias = min(bias, close_bias(v_len_before))
                choose_letter = rng.random() >= bias
            elif can_letter:
                choose_letter = True
            else:
                # can_clue est normalement True ici (voir docstring) ; le cas
                # contraire est un conflit rarissime — on referme quand même,
                # l'essai entier échouera proprement au remplissage et sera
                # simplement retenté par generate_best().
                choose_letter = False

            roles[r][c] = choose_letter

            if choose_letter:
                if not h_open:
                    h_start[r] = c
                    # Colonne 0 : aucune case à gauche pour un indice droit,
                    # mais une flèche coudée ↳ peut le prendre AU-DESSUS —
                    # encore faut-il que cette case soit bien un indice. Elle
                    # appartient à la ligne précédente, déjà décidée.
                    if c == 0:
                        bent_ok = r >= 1 and not roles[r - 1][0]
                        h_short[r] = (not bent_ok) or (cols - c) < min_viable
                    else:
                        h_short[r] = (cols - c) < min_viable
                if not v_open:
                    v_start[c] = r
                    # Symétrique en ligne 0 : la flèche coudée ⤵ prend son
                    # indice À GAUCHE, case déjà décidée dans cette même ligne.
                    if r == 0:
                        bent_ok = c >= 1 and not roles[0][c - 1]
                        v_short[c] = (not bent_ok) or (rows - r) < min_viable
                    else:
                        v_short[c] = (rows - r) < min_viable
            else:
                if h_open and h_len_before > 1:
                    closed_count[h_len_before] += 1
                if v_open and v_len_before > 1:
                    closed_count[v_len_before] += 1
                h_start[r] = None
                v_start[c] = None

    return roles


def find_orphan_positions(roles, rows, cols):
    """Cases-lettres isolées (longueur 1 dans les DEUX directions) : aucun
    mot ne les couvre dans aucune direction. Rares avec le biais ci-dessus,
    mais pas impossibles — plutôt que de tout rejeter, l'appelant les
    convertit en cases noires (budget limité, voir generate_best)."""

    orphans = []

    for r in range(rows):
        for c in range(cols):
            if not roles[r][c]:
                continue

            h_len = 1
            cc = c - 1
            while cc >= 0 and roles[r][cc]:
                h_len += 1
                cc -= 1
            cc = c + 1
            while cc < cols and roles[r][cc]:
                h_len += 1
                cc += 1
            if h_len > 1:
                continue

            v_len = 1
            rr = r - 1
            while rr >= 0 and roles[rr][c]:
                v_len += 1
                rr -= 1
            rr = r + 1
            while rr < rows and roles[rr][c]:
                v_len += 1
                rr += 1
            if v_len == 1:
                orphans.append((r, c))

    return orphans

    return False


def extract_slots(roles, rows, cols, min_len=2):
    slots = []

    for r in range(rows):
        c = 0
        while c < cols:
            if not roles[r][c]:
                c += 1
                continue
            start = c
            while c < cols and roles[r][c]:
                c += 1
            length = c - start
            if length >= min_len:
                # Un mot horizontal démarrant colonne 0 n'a aucune case à sa
                # gauche : son indice est au-dessus, avec une flèche coudée.
                arrow = ARROW_DOWN_RIGHT if start == 0 else ARROW_RIGHT
                slots.append(
                    Slot(row=r, col=start, direction="H", length=length, arrow=arrow)
                )

    for c in range(cols):
        r = 0
        while r < rows:
            if not roles[r][c]:
                r += 1
                continue
            start = r
            while r < rows and roles[r][c]:
                r += 1
            length = r - start
            if length >= min_len:
                # Symétriquement, un mot vertical démarrant ligne 0 prend son
                # indice à sa gauche.
                arrow = ARROW_RIGHT_DOWN if start == 0 else ARROW_DOWN
                slots.append(
                    Slot(row=start, col=c, direction="V", length=length, arrow=arrow)
                )

    return slots


# ============================================================
# QUALITÉ DU SQUELETTE
# ============================================================
#
# Ces deux mesures ne dépendent QUE du squelette, jamais des mots choisis :
# on peut donc écarter un mauvais squelette avant l'étape de remplissage,
# qui est de loin la plus coûteuse.

def slots_are_valid(roles, slots, rows, cols):
    """Vérifie que chaque mot a bien un indice utilisable.

    Les flèches coudées permettent à un indice d'être perpendiculaire au mot
    qu'il introduit ; il reste que la case visée doit exister, être une
    case-indice, et ne pas porter plus de deux définitions (au-delà, elle
    devient illisible dans une case de 46 px).
    """
    load = defaultdict(int)
    seen = set()

    for s in slots:
        r, c = s.clue_pos()
        if not (0 <= r < rows and 0 <= c < cols):
            return False
        if roles[r][c]:  # c'est une lettre, pas un indice
            return False
        # Deux mots ne peuvent pas partager le même indice ET la même flèche :
        # rien ne permettrait au joueur de les distinguer.
        key = (r, c, s.arrow)
        if key in seen:
            return False
        seen.add(key)
        load[(r, c)] += 1

    return all(n <= 2 for n in load.values())


def count_isolated_slots(slots):
    """Mots qui ne croisent aucun autre mot.

    Dans une vraie grille de mots fléchés, chaque mot s'appuie sur ses
    voisins : un mot isolé se résout sans aucune aide du reste de la grille
    et donne une impression de remplissage artificiel.
    """
    cell_users = defaultdict(int)
    for s in slots:
        for rc in s.cells():
            cell_users[rc] += 1

    return sum(1 for s in slots if all(cell_users[rc] == 1 for rc in s.cells()))


def count_dead_clue_cells(roles, slots, rows, cols):
    """Cases-indices qui n'introduisent aucun mot.

    Ce sont exactement les « trous » visibles dans l'app : n'ayant aucune
    définition à afficher, elles sont omises du payload et `buildGrid` les
    laisse en case neutre.
    """
    serving = {s.clue_pos() for s in slots}
    return sum(
        1
        for r in range(rows)
        for c in range(cols)
        if not roles[r][c] and (r, c) not in serving
    )


# ============================================================
# REMPLISSAGE (mot-croisé classique : les mots les plus longs
# — donc les plus contraints — sont posés en premier)
# ============================================================

class WordIndex:
    """Index inversé du dictionnaire, pour trouver les mots compatibles avec
    un motif partiel (ex. « _ a _ e ») par intersection d'ensembles plutôt
    que par balayage linéaire de tout le stock.

    Le profilage de la version précédente était sans appel : le balayage
    linéaire dans candidates_for représentait ~85 % du temps total (plusieurs
    millions d'appels, chacun parcourant tout le stock de sa longueur).

    L'index est construit UNE fois par dictionnaire et se réutilise sur
    toutes les tentatives — et, côté serveur, sur toutes les requêtes :
    c'est un objet immuable, contrairement à l'ancien `by_length` qui était
    reconstruit et re-mélangé à chaque tentative.
    """

    __slots__ = ("by_length", "pos_index", "all_sets")

    def __init__(self, words):
        self.by_length = defaultdict(list)
        for w in words:
            self.by_length[len(w.word)].append(w)

        self.pos_index = {}
        self.all_sets = {}
        for length, pool in self.by_length.items():
            buckets = defaultdict(set)
            for i, w in enumerate(pool):
                for pos, ch in enumerate(w.word):
                    buckets[(pos, ch)].add(i)
            self.pos_index[length] = {k: frozenset(v) for k, v in buckets.items()}
            self.all_sets[length] = frozenset(range(len(pool)))


def build_word_index(words):
    return WordIndex(words)


def fill_slots(slots, words, rng, max_backtracks=150000, candidate_cap=60, index=None):
    """Renvoie (assignment, complete). `assignment` couvre tous les slots
    quand complete=True ; sinon c'est le MEILLEUR remplissage partiel
    rencontré pendant la recherche (le plus de slots comblés), pour que
    l'appelant puisse sacrifier les quelques slots restants plutôt que d'
    abandonner toute la grille — cohérent avec le budget de cases noires
    toléré par generate_best.

    `index` (WordIndex) peut être fourni pour éviter de le reconstruire à
    chaque appel — indispensable pour un usage serveur.
    """

    if index is None:
        index = WordIndex(words)

    n = len(slots)
    if n == 0:
        return {}, True

    cell_to_slots = defaultdict(list)
    for si, s in enumerate(slots):
        for pos, rc in enumerate(s.cells()):
            cell_to_slots[rc].append((si, pos))

    # Chaque case appartient à au plus 2 slots (un H, un V) : on précalcule
    # directement le slot perpendiculaire de chaque position, plutôt que de
    # reparcourir cell_to_slots à chaque évaluation de candidats.
    cross = []
    neighbors = []
    for si, s in enumerate(slots):
        row = []
        nb = set()
        for rc in s.cells():
            other = None
            for osi, opos in cell_to_slots[rc]:
                if osi != si:
                    other = (osi, opos)
                    nb.add(osi)
                    break
            row.append(other)
        cross.append(row)
        neighbors.append(nb)

    assignment = [None] * n
    used_idx = defaultdict(set)  # longueur -> indices déjà pris dans le pool
    calls = [0]
    best_assignment = [None] * n
    best_filled = [0]

    empty = frozenset()

    def candidate_set(si):
        """Ensemble des indices de mots compatibles avec les lettres déjà
        fixées par les slots perpendiculaires (mots déjà pris exclus)."""
        length = slots[si].length
        pindex = index.pos_index.get(length)
        if pindex is None:
            return empty

        cand = None
        for pos, other in enumerate(cross[si]):
            if other is None:
                continue
            osi, opos = other
            w = assignment[osi]
            if w is None:
                continue
            st = pindex.get((pos, w.word[opos]))
            if not st:
                return empty
            cand = st if cand is None else (cand & st)
            if not cand:
                return empty

        if cand is None:
            cand = index.all_sets.get(length, empty)

        taken = used_idx[length]
        return (cand - taken) if taken else cand

    def materialize(si, cand):
        pool = index.by_length[slots[si].length]
        picks = list(cand)
        rng.shuffle(picks)  # variété entre générations successives
        del picks[candidate_cap:]
        return [(i, pool[i]) for i in picks]

    def pick_next(remaining):
        # MRV (minimum remaining values) : on comble toujours la case la
        # plus contrainte en premier — un ordre statique peut s'enfoncer des
        # milliers d'essais dans une branche condamnée avant de découvrir
        # qu'une case anodine n'a en fait aucun mot compatible.
        #
        # On ne compare que des TAILLES d'ensembles (opération O(1)) et on
        # ne construit la vraie liste de candidats que pour le slot retenu :
        # matérialiser les candidats de chaque slot à chaque nœud était
        # l'essentiel du coût de l'ancienne version.
        best_si, best_cand, best_count = None, None, None
        for si in remaining:
            cand = candidate_set(si)
            size = len(cand)
            if best_count is None or size < best_count:
                best_si, best_cand, best_count = si, cand, size
                if size == 0:
                    break
        return best_si, best_cand

    def backtrack(remaining):
        calls[0] += 1

        filled = n - len(remaining)
        if filled > best_filled[0]:
            best_filled[0] = filled
            best_assignment[:] = assignment

        if calls[0] > max_backtracks:
            return False
        if not remaining:
            return True

        si, cand = pick_next(remaining)
        if not cand:
            return False

        length = slots[si].length
        taken = used_idx[length]
        next_remaining = [x for x in remaining if x != si]

        for wi, w in materialize(si, cand):
            assignment[si] = w
            taken.add(wi)

            # Vérification anticipée (forward checking) : un choix qui laisse
            # un slot voisin à 0 candidat est perdant à coup sûr ; le
            # découvrir seulement quelques niveaux plus bas coûte des
            # milliers d'essais gâchés.
            doomed = False
            for osi in neighbors[si]:
                if assignment[osi] is None and not candidate_set(osi):
                    doomed = True
                    break

            if not doomed and backtrack(next_remaining):
                return True

            taken.discard(wi)
            assignment[si] = None

        return False

    complete = backtrack(list(range(n)))
    source = assignment if complete else best_assignment
    return {i: source[i] for i in range(n) if source[i] is not None}, complete


# ============================================================
# CONSTRUCTION DU JSON JOUABLE
# ============================================================

def build_cells_and_words(roles, slots, assignment, rows, cols, black_positions=frozenset()):
    cells = [
        [{"type": "letter", "number": None, "solution": None, "clues": []} for _ in range(cols)]
        for _ in range(rows)
    ]

    slots_by_clue_pos = defaultdict(list)
    for si, s in enumerate(slots):
        slots_by_clue_pos[s.clue_pos()].append(si)

    for r in range(rows):
        for c in range(cols):
            if (r, c) in black_positions:
                cells[r][c] = {"type": "black", "number": None, "solution": None, "clues": []}
            elif not roles[r][c]:
                cells[r][c] = {"type": "clue", "number": None, "solution": None, "clues": []}

    # `assignment` peut être partiel (voir fill_slots) : seuls les slots
    # effectivement comblés y figurent. Un slot absent n'obtient ni lettre
    # ni indice ici — c'est à l'appelant (generate_best) de s'être assuré
    # que ses cases sont soit couvertes par un autre slot rempli, soit
    # noircies, avant d'arriver jusqu'ici.
    for si, w in assignment.items():
        s = slots[si]
        for pos, (r, c) in enumerate(s.cells()):
            cells[r][c]["solution"] = w.word[pos]

    number = 1
    words_out = []
    dead_clues = 0

    for r in range(rows):
        for c in range(cols):
            if cells[r][c]["type"] != "clue":
                continue

            slot_indices = [si for si in slots_by_clue_pos.get((r, c), []) if si in assignment]
            if not slot_indices:
                dead_clues += 1
                continue

            cells[r][c]["number"] = number

            for si in slot_indices:
                s = slots[si]
                w = assignment[si]
                cells[r][c]["clues"].append(
                    {
                        "number": number,
                        "word": w.word,
                        "hint_str": w.hint,
                        "complexity": w.complexity,
                        "direction": s.direction,
                        "arrow": s.arrow,
                        "start": [s.row, s.col],
                        "length": s.length,
                    }
                )
                words_out.append(
                    {
                        "number": number,
                        "word": w.word,
                        "hint_str": w.hint,
                        "complexity": w.complexity,
                        "row": s.row,
                        "col": s.col,
                        "direction": s.direction,
                        "length": s.length,
                    }
                )

            number += 1

    return cells, words_out, dead_clues


def quality_metrics(cells, words_out, slots, dead_clues, black_count, rows, cols):
    clue_cells = sum(1 for row in cells for cell in row if cell["type"] == "clue")
    black_cells = sum(1 for row in cells for cell in row if cell["type"] == "black")
    letter_cells = rows * cols - clue_cells - black_cells

    lengths = [s.length for s in slots]
    avg_len = sum(lengths) / len(lengths) if lengths else 0

    score = (
        len(words_out) * 120
        + letter_cells * 6
        + avg_len * 15
        - dead_clues * 400
        - black_count * 60  # toléré (budget), mais une grille avec moins de noir gagne à score égal
    )

    return {
        "score": score,
        "words": len(words_out),
        "letters": letter_cells,
        "clues": clue_cells,
        "black": black_cells,
        "dead_clues": dead_clues,
        "avg_word_length": round(avg_len, 2),
        "coverage": round(letter_cells / (rows * cols), 4),
        "compactness": 1.0,
        "isolated_black": 0,
    }


# ============================================================
# RECHERCHE
# ============================================================

def generate_best(words, rows, cols, attempts, seed, max_word_len=None, max_black_cells=25):
    rng = random.Random(seed)
    max_len = max_word_len or min(max(len(w.word) for w in words), max(rows, cols))
    weights = word_length_weights(words, max_len)
    # Construit une seule fois puis réutilisé par toutes les tentatives.
    word_index = build_word_index(words)
    viable = {L for L, n in weights.items() if n > 0 and 2 <= L <= max_len}

    best = None
    best_metrics = None
    filled_attempts = 0

    for attempt in range(attempts):
        roles = generate_skeleton(rows, cols, rng, weights, max_len)

        # Cases-lettres isolées (aucun mot ni horizontal ni vertical) : rares,
        # mais plutôt que de tout rejeter, elles deviennent des cases noires —
        # tant que le budget accordé (--max-black) n'est pas dépassé.
        orphans = find_orphan_positions(roles, rows, cols)
        if len(orphans) > max_black_cells:
            continue
        black_positions = set(orphans)
        for r, c in orphans:
            roles[r][c] = False

        slots = extract_slots(roles, rows, cols)

        if len(slots) < 3:
            continue

        # Une suite peut atteindre le bord droit/bas de la grille (fin
        # naturelle, sans case-indice à poser) sur une longueur que le
        # dictionnaire ne couvre pas : ce cas échappe à la vérification
        # can_clue (qui ne s'applique qu'au moment de poser une case-indice).
        if any(s.length not in viable for s in slots):
            continue

        # Filet de sécurité définitif : quelle que soit la façon dont une
        # suite s'est refermée (choix explicite suivi par closed_count, ou
        # fin naturelle en bord de grille qui lui échappe), le nombre de
        # suites d'une longueur donnée ne doit jamais dépasser la marge
        # visée (length_capacity, pas le stock brut — sinon une suite qui a
        # échappé au comptage can_clue pendant la construction passe ce
        # filet alors qu'elle a déjà dépassé la marge prévue). Plutôt que de
        # traquer tous les cas de figure au moment de la construction, on
        # vérifie le résultat final et on retente si besoin — bien plus
        # robuste qu'une prévention parfaite au fil de l'eau.
        demand = defaultdict(int)
        for s in slots:
            demand[s.length] += 1
        if any(count > length_capacity(length, weights) for length, count in demand.items()):
            continue

        assignment, complete = fill_slots(slots, words, rng, index=word_index)

        if not complete:
            # Quelques slots n'ont pas trouvé de mot compatible (lettres de
            # croisement trop contraignantes pour le stock disponible à
            # cette longueur). Plutôt que de jeter toute la grille, on
            # sacrifie leurs cases non partagées avec un slot rempli — tant
            # que ça reste dans le budget de cases noires. Une case qui
            # appartient UNIQUEMENT à un slot non rempli doit être noircie
            # (elle n'aurait sinon aucune lettre définie) ; si un slot non
            # rempli n'a AUCUNE case propre (toutes ses cases sont fixées
            # par des slots perpendiculaires remplis), il est impossible à
            # éliminer proprement sans casser un mot déjà posé — on
            # abandonne cet essai plutôt que de livrer un mot invalide.
            filled_cells = set()
            for si in assignment:
                filled_cells.update(slots[si].cells())

            unfilled = [si for si in range(len(slots)) if si not in assignment]
            extra_black = set()
            resolvable = True
            for si in unfilled:
                own_cells = [rc for rc in slots[si].cells() if rc not in filled_cells]
                if not own_cells:
                    resolvable = False
                    break
                extra_black.update(own_cells)

            if not resolvable or len(black_positions) + len(extra_black) > max_black_cells:
                continue

            black_positions = black_positions | extra_black

        filled_attempts += 1

        cells, words_out, dead_clues = build_cells_and_words(
            roles, slots, assignment, rows, cols, black_positions
        )

        if len(words_out) < 3:
            continue

        metrics = quality_metrics(
            cells, words_out, slots, dead_clues, len(black_positions), rows, cols
        )

        if best_metrics is None or metrics["score"] > best_metrics["score"]:
            best = (roles, cells, words_out)
            best_metrics = metrics

        if attempt == 0 or attempt % 20 == 0:
            print(
                f"\r[SEARCH] {attempt + 1:,}/{attempts:,} "
                f"| squelettes remplis={filled_attempts} "
                f"| mots={metrics['words']} "
                f"| noires={metrics['black']} "
                f"| indices morts={dead_clues}",
                end="",
                flush=True,
            )

    print()

    if best is None:
        raise RuntimeError(
            "Aucune grille jouable n'a pu être générée "
            "(le dictionnaire ne couvre probablement pas assez de longueurs "
            "de mots différentes pour cette taille de grille)."
        )

    return best[0], best[1], best[2], best_metrics


# ============================================================
# BANC DE SQUELETTES (hors-ligne lent / temps réel rapide)
# ============================================================
#
# Mesures qui motivent cette séparation :
#   - CHERCHER un squelette remplissable est lent ET très variable
#     (1 à 400+ essais selon la chance ; certains seeds échouent).
#   - RE-REMPLIR un squelette déjà éprouvé avec d'autres mots réussit
#     30 fois sur 30, en ~1 ms (66 ms au pire).
#
# On paie donc la recherche une seule fois hors-ligne, et le serveur ne
# fait plus que du remplissage — rapide et prévisible. On ne stocke que
# des squelettes ENTIÈREMENT pavés (aucune case orpheline, remplissage
# complet), donc le temps réel n'a jamais besoin de la réparation par
# cases noires.

SKELETON_BANK_VERSION = 1


def encode_roles(roles):
    return ["".join("1" if v else "0" for v in row) for row in roles]


def decode_roles(rows_str):
    return [[ch == "1" for ch in row] for row in rows_str]


def build_skeleton_bank(
    words, rows, cols, target, max_word_len=None, seed=None,
    min_words=18, max_dead_clues=None, max_isolated=0,
    max_attempts_per_hit=4000, progress=True,
):
    """Cherche `target` squelettes distincts, entièrement pavés et dont on a
    prouvé qu'ils se remplissent complètement. Renvoie la liste des rôles
    encodés.

    `max_dead_clues` borne les trous (cases-indices sans définition) et
    `max_isolated` les mots ne croisant personne. Les deux se calculent sur
    le seul squelette, donc on filtre AVANT le remplissage : un squelette
    médiocre est rejeté pour quelques microsecondes au lieu de plusieurs
    millisecondes de recherche inutile.
    """

    rng = random.Random(seed)
    max_len = max_word_len or min(max(len(w.word) for w in words), max(rows, cols))
    weights = word_length_weights(words, max_len)
    viable = {L for L, n in weights.items() if n > 0 and 2 <= L <= max_len}
    index = build_word_index(words)

    bank = []
    seen = set()
    attempts = 0
    budget = target * max_attempts_per_hit

    while len(bank) < target and attempts < budget:
        attempts += 1

        roles = generate_skeleton(rows, cols, rng, weights, max_len)

        # Zéro tolérance ici : une case orpheline deviendrait une case noire
        # au runtime, or on veut un banc utilisable tel quel.
        if find_orphan_positions(roles, rows, cols):
            continue

        key = tuple("".join("1" if v else "0" for v in row) for row in roles)
        if key in seen:
            continue

        slots = extract_slots(roles, rows, cols)
        if len(slots) < 3 or any(s.length not in viable for s in slots):
            continue

        if not slots_are_valid(roles, slots, rows, cols):
            continue

        # Filtres de qualité : purement structurels, donc évalués avant le
        # remplissage (voir docstring).
        if max_isolated is not None and count_isolated_slots(slots) > max_isolated:
            continue
        if (
            max_dead_clues is not None
            and count_dead_clue_cells(roles, slots, rows, cols) > max_dead_clues
        ):
            continue

        demand = defaultdict(int)
        for s in slots:
            demand[s.length] += 1
        if any(cnt > length_capacity(L, weights) for L, cnt in demand.items()):
            continue

        assignment, complete = fill_slots(slots, words, rng, index=index)
        if not complete:
            continue

        cells, words_out, dead_clues = build_cells_and_words(
            roles, slots, assignment, rows, cols
        )
        if len(words_out) < min_words:
            continue

        seen.add(key)
        bank.append(list(key))

        if progress:
            print(
                f"\r[BANC] {len(bank)}/{target} squelettes "
                f"({attempts} essais, {len(words_out)} mots, {dead_clues} indices morts)",
                end="", flush=True,
            )

    if progress:
        print()

    return bank, attempts


def save_skeleton_bank(path, bank, rows, cols, difficulty=None):
    payload = {
        "version": SKELETON_BANK_VERSION,
        "rows": rows,
        "cols": cols,
        "difficulty": difficulty,
        "count": len(bank),
        "skeletons": bank,
    }
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)


def load_skeleton_bank(path):
    with open(path, "r", encoding="utf-8") as f:
        payload = json.load(f)
    if payload.get("version") != SKELETON_BANK_VERSION:
        raise RuntimeError(
            f"Banc de squelettes en version {payload.get('version')}, "
            f"attendu {SKELETON_BANK_VERSION} — régénère-le avec --build-bank."
        )
    return payload


def generate_from_bank(payload, words, rng, index=None, tries=25, max_backtracks=2500):
    """Chemin TEMPS RÉEL : prend un squelette du banc et le remplit.

    `index` (WordIndex) doit être construit une fois au démarrage du serveur
    et réutilisé sur toutes les requêtes. Renvoie (cells, words_out, metrics).

    `max_backtracks` est volontairement BAS. Un squelette du banc s'est déjà
    rempli au moins une fois : s'il patine au-delà de quelques milliers de
    retours arrière, c'est que le tirage aléatoire de mots est tombé dans
    une mauvaise branche — relancer sur un autre squelette coûte ~1 ms,
    alors que s'acharner coûtait jusqu'à 1,2 s (p99 mesuré avec la limite
    par défaut). On échange donc de la ténacité contre une latence stable.
    """

    rows = payload["rows"]
    cols = payload["cols"]
    skeletons = payload["skeletons"]
    if not skeletons:
        raise RuntimeError("Banc de squelettes vide.")

    if index is None:
        index = build_word_index(words)

    for _ in range(tries):
        roles = decode_roles(rng.choice(skeletons))
        slots = extract_slots(roles, rows, cols)
        assignment, complete = fill_slots(
            slots, words, rng, max_backtracks=max_backtracks, index=index
        )
        if not complete:
            continue
        cells, words_out, dead_clues = build_cells_and_words(
            roles, slots, assignment, rows, cols
        )
        metrics = quality_metrics(cells, words_out, slots, dead_clues, 0, rows, cols)
        return cells, words_out, metrics

    raise RuntimeError(
        "Aucun squelette du banc n'a pu être rempli — dictionnaire trop "
        "restreint par rapport à celui utilisé pour construire le banc ?"
    )


# ============================================================
# EXPORT
# ============================================================

def save_json(path, cells, words_out, metrics, rows, cols):
    output = {
        "version": 3,
        "type": "mots-fleches",
        "rows": rows,
        "cols": cols,
        "grid": cells,
        "words": words_out,
        "stats": {
            "words": len(words_out),
            "letters": metrics["letters"],
            "clues": metrics["clues"],
            "black": metrics["black"],
            "dead_clues": metrics["dead_clues"],
            "avg_word_length": metrics["avg_word_length"],
            "coverage": metrics["coverage"],
            "score": round(metrics["score"], 2),
        },
    }

    with open(path, "w", encoding="utf-8") as f:
        json.dump(output, f, ensure_ascii=False, indent=2)


def _cell_symbol(cell):
    if cell["type"] == "black":
        return "██"
    if cell["type"] == "clue":
        return f"{cell['number']:02d}" if cell["number"] else "??"
    return "··"


def save_txt(path, cells):
    path = Path(path)
    txt_path = path.with_suffix(".txt")

    with open(txt_path, "w", encoding="utf-8") as f:
        for row in cells:
            f.write(" ".join(_cell_symbol(cell) for cell in row) + "\n")

    return txt_path


def print_grid(cells):
    print()
    print("NN = case-indice | ·· = lettre | ██ = noire (rare, budget limité)")
    print()

    for row in cells:
        print(" ".join(_cell_symbol(cell) for cell in row))

    print()


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Générateur V3 de mots fléchés (grille entièrement pavée)."
    )

    parser.add_argument("json_file", type=Path, help="Dictionnaire JSON")
    parser.add_argument("--rows", type=int, default=8)
    parser.add_argument("--cols", type=int, default=8)
    parser.add_argument("--attempts", type=int, default=200)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--output", type=Path, default=Path("grid.json"))
    parser.add_argument(
        "--max-black", type=int, default=25,
        help="Budget de cases noires toléré (cases-lettres isolées sans mot possible). Défaut 25.",
    )
    parser.add_argument(
        "--build-bank", type=int, metavar="N", default=None,
        help="HORS-LIGNE : cherche N squelettes entièrement pavés et les enregistre "
             "(voir --bank-file). Lent, à lancer une seule fois.",
    )
    parser.add_argument(
        "--bank-file", type=Path, default=None,
        help="Fichier du banc de squelettes (écrit par --build-bank, lu par --from-bank).",
    )
    parser.add_argument(
        "--from-bank", action="store_true",
        help="TEMPS RÉEL : génère en remplissant un squelette du banc (~ms) "
             "au lieu de chercher une nouvelle structure.",
    )
    parser.add_argument(
        "--max-isolated", type=int, default=0,
        help="Nombre max de mots ne croisant aucun autre mot (défaut 0).",
    )
    parser.add_argument(
        "--max-attempts-per-hit", type=int, default=4000,
        help="Budget de tentatives par squelette recherché (défaut 4000). "
             "À augmenter quand les filtres sont stricts sur une grande grille : "
             "les bons squelettes y sont bien plus rares.",
    )
    parser.add_argument(
        "--max-dead-clues", type=int, default=None,
        help="Nombre max de cases-indices sans définition, c.-à-d. de trous "
             "visibles dans la grille (défaut : illimité).",
    )

    args = parser.parse_args()

    print("=" * 70)
    print("GENERATEUR MOTS FLECHES — V3 (grille quasi entièrement pavée)")
    print("=" * 70)

    words = load_dictionary(args.json_file)

    if not words:
        raise SystemExit("[ERREUR] Aucun mot utilisable.")

    print(f"[DICO] {len(words)} mots utilisables")

    # ---------- Mode 1 : construction du banc (hors-ligne) ----------
    if args.build_bank:
        bank_path = args.bank_file or Path(
            f"skeletons_{args.rows}x{args.cols}.json"
        )
        print(f"[GRID] {args.rows} x {args.cols}")
        print(f"[BANC] recherche de {args.build_bank} squelettes -> {bank_path}")
        t0 = time.time()
        bank, attempts = build_skeleton_bank(
            words, args.rows, args.cols, args.build_bank, seed=args.seed,
            max_isolated=args.max_isolated, max_dead_clues=args.max_dead_clues,
            max_attempts_per_hit=args.max_attempts_per_hit,
        )
        if not bank:
            raise SystemExit(
                "[ERREUR] Aucun squelette entièrement pavé trouvé. "
                "Essaie une grille plus petite ou enrichis le dictionnaire "
                "(surtout les mots de 2 et 3 lettres)."
            )
        save_skeleton_bank(
            bank_path, bank, args.rows, args.cols,
            difficulty=args.json_file.stem,
        )
        print(f"[OK] {len(bank)} squelettes en {time.time()-t0:.1f}s "
              f"({attempts} essais) -> {bank_path}")
        return

    # ---------- Mode 2 : génération depuis le banc (temps réel) ----------
    if args.from_bank:
        bank_path = args.bank_file or Path(
            f"skeletons_{args.rows}x{args.cols}.json"
        )
        if not bank_path.exists():
            raise SystemExit(
                f"[ERREUR] Banc introuvable : {bank_path}\n"
                f"Construis-le d'abord :\n"
                f"  python generate_grid_v2.py {args.json_file} "
                f"--build-bank 200 --bank-file {bank_path}"
            )
        payload = load_skeleton_bank(bank_path)
        rng = random.Random(args.seed)
        t0 = time.time()
        index = build_word_index(words)
        t_index = time.time() - t0
        t1 = time.time()
        cells, words_out, metrics = generate_from_bank(payload, words, rng, index=index)
        t_fill = time.time() - t1

        print(f"[BANC] {payload['count']} squelettes {payload['rows']}x{payload['cols']}")
        print(f"[TEMPS] index={t_index*1000:.0f}ms (une fois au démarrage) "
              f"| remplissage={t_fill*1000:.0f}ms")
        print()
        print("[RESULTAT]")
        print(f"  mots               : {metrics['words']}")
        print(f"  lettres            : {metrics['letters']}")
        print(f"  indices            : {metrics['clues']}")
        print(f"  cases noires       : {metrics['black']}")
        print(f"  indices sans mot   : {metrics['dead_clues']}")
        print(f"  couverture lettres : {metrics['coverage']:.1%}")
        print_grid(cells)
        save_json(args.output, cells, words_out, metrics, payload["rows"], payload["cols"])
        txt_path = save_txt(args.output, cells)
        print(f"[OK] {args.output}")
        print(f"[OK] {txt_path}")
        return

    # ---------- Mode 3 : recherche complète (comportement historique) ----------
    print(f"[GRID] {args.rows} x {args.cols}")
    print(f"[SEARCH] {args.attempts:,} essais (budget noires : {args.max_black})")

    roles, cells, words_out, metrics = generate_best(
        words, args.rows, args.cols, args.attempts, args.seed,
        max_black_cells=args.max_black,
    )

    print()
    print("[RESULTAT]")
    print(f"  mots               : {metrics['words']}")
    print(f"  lettres            : {metrics['letters']}")
    print(f"  indices            : {metrics['clues']}")
    print(f"  cases noires       : {metrics['black']}")
    print(f"  indices sans mot   : {metrics['dead_clues']}")
    print(f"  longueur moy. mots : {metrics['avg_word_length']}")
    print(f"  couverture lettres : {metrics['coverage']:.1%}")

    print_grid(cells)

    save_json(args.output, cells, words_out, metrics, args.rows, args.cols)
    txt_path = save_txt(args.output, cells)

    print(f"[OK] {args.output}")
    print(f"[OK] {txt_path}")


if __name__ == "__main__":
    main()
