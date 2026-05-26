#!/usr/bin/env bash
# HLAgent — Start all services (Linux / macOS / WSL)
# Usage: bash scripts/start.sh [--port-gateway 8000] [--port-web 5173] [--no-open]
set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'
BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
ok()      { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }

# ── defaults ──────────────────────────────────────────────────────────────────
GATEWAY_PORT="${HLAGENT_GATEWAY_PORT:-8000}"
WEB_PORT="${HLAGENT_WEB_PORT:-5173}"
OPEN_BROWSER=true

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port-gateway) GATEWAY_PORT="$2"; shift 2 ;;
    --port-web)     WEB_PORT="$2";     shift 2 ;;
    --no-open)      OPEN_BROWSER=false; shift ;;
    *) shift ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATEWAY_DIR="$REPO_ROOT/HLAgent/gateway"
WEB_DIR="$REPO_ROOT/HLAgent/web"
VENV_DIR="$REPO_ROOT/.venv"
LOG_DIR="$REPO_ROOT/.hlagent-run"

mkdir -p "$LOG_DIR"

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════╗"
echo "  ║       HLAgent — Starting         ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${RESET}"

# ── activate virtualenv if present ───────────────────────────────────────────
if [ -f "$VENV_DIR/bin/activate" ]; then
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  info "Virtualenv activated: $VENV_DIR"
fi

# ── choose how to serve the frontend ─────────────────────────────────────────
# Prefer the pre-built dist/ (production).  Fall back to vite dev server.
if [ -d "$WEB_DIR/dist" ]; then
  SERVE_MODE="static"
else
  SERVE_MODE="dev"
  if ! command -v npm &>/dev/null; then
    echo -e "\033[0;31m[ERROR]\033[0m npm not found — cannot start web dev server." >&2
    exit 1
  fi
fi

# ── stop any lingering processes on those ports ───────────────────────────────
_kill_port() {
  local port="$1"
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    warn "Port $port in use (PID $p) — killing old process"
    kill "$p" 2>/dev/null || true
  done <<< "$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  sleep 0.3
}
_kill_port "$GATEWAY_PORT"
_kill_port "$WEB_PORT"

# ── start Gateway ──────────────────────────────────────────────────────────────
info "Starting Gateway on port $GATEWAY_PORT…"
GATEWAY_LOG="$LOG_DIR/gateway.log"
(
  cd "$GATEWAY_DIR"
  export HLAGENT_GATEWAY_PORT="$GATEWAY_PORT"
  uvicorn main:app \
    --host 127.0.0.1 \
    --port "$GATEWAY_PORT" \
    --log-level info \
    > "$GATEWAY_LOG" 2>&1
) &
GATEWAY_PID=$!
echo "$GATEWAY_PID" > "$LOG_DIR/gateway.pid"
ok "Gateway started (PID $GATEWAY_PID)  →  log: $GATEWAY_LOG"

# wait for gateway to be ready (up to 15 s)
info "Waiting for Gateway to become ready…"
for i in $(seq 1 30); do
  if curl -sf "http://localhost:$GATEWAY_PORT/health" &>/dev/null; then
    ok "Gateway is ready"
    break
  fi
  sleep 0.5
  if [ "$i" -eq 30 ]; then
    warn "Gateway did not respond in time — check $GATEWAY_LOG"
  fi
done

# ── start Web frontend ────────────────────────────────────────────────────────
WEB_LOG="$LOG_DIR/web.log"

if [ "$SERVE_MODE" = "static" ]; then
  info "Serving pre-built frontend with Python static server on port $WEB_PORT…"
  (
    cd "$WEB_DIR/dist"
    python3 -m http.server "$WEB_PORT" > "$WEB_LOG" 2>&1
  ) &
  WEB_PID=$!
  echo "$WEB_PID" > "$LOG_DIR/web.pid"
  ok "Static server started (PID $WEB_PID)"
else
  info "Starting Vite dev server on port $WEB_PORT…"
  (
    cd "$WEB_DIR"
    VITE_GATEWAY_URL="http://localhost:$GATEWAY_PORT" \
    npm run dev -- --port "$WEB_PORT" > "$WEB_LOG" 2>&1
  ) &
  WEB_PID=$!
  echo "$WEB_PID" > "$LOG_DIR/web.pid"
  ok "Vite dev server started (PID $WEB_PID)"
fi

# ── open browser ──────────────────────────────────────────────────────────────
APP_URL="http://localhost:$WEB_PORT"
if $OPEN_BROWSER; then
  sleep 1
  if command -v xdg-open &>/dev/null; then
    xdg-open "$APP_URL" &>/dev/null &
  elif command -v open &>/dev/null; then
    open "$APP_URL"
  fi
fi

# ── summary ───────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}HLAgent is running!${RESET}"
echo ""
echo -e "  Web UI:        ${BOLD}$APP_URL${RESET}"
echo -e "  Gateway API:   ${BOLD}http://localhost:$GATEWAY_PORT${RESET}"
echo -e "  API Docs:      ${BOLD}http://localhost:$GATEWAY_PORT/docs${RESET}"
echo ""
echo -e "  Gateway log:   $GATEWAY_LOG"
echo -e "  Web log:       $WEB_LOG"
echo ""
echo -e "  To stop:       ${BOLD}bash scripts/stop.sh${RESET}   or   Ctrl+C"
echo ""

# ── trap Ctrl+C for clean shutdown ────────────────────────────────────────────
_shutdown() {
  echo -e "\n${YELLOW}Shutting down…${RESET}"
  kill "$GATEWAY_PID" "$WEB_PID" 2>/dev/null || true
  rm -f "$LOG_DIR/gateway.pid" "$LOG_DIR/web.pid"
  echo -e "${GREEN}Done.${RESET}"
  exit 0
}
trap _shutdown INT TERM

# keep script alive (parent of background processes)
wait
