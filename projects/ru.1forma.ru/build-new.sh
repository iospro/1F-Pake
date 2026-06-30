#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT/build"
DIST_DIR="$ROOT/dist"
PAKE_CLI_ROOT="$ROOT/../.."
PAKE_CLI_ENTRY="$PAKE_CLI_ROOT/dist/cli.js"
APP_SLUG="1forma"
PAKE_OUTPUT_APP="$PAKE_CLI_ROOT/$APP_SLUG.app"

if [ ! -d "$PAKE_CLI_ROOT" ]; then
  echo "Missing local pake-cli repo: $PAKE_CLI_ROOT" >&2
  exit 1
fi

cleanup_local_pake_repo() {
  if [ -d "$PAKE_CLI_ROOT/.git" ]; then
    git -C "$PAKE_CLI_ROOT" restore src-tauri/entitlements.plist src-tauri/src/inject/custom.js >/dev/null 2>&1 || true
    rm -f "$PAKE_CLI_ROOT/src-tauri/icons/$APP_SLUG.icns"
  fi
}

trap cleanup_local_pake_repo EXIT

run_pake_pm() {
  if command -v pnpm >/dev/null 2>&1; then
    (cd "$PAKE_CLI_ROOT" && pnpm "$@")
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    (cd "$PAKE_CLI_ROOT" && corepack pnpm "$@")
    return
  fi

  echo "pnpm or corepack is required to bootstrap local pake-cli" >&2
  exit 1
}

ALLOW_NETWORK_INSTALL="${ALLOW_NETWORK_INSTALL:-0}"

if [ "$ALLOW_NETWORK_INSTALL" = "1" ]; then
  run_pake_pm install
  run_pake_pm run cli:build
else
  if [ ! -d "$PAKE_CLI_ROOT/node_modules" ]; then
    echo "Missing local node_modules in $PAKE_CLI_ROOT; set ALLOW_NETWORK_INSTALL=1 to install them." >&2
    exit 1
  fi

  if [ ! -f "$PAKE_CLI_ENTRY" ]; then
    echo "Missing local CLI bundle at $PAKE_CLI_ENTRY; set ALLOW_NETWORK_INSTALL=1 to build it." >&2
    exit 1
  fi
fi

mkdir -p "$BUILD_DIR"
rm -rf "$PAKE_OUTPUT_APP"

cd "$PAKE_CLI_ROOT"
PAKE_CREATE_APP=1 node "$PAKE_CLI_ENTRY" https://ru.1forma.ru \
  --name "$APP_SLUG" \
  --width 1600 \
  --height 1000 \
  --hide-title-bar \
  --multi-window \
  --camera \
  --microphone \
  --inject "$ROOT/same-window-routes.js"

rm -rf "$BUILD_DIR/$APP_SLUG.app" "$BUILD_DIR/Первая Форма.app"
cp -R "$PAKE_OUTPUT_APP" "$BUILD_DIR/$APP_SLUG.app"

cd "$ROOT"
bash ./scripts/postprocess-macos-app.sh

mkdir -p "$DIST_DIR"
rm -rf "$DIST_DIR/Первая Форма.app"
cp -R "$BUILD_DIR/Первая Форма.app" "$DIST_DIR/Первая Форма.app"
