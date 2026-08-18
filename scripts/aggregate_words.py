#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
AGRÉGATEUR FRANÇAIS
===================

Sources locales :
    - Lexique 4 (Lexique400.tsv)
    - Kaikki French dictionary JSONL

Objectif :
    Construire un JSON de mots français jouables pour des mots fléchés.

Principe :
    Lexique 4
        -> formes, fréquence, lemme, genre, nombre, morphologie

    Kaikki
        -> POS, genre/nombre, synonymes, hyperonymes, hyponymes,
           formes et informations grammaticales

    IMPORTANT :
        Les définitions Kaikki sont souvent en ANGLAIS.
        Elles ne sont donc PAS utilisées comme indice.

    hint_str est construit uniquement à partir de relations
    lexicales françaises présentes dans Kaikki :
        - synonymes
        - hyperonymes
        - hyponymes

    L'étape suivante pourra remplacer hint_str par un vrai
    indice de mots fléchés.

Sortie :
    JSON avec une structure du type :

    {
        "word": "chat",
        "size": 4,
        "lemma": "chat",
        "pos": "noun",
        "gender": "m",
        "number": "s",
        "person": null,
        "tense": null,
        "mood": null,
        "form_tags": [],
        "verb_info": "",
        "frequency": 123.45,
        "is_lemma": "1",
        "hint_str": "félin",
        "complexity": 3
    }
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Set, Tuple


# ============================================================
# CONFIGURATION
# ============================================================

DEFAULT_TARGET = 10000
DEFAULT_MIN_SIZE = 2
DEFAULT_MAX_SIZE = 15
DEFAULT_MIN_HINT_SIZE = 2
DEFAULT_MAX_HINT_SIZE = 15


# ============================================================
# UTILITAIRES TEXTE
# ============================================================

def normalize_spaces(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip())


def normalize_word(value: str) -> str:
    """
    Normalisation destinée aux comparaisons.

    On conserve les accents pour la sortie mais on utilise une
    version minuscule/normalisée pour le matching.
    """
    if value is None:
        return ""

    value = str(value).strip().lower()
    value = normalize_spaces(value)

    return value


def normalize_match(value: str) -> str:
    """
    Normalisation plus agressive pour le matching Lexique/Kaikki.

    Exemple :
        "Été" -> "ete"
        "été" -> "ete"
    """
    value = normalize_word(value)

    value = unicodedata.normalize("NFD", value)
    value = "".join(
        c for c in value
        if unicodedata.category(c) != "Mn"
    )

    return value


def clean_hint(value: str) -> str:
    """
    Nettoyage d'un éventuel indice lexical.
    """
    if not isinstance(value, str):
        return ""

    value = normalize_spaces(value)

    # Supprimer quelques marqueurs de gloss.
    value = re.sub(r"^\([^)]*\)\s*", "", value)

    # Pas de point final.
    value = value.rstrip(" .;,:!?")

    return value.strip()


def letter_count(value: str) -> int:
    """
    Nombre de lettres, sans compter espaces/ponctuation.
    """
    return sum(c.isalpha() for c in value)


def valid_word(value: str) -> bool:
    """
    Mot utilisable dans un mot fléché.

    On autorise les lettres accentuées mais pas les espaces,
    apostrophes, chiffres, traits d'union, etc.
    """
    if not value:
        return False

    return bool(re.fullmatch(r"[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+", value))


def valid_hint(value: str) -> bool:
    """
    Un hint doit :
        - être non vide
        - avoir <= 15 caractères
        - être suffisamment court
        - être une expression lexicalement simple
    """
    value = clean_hint(value)

    if not value:
        return False

    if len(value) > DEFAULT_MAX_HINT_SIZE:
        return False

    if len(value) < DEFAULT_MIN_HINT_SIZE:
        return False

    # Pas de définitions longues.
    if value.count(",") > 0:
        return False

    if value.count(";") > 0:
        return False

    if value.count(":") > 0:
        return False

    if value.count("(") > 0 or value.count(")") > 0:
        return False

    # Un indice relationnel doit rester compact.
    if len(value.split()) > 3:
        return False

    return True


# ============================================================
# FILTRE "FRANÇAIS"
# ============================================================

