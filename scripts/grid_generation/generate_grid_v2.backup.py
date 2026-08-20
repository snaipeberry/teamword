#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
V2 — Générateur de grilles de mots fléchés 10x12

Principe :
- La grille est construite comme une grille de mots fléchés dès le départ.
- Chaque mot doit avoir une case-indice immédiatement avant lui :
    H : case-indice à gauche
    V : case-indice au-dessus
- Une case-indice peut porter un indice H, un indice V, ou les deux.
- Les cases noires ne sont jamais utilisées comme simples "trous" au milieu
  d'une séquence : elles servent uniquement de séparation / indice.
- Les mots se croisent uniquement sur des lettres compatibles.
- On pénalise fortement les cases noires isolées et les zones inutilisables.
- Plusieurs essais sont effectués puis la meilleure grille est conservée.

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
    python generate_grid_v2.py words.json --attempts 10000 --seed 42
"""

import argparse
import json
import random
import re
from dataclasses import dataclass
from pathlib import Path
from collections import defaultdict


WORD_RE = re.compile(r"^[a-zàâäæçéèêëîïôöœùûüÿñ]+$")


@dataclass(frozen=True)
class Word:
    word: str
    hint: str
    complexity: int


@dataclass
class Placement:
    word: Word
    row: int
    col: int
    direction: str
    number: int = 0


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

        if not 3 <= len(word) <= 12:
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
# GRILLE
# ============================================================

def new_grid(rows, cols):
    return [[None for _ in range(cols)] for _ in range(rows)]


def inside(rows, cols, r, c):
    return 0 <= r < rows and 0 <= c < cols


def delta(direction):
    return (0, 1) if direction == "H" else (1, 0)


def cell(grid, r, c):
    if 0 <= r < len(grid) and 0 <= c < len(grid[0]):
        return grid[r][c]
    return None


# ============================================================
# MODÈLE VRAI MOTS FLÉCHÉS
# ============================================================

def clue_position(row, col, direction):
    """Case-indice avant la première lettre."""
    if direction == "H":
        return row, col - 1
    return row - 1, col


def word_cells(row, col, direction, length):
    dr, dc = delta(direction)
    return [
        (row + i * dr, col + i * dc)
        for i in range(length)
    ]


def can_place_arrow_word(
    grid,
    word,
    row,
    col,
    direction,
    require_cross=False,
):
    """
    Contraintes V2 :

    1. Une case-indice dédiée doit exister avant le mot.
    2. Cette case doit être libre.
    3. Les lettres doivent être compatibles.
    4. Aucun contact latéral parasite.
    5. Aucun autre mot ne doit passer sur la case-indice.
    6. Le mot ne doit pas être collé à un autre mot avant/après.
    """

    rows = len(grid)
    cols = len(grid[0])
    dr, dc = delta(direction)

    cr, cc = clue_position(row, col, direction)

    if not inside(rows, cols, cr, cc):
        return False, 0

    # La case-indice doit être vide.
    if grid[cr][cc] is not None:
        return False, 0

    positions = word_cells(
        row, col, direction, len(word)
    )

    for r, c in positions:
        if not inside(rows, cols, r, c):
            return False, 0

    # Case juste avant la case-indice : séparation.
    before_clue = (
        (cr, cc - 1) if direction == "H"
        else (cr - 1, cc)
    )
    br, bc = before_clue
    if inside(rows, cols, br, bc) and grid[br][bc] is not None:
        return False, 0

    # Case après le mot.
    er, ec = positions[-1]
    after = (er, ec + 1) if direction == "H" else (er + 1, ec)
    ar, ac = after
    if inside(rows, cols, ar, ac) and grid[ar][ac] is not None:
        return False, 0

    crossings = 0

    for i, (r, c) in enumerate(positions):
        existing = grid[r][c]

        if existing is not None:
            if existing != word[i]:
                return False, 0
            crossings += 1
            continue

        # Une lettre fraîche ne doit pas toucher un autre mot
        # perpendiculairement.
        if direction == "H":
            side = ((r - 1, c), (r + 1, c))
        else:
            side = ((r, c - 1), (r, c + 1))

        for nr, nc in side:
            if inside(rows, cols, nr, nc):
                if grid[nr][nc] is not None:
                    return False, 0

    # La case-indice ne peut pas être traversée par un mot existant.
    # C'est déjà assuré par grid[cr][cc] is None.

    if require_cross and crossings == 0:
        return False, 0

    return True, crossings


def place_word(grid, word, row, col, direction):
    positions = word_cells(
        row, col, direction, len(word)
    )

    changed = []

    for i, (r, c) in enumerate(positions):
        if grid[r][c] is None:
            grid[r][c] = word[i]
            changed.append((r, c))

    return changed


# ============================================================
# CANDIDATS
# ============================================================

def candidate_positions(grid, word, allow_no_cross=False):
    rows = len(grid)
    cols = len(grid[0])
    candidates = []

    # Une case-indice doit être disponible.
    for direction in ("H", "V"):
        for row in range(rows):
            for col in range(cols):
                ok, crossings = can_place_arrow_word(
                    grid,
                    word,
                    row,
                    col,
                    direction,
                    require_cross=not allow_no_cross,
                )
                if ok:
                    candidates.append(
                        (row, col, direction, crossings)
                    )

    return candidates


# ============================================================
# STRUCTURE / QUALITÉ
# ============================================================

def connected_letters(grid):
    cells = [
        (r, c)
        for r in range(len(grid))
        for c in range(len(grid[0]))
        if grid[r][c] is not None
    ]

    if not cells:
        return False

    seen = {cells[0]}
    stack = [cells[0]]

    while stack:
        r, c = stack.pop()
        for nr, nc in (
            (r - 1, c),
            (r + 1, c),
            (r, c - 1),
            (r, c + 1),
        ):
            if (
                0 <= nr < len(grid)
                and 0 <= nc < len(grid[0])
                and grid[nr][nc] is not None
                and (nr, nc) not in seen
            ):
                seen.add((nr, nc))
                stack.append((nr, nc))

    return len(seen) == len(cells)


def crossing_count(grid, placements):
    occupancy = defaultdict(int)

    for p in placements:
        for pos in word_cells(
            p.row, p.col, p.direction, len(p.word.word)
        ):
            occupancy[pos] += 1

    return sum(v >= 2 for v in occupancy.values())


def bounding_box_score(grid):
    coords = [
        (r, c)
        for r in range(len(grid))
        for c in range(len(grid[0]))
        if grid[r][c] is not None
    ]

    if not coords:
        return 0

    min_r = min(r for r, _ in coords)
    max_r = max(r for r, _ in coords)
    min_c = min(c for _, c in coords)
    max_c = max(c for _, c in coords)

    area = (max_r - min_r + 1) * (max_c - min_c + 1)
    used = len(coords)

    # Plus le remplissage est compact, mieux c'est.
    return used / max(1, area)


def build_placements(words, rows, cols, rng):
    """
    Construit une grille de mots fléchés.

    Le premier mot est placé avec une vraie case-indice.
    Tous les mots suivants doivent croiser au moins un mot
    existant.
    """

    grid = new_grid(rows, cols)
    placements = []
    used = set()

    shuffled = words[:]
    rng.shuffle(shuffled)

    starters = [
        w for w in shuffled
        if 4 <= len(w.word) <= 9
    ]
    if not starters:
        starters = shuffled

    if not starters:
        return grid, placements

    # On choisit un premier mot dont la case-indice
    # peut être placée dans la grille.
    first_candidates = []

    for w in starters[:500]:
        for direction in ("H", "V"):
            if direction == "H":
                row = rows // 2
                col = max(
                    1,
                    (cols - len(w.word)) // 2
                )
            else:
                row = max(
                    1,
                    (rows - len(w.word)) // 2
                )
                col = cols // 2

            ok, _ = can_place_arrow_word(
                grid,
                w.word,
                row,
                col,
                direction,
                require_cross=False,
            )

            if ok:
                first_candidates.append(
                    (w, row, col, direction)
                )

    if not first_candidates:
        return grid, placements

    first = rng.choice(first_candidates)

    w, row, col, direction = first

    place_word(
        grid,
        w.word,
        row,
        col,
        direction
    )

    placements.append(
        Placement(
            word=w,
            row=row,
            col=col,
            direction=direction,
        )
    )

    used.add(w.word)

    # --------------------------------------------------------
    # Ajout progressif
    # --------------------------------------------------------

    remaining = [
        w for w in shuffled
        if w.word not in used
    ]

    stagnation = 0

    while remaining and stagnation < 12:
        candidates = []

        # Le nombre de candidats testés est limité pour
        # garder le générateur rapide avec 10k+ mots.
        sample = (
            rng.sample(
                remaining,
                min(350, len(remaining))
            )
        )

        for w in sample:
            positions = candidate_positions(
                grid,
                w.word,
                allow_no_cross=False,
            )

            if not positions:
                continue

            # On préfère les placements avec plusieurs
            # croisements, mais évite les mots trop longs
            # qui remplissent toute la grille.
            for row, col, direction, crossings in positions:
                score = (
                    crossings * 1500
                    + len(w.word) * 35
                    + w.complexity * 8
                    + rng.random() * 100
                )

                candidates.append(
                    (
                        score,
                        w,
                        row,
                        col,
                        direction,
                        crossings,
                    )
                )

        if not candidates:
            stagnation += 1
            rng.shuffle(remaining)
            continue

        candidates.sort(
            key=lambda x: x[0],
            reverse=True
        )

        # Diversification : on choisit dans les meilleurs.
        top = candidates[:min(15, len(candidates))]
        selected = rng.choice(top)

        (
            _score,
            w,
            row,
            col,
            direction,
            crossings,
        ) = selected

        place_word(
            grid,
            w.word,
            row,
            col,
            direction
        )

        placements.append(
            Placement(
                word=w,
                row=row,
                col=col,
                direction=direction,
            )
        )

        used.add(w.word)

        remaining = [
            x for x in remaining
            if x.word != w.word
        ]

        stagnation = 0

    return grid, placements


# ============================================================
# COMBLEMENT DES TROUS
# ============================================================
#
# build_placements() s'arrête dès que `stagnation` atteint sa limite : tout
# ce qui reste alors à None devient une case noire. Cette passe cible
# spécifiquement ces trous après coup, sans toucher aux placements déjà
# posés : elle repère chaque segment vide maximal (horizontal ou vertical)
# et tente d'y loger un mot de la longueur exacte disponible, en réservant
# sa première case comme case-indice. Elle réutilise can_place_arrow_word()
# donc respecte automatiquement toutes les règles existantes (séparation,
# contact latéral parasite, etc.) : certains segments restent donc parfois
# non comblables (case-indice qui collerait à un mot voisin, longueur < 3),
# ce qui est attendu plutôt qu'un bug.

MAX_GAP_CANDIDATES = 60  # mots examinés par longueur (les listes sont déjà mélangées)


def try_fill_run(grid, by_length, used, placements, row, col, direction, max_word_len):
    """Essaie la longueur la plus longue d'abord (comble le segment en un
    seul mot autant que possible ; toute longueur plus courte laisse un
    reliquat qui sera retenté à l'itération suivante). Les mots utilisés
    sont retirés de `by_length` au fur et à mesure pour ne pas les
    rescanner à chaque case vide."""

    for length in range(max_word_len, 1, -1):
        candidates = by_length.get(length)
        if not candidates:
            continue

        checked = 0
        i = 0
        while i < len(candidates) and checked < MAX_GAP_CANDIDATES:
            w = candidates[i]
            checked += 1

            ok, _ = can_place_arrow_word(
                grid, w.word, row, col, direction, require_cross=False,
            )
            if not ok:
                i += 1
                continue

            place_word(grid, w.word, row, col, direction)
            placements.append(
                Placement(word=w, row=row, col=col, direction=direction)
            )
            used.add(w.word)
            del candidates[i]  # ne plus jamais rescanner ce mot
            return True

        # Ce préfixe ne convient à aucun mot de cette longueur pour cette
        # position précise ; on le laisse pour d'autres cases (un mot
        # rejeté ici peut très bien convenir ailleurs).

    return False


def fill_gaps(grid, words, used, rng, placements, min_word_len=2, max_passes=15):
    """Comble par balayages successifs (horizontal puis vertical) tant
    qu'un passage complet apporte encore au moins un mot."""

    rows = len(grid)
    cols = len(grid[0])

    by_length = defaultdict(list)
    for w in words:
        if w.word not in used:
            by_length[len(w.word)].append(w)
    for length in by_length:
        rng.shuffle(by_length[length])

    min_run = min_word_len + 1  # 1 case-indice + au moins min_word_len lettres

    for _ in range(max_passes):
        progress = False

        # --- balayage horizontal ---
        for r in range(rows):
            c = 0
            while c < cols:
                if grid[r][c] is not None:
                    c += 1
                    continue
                run_start = c
                while c < cols and grid[r][c] is None:
                    c += 1
                run_len = c - run_start
                if run_len < min_run:
                    continue
                if try_fill_run(
                    grid, by_length, used, placements,
                    r, run_start + 1, "H", run_len - 1,
                ):
                    progress = True
                    c = run_start  # relit le même point : reliquat éventuel

        # --- balayage vertical ---
        for c in range(cols):
            r = 0
            while r < rows:
                if grid[r][c] is not None:
                    r += 1
                    continue
                run_start = r
                while r < rows and grid[r][c] is None:
                    r += 1
                run_len = r - run_start
                if run_len < min_run:
                    continue
                if try_fill_run(
                    grid, by_length, used, placements,
                    run_start + 1, c, "V", run_len - 1,
                ):
                    progress = True
                    r = run_start

        if not progress:
            break


