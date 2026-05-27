#!/usr/bin/env bash
# HLAgent — Start all services
# Delegates to HLAgent/restart.sh which manages the correct ports (gateway:7779, web:5173)
set -euo pipefail
exec bash "$(dirname "${BASH_SOURCE[0]}")/../HLAgent/restart.sh" all
