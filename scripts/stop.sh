#!/usr/bin/env bash
# HLAgent — Stop all services
set -euo pipefail

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/.hlagent-run"

echo -e "${YELLOW}Stopping HLAgent services…${RESET}"

for pid_file in gateway.pid web.pid; do
  PID_PATH="$LOG_DIR/$pid_file"
  if [ -f "$PID_PATH" ]; then
    PID=$(cat "$PID_PATH")
    if kill -0 "$PID" 2>/dev/null; then
      kill "$PID"
      echo -e "${GREEN}  Stopped${RESET} $pid_file (PID $PID)"
    else
      echo -e "  $pid_file (PID $PID) was not running"
    fi
    rm -f "$PID_PATH"
  fi
done

# also kill any uvicorn / vite on default ports as fallback
for port in "${HLAGENT_GATEWAY_PORT:-8000}" "${HLAGENT_WEB_PORT:-5173}"; do
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    kill "$p" 2>/dev/null || true
    echo -e "${GREEN}  Killed${RESET} process on port $port (PID $p)"
  done <<< "$(lsof -ti tcp:"$port" 2>/dev/null || true)"
done

echo -e "${GREEN}Done.${RESET}"
