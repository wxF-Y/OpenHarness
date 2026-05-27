#!/usr/bin/env bash
# HLAgent — Stop all services
# Delegates to HLAgent/restart.sh stop
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/../HLAgent/restart.sh" stop
