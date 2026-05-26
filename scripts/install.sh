#!/usr/bin/env bash
# HLAgent Installer — Linux / macOS / WSL
# Usage: bash scripts/install.sh [--no-venv] [--dev]
set -euo pipefail

# ── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { echo -e "${BLUE}[INFO]${RESET}  $*"; }
ok()      { echo -e "${GREEN}[OK]${RESET}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${RESET}  $*"; }
die()     { echo -e "${RED}[ERROR]${RESET} $*" >&2; exit 1; }
section() { echo -e "\n${BOLD}── $* ──${RESET}"; }

# ── options ───────────────────────────────────────────────────────────────────
USE_VENV=true
INSTALL_DEV=false
for arg in "$@"; do
  case "$arg" in
    --no-venv) USE_VENV=false ;;
    --dev)     INSTALL_DEV=true ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="$REPO_ROOT/.venv"

echo -e "${BOLD}"
echo "  ╔══════════════════════════════════╗"
echo "  ║     HLAgent Installer            ║"
echo "  ╚══════════════════════════════════╝"
echo -e "${RESET}"

# ── 1. Check prerequisites ────────────────────────────────────────────────────
section "Checking prerequisites"

# Python
PYTHON_BIN=""
for py in python3.12 python3.11 python3.10 python3 python; do
  if command -v "$py" &>/dev/null; then
    if "$py" -c "import sys; sys.exit(0 if sys.version_info >= (3,10) else 1)" 2>/dev/null; then
      VER=$("$py" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')
      PYTHON_BIN="$py"; break
    fi
  fi
done
[ -z "$PYTHON_BIN" ] && die "Python >= 3.10 not found. Install it from https://python.org"
ok "Python $VER  ($PYTHON_BIN)"

# Node.js
if ! command -v node &>/dev/null; then
  die "Node.js >= 18 not found. Install it from https://nodejs.org"
fi
NODE_VER=$(node --version | sed 's/v//')
NODE_MAJOR="${NODE_VER%%.*}"
[ "$NODE_MAJOR" -lt 18 ] && die "Node.js >= 18 required (found $NODE_VER)"
ok "Node.js v$NODE_VER"

# npm
if ! command -v npm &>/dev/null; then
  die "npm not found. It should come with Node.js."
fi
ok "npm $(npm --version)"

# pip / uv
USE_UV=false
if command -v uv &>/dev/null; then
  USE_UV=true
  ok "uv $(uv --version | awk '{print $2}')"
else
  warn "uv not found — falling back to pip. Install uv for faster installs: https://docs.astral.sh/uv/"
  if ! command -v pip &>/dev/null && ! command -v pip3 &>/dev/null; then
    die "pip not found. Install pip or uv."
  fi
  PIP_BIN=$(command -v pip3 || command -v pip)
  ok "pip ($PIP_BIN)"
fi

# ── 2. Virtual environment ────────────────────────────────────────────────────
section "Python virtual environment"

if $USE_VENV; then
  if [ ! -d "$VENV_DIR" ]; then
    info "Creating virtualenv at $VENV_DIR"
    "$PYTHON_BIN" -m venv "$VENV_DIR"
  else
    info "Reusing existing virtualenv at $VENV_DIR"
  fi
  # shellcheck disable=SC1091
  source "$VENV_DIR/bin/activate"
  PYTHON_BIN="$VENV_DIR/bin/python"
  PIP_BIN="$VENV_DIR/bin/pip"
  ok "Virtualenv activated"
else
  warn "Skipping virtualenv (--no-venv)"
fi

# ── 3. Install Python packages ────────────────────────────────────────────────
section "Installing Python packages"

install_pkg() {
  local label="$1"; shift
  info "Installing $label…"
  if $USE_UV && ! $USE_VENV; then
    uv pip install "$@"
  elif $USE_UV && $USE_VENV; then
    uv pip install --python "$PYTHON_BIN" "$@"
  else
    "$PIP_BIN" install --quiet "$@"
  fi
  ok "$label installed"
}

# Core engine (editable from repo root)
install_pkg "openharness-ai" -e "$REPO_ROOT"

# HLAgent SDK (editable)
install_pkg "hlagent-sdk" -e "$REPO_ROOT/HLAgent/sdk"

# Gateway and its dependencies (editable)
install_pkg "hlagent-gateway" -e "$REPO_ROOT/HLAgent/gateway"

if $INSTALL_DEV; then
  install_pkg "dev extras" -e "$REPO_ROOT[dev]"
fi

# ── 4. Build Web frontend ──────────────────────────────────────────────────────
section "Building Web frontend"

WEB_DIR="$REPO_ROOT/HLAgent/web"

if [ ! -d "$WEB_DIR/node_modules" ]; then
  info "Running npm install…"
  npm --prefix "$WEB_DIR" install --silent
  ok "npm install complete"
else
  info "node_modules exists — skipping npm install (run 'npm install' manually to update)"
fi

# Build only when dist/ is absent or stale
if [ ! -d "$WEB_DIR/dist" ]; then
  info "Building frontend (npm run build)…"
  npm --prefix "$WEB_DIR" run build
  ok "Frontend built → $WEB_DIR/dist"
else
  warn "dist/ already exists — skipping build. Run 'npm --prefix HLAgent/web run build' to rebuild."
fi

# ── Done ───────────────────────────────────────────────────────────────────────
echo -e "\n${GREEN}${BOLD}✓ HLAgent installed successfully!${RESET}\n"
echo -e "  Start all services:     ${BOLD}bash scripts/start.sh${RESET}"
echo -e "  Start with Docker:      ${BOLD}cd HLAgent && docker-compose up${RESET}"
echo -e "  Open browser:           ${BOLD}http://localhost:5173${RESET}"
echo -e "  Gateway API docs:       ${BOLD}http://localhost:8000/docs${RESET}"
echo ""