# Mots anglais très fréquents qui apparaissent souvent dans les
# glosses Kaikki. Ce n'est volontairement PAS une liste exhaustive :
# le but est de rejeter les cas manifestement anglais.
ENGLISH_WORDS = {
    "a",
    "about",
    "above",
    "after",
    "again",
    "all",
    "animal",
    "another",
    "any",
    "are",
    "around",
    "as",
    "at",
    "be",
    "because",
    "been",
    "before",
    "being",
    "below",
    "between",
    "both",
    "but",
    "by",
    "can",
    "child",
    "city",
    "come",
    "common",
    "completely",
    "could",
    "country",
    "day",
    "different",
    "do",
    "does",
    "done",
    "during",
    "each",
    "either",
    "enough",
    "especially",
    "even",
    "every",
    "example",
    "first",
    "for",
    "from",
    "fully",
    "general",
    "give",
    "given",
    "go",
    "good",
    "government",
    "great",
    "have",
    "he",
    "her",
    "here",
    "him",
    "his",
    "how",
    "if",
    "in",
    "including",
    "into",
    "is",
    "it",
    "its",
    "just",
    "kind",
    "large",
    "little",
    "many",
    "may",
    "more",
    "most",
    "much",
    "my",
    "never",
    "new",
    "no",
    "not",
    "now",
    "of",
    "often",
    "old",
    "on",
    "one",
    "only",
    "or",
    "other",
    "our",
    "out",
    "over",
    "part",
    "person",
    "place",
    "probably",
    "put",
    "same",
    "say",
    "she",
    "should",
    "since",
    "small",
    "some",
    "something",
    "such",
    "than",
    "that",
    "the",
    "their",
    "them",
    "then",
    "there",
    "these",
    "they",
    "thing",
    "this",
    "those",
    "through",
    "time",
    "to",
    "under",
    "until",
    "up",
    "use",
    "used",
    "very",
    "want",
    "was",
    "way",
    "we",
    "were",
    "what",
    "when",
    "where",
    "which",
    "who",
    "will",
    "with",
    "without",
    "would",
    "you",
    "your",
}


def looks_french(value: str) -> bool:
    """
    Détecte grossièrement si une relation lexicale est
    vraisemblablement française.

    Ce n'est pas un dictionnaire français :
    c'est volontairement un filtre de sécurité pour empêcher
    les glosses anglaises de devenir des hints.
    """
    if not isinstance(value, str):
        return False

    value = clean_hint(value)

    if not value:
        return False

    if not valid_hint(value):
        return False

    # Les relations doivent être lexicales et compactes.
    if not re.fullmatch(
        r"[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ'’\- ]+",
        value
    ):
        return False

    tokens = re.findall(
        r"[A-Za-zÀ-ÖØ-öø-ÿŒœÆæ]+",
        value.lower()
    )

    if not tokens:
        return False

    # Si un mot anglais très évident apparaît, rejet.
    for token in tokens:
        if token in ENGLISH_WORDS:
            return False

    # Indices très typiques de gloss anglais.
    lower = value.lower()

    bad_patterns = (
        " of ",
        " to ",
        " from ",
        " in ",
        " on ",
        " the ",
        " a ",
        " an ",
        "you ",
        " is ",
        " are ",
        " and ",
        " or ",
    )

    padded = f" {lower} "

    if any(pattern in padded for pattern in bad_patterns):
        return False

    return True


# ============================================================
# LEXIQUE 4
# ============================================================

def detect_delimiter(line: str) -> str:
    """
    Lexique400.tsv est normalement tabulé.
    """
    if "\t" in line:
        return "\t"

    if ";" in line:
        return ";"

    return "\t"


def parse_float(value: Any) -> Optional[float]:
    if value is None:
        return None

    value = str(value).strip()

    if not value:
        return None

    try:
        return float(value.replace(",", "."))
    except ValueError:
        return None


def parse_int(value: Any) -> Optional[int]:
    if value is None:
        return None

    value = str(value).strip()

    if not value:
        return None

    try:
        return int(float(value))
    except ValueError:
        return None


def normalize_gender(value: str) -> Optional[str]:
    value = normalize_word(value)

    if value in {"m", "masculine", "masc"}:
        return "m"

    if value in {"f", "feminine", "fem"}:
        return "f"

    return None


def normalize_number(value: str) -> Optional[str]:
    value = normalize_word(value)

    if value in {"s", "singular", "sg"}:
        return "s"

    if value in {"p", "plural", "pl"}:
        return "p"

    return None


