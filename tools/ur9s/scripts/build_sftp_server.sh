#!/usr/bin/env bash
# build_sftp_server.sh — rebuild the static ARM OpenSSH sftp-server for the
# 75UR9S SFTP lane (findings 02).
#
# Source: https://cdn.openbsd.org/pub/OpenBSD/OpenSSH/portable/
#         openssh-9.9p1.tar.gz
# Same recipe as tools/he40 (9.9p1 static, no OpenSSL/zlib/PAM — sftp-server
# only; the SSH crypto stays in dropbear). The TV has glibc 2.35 and no
# package manager; a static build has no runtime dependency.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
TOP="$(cd "$HERE/.." && pwd)"
SRC="${OPENSSH_SRC:-$TOP/sources/openssh-9.9p1.tar.gz}"
BUILD="$TOP/build/openssh"
TAR_SHA="b343fbcdbff87f15b1986e6e15d6d4fc9a7d36066be6b7fb507087ba8f966c02"

[ -f "$SRC" ] || {
  echo "missing $SRC"
  echo "Download openssh-9.9p1.tar.gz from the upstream portable release page,"
  echo "place it in tools/ur9s/sources/, or set OPENSSH_SRC=/path/to/tarball."
  exit 1
}
echo "$TAR_SHA  $SRC" | sha256sum -c -
command -v arm-linux-gnueabihf-gcc >/dev/null || { echo "missing arm-linux-gnueabihf-gcc"; exit 1; }

rm -rf "$BUILD"; mkdir -p "$BUILD"
tar xzf "$SRC" -C "$BUILD"
cd "$BUILD/openssh-9.9p1"

./configure --host=arm-linux-gnueabihf \
  --without-openssl --without-zlib --without-pam \
  --disable-etc-default-login --disable-lastlog --disable-utmp --disable-wtmp \
  --disable-utmpx --disable-wtmpx --without-selinux --without-audit \
  CC=arm-linux-gnueabihf-gcc CFLAGS="-Os -fno-pie" LDFLAGS="-static -no-pie"

make -j"$(nproc)" sftp-server
arm-linux-gnueabihf-strip sftp-server
mkdir -p "$TOP/bin"
cp -f sftp-server "$TOP/bin/sftp-server"
chmod 755 "$TOP/bin/sftp-server"

echo "---"
file "$TOP/bin/sftp-server"
readelf -d "$TOP/bin/sftp-server" 2>&1 | head -5 || true
sha256sum "$TOP/bin/sftp-server"

# Static + ARM sanity: refuse a dynamic or non-ARM result.
file "$TOP/bin/sftp-server" | grep -q "statically linked" || { echo "FATAL: not statically linked"; exit 1; }
file "$TOP/bin/sftp-server" | grep -qE "ARM|aarch64" || { echo "FATAL: wrong architecture"; exit 1; }

if command -v qemu-arm >/dev/null; then
  echo "--- qemu smoke ---"
  timeout 3 qemu-arm "$TOP/bin/sftp-server" -h 2>&1 | head -5 || true
fi
echo "built -> $TOP/bin/sftp-server"
