#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="$ROOT/build/.staging/1forma.app"
DMGBUILD_BIN="$HOME/Library/Python/3.12/bin/dmgbuild"
NOTARY_KEY_PATH="/Users/malex/Work/1Forma/CI/Сборка Electron/AuthKey_A8R92JBBQB.p8"
NOTARY_KEY_ID="A8R92JBBQB"
NOTARY_ISSUER_ID="69a6de77-ec36-47e3-e053-5b8c7c11a4d1"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing app: $APP_PATH" >&2
  echo "Build the app first with ./build-new.sh" >&2
  exit 1
fi

if [[ ! -x "$DMGBUILD_BIN" ]]; then
  echo "Missing dependency: dmgbuild" >&2
  echo "Install once: python3 -m pip install --user dmgbuild" >&2
  exit 1
fi

if [[ ! -f "$NOTARY_KEY_PATH" ]]; then
  echo "Missing notarization key: $NOTARY_KEY_PATH" >&2
  exit 1
fi

if ! xcrun notarytool --help >/dev/null 2>&1; then
  echo "Missing dependency: xcrun notarytool" >&2
  exit 1
fi

echo "Preflight OK:"
echo "- app=$APP_PATH"
echo "- dmgbuild=$DMGBUILD_BIN"
echo "- notary_key=$NOTARY_KEY_PATH"
echo "- notary_key_id=$NOTARY_KEY_ID"
echo "- notary_issuer_id=$NOTARY_ISSUER_ID"
