#!/usr/bin/env bash
set -euo pipefail

UUID="save-my-windows@lukastymo.com"
OUT_DIR="dist"
OUT_ZIP="$OUT_DIR/${UUID}.shell-extension.zip"

mkdir -p "$OUT_DIR"

# List ONLY the files/dirs you want at the ZIP root
zip -r "$OUT_ZIP" \
  metadata.json \
  extension.js \
  schemas \
  -x "schemas/gschemas.compiled" \
  -x ".git/*" "dist/*" "node_modules/*" ".idea/*" ".vscode/*"

# sanity check
echo; echo "Contents:"
unzip -l "$OUT_ZIP"
echo; echo "Wrote: $OUT_ZIP"
