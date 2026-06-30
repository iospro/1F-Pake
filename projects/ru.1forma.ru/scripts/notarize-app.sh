#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH="$ROOT/build/1forma.app"
ZIP_PATH="$ROOT/dist/1forma-notarize.zip"
NOTARY_KEY_PATH="${1:-/Users/malex/Work/1Forma/CI/Сборка Electron/AuthKey_A8R92JBBQB.p8}"
NOTARY_KEY_ID="${NOTARY_KEY_ID:-A8R92JBBQB}"
NOTARY_ISSUER_ID="${NOTARY_ISSUER_ID:-69a6de77-ec36-47e3-e053-5b8c7c11a4d1}"

"$ROOT/scripts/preflight-notarization.sh"

if [[ ! -d "$APP_PATH" ]]; then
  echo "Missing app: $APP_PATH" >&2
  echo "Build the app first with ./build-new.sh" >&2
  exit 1
fi

rm -f "$ZIP_PATH"
/usr/bin/ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"

xcrun notarytool submit \
  "$ZIP_PATH" \
  --key "$NOTARY_KEY_PATH" \
  --key-id "$NOTARY_KEY_ID" \
  --issuer "$NOTARY_ISSUER_ID" \
  --wait
xcrun stapler staple "$APP_PATH"
spctl --assess --type exec --verbose "$APP_PATH"

echo "Notarization complete and stapled: $APP_PATH"
