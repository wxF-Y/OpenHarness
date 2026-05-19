#!/usr/bin/env bash
# HLAgent 开发服务重启脚本
# 用法: bash restart.sh [gateway|web|all]
#   gateway  — 仅重启网关 (port 7779)
#   web      — 仅重启前端 (port 5173)
#   all      — 重启全部 (默认)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATEWAY_DIR="$SCRIPT_DIR/gateway"
WEB_DIR="$SCRIPT_DIR/web"
GATEWAY_PORT=7779
WEB_PORT=5173
GATEWAY_LOG="/tmp/hlagent_gateway.log"
WEB_LOG="/tmp/hlagent_web.log"

TARGET="${1:-all}"

# ---------------------------------------------------------------------------
# Python 解释器检测（优先使用环境变量覆盖）
# ---------------------------------------------------------------------------

if [ -n "${OPENHARNESS_PYTHON:-}" ]; then
  PYTHON="$OPENHARNESS_PYTHON"
elif [ -f "C:/Python314/python.exe" ]; then
  PYTHON="C:/Python314/python.exe"
else
  PYTHON="$(command -v python3 2>/dev/null || command -v python 2>/dev/null || true)"
  if [ -z "$PYTHON" ]; then
    echo "ERROR: Python not found. Set OPENHARNESS_PYTHON env var." >&2
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

kill_port() {
  local port="$1"
  local pid
  pid=$(netstat -ano 2>/dev/null | awk "/LISTENING/ && /:${port}[[:space:]]/{print \$NF}" | head -1)
  if [ -n "$pid" ] && [ "$pid" != "0" ]; then
    echo "  Killing PID $pid on port $port..."
    taskkill //PID "$pid" //F >/dev/null 2>&1 || true
    sleep 0.5
  fi
}

wait_http() {
  local url="$1" label="$2" retries=20
  printf "  Waiting for %s" "$label"
  for i in $(seq 1 $retries); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo " ✓"
      return 0
    fi
    printf "."
    sleep 1
  done
  echo " ✗ (timeout)"
  return 1
}

# ---------------------------------------------------------------------------
# gateway
# ---------------------------------------------------------------------------

restart_gateway() {
  echo "[gateway] Stopping..."
  kill_port $GATEWAY_PORT

  echo "[gateway] Starting (port $GATEWAY_PORT)..."
  # 用子 shell 避免污染当前目录
  (cd "$GATEWAY_DIR" && "$PYTHON" -m uvicorn main:app --host 127.0.0.1 --port $GATEWAY_PORT) \
    >"$GATEWAY_LOG" 2>&1 &
  echo "  PID $! → log: $GATEWAY_LOG"

  wait_http "http://127.0.0.1:${GATEWAY_PORT}/health" "gateway"
}

# ---------------------------------------------------------------------------
# web
# ---------------------------------------------------------------------------

restart_web() {
  echo "[web] Stopping..."
  kill_port $WEB_PORT

  echo "[web] Starting (port $WEB_PORT)..."
  (cd "$WEB_DIR" && npm run dev -- --port $WEB_PORT) >"$WEB_LOG" 2>&1 &
  echo "  PID $! → log: $WEB_LOG"

  local retries=20 started=0
  printf "  Waiting for web"
  for i in $(seq 1 $retries); do
    if grep -q "ready in" "$WEB_LOG" 2>/dev/null; then
      echo " ✓"
      started=1
      break
    fi
    printf "."
    sleep 1
  done

  if [ "$started" -eq 0 ]; then
    echo " ✗ (timeout)"
    return 1
  fi
}

# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------

case "$TARGET" in
  gateway) restart_gateway ;;
  web)     restart_web ;;
  all)
    restart_gateway
    restart_web
    echo ""
    echo "✅ HLAgent is running:"
    echo "   Gateway → http://127.0.0.1:${GATEWAY_PORT}"
    echo "   Web     → http://localhost:${WEB_PORT}"
    ;;
  *)
    echo "Usage: bash restart.sh [gateway|web|all]"
    exit 1
    ;;
esac
