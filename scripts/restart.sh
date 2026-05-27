#!/usr/bin/env bash
# HLAgent — Restart services
# Usage: bash scripts/restart.sh [gateway|web|stop|all]
# Delegates to HLAgent/restart.sh
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/../HLAgent/restart.sh" "${@:-all}"
