#!/usr/bin/env bash
# Regenerate the README demo GIF from .github/demo.tape.
#
# The GIF is a recording of examples/demo-decode.mjs (live @boarteam/fix output), so it
# stays correct by construction — re-render it whenever the engine output changes.
#
# Requires VHS (https://github.com/charmbracelet/vhs):  brew install vhs
#
# Usage:  scripts/render-demo.sh
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v vhs >/dev/null 2>&1; then
  echo "error: 'vhs' not found. Install it with 'brew install vhs' (or see https://github.com/charmbracelet/vhs)." >&2
  exit 1
fi

echo "Rendering .github/demo.gif from .github/demo.tape ..."
vhs .github/demo.tape
echo "Done -> .github/demo.gif"
