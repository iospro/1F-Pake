#!/bin/bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 INPUT.deb OUTPUT.deb" >&2
  exit 2
fi

INPUT_DEB="$1"
OUTPUT_DEB="$2"

if [[ ! -f "$INPUT_DEB" ]]; then
  echo "Missing input DEB: $INPUT_DEB" >&2
  exit 1
fi

WORKDIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

dpkg-deb -R "$INPUT_DEB" "$WORKDIR/root"

desktop_file=""
while IFS= read -r candidate; do
  desktop_file="$candidate"
  break
done <<EOF
$(find "$WORKDIR/root/usr/share/applications" -maxdepth 1 -name "*.desktop" 2>/dev/null || true)
EOF

if [[ -z "$desktop_file" ]]; then
  echo "No desktop file found inside package" >&2
  exit 1
fi

desktop_dir="$(dirname "$desktop_file")"
target_desktop_file="$desktop_dir/ru.1forma.desktop"

sed -i \
  -e 's/^Name=.*/Name=Первая Форма/' \
  -e 's/^Comment=.*/Comment=desktop client for 1Forma/' \
  -e 's/^Icon=.*/Icon=1forma/' \
  -e 's/^Exec=.*/Exec=1forma/' \
  -e 's/^StartupWMClass=.*/StartupWMClass=1forma/' \
  "$desktop_file"

mv "$desktop_file" "$target_desktop_file"

if [[ -f "$WORKDIR/root/usr/bin/pake-1forma" ]]; then
  ln -sf pake-1forma "$WORKDIR/root/usr/bin/1forma"
fi

if [[ -d "$WORKDIR/root/usr/share/icons" ]]; then
  while IFS= read -r icon_path; do
    icon_dir="$(dirname "$icon_path")"
    icon_base="$(basename "$icon_path")"
    renamed_base="${icon_base/pake-1forma/1forma}"
    renamed_base="${renamed_base/com.pake.1forma/1forma}"
    mv "$icon_path" "$icon_dir/$renamed_base"
  done <<EOF
$(find "$WORKDIR/root/usr/share/icons" -type f \( -name '*pake-1forma*' -o -name '*com.pake.1forma*' \) 2>/dev/null || true)
EOF
fi

while IFS= read -r file; do
  perl -0pi -e 's/com\.pake\.1forma/ru.1forma/g; s/pake-1forma/1forma/g; s/Name=1forma/Name=Первая Форма/g; s/Comment=🤱🏻 Turn any webpage into a desktop app with Rust\./Comment=desktop client for 1Forma/g; s/StartupWMClass=pake-1forma/StartupWMClass=1forma/g; s/Icon=pake-1forma/Icon=1forma/g' "$file"
done <<EOF
$(find "$WORKDIR/root" -type f \( -name '*.desktop' -o -name '*.service' -o -name '*.json' -o -name '*.ini' -o -name '*.txt' \) 2>/dev/null || true)
EOF

dpkg-deb -b "$WORKDIR/root" "$OUTPUT_DEB" >/dev/null

echo "Patched DEB: $OUTPUT_DEB"
