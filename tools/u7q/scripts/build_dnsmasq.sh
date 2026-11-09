#!/bin/bash
# Build static ARM32 (musleabihf) dnsmasq for the 09.09D dns stage,
# zig-cc cross-hosted on macOS. Product: dnsmasq (stripped, zero DT_NEEDED).
#
#   tools/u7q/scripts/build_dnsmasq.sh /tmp/dnsmasq-build/dnsmasq
#
# Prereqs (brew): zig (cc cross, target arm-linux-musleabihf), binutils
# (GNU ar/strip/readelf — LLVM ar/ld mis-handle ELF objects on macOS).
#
# COPTS strip dhcp/tftp — the TV uses this as a loopback resolver only
# (see make_min_installer.py, dns stage): dnsblock.conf in, vendor
# resolv.conf forwards out. No gettext/i18n on static musl.
set -euo pipefail

SRC="${1:-/tmp/dnsmasq-build/dnsmasq}"
OUT="${2:-$(cd "$(dirname "$0")/../bin" && pwd)}"
VER="${DNSMASQ_VER:-2.91}"
WORK="$(dirname "$SRC")"

mkdir -p "$WORK"
if [ ! -d "$SRC" ]; then
    echo "fetch dnsmasq $VER -> $WORK"
    ok=""
    for u in "https://www.thekelleys.org.uk/dnsmasq/dnsmasq-$VER.tar.xz" \
             "https://www.thekelleys.org.uk/dnsmasq/dnsmasq-2.90.tar.xz"; do
        if curl -fsSL -o "$WORK/dnsmasq.tar.xz" "$u"; then ok="$u"; break; fi
    done
    [ -n "$ok" ] || { echo "download failed"; exit 1; }
    echo "source: $ok"
    tarball_dir="$(tar -tf "$WORK/dnsmasq.tar.xz" | head -1 | cut -d/ -f1)"
    (cd "$WORK" && tar xf dnsmasq.tar.xz && mv "$tarball_dir" "$SRC")
fi

CCWRAP="$WORK/cc-wrapper.sh"
if [ ! -x "$CCWRAP" ]; then
    printf '#!/bin/sh\nexec zig cc -target arm-linux-musleabihf "$@"\n' > "$CCWRAP"
    chmod +x "$CCWRAP"
fi

cd "$SRC"
make clean >/dev/null 2>&1 || true
make CC="$CCWRAP" COPTS="-DNO_DHCP -DNO_TFTP" LDFLAGS="-static" -j8 2>&1 | tail -3

GSTRIP="$(brew --prefix binutils)/bin/gstrip"
GREALD="$(brew --prefix binutils)/bin/greadelf"
BIN="$SRC/src/dnsmasq"
[ -f "$BIN" ] || { echo "no src/dnsmasq produced"; exit 1; }
"$GSTRIP" "$BIN"
if [ -n "$("$GREALD" -d "$BIN" | grep NEEDED)" ]; then
    echo "NOT STATIC: $("$GREALD" -d "$BIN" | grep NEEDED)"; exit 1
fi
echo "dnsmasq: $(file -b "$BIN" | cut -d, -f1-4 | tr -d ' ') $(stat -f%z "$BIN")b"

mkdir -p "$OUT"
cp "$BIN" "$OUT/dnsmasq"
echo "staged in $OUT"
