#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# Foci Dashboard Desktop - Developer Launch Script (macOS / Linux)
# -----------------------------------------------------------------------------

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"

echo "========================================="
echo "      Foci Dashboard Desktop (Dev)        "
echo "========================================="

if [ ! -d "$ROOT_DIR/server/node_modules" ]; then
    echo "[*] Installing dependencies..."
    npm --prefix "$ROOT_DIR" install
fi

cd "$ROOT_DIR"
npm start