def infer_gender_from_lexique(row: Dict[str, str]) -> Optional[str]:
    """
    Lexique contient notamment Genre.

    Selon les versions, la valeur peut être m/f ou autre notation.
    """
    for key in (
        "7_Genre",
        "Genre",
        "genre",
    ):
        if key in row:
            result = normalize_gender(row[key])
            if result:
                return result

    return None


def infer_number_from_lexique(row: Dict[str, str]) -> Optional[str]:
    for key in (
        "8_Nombre",
        "Nombre",
        "nombre",
    ):
        if key in row:
            result = normalize_number(row[key])
            if result:
                return result

    return None


def load_lexique(path: Path) -> Dict[str, Dict[str, Any]]:
    """
    Charge Lexique et indexe par forme normalisée.

    Si plusieurs lignes existent pour une même forme,
    on garde la meilleure fréquence.
    """
    print("[LEXIQUE] Chargement...")

    if not path.exists():
        raise FileNotFoundError(
            f"Fichier Lexique introuvable : {path}"
        )

    with path.open(
        "r",
        encoding="utf-8-sig",
        errors="replace",
        newline=""
    ) as f:

        first_line = f.readline()

        if not first_line:
            raise RuntimeError("Lexique vide.")

        delimiter = detect_delimiter(first_line)

        headers = [
            h.strip()
            for h in first_line.rstrip("\n\r").split(delimiter)
        ]

        print(
            "[LEXIQUE] Colonnes : "
            + ", ".join(headers)
        )

        if "1_Mot" not in headers:
            raise RuntimeError(
                "Impossible de trouver la colonne 1_Mot "
                "dans Lexique."
            )

        print("[LEXIQUE] Colonne mot : 1_Mot")

        index = {
            name: i
            for i, name in enumerate(headers)
        }

        word_index = index["1_Mot"]

        result: Dict[str, Dict[str, Any]] = {}

        total = 0
        retained = 0

        for line in f:
            total += 1

            parts = line.rstrip("\n\r").split(delimiter)

            if len(parts) <= word_index:
                continue

            word = parts[word_index].strip()

            if not valid_word(word):
                continue

            norm = normalize_match(word)

            if not norm:
                continue

            row = {}

            for i, header in enumerate(headers):
                if i < len(parts):
                    row[header] = parts[i].strip()
                else:
                    row[header] = ""

            frequency = (
                parse_float(row.get("10_FreqMot"))
                or parse_float(row.get("11_FreqOrtho"))
                or 0.0
            )

            is_lemma = row.get("14_IsLem", "0").strip()

            candidate = {
                "word": word,
                "lemma": row.get("4_Lemme", "").strip() or word,
                "frequency": frequency,
                "is_lemma": is_lemma,
                "gender": infer_gender_from_lexique(row),
                "number": infer_number_from_lexique(row),
                "lexique": row,
            }

            previous = result.get(norm)

            if previous is None:
                result[norm] = candidate
                retained += 1

            else:
                old_freq = previous.get("frequency", 0.0)
                new_freq = candidate.get("frequency", 0.0)

                # Garder la forme la plus fréquente.
                if new_freq > old_freq:
                    result[norm] = candidate

        print(
            f"[LEXIQUE] {retained:,} formes retenues "
            f"sur {total:,} lignes"
        )

        return result


# ============================================================
# KAIKKI
# ============================================================

def extract_string_list(
    obj: Any,
    key: str = "word",
) -> List[str]:
    """
    Extrait une liste de mots depuis :
        [{"word": "..."}]
    """
    result = []

    if not isinstance(obj, list):
        return result

    for item in obj:
        if isinstance(item, str):
            value = item

        elif isinstance(item, dict):
            value = item.get(key)

        else:
            continue

        if not isinstance(value, str):
            continue

        value = clean_hint(value)

        if value:
            result.append(value)

    return result


def extract_forms(record: Dict[str, Any]) -> List[Tuple[str, List[str]]]:
    """
    Retourne :
        [(forme, tags), ...]
    """
    result = []

    forms = record.get("forms", [])

    if not isinstance(forms, list):
        return result

    for item in forms:
        if not isinstance(item, dict):
            continue

        form = item.get("form")

        if not isinstance(form, str):
            continue

        tags = item.get("tags", [])

        if not isinstance(tags, list):
            tags = []

        tags = [
            str(tag).strip().lower()
            for tag in tags
            if str(tag).strip()
        ]

        result.append((form, tags))

    return result


def extract_senses(record: Dict[str, Any]) -> List[Dict[str, Any]]:
    senses = record.get("senses")

    if not isinstance(senses, list):
        return []

    return [
        sense
        for sense in senses
        if isinstance(sense, dict)
    ]