# ============================================================
# CASES-INDICES
# ============================================================

def derive_clue_cells(grid, placements):
    """
    Construit les cases-indices à partir des placements.

    Une case-indice est une case vide immédiatement avant
    un mot.

    Deux mots peuvent partager la même case-indice :
        H + V
    """

    rows = len(grid)
    cols = len(grid[0])

    clue_map = defaultdict(list)

    for p in placements:
        cr, cc = clue_position(
            p.row,
            p.col,
            p.direction
        )

        if not (0 <= cr < rows and 0 <= cc < cols):
            continue

        # La case doit être libre.
        if grid[cr][cc] is not None:
            continue

        clue_map[(cr, cc)].append(p)

    return clue_map


# ============================================================
# CONSTRUCTION DU JSON JOUABLE
# ============================================================

def create_playable_grid(
    grid,
    placements
):
    rows = len(grid)
    cols = len(grid[0])

    clue_map = derive_clue_cells(
        grid,
        placements
    )

    cells = []

    for r in range(rows):
        row = []

        for c in range(cols):

            if (r, c) in clue_map:
                row.append({
                    "type": "clue",
                    "number": None,
                    "solution": None,
                    "clues": [],
                })

            elif grid[r][c] is None:
                row.append({
                    "type": "black",
                    "number": None,
                    "solution": None,
                    "clues": [],
                })

            else:
                row.append({
                    "type": "letter",
                    "number": None,
                    "solution": grid[r][c],
                    "clues": [],
                })

        cells.append(row)

    # Numérotation des cases-indices.
    number = 1

    for r in range(rows):
        for c in range(cols):

            if cells[r][c]["type"] != "clue":
                continue

            cells[r][c]["number"] = number

            for p in clue_map[(r, c)]:
                cells[r][c]["clues"].append({
                    "number": number,
                    "word": p.word.word,
                    "hint_str": p.word.hint,
                    "complexity": p.word.complexity,
                    "direction": p.direction,
                    "start": [p.row, p.col],
                    "length": len(p.word.word),
                })

                p.number = number

            number += 1

    # Les placements sans case-indice ne sont pas jouables.
    playable = [
        p for p in placements
        if p.number > 0
    ]

    return cells, playable


