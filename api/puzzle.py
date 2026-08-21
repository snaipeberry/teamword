"""Fonction serverless Vercel : remplit une grille et la renvoie à l'app.

Elle ne CHERCHE jamais de structure de grille — les squelettes sont générés
hors-ligne et versionnés dans le dépôt (`scripts/grid_generation/banks/`).
C'est ce qui permet de répondre en quelques millisecondes sans démarrage à
froid coûteux : il n'y a qu'un JSON à charger et un remplissage à faire.

Tout ce qui est coûteux (dictionnaire, index inversé, banc) est chargé au
niveau du module, donc une seule fois par instance : les invocations chaudes
réutilisent tel quel.

Route : GET /api/puzzle?seed=XXXX
"""

import json
import random
import sys
import time
import traceback
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse


def _find_project_root():
    """Remonte l'arborescence jusqu'au dossier contenant le générateur.

    Vercel n'exécute pas la fonction depuis la racine du dépôt et la
    profondeur exacte n'est pas garantie : on cherche donc un repère plutôt
    que de coder en dur un nombre de `..`.
    """
    here = Path(__file__).resolve()
    for candidate in (here.parent, *here.parents):
        if (candidate / "scripts" / "grid_generation" / "generate_grid_v2.py").exists():
            return candidate
    raise RuntimeError(
        "Racine du projet introuvable : scripts/grid_generation/ n'a pas été "
        "embarqué dans le bundle (voir `functions.includeFiles` dans vercel.json)."
    )


# --- Chargement au démarrage à froid -------------------------------------
# Toute erreur ici est capturée plutôt que propagée : une exception au niveau
# du module donnerait un 500 opaque, alors qu'on veut pouvoir diagnostiquer
# (fichier manquant, banc non embarqué, etc.) depuis la réponse HTTP.

_BOOT_ERROR = None
_WORDS = _INDEX = _BANK = _to_app_puzzle = None
_BOOT_MS = 0.0

try:
    _t0 = time.perf_counter()

    ROOT = _find_project_root()
    GEN_DIR = ROOT / "scripts" / "grid_generation"
    sys.path.insert(0, str(GEN_DIR))

    from generate_grid_v2 import (  # noqa: E402
        build_word_index,
        generate_from_bank,
        load_dictionary,
        load_skeleton_bank,
    )
    from serve_puzzles import to_app_puzzle as _to_app_puzzle  # noqa: E402

    DATASET_PATH = ROOT / "scripts" / "datasets" / "mots_fleches_enriched_v6_hard_hints.json"
    BANK_PATH = GEN_DIR / "banks" / "skeletons_8x8.json"

    _WORDS = load_dictionary(DATASET_PATH)
    _INDEX = build_word_index(_WORDS)
    _BANK = load_skeleton_bank(BANK_PATH)

    _BOOT_MS = (time.perf_counter() - _t0) * 1000
except Exception:  # noqa: BLE001 — on veut le détail dans la réponse
    _BOOT_ERROR = traceback.format_exc()


def build_payload(seed=None):
    rng = random.Random(seed) if seed is not None else random.Random()

    cells, words_out, metrics = generate_from_bank(
        _BANK, _WORDS, rng, index=_INDEX
    )

    payload = _to_app_puzzle(
        cells,
        words_out,
        _BANK["rows"],
        _BANK["cols"],
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


class handler(BaseHTTPRequestHandler):
    # Vercel exige une classe nommée exactement `handler`.

    def _send(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        # La grille dépend de la graine : deux joueurs d'une même partie
        # doivent obtenir la même, donc une réponse est cacheable par graine.
        self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if _BOOT_ERROR is not None:
            self._send(500, {"error": "initialisation impossible", "detail": _BOOT_ERROR})
            return

        params = parse_qs(urlparse(self.path).query)
        seed = (params.get("seed") or [None])[0]

        try:
            t0 = time.perf_counter()
            payload = build_payload(seed)
            payload["generated_in_ms"] = round((time.perf_counter() - t0) * 1000, 2)
            payload["boot_ms"] = round(_BOOT_MS, 2)
            self._send(200, payload)
        except Exception as exc:  # noqa: BLE001
            self._send(500, {"error": str(exc), "detail": traceback.format_exc()})

    def log_message(self, fmt, *args):  # silence : Vercel journalise déjà
        pass