def extract_relation_words(
    record: Dict[str, Any]
) -> List[Tuple[str, str]]:
    """
    Retourne des relations candidates :

        (mot, type)

    type :
        synonym
        hypernym
        hyponym
    """
    result = []

    for item in record.get("synonyms", []) or []:
        if isinstance(item, dict):
            word = item.get("word")
        elif isinstance(item, str):
            word = item
        else:
            word = None

        if isinstance(word, str):
            result.append((word, "synonym"))

    for item in record.get("hypernyms", []) or []:
        if isinstance(item, dict):
            word = item.get("word")
        elif isinstance(item, str):
            word = item
        else:
            word = None

        if isinstance(word, str):
            result.append((word, "hypernym"))

    for item in record.get("hyponyms", []) or []:
        if isinstance(item, dict):
            word = item.get("word")
        elif isinstance(item, str):
            word = item
        else:
            word = None

        if isinstance(word, str):
            result.append((word, "hyponym"))

    return result


def get_pos(record: Dict[str, Any]) -> str:
    pos = record.get("pos")

    if isinstance(pos, str):
        return pos.strip().lower()

    return ""


def get_record_gender(record: Dict[str, Any]) -> Optional[str]:
    """
    Essaie de récupérer le genre depuis Kaikki.
    """
    head_templates = record.get("head_templates", [])

    if isinstance(head_templates, list):
        for template in head_templates:
            if not isinstance(template, dict):
                continue

            args = template.get("args", {})

            if not isinstance(args, dict):
                continue

            for key in ("1", "gender", "g"):
                value = args.get(key)

                if isinstance(value, str):
                    result = normalize_gender(value)

                    if result:
                        return result

    return None


def tags_to_metadata(
    tags: List[str],
) -> Tuple[Optional[str], Optional[str]]:
    gender = None
    number = None

    for tag in tags:
        tag = tag.lower()

        if tag in {"masculine", "masc"}:
            gender = "m"

        elif tag in {"feminine", "fem"}:
            gender = "f"

        elif tag in {"singular", "sing"}:
            number = "s"

        elif tag in {"plural", "pl"}:
            number = "p"

    return gender, number


def extract_verb_info(
    record: Dict[str, Any],
    form_tags: List[str],
) -> Tuple[
    Optional[str],
    Optional[str],
    Optional[str],
    Optional[str],
]:
    """
    Extraction prudente des informations verbales.

    Retour :
        person
        tense
        mood
        verb_info
    """
    pos = get_pos(record)

    if pos not in {
        "verb",
        "auxiliary verb",
        "aux",
    }:
        return None, None, None, None

    tags = [t.lower() for t in form_tags]

    person = None
    tense = None
    mood = None

    # Tags Kaikki courants.
    for tag in tags:
        if tag in {
            "first-person",
            "1st-person",
            "first-person singular",
            "1st-person singular",
        }:
            person = "1"

        elif tag in {
            "second-person",
            "2nd-person",
            "second-person singular",
            "2nd-person singular",
        }:
            person = "2"

        elif tag in {
            "third-person",
            "3rd-person",
            "third-person singular",
            "3rd-person singular",
        }:
            person = "3"

        # Temps.
        if tag in {
            "present",
            "present indicative",
        }:
            tense = "present"

        elif tag in {"imperfect"}:
            tense = "imperfect"

        elif tag in {
            "future",
            "future indicative",
        }:
            tense = "future"

        elif tag in {
            "past",
            "past historic",
            "passé simple",
        }:
            tense = "past"

        elif tag in {
            "conditional",
        }:
            tense = "conditional"

        elif tag in {
            "past participle",
        }:
            tense = "past_participle"

        # Mode.
        if "indicative" in tag:
            mood = "indicative"

        elif "subjunctive" in tag:
            mood = "subjunctive"

        elif "imperative" in tag:
            mood = "imperative"

        elif "conditional" in tag:
            mood = "conditional"

    verb_info = ",".join(tags)

    return person, tense, mood, verb_info


def extract_kaikki_record(
    record: Dict[str, Any]
) -> Optional[Dict[str, Any]]:
    """
    Transforme une entrée Kaikki en structure interne.
    """
    if record.get("lang_code") != "fr":
        return None

    word = record.get("word")

    if not isinstance(word, str):
        return None

    word = word.strip()

    if not valid_word(word):
        return None

    pos = get_pos(record)

    if not pos:
        return None

    return {
        "word": word,
        "pos": pos,
        "gender": get_record_gender(record),
        "forms": extract_forms(record),
        "senses": extract_senses(record),
        "relations": extract_relation_words(record),
        "raw": record,
    }


