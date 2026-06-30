#!/bin/sh
set -eu

cd "$(dirname "$0")/build"
pake https://1forma.ru \
  --name 1forma \
  --width 1600 \
  --height 1000 \
  --inject ../transition.js
