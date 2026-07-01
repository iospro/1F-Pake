#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")" && pwd)"
BUILD_DIR="$ROOT/build"
APP_STAGING_DIR="$BUILD_DIR/.staging"
DIST_DIR="$ROOT/dist"
PAKE_CLI_ROOT="$ROOT/../.."
PAKE_CLI_ENTRY="$PAKE_CLI_ROOT/dist/cli.js"
APP_SLUG="1forma"
PAKE_OUTPUT_APP="$PAKE_CLI_ROOT/$APP_SLUG.app"
TAURI_ICON_PATH="$PAKE_CLI_ROOT/src-tauri/target/aarch64-apple-darwin/release/icons/$APP_SLUG.icns"
TAURI_DYLIB_PATH="$PAKE_CLI_ROOT/src-tauri/target/aarch64-apple-darwin/release/deps/libapp_lib.dylib"

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

ensure_writable_path() {
  path="$1"
  if [ -e "$path" ] && [ ! -w "$path" ]; then
    chmod u+rw "$path" >/dev/null 2>&1 || true
  fi
  if [ -e "$path" ] && [ ! -w "$path" ]; then
    echo "Missing write access: $path" >&2
    echo "This usually means the file was created with sudo. Fix ownership once:" >&2
    echo "  sudo chown \"$USER\":staff \"$path\"" >&2
    exit 1
  fi
}

remove_app_bundle() {
  if [ -e "$PAKE_OUTPUT_APP" ]; then
    chmod -R u+w "$PAKE_OUTPUT_APP" >/dev/null 2>&1 || true
    rm -rf "$PAKE_OUTPUT_APP"
    if [ -e "$PAKE_OUTPUT_APP" ]; then
      echo "Unable to remove existing app bundle: $PAKE_OUTPUT_APP" >&2
      echo "If it was created with sudo, fix ownership once:" >&2
      echo "  sudo chown -R \"\$USER\":staff \"$PAKE_OUTPUT_APP\"" >&2
      echo "Or delete it manually before rerunning the build." >&2
      exit 1
    fi
  fi
}

remove_stale_generated_files() {
  if [ -e "$TAURI_ICON_PATH" ]; then
    chmod u+rw "$TAURI_ICON_PATH" >/dev/null 2>&1 || true
    rm -f "$TAURI_ICON_PATH"
  fi

  if [ -e "$TAURI_DYLIB_PATH" ]; then
    chmod u+rw "$TAURI_DYLIB_PATH" >/dev/null 2>&1 || true
    rm -f "$TAURI_DYLIB_PATH"
  fi
}

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

ensure_writable_path "$PAKE_CLI_ROOT/src-tauri/src/inject/custom.js"
ensure_writable_path "$PAKE_CLI_ROOT/src-tauri/entitlements.plist"
remove_stale_generated_files

mkdir -p "$BUILD_DIR"
remove_app_bundle
mkdir -p "$APP_STAGING_DIR"

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

rm -rf "$APP_STAGING_DIR/$APP_SLUG.app"
cp -R "$PAKE_OUTPUT_APP" "$APP_STAGING_DIR/$APP_SLUG.app"

cd "$ROOT"
bash ./scripts/postprocess-macos-app.sh

mkdir -p "$DIST_DIR"
rm -rf "$DIST_DIR/Первая Форма.app"
cp -R "$BUILD_DIR/Первая Форма.app" "$DIST_DIR/Первая Форма.app"