# ============================================================
# CONTRAINTES DE QUALITÉ
# ============================================================

def quality_metrics(grid, cells, placements):
    rows = len(grid)
    cols = len(grid[0])

    letters = sum(
        grid[r][c] is not None
        for r in range(rows)
        for c in range(cols)
    )

    black = sum(
        cells[r][c]["type"] == "black"
        for r in range(rows)
        for c in range(cols)
    )

    clues = sum(
        cells[r][c]["type"] == "clue"
        for r in range(rows)
        for c in range(cols)
    )

    isolated_black = 0

    for r in range(rows):
        for c in range(cols):

            if cells[r][c]["type"] != "black":
                continue

            around = []

            for nr, nc in (
                (r - 1, c),
                (r + 1, c),
                (r, c - 1),
                (r, c + 1),
            ):
                if 0 <= nr < rows and 0 <= nc < cols:
                    around.append(
                        cells[nr][nc]["type"]
                    )

            # Une case noire complètement entourée de noires
            # est généralement peu intéressante.
            if around and all(
                x == "black"
                for x in around
            ):
                isolated_black += 1

    crossings = crossing_count(
        grid,
        placements
    )

    compact = bounding_box_score(
        grid
    )

    coverage = letters / (rows * cols)

    # Objectif :
    # - beaucoup de lettres
    # - beaucoup de mots
    # - beaucoup de croisements
    # - grille compacte
    # - peu de trous noirs inutiles

    score = (
        coverage * 12000
        + len(placements) * 60
        + crossings * 250
        + compact * 1500
        - isolated_black * 80
    )

    return {
        "score": score,
        "letters": letters,
        "black": black,
        "clues": clues,
        "words": len(placements),
        "crossings": crossings,
        "coverage": coverage,
        "compactness": compact,
        "isolated_black": isolated_black,
    }


