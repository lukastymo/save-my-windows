#!/usr/bin/env bash
# Ultra-minimal installer for a GNOME Shell extension
# Usage:
#   ./install.sh              # install for current user (~/.local/…)
#   sudo ./install.sh --system   # install system-wide (/usr/share/…)

set -euo pipefail

UUID="save-my-windows@lukastymo.com"
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"

USER_DIR="$HOME/.local/share/gnome-shell/extensions/$UUID"
SYSTEM_DIR="/usr/share/gnome-shell/extensions/$UUID"
DEST="$USER_DIR"

if [[ "${1:-}" == "--system" ]]; then
  if [[ $EUID -ne 0 ]]; then
    echo "System install requires sudo: sudo $0 --system" >&2
    exit 1
  fi
  DEST="$SYSTEM_DIR"
fi

echo "Installing \"$UUID\" to: $DEST"
mkdir -p "$DEST"

# Copy only essential files
cp "$ROOT/metadata.json" "$DEST/"
cp "$ROOT/extension.js" "$DEST/"

# Compile schemas if present
if [[ -d "$ROOT/schemas" ]]; then
  mkdir -p "$DEST/schemas"
  cp "$ROOT/schemas/"*.gschema.xml "$DEST/schemas/" 2>/dev/null || true
  if command -v glib-compile-schemas >/dev/null 2>&1; then
    echo "Compiling GSettings schemas…"
    glib-compile-schemas "$DEST/schemas"
  fi
fi

# Enable extension (per-user)
if command -v gnome-extensions >/dev/null 2>&1; then
  if [[ "${1:-}" == "--system" && -n "${SUDO_USER:-}" ]]; then
    # System install: enable for the desktop user who ran sudo
    sudo -u "$SUDO_USER" gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
  else
    # User install: enable for current user
    gnome-extensions enable "$UUID" >/dev/null 2>&1 || true
  fi
fi

echo "Done. If changes don’t show, restart GNOME Shell (Wayland: log out/in; Xorg: Alt+F2 then 'r')."
