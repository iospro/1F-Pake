#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_APP_PATH="$ROOT/build/1forma.app"
TARGET_APP_PATH="$ROOT/build/Первая Форма.app"
APP_PATH="$TARGET_APP_PATH"
PLIST_PATH="$APP_PATH/Contents/Info.plist"
ENTITLEMENTS_PATH="$ROOT/scripts/macos-entitlements.plist"
PLIST_BUDDY="/usr/libexec/PlistBuddy"

if [[ ! -d "$SOURCE_APP_PATH" ]]; then
  echo "Missing app: $SOURCE_APP_PATH" >&2
  echo "Build the app first with ./build-new.sh" >&2
  exit 1
fi

rm -rf "$TARGET_APP_PATH"
mv "$SOURCE_APP_PATH" "$TARGET_APP_PATH"

if [[ ! -f "$PLIST_PATH" ]]; then
  echo "Missing Info.plist: $PLIST_PATH" >&2
  exit 1
fi

if [[ ! -f "$ENTITLEMENTS_PATH" ]]; then
  echo "Missing entitlements file: $ENTITLEMENTS_PATH" >&2
  exit 1
fi

set_plist_value() {
  local key="$1"
  local type="$2"
  local value="$3"

  "$PLIST_BUDDY" -c "Delete :$key" "$PLIST_PATH" >/dev/null 2>&1 || true
  "$PLIST_BUDDY" -c "Add :$key $type $value" "$PLIST_PATH"
}

set_plist_value "CFBundleDisplayName" "string" "Первая Форма"
set_plist_value "CFBundleName" "string" "Первая Форма"
set_plist_value "CFBundleSpokenName" "string" "Первая Форма"
set_plist_value "NSCameraUsageDescription" "string" "Первая Форма использует камеру для видеозвонков и ВКС."
set_plist_value "NSMicrophoneUsageDescription" "string" "Первая Форма использует микрофон для видеозвонков и ВКС."
set_plist_value "NSLocationUsageDescription" "string" "Первая Форма может использовать геолокацию для функций портала, если они будут включены."

codesign --force --sign - --entitlements "$ENTITLEMENTS_PATH" "$APP_PATH"

echo "Postprocess complete: $APP_PATH"