# ============================================================
# RECHERCHE
# ============================================================

def generate_best(
    words,
    rows,
    cols,
    attempts,
    seed,
):
    rng = random.Random(seed)

    best = None
    best_metrics = None

    for attempt in range(attempts):

        grid, placements = build_placements(
            words,
            rows,
            cols,
            rng,
        )

        if len(placements) < 3:
            continue

        used = {p.word.word for p in placements}
        fill_gaps(grid, words, used, rng, placements)

        if not connected_letters(grid):
            continue

        cells, playable = create_playable_grid(
            grid,
            placements
        )

        if len(playable) < 3:
            continue

        metrics = quality_metrics(
            grid,
            cells,
            playable
        )

        if (
            best_metrics is None
            or metrics["score"] > best_metrics["score"]
        ):
            best = (
                grid,
                cells,
                playable,
            )
            best_metrics = metrics

        if attempt == 0 or attempt % 100 == 0:
            print(
                f"\r[SEARCH] "
                f"{attempt + 1:,}/{attempts:,} "
                f"| mots={metrics['words']} "
                f"| croisements={metrics['crossings']} "
                f"| couverture={metrics['coverage']:.1%}",
                end="",
                flush=True,
            )

    print()

    if best is None:
        raise RuntimeError(
            "Aucune grille jouable n'a pu être générée."
        )

    return best[0], best[1], best[2], best_metrics


