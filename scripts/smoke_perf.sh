#!/usr/bin/env bash
set -euo pipefail

BASE="${1:-http://localhost:3000}"
echo "Checking $BASE/api/health..."
time curl -sf "$BASE/api/health" >/dev/null
echo "OK"
