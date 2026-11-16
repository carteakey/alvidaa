#!/usr/bin/env bash
# Builds shotconv for the TV: static 32-bit ARM (armhf), no dependencies on the
# TV. Fetches stb_image / stb_image_write (public domain) at a pinned commit and
# checks their sha256 first; they are not vendored into this repo.
#
# Needs: arm-linux-gnueabihf-gcc (Debian/Ubuntu: gcc-arm-linux-gnueabihf), curl.
# For a quick host build to compare against ffmpeg: HOST=1 ./build.sh
set -euo pipefail
cd "$(dirname "$0")"
STB=c16853e213f8452670d8ca2cc96c76e80d5144db   # nothings/stb, 2026-10-30
fetch() {
  [ -f "$1" ] || curl -fsS -o "$1" "https://raw.githubusercontent.com/nothings/stb/$STB/$1"
  echo "$2  $1" | sha256sum -c --quiet || { echo "checksum mismatch: $1" >&2; rm -f "$1"; exit 1; }
}
fetch stb_image.h       58e0521d7072fcbbb8cb9048ac0056a5908f00bc159c93757a43d22d63f5b904
fetch stb_image_write.h 158a962aeaa13064470cc741dee03c7815b4c9ec45c12b115de4899074ebc38a
if [ "${HOST:-0}" = 1 ]; then
  cc -O2 -o shotconv-host shotconv.c -lm && echo "built shotconv-host"
else
  arm-linux-gnueabihf-gcc -O2 -march=armv7-a -mfpu=neon -mfloat-abi=hard -static -s \
    -o shotconv-armhf shotconv.c -lm
  file shotconv-armhf
fi
