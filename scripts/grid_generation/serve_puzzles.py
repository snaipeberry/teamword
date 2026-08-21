#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Serveur de grilles de mots fléchés — REMPLISSAGE UNIQUEMENT.

Le serveur ne cherche JAMAIS de nouvelle structure de grille : il charge les
bancs de squelettes déjà construits hors-ligne (voir `--build-bank` dans
generate_grid_v2.py) et se contente de les remplir avec des mots tirés au
hasard. C'est ce qui rend la latence faible et prévisible (~1 ms contre
plusieurs secondes, et sans risque d'échec).

Tout ce qui est coûteux — dictionnaires, index inversés, bancs — est chargé
UNE fois au démarrage et partagé par toutes les requêtes.

Endpoints :
    GET /health              état du service et banc chargé
    GET /puzzle              grille remplie au hasard
    GET /puzzle?seed=XXXX    grille DÉTERMINISTE pour cette graine

La graine est indispensable en multijoueur : deux joueurs qui appellent le
service chacun de leur côté doivent obtenir exactement la même grille. En
passant le code de partie comme graine, le service devient reproductible
sans avoir à stocker quoi que ce soit.

Il n'y a qu'un seul dictionnaire et un seul banc : la notion de difficulté a
été retirée au profit d'un dataset unique, bien plus large.

Lancement :
    python serve_puzzles.py                 # port 8787
    python serve_puzzles.py --port 9000
