#!/usr/bin/env bash
# Build the ANSUR dashboard end to end.
#
#   1. Stage 1  - CSV  -> JSON  (tools/build_data.py)
#   2. Stage 2  - statistics    (tools/analyze.py)
#   3. Pack     - JSON  -> JS    (tools/pack_data.py)
#   4. Verify   - statistics    (tools/test_stats.js)
#   5. Verify   - static checks (tools/verify_static.js)
#   6. Render   - static SVG    (tools/render.js, needs node)
#
# Usage: bash tools/build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

NODE_BIN="${NODE_BIN:-node}"

echo "==> Stage 1: ingest data/ansur-full.csv"
python3 -I tools/build_data.py

echo
echo "==> Stage 2: statistics"
python3 -I tools/analyze.py

echo
echo "==> Pack the payloads for the browser"
python3 -I tools/pack_data.py

echo
echo "==> Verify: statistical core"
"$NODE_BIN" tools/test_stats.js

echo
echo "==> Verify: static contract"
"$NODE_BIN" tools/verify_static.js

echo
echo "==> Verify: palette (both modes, all pairs)"
bash tools/check_palette.sh light all
bash tools/check_palette.sh dark all

echo
echo "==> Render: static SVG export"
# The render step executes the vendored d3 bundle. It is opt-in because
# running third-party code from the network is a decision the operator makes:
#   RENDER=1 bash tools/build.sh
if [ "${RENDER:-0}" = "1" ]; then
  "$NODE_BIN" tools/render.js
else
  echo "skipped (set RENDER=1 to run; this step executes the vendored d3 bundle)"
fi

echo
echo "Build complete. Open dist/chart.html in a browser."
