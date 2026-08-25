#!/usr/bin/env bash
#
# Affiche les URLs réellement COMPILÉES dans l'app mobile (iOS), et prévient
# si elles ne ressemblent pas à ce qu'on attend.
#
# À quoi ça sert : le bundle iOS est une copie figée de `dist/`. Un simple
# `vite build` (sans `--mode mobile`) écrase `dist/` avec des variables
# d'environnement VIDES — l'app retombe alors sur des chemins relatifs
# (/api, /rt, /ws) qui n'existent pas dans `capacitor://localhost`, et tout
# affiche « Serveur injoignable » sans autre indice. Ce script rend cette
# erreur visible en une commande.
#
#   npm run check:urls

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

BUNDLE_DIR="ios/App/App/public/assets"

if [ ! -d "$BUNDLE_DIR" ]; then
  echo "✗ Aucun bundle iOS ($BUNDLE_DIR). Lance d'abord : npm run cap:sync"
  exit 1
fi

echo "Bundle iOS : $(ls -1 "$BUNDLE_DIR"/index-*.js 2>/dev/null | head -1)"
echo "Compilé le : $(date -r "$(ls -1t "$BUNDLE_DIR"/index-*.js | head -1)" '+%Y-%m-%d %H:%M')"
echo

urls="$(grep -oh "https\?://[a-zA-Z0-9.:-]*\|wss\?://[a-zA-Z0-9.:-]*" "$BUNDLE_DIR"/*.js \
        | grep -v "w3.org\|capacitorjs.com\|reactjs.org" | sort -u || true)"

if [ -z "$urls" ]; then
  echo "✗ AUCUNE URL de backend compilée."
  echo "  L'app utilisera /api, /rt, /ws en relatif → « Serveur injoignable »."
  echo "  Cause probable : un 'vite build' nu a écrasé dist/ avant le sync."
  echo "  Correctif : npm run cap:sync"
  exit 1
fi

echo "URLs de backend compilées :"
echo "$urls" | sed 's/^/  /'
echo

api=$(echo "$urls" | grep -c "^https\?://" || true)
ws=$(echo "$urls" | grep -c "^wss\?://" || true)

if [ "$ws" -eq 0 ]; then
  echo "✗ Pas d'URL temps réel (ws:// ou wss://) : multijoueur, profil et"
  echo "  classement ne répondront pas. Correctif : npm run cap:sync"
  exit 1
fi
if [ "$api" -eq 0 ]; then
  echo "✗ Pas d'URL de grilles (http(s)://) : aucune grille ne chargera."
  echo "  Correctif : npm run cap:sync"
  exit 1
fi

if echo "$urls" | grep -q "localhost\|192\.168\.\|10\.\|127\.0\.0\.1"; then
  echo "⚠ Build LOCAL (serveurs de dev). Ne fonctionne que sur ce réseau,"
  echo "  avec ./run.sh démarré. Pour viser la prod : npm run cap:sync"
else
  echo "✓ Build PRODUCTION — utilisable partout, sans serveur local."
fi