# ============================================================
# EXPORT
# ============================================================

def save_json(
    path,
    cells,
    placements,
    metrics,
):
    rows = len(cells)
    cols = len(cells[0])

    words = []

    for p in placements:
        words.append({
            "number": p.number,
            "word": p.word.word,
            "hint_str": p.word.hint,
            "complexity": p.word.complexity,
            "row": p.row,
            "col": p.col,
            "direction": p.direction,
            "length": len(p.word.word),
        })

    output = {
        "version": 2,
        "type": "mots-fleches",
        "rows": rows,
        "cols": cols,

        "grid": cells,

        "words": words,

        "stats": {
            "words": len(words),
            "letters": metrics["letters"],
            "clues": metrics["clues"],
            "black": metrics["black"],
            "crossings": metrics["crossings"],
            "coverage": round(
                metrics["coverage"], 4
            ),
            "compactness": round(
                metrics["compactness"], 4
            ),
            "isolated_black":
                metrics["isolated_black"],
            "score": round(
                metrics["score"], 2
            ),
        },
    }

    with open(
        path,
        "w",
        encoding="utf-8"
    ) as f:
        json.dump(
            output,
            f,
            ensure_ascii=False,
            indent=2
        )


def save_txt(path, cells):
    path = Path(path)
    txt_path = path.with_suffix(".txt")

    with open(
        txt_path,
        "w",
        encoding="utf-8"
    ) as f:

        for row in cells:
            parts = []

            for cell in row:

                if cell["type"] == "black":
                    parts.append("██")

                elif cell["type"] == "clue":
                    parts.append(
                        f"{cell['number']:02d}"
                    )

                else:
                    parts.append("··")

            f.write(
                " ".join(parts) + "\n"
            )

    return txt_path