# ============================================================
# CHOIX DU HINT
# ============================================================

RELATION_PRIORITY = {
    "synonym": 0,
    "hypernym": 1,
    "hyponym": 2,
}


def hint_score(
    hint: str,
    relation_type: str,
    target_word: str,
) -> Tuple[int, int, int, int]:
    """
    Score de préférence.

    On privilégie :
        1. synonymes
        2. hyperonymes
        3. hyponymes

    Puis :
        - proximité de longueur
        - mots simples
        - indices courts
    """
    relation_score = RELATION_PRIORITY.get(
        relation_type,
        10,
    )

    # Éviter une relation identique au mot.
    same = (
        normalize_match(hint)
        == normalize_match(target_word)
    )

    same_penalty = 100 if same else 0

    # Un indice trop court est souvent peu intéressant.
    length_penalty = abs(len(hint) - len(target_word))

    # Favoriser les mots simples plutôt que des expressions.
    spaces_penalty = hint.count(" ")

    return (
        relation_score,
        same_penalty,
        spaces_penalty,
        length_penalty,
    )


def choose_hint(
    target_word: str,
    relations: List[Tuple[str, str]],
    lexique: Dict[str, Dict[str, Any]],
) -> Optional[str]:
    """
    Choisit un hint français parmi les relations Kaikki.

    Très important :
        le hint doit lui-même être une forme connue de Lexique
        afin de réduire fortement le risque de récupérer une
        relation étrangère ou exotique.
    """
    candidates = []

    seen: Set[str] = set()

    for raw_hint, relation_type in relations:
        hint = clean_hint(raw_hint)

        if not hint:
            continue

        norm = normalize_match(hint)

        if norm in seen:
            continue

        seen.add(norm)

        if norm == normalize_match(target_word):
            continue

        if not valid_hint(hint):
            continue

        if not looks_french(hint):
            continue

        # Le hint doit idéalement exister dans Lexique.
        if norm not in lexique:
            continue

        candidates.append(
            (
                hint_score(
                    hint,
                    relation_type,
                    target_word,
                ),
                hint,
            )
        )

    if not candidates:
        return None

    candidates.sort(key=lambda x: x[0])

    return candidates[0][1]


# ============================================================
# COMPLEXITÉ
# ============================================================

def calculate_complexity(
    word: str,
    frequency: float,
    pos: str,
    hint: Optional[str],
) -> int:
    """
    Complexité heuristique de 1 à 5.

    Ce n'est PAS une donnée lexicale :
    c'est un score interne destiné au jeu.
    """
    score = 1

    size = len(word)

    # Longueur.
    if size >= 5:
        score += 1

    if size >= 8:
        score += 1

    if size >= 11:
        score += 1

    # Fréquence.
    if frequency > 0:
        if frequency < 10:
            score += 1

        elif frequency < 50:
            score += 1

    # POS moins immédiats.
    if pos in {
        "noun",
        "verb",
        "adjective",
    }:
        pass
    else:
        score += 0

    # Hint multi-mot légèrement plus difficile.
    if hint and " " in hint:
        score += 1

    return max(1, min(5, score))


# ============================================================
# CONSTRUCTION DES FORMES
# ============================================================

