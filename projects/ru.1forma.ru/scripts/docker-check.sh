#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
IMAGE="${IMAGE:-pake-1forma-check:local}"
DOCKERFILE="${DOCKERFILE:-$ROOT/.docker/check.Dockerfile}"

show_help() {
  cat <<'EOF'
Usage:
  scripts/docker-check.sh [--build] [--shell]

This script runs lightweight container checks for the 1Forma Pake project.
It does not build the macOS .app. macOS/Tauri app builds require macOS and
must use scripts/rebuild-local.sh.

Options:
  --build    Build the local check image before running checks.
  --shell    Open an interactive shell in the check container.
  -h, --help Show this help.

Environment:
  IMAGE      Docker image tag. Default: pake-1forma-check:local
  DOCKERFILE Dockerfile path. Default: .docker/check.Dockerfile
EOF
}

BUILD_IMAGE=0
OPEN_SHELL=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --build)
      BUILD_IMAGE=1
      ;;
    --shell)
      OPEN_SHELL=1
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

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is not installed or not in PATH" >&2
  exit 1
fi

if [ "$BUILD_IMAGE" = "1" ]; then
  echo "[docker-check] building $IMAGE"
  docker build -f "$DOCKERFILE" -t "$IMAGE" "$ROOT"
fi

if [ "$OPEN_SHELL" = "1" ]; then
  docker run --rm -it \
    -v "$ROOT:/work:ro" \
    -w /work \
    "$IMAGE" \
    sh
  exit 0
fi

echo "[docker-check] running JS syntax checks in $IMAGE"
docker run --rm \
  -v "$ROOT:/work:ro" \
  -w /work \
  "$IMAGE" \
  sh -lc 'node --check same-window-routes.js'

echo "[docker-check] done"