def print_grid(cells):
    print()
    print(
        "██ = noire | "
        "NN = case-indice | "
        "·· = lettre"
    )
    print()

    for row in cells:

        parts = []

        for cell in row:

            if cell["type"] == "black":
                parts.append("██")

            elif cell["type"] == "clue":
                parts.append(
                    f"{cell['number']:02d}"
                )

            else:
                parts.append("··")

        print(" ".join(parts))

    print()


# ============================================================
# MAIN
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Générateur V2 de mots fléchés."
    )

    parser.add_argument(
        "json_file",
        type=Path,
        help="Dictionnaire JSON",
    )

    parser.add_argument(
        "--rows",
        type=int,
        default=10,
    )

    parser.add_argument(
        "--cols",
        type=int,
        default=12,
    )

    parser.add_argument(
        "--attempts",
        type=int,
        default=5000,
    )

    parser.add_argument(
        "--seed",
        type=int,
        default=None,
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path("grid.json"),
    )

    args = parser.parse_args()

    print("=" * 70)
    print("GENERATEUR MOTS FLECHES — V2")
    print("=" * 70)

    words = load_dictionary(
        args.json_file
    )

    if not words:
        raise SystemExit(
            "[ERREUR] Aucun mot utilisable."
        )

    print(
        f"[GRID] {args.rows} x {args.cols}"
    )

    print(
        f"[SEARCH] {args.attempts:,} essais"
    )

    grid, cells, placements, metrics = (
        generate_best(
            words,
            args.rows,
            args.cols,
            args.attempts,
            args.seed,
        )
    )

    print()
    print("[RESULTAT]")
    print(
        f"  mots          : {metrics['words']}"
    )
    print(
        f"  croisements   : {metrics['crossings']}"
    )
    print(
        f"  lettres       : {metrics['letters']}"
    )
    print(
        f"  indices       : {metrics['clues']}"
    )
    print(
        f"  cases noires  : {metrics['black']}"
    )
    print(
        f"  couverture    : "
        f"{metrics['coverage']:.1%}"
    )
    print(
        f"  compacité     : "
        f"{metrics['compactness']:.1%}"
    )
    print(
        f"  noires isolées: "
        f"{metrics['isolated_black']}"
    )

    print_grid(cells)

    save_json(
        args.output,
        cells,
        placements,
        metrics,
    )

    txt_path = save_txt(
        args.output,
        cells,
    )

    print(
        f"[OK] {args.output}"
    )
    print(
        f"[OK] {txt_path}"
    )


if __name__ == "__main__":
    main()
