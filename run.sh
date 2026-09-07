#!/usr/bin/env bash
#
# Lance (ou arrête) les trois services nécessaires en développement local :
#   web       Vite (front)                        :5173
#   realtime  Serveur temps réel des parties       :8080  (server/websocket/index.js)
#   puzzles   Service de remplissage des grilles   :8787  (Python, stdlib seul)
#
# Chacun tourne en arrière-plan (nohup), sa sortie va dans logs/<nom>.log.
# Relancer le script quand un service est déjà debout ne fait rien (repéré
# par le port en écoute) : sûr à exécuter plusieurs fois de suite.
#
# Usage :
#   ./run.sh [start|stop|restart|status]   # start par défaut

set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

ROOT="$PWD"
LOG_DIR="$ROOT/logs"
mkdir -p "$LOG_DIR"

port_pid() {
  lsof -ti ":$1" -sTCP:LISTEN 2>/dev/null || true
}

start_one() {
  local name="$1" port="$2" cwd="$3"
  shift 3
  local pid
  pid="$(port_pid "$port")"
  if [ -n "$pid" ]; then
    echo "  ✓ $name déjà en écoute sur :$port (pid $pid)"
    return
  fi
  ( cd "$ROOT/$cwd" && nohup "$@" >"$LOG_DIR/$name.log" 2>&1 & )
  # jusqu'à 8s par pas de 0.5s : "realtime" fait maintenant un aller-retour
  # réseau vers Postgres au démarrage (schéma + rechargement), plus lent
  # qu'un simple bind de port — un sleep fixe trop court le déclarait "pas
  # démarré" alors qu'il continuait de charger juste après le contrôle.
  for _ in $(seq 1 16); do
    pid="$(port_pid "$port")"
    [ -n "$pid" ] && break
    sleep 0.5
  done
  if [ -n "$pid" ]; then
    echo "  ✓ $name démarré sur :$port (pid $pid) — log: logs/$name.log"
  else
    echo "  ✗ $name n'a pas démarré — voir logs/$name.log"
  fi
}

stop_one() {
  local name="$1" port="$2"
  local pid
  pid="$(port_pid "$port")"
  if [ -z "$pid" ]; then
    echo "  – $name : rien sur :$port"
    return
  fi
  if ! kill "$pid" 2>/dev/null; then
    echo "  ✗ impossible d'arrêter $name (pid $pid)"
    return
  fi
  # Attend que le port se libère pour de vrai avant de rendre la main :
  # "realtime" reçoit SIGTERM puis fait un aller-retour réseau (instantané
  # Postgres) avant de sortir — un `kill` suivi d'un retour immédiat laissait
  # `restart` relancer pendant que l'ancien process terminait encore, et
  # `start_one` prenait alors ce dernier souffle pour "déjà en écoute".
  local encore
  for _ in $(seq 1 16); do
    encore="$(port_pid "$port")"
    [ -z "$encore" ] && break
    sleep 0.5
  done
  if [ -n "$encore" ]; then
    echo "  ✗ $name (pid $pid) ne s'est pas arrêté à temps"
  else
    echo "  ✓ $name arrêté (pid $pid)"
  fi
}

status_one() {
  local name="$1" port="$2"
  local pid
  pid="$(port_pid "$port")"
  if [ -n "$pid" ]; then
    echo "  ✓ $name — :$port (pid $pid)"
  else
    echo "  – $name — :$port (arrêté)"
  fi
}

cmd="${1:-start}"

case "$cmd" in
  start)
    echo "Démarrage des services locaux…"
    start_one "web"      5173 "."                        npm run dev
    # cwd = server/ (et non server/websocket/) : le serveur écrit ses
    # instantanés dans « ./data », donc dans server/data — là où vivent les
    # comptes et profils réels. Lancé depuis server/websocket il repartirait
    # sur la copie périmée server/websocket/data.
    start_one "realtime" 8080 "server"                    node websocket/index.js
    start_one "puzzles"  8787 "scripts/grid_generation"   python3 serve_puzzles.py --host 0.0.0.0
    echo
    echo "Front       http://localhost:5173"
    echo "Grilles     http://localhost:8787/health"
    echo "Temps réel  ws://localhost:8080 (proxifié via /ws et /rt en dev, voir vite.config.ts)"
    echo
    echo "Logs dans logs/. Pour arrêter : ./run.sh stop"
    ;;
  stop)
    echo "Arrêt des services locaux…"
    stop_one "web" 5173
    stop_one "realtime" 8080
    stop_one "puzzles" 8787
    ;;
  restart)
    "$0" stop
    sleep 1
    "$0" start
    ;;
  status)
    status_one "web" 5173
    status_one "realtime" 8080
    status_one "puzzles" 8787
    ;;
  *)
    echo "Usage: $0 [start|stop|restart|status]" >&2
    exit 1
    ;;
esac