"""

import argparse
import json
import random
import re
import sys
import time
import unicodedata
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse, parse_qs

from generate_grid_v2 import (
    build_word_index,
    generate_from_bank,
    load_dictionary,
    load_skeleton_bank,
)

# Le générateur travaille en 'H'/'V', l'app en 'right'/'down'.
DIRECTION_MAP = {"H": "right", "V": "down"}


def to_app_answer(word):
    """Aligne la réponse sur ce que l'app peut réellement saisir.

    Le clavier iOS produit des lettres accentuées, mais CrosswordGrid les
    normalise (NFD + suppression des diacritiques + majuscules) avant de les
    comparer : une réponse « ÉPI » serait donc impossible à saisir. On
    applique ici exactement la même normalisation.

    Sans risque pour la cohérence de la grille : deux mots qui se croisaient
    sur 'é' se croisent toujours sur 'E' — et le générateur avait déjà rejeté
    un croisement 'é'/'e', qui restent distincts avant normalisation.
    """
    decomposed = unicodedata.normalize("NFD", word)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return stripped.upper()


def to_app_puzzle(cells, words_out, rows, cols, puzzle_id, title):
    """Convertit la sortie du générateur vers la forme attendue par l'app.

    On renvoie `words` + `clue_cells` (et non une grille toute faite) parce
    que c'est exactement ce que `usePuzzle` consomme déjà : le front
    reconstruit la grille via `buildGrid`, qui revalide au passage
    l'adjacence indice/mot et la cohérence des croisements.
    """

    words_app = []
    key_to_id = {}

    for i, w in enumerate(words_out):
        wid = f"w{i}"
        key_to_id[(w["word"], w["direction"], w["row"], w["col"])] = wid
        words_app.append(
            {
                "id": wid,
                "direction": DIRECTION_MAP[w["direction"]],
                "clue": w["hint_str"],
                "startRow": w["row"],
                "startCol": w["col"],
                "length": w["length"],
                "answer": to_app_answer(w["word"]),
            }
        )

    clue_cells = []
    for r, row in enumerate(cells):
        for c, cell in enumerate(row):
            # Les cases-indices sans définition (elles ne précèdent aucun mot)
            # sont omises : buildGrid les laissera en case neutre côté app.
            if cell["type"] != "clue" or not cell["clues"]:
                continue
            entries = []
            for cl in cell["clues"]:
                key = (cl["word"], cl["direction"], cl["start"][0], cl["start"][1])
                entries.append(
                    {
                        "text": cl["hint_str"],
                        "direction": DIRECTION_MAP[cl["direction"]],
                        # Flèche coudée éventuelle : l'app doit dessiner un
                        # glyphe différent et le placer du bon côté.
                        "arrow": cl.get("arrow", DIRECTION_MAP[cl["direction"]]),
                        "wordId": key_to_id[key],
                    }
                )
            clue_cells.append({"row": r, "col": c, "clues": entries})

    return {
        "id": puzzle_id,
        "title": title,
        "rows": rows,
        "cols": cols,
        "words": words_app,
        "clue_cells": clue_cells,
    }


# L'app envoie une graine de la forme « <session>-r<numéro de grille> ».
SEED_RE = re.compile(r"^(?P<session>.+)-r(?P<round>\d+)$")

# Longueurs dont le stock est trop mince pour éviter les redites naturellement.
# Mesuré sur ce dictionnaire : 91 mots répétés d'une grille à la suivante,
# dont 75 de 2 lettres et 15 de 3 lettres — au-delà de 4 lettres, 1 sur 231.
# Le stock (62 mots de 2 lettres pour une douzaine utilisés par grille) rend
# la collision quasi certaine par simple tirage.
THIN_STOCK_MAX = 200

# Nombre de groupes alternés. Deux est optimal ici : plus fin, chaque groupe
# devient trop petit pour couvrir les ~12 mots de 2 lettres d'une grille, le
# remplissage doit puiser dans les autres groupes et l'effet se dilue
# (mesuré : 7,6 % de recouvrement à K=2, contre 10,1 % à K=3 et 10,8 % à K=4).
ROTATION_GROUPS = 2


def rotation_avoid(index, seed):
    """Mots à rétrograder pour que deux grilles consécutives ne se ressemblent pas.

    Le stock court est découpé en groupes alternés, et chaque grille
    privilégie celui qui correspond à son numéro : deux grilles qui se
    suivent puisent donc dans des moitiés différentes.

    Entièrement déterministe — cela ne dépend que du numéro de grille, que
    les deux joueurs partagent — et sans coût : aucune grille précédente
    n'est recalculée.
    """
    m = SEED_RE.match(seed or "")
    if not m:
        return None

    current = int(m.group("round"))
    avoid = set()
    for length, pool in index.by_length.items():
        if len(pool) > THIN_STOCK_MAX:
            continue  # stock large : les redites y sont déjà négligeables
        for i, word in enumerate(pool):
            if i % ROTATION_GROUPS != current % ROTATION_GROUPS:
                avoid.add(word.word)
    return avoid or None


class PuzzleService:
    """Détient les ressources immuables (dictionnaire, index, banc)."""

    def __init__(self, dataset_path, bank_path):
        dataset_path = Path(dataset_path)
        bank_path = Path(bank_path)

        if not dataset_path.exists():
            raise SystemExit(f"[ERREUR] Dictionnaire absent : {dataset_path}")
        if not bank_path.exists():
            raise SystemExit(
                f"[ERREUR] Banc absent : {bank_path}\n"
                f"        Le serveur ne construit pas de squelettes, il les remplit.\n"
                f"        Construis-le d'abord :\n"
                f"        python generate_grid_v2.py {dataset_path} \\\n"
                f"            --build-bank 80 --bank-file {bank_path}"
            )

        self.words = load_dictionary(dataset_path)
        self.index = build_word_index(self.words)
        self.bank = load_skeleton_bank(bank_path)

        print(
            f"[OK] {len(self.words)} mots, {self.bank['count']} squelettes "
            f"{self.bank['rows']}x{self.bank['cols']}"
        )

    def fill(self, seed=None):
        # Avec une graine, tout devient reproductible : choix du squelette et
        # des mots. Deux joueurs d'une même partie obtiennent ainsi une grille
        # identique sans que le serveur ait à stocker quoi que ce soit.
        rng = random.Random(seed) if seed is not None else random.Random()

        cells, words_out, metrics = generate_from_bank(
            self.bank, self.words, rng, index=self.index,
            avoid_words=rotation_avoid(self.index, seed),
        )

        payload = to_app_puzzle(
            cells,
            words_out,
            self.bank["rows"],
            self.bank["cols"],
            puzzle_id=str(seed) if seed is not None else f"{rng.getrandbits(48):012x}",
            title="Mots fléchés",
        )
        payload["stats"] = {
            "words": metrics["words"],
            "letters": metrics["letters"],
            "clues": metrics["clues"],
            "dead_clues": metrics["dead_clues"],
        }
        return payload


class Handler(BaseHTTPRequestHandler):
    service = None
    protocol_version = "HTTP/1.1"

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # Le front tourne sur un autre port en dev (Vite) : sans CORS le
        # navigateur bloquerait la réponse.
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)

        # Les alias /api/* alignent le serveur de dev sur la convention Vercel
        # (une fonction par fichier dans api/), pour que le front appelle
        # exactement la même URL en local et en production.
        if parsed.path in ("/health", "/api/health"):
            self._send(
                200,
                {
                    "status": "ok",
                    "words": len(self.service.words),
                    "skeletons": self.service.bank["count"],
                    "size": f"{self.service.bank['rows']}x{self.service.bank['cols']}",
                },
            )
            return

        if parsed.path in ("/puzzle", "/api/puzzle"):
            params = parse_qs(parsed.query)
            seed = (params.get("seed") or [None])[0]
            try:
                t0 = time.perf_counter()
                payload = self.service.fill(seed)
                payload["generated_in_ms"] = round((time.perf_counter() - t0) * 1000, 2)
                self._send(200, payload)
            except Exception as exc:  # remplissage impossible
                self._send(500, {"error": str(exc)})
            return

        self._send(404, {"error": "route inconnue", "routes": ["/api/puzzle", "/api/health"]})

    def log_message(self, fmt, *args):
        sys.stderr.write(f"[{self.log_date_time_string()}] {fmt % args}\n")


def main():
    here = Path(__file__).resolve().parent

    parser = argparse.ArgumentParser(
        description="Serveur de mots fléchés (remplissage seul, jamais de recherche)."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8787)
    parser.add_argument(
        "--dataset",
        type=Path,
        default=here.parent / "datasets" / "mots_fleches_enriched_v9_infinitives_2letters.json",
    )
    parser.add_argument(
        "--bank-file", type=Path, default=here / "banks" / "skeletons_10x10.json"
    )
    args = parser.parse_args()

    print("=" * 66)
    print("SERVEUR MOTS FLECHES — remplissage depuis un banc pre-construit")
    print("=" * 66)

    t0 = time.time()
    Handler.service = PuzzleService(args.dataset, args.bank_file)
    print(f"[BOOT] pret en {(time.time() - t0) * 1000:.0f}ms")
    print(f"[HTTP] http://{args.host}:{args.port}/puzzle")

    server = ThreadingHTTPServer((args.host, args.port), Handler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[STOP]")
        server.shutdown()


if __name__ == "__main__":
    main()