def build_form_entries(
    kaikki: Dict[str, Any],
    lexique: Dict[str, Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Construit toutes les formes Kaikki qui croisent Lexique.

    Le headword est inclus, ainsi que les formes grammaticales.
    """
    record = extract_kaikki_record(kaikki)

    if record is None:
        return []

    headword = record["word"]

    all_forms: List[Tuple[str, List[str]]] = [
        (headword, [])
    ]

    all_forms.extend(record["forms"])

    result = []

    seen = set()

    for form, tags in all_forms:
        if not isinstance(form, str):
            continue

        form = form.strip()

        if not valid_word(form):
            continue

        norm = normalize_match(form)

        if not norm:
            continue

        if norm in seen:
            continue

        seen.add(norm)

        lex = lexique.get(norm)

        if lex is None:
            continue

        gender, number = tags_to_metadata(tags)

        if gender is None:
            gender = record["gender"]

        if number is None:
            number = lex.get("number")

        if gender is None:
            gender = lex.get("gender")

        person, tense, mood, verb_info = extract_verb_info(
            kaikki,
            tags,
        )

        if verb_info is None:
            verb_info = ""

        # Si la forme est explicitement marquée plural/feminine,
        # enrichir les form_tags.
        form_tags = list(tags)

        if gender == "m" and "masculine" not in form_tags:
            form_tags.append("masculine")

        elif gender == "f" and "feminine" not in form_tags:
            form_tags.append("feminine")

        if number == "s" and "singular" not in form_tags:
            form_tags.append("singular")

        elif number == "p" and "plural" not in form_tags:
            form_tags.append("plural")

        result.append(
            {
                "word": form,
                "lemma": (
                    lex.get("lemma")
                    or headword
                ),
                "pos": record["pos"],
                "gender": gender,
                "number": number,
                "person": person,
                "tense": tense,
                "mood": mood,
                "form_tags": form_tags,
                "verb_info": verb_info,
                "frequency": float(
                    lex.get("frequency") or 0.0
                ),
                "is_lemma": str(
                    lex.get("is_lemma") or "0"
                ),
                "relations": record["relations"],
            }
        )

    return result


# ============================================================
# LECTURE KAIKKI
# ============================================================

def process_kaikki(
    path: Path,
    lexique: Dict[str, Dict[str, Any]],
    target: int,
    min_size: int,
    max_size: int,
) -> List[Dict[str, Any]]:

    print("[KAIKKI] Lecture du dump...")

    if not path.exists():
        raise FileNotFoundError(
            f"Dump Kaikki introuvable : {path}"
        )

    french_entries = 0
    entries_with_relations = 0
    headwords_in_lexique = 0
    crossed_forms = 0
    candidates_count = 0

    results = []

    seen_words: Set[str] = set()

    # DEBUG chat
    debug_chat_done = False

    with path.open(
        "r",
        encoding="utf-8",
        errors="replace",
    ) as f:

        for line_number, line in enumerate(f, 1):

            line = line.strip()

            if not line:
                continue

            try:
                record = json.loads(line)

            except json.JSONDecodeError:
                continue

            if not isinstance(record, dict):
                continue

            if record.get("lang_code") != "fr":
                continue

            french_entries += 1

            word = record.get("word")

            if (
                not debug_chat_done
                and isinstance(word, str)
                and normalize_match(word) == "chat"
            ):
                debug_chat_done = True

                senses = extract_senses(record)

                print(
                    f"[DEBUG] chat : "
                    f"{len(senses)} sens bruts"
                )

                print(
                    "[DEBUG] RECORD :"
                )

                print(
                    json.dumps(
                        {
                            "word": record.get("word"),
                            "lang": record.get("lang"),
                            "lang_code": record.get("lang_code"),
                            "pos": record.get("pos"),
                            "senses_count": len(
                                record.get("senses", [])
                            )
                            if isinstance(
                                record.get("senses"),
                                list,
                            )
                            else 0,
                            "forms_count": len(
                                record.get("forms", [])
                            )
                            if isinstance(
                                record.get("forms"),
                                list,
                            )
                            else 0,
                        },
                        ensure_ascii=False,
                        indent=2,
                    )
                )

            record_data = extract_kaikki_record(record)

            if record_data is None:
                continue

            relations = record_data["relations"]

            if relations:
                entries_with_relations += 1

            # Le headword croise-t-il Lexique ?
            headword = record_data["word"]

            if normalize_match(headword) in lexique:
                headwords_in_lexique += 1

            forms = build_form_entries(
                record,
                lexique,
            )

            if not forms:
                continue

            crossed_forms += len(forms)

            for entry in forms:

                word_form = entry["word"]

                if len(word_form) < min_size:
                    continue

                if len(word_form) > max_size:
                    continue

                norm = normalize_match(word_form)

                if norm in seen_words:
                    continue

                hint = choose_hint(
                    target_word=word_form,
                    relations=relations,
                    lexique=lexique,
                )

                if hint is None:
                    continue

                seen_words.add(norm)

                complexity = calculate_complexity(
                    word=word_form,
                    frequency=entry["frequency"],
                    pos=entry["pos"],
                    hint=hint,
                )

                output = {
                    "word": word_form,
                    "size": len(word_form),
                    "lemma": entry["lemma"],
                    "pos": entry["pos"],
                    "gender": entry["gender"],
                    "number": entry["number"],
                    "person": entry["person"],
                    "tense": entry["tense"],
                    "mood": entry["mood"],
                    "form_tags": entry["form_tags"],
                    "verb_info": entry["verb_info"],
                    "frequency": entry["frequency"],
                    "is_lemma": entry["is_lemma"],
                    "hint_str": hint,
                    "complexity": complexity,
                }

                results.append(output)

                candidates_count += 1

                # On continue à parcourir le fichier jusqu'à la fin
                # pour avoir les meilleurs mots/fréquences ensuite.

    print(
        f"[KAIKKI] {french_entries:,} entrées françaises"
    )

    print(
        f"[KAIKKI] {entries_with_relations:,} entrées "
        f"avec relations lexicales"
    )

    print(
        f"[KAIKKI] {headwords_in_lexique:,} headwords "
        f"trouvés dans Lexique"
    )

    print(
        f"[KAIKKI] {crossed_forms:,} formes croisées "
        f"avec Lexique"
    )

    print(
        f"[KAIKKI] {candidates_count:,} mots candidats "
        f"avec hint français"
    )

    return results


# ============================================================
# DÉDUPLICATION / TRI
# ============================================================

def rank_candidates(
    candidates: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """
    Classe les mots.

    On favorise :
        - fréquence raisonnable
        - variété de longueurs
        - complexité

    La fréquence seule ne doit pas produire 10k mots très courants.
    """
    def score(item: Dict[str, Any]):
        frequency = float(
            item.get("frequency") or 0.0
        )

        size = int(item.get("size") or 0)

        # logarithme de fréquence pour éviter qu'elle domine tout.
        freq_score = math.log10(
            max(frequency, 0.01)
        )

        # Longueurs moyennes légèrement favorisées.
        length_score = min(size, 12) * 0.15

        return (
            -freq_score,
            -length_score,
            item.get("complexity", 3),
            item.get("word", ""),
        )

    return sorted(
        candidates,
        key=score,
    )


def diversify(
    candidates: List[Dict[str, Any]],
    target: int,
) -> List[Dict[str, Any]]:
    """
    Sélection diversifiée par longueur.

    On évite que les premiers milliers soient uniquement
    des mots de 2-5 lettres.
    """
    buckets: Dict[int, List[Dict[str, Any]]] = defaultdict(list)

    for item in candidates:
        buckets[int(item["size"])].append(item)

    sizes = sorted(buckets)

    if not sizes:
        return []

    # Tourniquet entre longueurs.
    result = []

    positions = {
        size: 0
        for size in sizes
    }

    while len(result) < target:

        progressed = False

        for size in sizes:
            items = buckets[size]
            pos = positions[size]

            if pos >= len(items):
                continue

            result.append(items[pos])
            positions[size] += 1
            progressed = True

            if len(result) >= target:
                break

        if not progressed:
            break

    return result


# ============================================================
# VALIDATION
# ============================================================

def validate(
    data: List[Dict[str, Any]],
    target: int,
    min_size: int,
    max_size: int,
) -> None:

    print("[VALIDATION] Contrôle final...")
    print(
        f"  - Nombre d'entrées : "
        f"{len(data):,} / {target:,}"
    )

    errors = []

    seen = set()

    for i, item in enumerate(data):

        word = item.get("word")
        hint = item.get("hint_str")

        if not isinstance(word, str):
            errors.append(
                f"#{i}: word invalide"
            )
            continue

        if not valid_word(word):
            errors.append(
                f"#{i}: mot invalide: {word!r}"
            )

        if not (
            min_size
            <= len(word)
            <= max_size
        ):
            errors.append(
                f"#{i}: longueur invalide: {word!r}"
            )

        norm = normalize_match(word)

        if norm in seen:
            errors.append(
                f"#{i}: doublon: {word!r}"
            )

        seen.add(norm)

        if not isinstance(hint, str):
            errors.append(
                f"#{i}: hint invalide"
            )
            continue

        if not valid_hint(hint):
            errors.append(
                f"#{i}: hint invalide: {hint!r}"
            )

        if not looks_french(hint):
            errors.append(
                f"#{i}: hint suspect: {hint!r}"
            )

        if (
            item.get("size")
            != len(word)
        ):
            errors.append(
                f"#{i}: size incorrect"
            )

    if errors:
        print()
        print("[VALIDATION] ERREURS :")

        for error in errors[:20]:
            print(" -", error)

        if len(errors) > 20:
            print(
                f" ... et {len(errors) - 20} autres"
            )

        raise RuntimeError(
            "Validation échouée."
        )

    if len(data) < target:
        print(
            f"[WARNING] Seulement {len(data):,} "
            f"entrées valides disponibles."
        )

    print("[VALIDATION] OK")


# ============================================================
# SAUVEGARDE
# ============================================================

def save_json(
    path: Path,
    data: List[Dict[str, Any]],
) -> None:

    print(
        f"[SORTIE] Écriture de {len(data):,} "
        f"entrées..."
    )

    with path.open(
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            data,
            f,
            ensure_ascii=False,
            indent=2,
        )

    print(
        f"[SORTIE] {path}"
    )


# ============================================================
# MAIN
# ============================================================

def main():

    parser = argparse.ArgumentParser(
        description=(
            "Agrégateur français "
            "Lexique 4 + Kaikki"
        )
    )

    parser.add_argument(
        "--kaikki",
        type=Path,
        required=True,
        help=(
            "Dump Kaikki JSONL local"
        ),
    )

    parser.add_argument(
        "--lexique",
        type=Path,
        required=True,
        help=(
            "Lexique400.tsv local"
        ),
    )

    parser.add_argument(
        "--output",
        type=Path,
        default=Path(
            "french_words_intermediate.json"
        ),
        help="JSON de sortie",
    )

    parser.add_argument(
        "--target",
        type=int,
        default=DEFAULT_TARGET,
        help=(
            "Nombre d'entrées souhaitées "
            "(défaut: 10000)"
        ),
    )

    parser.add_argument(
        "--min-size",
        type=int,
        default=DEFAULT_MIN_SIZE,
    )

    parser.add_argument(
        "--max-size",
        type=int,
        default=DEFAULT_MAX_SIZE,
    )

    args = parser.parse_args()

    print()
    print("=" * 70)
    print("AGRÉGATEUR FRANÇAIS")
    print("LEXIQUE 4 + KAIKKI")
    print("=" * 70)
    print()

    print(
        f"[OK] Kaikki: {args.kaikki}"
    )

    print(
        f"[OK] Lexique 4: {args.lexique}"
    )

    print()

    # --------------------------------------------------------
    # LEXIQUE
    # --------------------------------------------------------

    lexique = load_lexique(
        args.lexique
    )

    if not lexique:
        raise RuntimeError(
            "Lexique vide après chargement."
        )

    # --------------------------------------------------------
    # KAIKKI
    # --------------------------------------------------------

    candidates = process_kaikki(
        path=args.kaikki,
        lexique=lexique,
        target=args.target,
        min_size=args.min_size,
        max_size=args.max_size,
    )

    if not candidates:
        raise RuntimeError(
            "\n"
            "Aucun candidat trouvé.\n\n"
            "Vérifie notamment :\n"
            "- le dump Kaikki est bien le dump français ;\n"
            "- lang_code vaut bien 'fr' ;\n"
            "- Lexique contient les mêmes formes ;\n"
            "- les relations synonyms/hypernyms/hyponyms "
            "sont présentes ;\n"
            "- les relations courtes existent dans Lexique."
        )

    # --------------------------------------------------------
    # TRI
    # --------------------------------------------------------

    print()
    print("[SÉLECTION] Classement...")

    candidates = rank_candidates(
        candidates
    )

    selected = diversify(
        candidates,
        args.target,
    )

    print(
        f"[SÉLECTION] "
        f"{len(selected):,} entrées"
    )

    # --------------------------------------------------------
    # VALIDATION
    # --------------------------------------------------------

    validate(
        data=selected,
        target=args.target,
        min_size=args.min_size,
        max_size=args.max_size,
    )

    # --------------------------------------------------------
    # OUTPUT
    # --------------------------------------------------------

    save_json(
        args.output,
        selected,
    )

    print()
    print("=" * 70)
    print("[OK] TERMINÉ")
    print("=" * 70)
    print()
    print(
        "Le champ hint_str est actuellement un "
        "indice lexical français provenant des "
        "relations Kaikki."
    )
    print()
    print(
        "Étape suivante : générer de vrais indices "
        "de mots fléchés à partir de ce JSON."
    )
    print()


if __name__ == "__main__":
    try:
        main()

    except KeyboardInterrupt:
        print(
            "\n[INTERRUPTION]"
        )
        sys.exit(130)

    except Exception as exc:
        print(
            f"\n[ERREUR] {exc}",
            file=sys.stderr,
        )
        sys.exit(1)