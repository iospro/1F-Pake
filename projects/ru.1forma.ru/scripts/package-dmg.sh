#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP_PATH="$ROOT/build/Первая Форма.app"
APP_NAME="Первая Форма.app"
APP_PATH="$ROOT/dist/$APP_NAME"
DMG_PATH="$ROOT/dist/1forma.dmg"
STAGE_DIR="$ROOT/dist/.dmg-stage"
DMGBUILD_SETTINGS="$ROOT/scripts/dmgbuild_settings.py"
DMGBUILD_BIN="$HOME/Library/Python/3.12/bin/dmgbuild"

cleanup() {
  for v in "/Volumes/1forma" "/Volumes/ru.1forma"; do
    /usr/bin/hdiutil detach "$v" -force >/dev/null 2>&1 || true
  done
  /usr/bin/hdiutil info | /usr/bin/awk '/\/Volumes\/dmg\./{print $1}' | while read -r dev; do
    /usr/bin/hdiutil detach "$dev" -force >/dev/null 2>&1 || true
  done
  rm -rf "$STAGE_DIR"
  rm -f "$ROOT/dist"/rw.*.dmg "$ROOT/dist"/*.layout.dmg "$ROOT/dist"/.dmg-rw.dmg
}

if [[ ! -d "$SOURCE_APP_PATH" ]]; then
  echo "Missing app: $SOURCE_APP_PATH" >&2
  echo "Build the app first with ./build-new.sh" >&2
  exit 1
fi

if [[ ! -x "$DMGBUILD_BIN" ]]; then
  echo "Missing dependency: dmgbuild" >&2
  echo "Install once: python3 -m pip install --user dmgbuild" >&2
  exit 1
fi

if [[ ! -f "$DMGBUILD_SETTINGS" ]]; then
  echo "Missing DMG settings: $DMGBUILD_SETTINGS" >&2
  exit 1
fi

trap cleanup EXIT
cleanup
rm -f "$DMG_PATH"
mkdir -p "$STAGE_DIR"
rm -rf "$APP_PATH"
cp -R "$SOURCE_APP_PATH" "$APP_PATH"
cp -R "$APP_PATH" "$STAGE_DIR/"
(
  cd "$ROOT"
  "$DMGBUILD_BIN" -s "$DMGBUILD_SETTINGS" "Первая Форма" "$DMG_PATH"
)

if [[ ! -f "$DMG_PATH" ]]; then
  echo "DMG was not created: $DMG_PATH" >&2
  exit 1
fi

cleanup
echo "DMG ready: $DMG_PATH"
