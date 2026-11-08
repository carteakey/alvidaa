#!/bin/bash
# Build static-PIE aarch64 dropbear (2026.94) per the a6q recipe, zig-cc
# cross-hosted on macOS. Products: dropbear, dropbearkey, dbclient,
# dropbearconvert (stripped, zero DT_NEEDED).
#
#   tools/e7qtuk/dropbear-build.sh /tmp/e7q-build/dropbear /tmp/e7q-tvtools
#
# Prereqs (brew):
#   zig                      # cc cross (target aarch64-linux-musl)
#   binutils                 # GNU ar/ranlib — LLVM ar skips ELF members
set -euo pipefail

SRC="${1:-/tmp/e7q-build/dropbear}"
OUT="${2:-/tmp/e7q-tvtools}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ZIG_CC_TMP="$(dirname "$SRC")"
CCWRAP="$ZIG_CC_TMP/cc-wrapper.sh"
GAR="$(brew --prefix binutils)/bin/gar"
GRANLIB="$(brew --prefix binutils)/bin/granlib"
GREaDELF="$(brew --prefix binutils)/bin/greadelf"

[ -d "$SRC" ] || { echo "clone first: git clone -b DROPBEAR_2026.94 github.com/mkj/dropbear"; exit 1; }
cat > "$CCWRAP" <<'EOF'
#!/bin/sh
exec zig cc -target aarch64-linux-musl "$@"
EOF
chmod +x "$CCWRAP"

cd "$SRC"
cp "$HERE/../a6q/dropbear-aarch64/localoptions.h" localoptions.h
git status --porcelain | grep -q " M " || patch -p1 < "$HERE/../a6q/dropbear-aarch64/dropbear-tv.patch"
grep -q "PATCHED" src/svr-auth.c src/svr-authpubkey.c src/common-session.c

CC="$CCWRAP" ./configure --disable-zlib --host=aarch64-linux-musl 2>&1 | tail -2
CC="$CCWRAP" LDFLAGS="-static" make -j8 2>&1 | tail -2 || true
"$CCWRAP" -c 2>/dev/null || true  # no-op warm
# the root make leaves single-member .a archives (host ar skips ELF) — rebuild
# them by mounting the loose objects directly:
( cd libtommath  && rm -f libtommath.a  && find . -name '*.o' -type f -print0 | /usr/bin/xargs -0 "$GAR" r libtommath.a )
( cd libtomcrypt && rm -f libtomcrypt.a && find . -name '*.o' -type f -print0 | /usr/bin/xargs -0 "$GAR" r libtomcrypt.a )
"$GRANLIB" "$SRC/libtommath/libtommath.a" "$SRC/libtomcrypt/libtomcrypt.a"

CC="$CCWRAP" LDFLAGS="-static" make -j8 2>&1 | tail -2

for b in dropbear dropbearkey dbclient dropbearconvert; do
  [ -f "$b" ] || exit 1
  "$(brew --prefix binutils)/bin/gstrip" "$b"
  [ -z "$("$GREaDELF" -d "$b" | grep NEEDED)" ] || { echo "NOT STATIC: $b"; exit 1; }
  echo "$b: $(file -b "$b" | cut -d, -f1-4 | tr -d ' ') $(stat -f%z "$b")b"
done

mkdir -p "$OUT"
cp dropbear dropbearkey dbclient dropbearconvert "$OUT/"
echo "staged in $OUT"
