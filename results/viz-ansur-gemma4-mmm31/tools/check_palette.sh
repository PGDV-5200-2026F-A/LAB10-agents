#!/usr/bin/env bash
# Run the dataviz palette validator for the categorical slots this dashboard
# uses: slot 1 (F), slot 2 (M) and slot 3 (the missing-values measure).
#
# The scatter plot puts any two marks side by side, so the binding test is
# --pairs all, not the default adjacent pairlist.
#
# Usage: check_palette.sh [light|dark] [all|adjacent]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NODE_BIN="${NODE_BIN:-node}"
MODE="${1:-light}"
PAIRS="${2:-all}"

if [ "$MODE" = "dark" ]; then
  PALETTE="#3987e5,#d95926,#199e70"; SURFACE="#1a1a19"
else
  PALETTE="#2a78d6,#eb6834,#1baf7a"; SURFACE="#fcfcfb"
fi

"$NODE_BIN" "$HERE/palette/validate_palette.js" \
  "$PALETTE" --mode "$MODE" --surface "$SURFACE" --pairs "$PAIRS"
