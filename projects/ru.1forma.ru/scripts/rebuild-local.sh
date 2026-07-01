#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

show_help() {
  cat <<'EOF'
Usage:
  scripts/rebuild-local.sh [--install] [--dmg]

Options:
  --install   Allow build-new.sh to run pnpm install / cli:build when local deps are missing.
  --dmg       Package dist/Первая Форма.dmg after the .app rebuild.
  -h, --help  Show this help.

Examples:
  scripts/rebuild-local.sh
  scripts/rebuild-local.sh --install
  scripts/rebuild-local.sh --dmg
EOF
}

ALLOW_INSTALL=0
PACKAGE_DMG=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --install)
      ALLOW_INSTALL=1
      ;;
    --dmg)
      PACKAGE_DMG=1
      ;;
    -h|--help)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      show_help >&2
      exit 2
      ;;
  esac
  shift
done

cd "$ROOT"

if [ "$ALLOW_INSTALL" = "0" ] && { [ ! -d "../../node_modules" ] || [ ! -f "../../dist/cli.js" ]; }; then
  echo "[rebuild-local] bootstrapping pake-cli because local bundle or dependencies are missing"
  ALLOW_INSTALL=1
fi

echo "[rebuild-local] project: $ROOT"
echo "[rebuild-local] rebuilding macOS app"

ALLOW_NETWORK_INSTALL="$ALLOW_INSTALL" bash ./build-new.sh

if [ "$PACKAGE_DMG" = "1" ]; then
  echo "[rebuild-local] packaging DMG"
  bash ./scripts/package-dmg.sh
fi

echo "[rebuild-local] done"
