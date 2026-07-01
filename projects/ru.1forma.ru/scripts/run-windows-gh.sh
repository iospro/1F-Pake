#!/bin/sh
set -eu

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKFLOW="ru-1forma-windows.yml"
BRANCH="1f"

cd "$ROOT"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "[run-windows-gh] working tree is not clean" >&2
  git status --short >&2
  exit 1
fi

echo "[run-windows-gh] triggering $WORKFLOW on $BRANCH"
gh workflow run "$WORKFLOW" --ref "$BRANCH"

before_id="$(gh run list --workflow="$WORKFLOW" --branch="$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"

run_id=""
i=0
while [ "$i" -lt 30 ]; do
  latest_id="$(gh run list --workflow="$WORKFLOW" --branch="$BRANCH" --limit 1 --json databaseId -q '.[0].databaseId' 2>/dev/null || true)"
  if [ -n "$latest_id" ] && [ "$latest_id" != "$before_id" ]; then
    run_id="$latest_id"
    break
  fi
  i=$((i + 1))
  sleep 2
done

if [ -z "$run_id" ]; then
  echo "[run-windows-gh] could not detect new run id automatically" >&2
  echo "[run-windows-gh] open the workflow page and use gh run list manually" >&2
  exit 1
fi

echo "[run-windows-gh] run id: $run_id"
echo "[run-windows-gh] web: https://github.com/iospro/1F-Pake/actions/runs/$run_id"
echo "[run-windows-gh] live log:"
gh run watch "$run_id"
