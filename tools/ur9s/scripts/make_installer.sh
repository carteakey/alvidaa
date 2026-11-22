#!/bin/sh
# make_installer.sh — build the 65UR9S root installer IPK.
#
# Windows/MSYS twin of tools/ur9s/scripts/make_installer.py: this host has no
# Python. The IPK is an ar archive (debian-binary + control.tar.gz +
# data.tar.gz), the same layout the Python builder produces, so the vendor
# opkg treats it the same way.
#
# Usage:
#   ./make_installer.sh --host <operator-ip> --port <port> [--arch mtk9655] --out installer.ipk
#
# Vendor contract (read on the device, findings 01 §4.2):
#   superwatch 82 -> /usr/local/scripts/ipk_install.sh <sid> <ipk> <pkg> <opts>
#                -> opkg --force-reinstall install <ipk>
# The patched vendor opkg requires AppId + AppName in control and a non-empty
# data.tar.gz (see docs/models/55U67LEVS/.../HANDOFF.md). The data set is
# extracted relative to /APPS/pkgs, hence the ./APPS/.re_sshd/... paths.
#
# Teardown of the artifact: delete the .ipk locally; on the TV, opkg remove
# re.installer + rm -rf /APPS/.re_sshd + remove the two iptables rules.
set -e

HERE=$(cd "$(dirname "$0")/.." && pwd)   # tools/ur9s
HOST=""
PORT=8008
ARCH=mtk9655
OUT=""

while [ $# -gt 0 ]; do
    case "$1" in
        --host) HOST="$2"; shift 2 ;;
        --port) PORT="$2"; shift 2 ;;
        --arch) ARCH="$2"; shift 2 ;;
        --out)  OUT="$2";  shift 2 ;;
        *) echo "unknown arg: $1" >&2; exit 2 ;;
    esac
done

if [ -z "$HOST" ] || [ -z "$OUT" ]; then
    echo "usage: make_installer.sh --host <ip> --port <port> [--arch mtk9655] --out <file.ipk>" >&2
    exit 2
fi

# absolute path: the archive is assembled from inside the work directory
case "$OUT" in
    /*) : ;;
    *) OUT="$(pwd)/$OUT" ;;
esac

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/pkg"

# --- control set -------------------------------------------------------
cat > "$WORK/control" <<EOF
Package: re.installer
Version: 1.0.0
Architecture: $ARCH
AppId: re.installer
AppName: re.installer
Section: ns
Priority: optional
Maintainer: re
Description: 65UR9S root shell (node rshell on 8008)
Format: 1
Persistent: false
PackageType: Entry
Userid: 0:0
Installed-Size: 20
EOF

# --- postinst ----------------------------------------------------------
sed -e "s|@HOST@|$HOST|g" -e "s|@PORT@|$PORT|g" \
    "$HERE/scripts/postinst-65ur9s.sh" > "$WORK/postinst"
chmod 755 "$WORK/postinst"

# --- data set ----------------------------------------------------------
# The postinst moves these into /APPS/.re_sshd and starts them.
mkdir -p "$WORK/data/APPS/.re_sshd"
cp "$HERE/rshell.js" "$WORK/data/APPS/.re_sshd/rshell.js"
cp "$HERE/rshell.sh" "$WORK/data/APPS/.re_sshd/rshell.sh"

# keep the real file modes (control 644, postinst 755, rshell.sh 755)
chmod 644 "$WORK/control"
chmod 755 "$WORK/postinst" "$WORK/data/APPS/.re_sshd/rshell.sh"
chmod 644 "$WORK/data/APPS/.re_sshd/rshell.js"

( cd "$WORK" && tar --format=ustar --numeric-owner --owner=0 --group=0 -czf control.tar.gz ./control ./postinst )
( cd "$WORK/data" && tar --format=ustar --numeric-owner --owner=0 --group=0 -czf "$WORK/data.tar.gz" ./APPS/.re_sshd/rshell.js ./APPS/.re_sshd/rshell.sh )

printf '2.0\n' > "$WORK/debian-binary"

( cd "$WORK" && ar rc "$OUT" debian-binary control.tar.gz data.tar.gz )

echo "wrote $OUT"
ls -l "$OUT"
echo "--- control ---"
cat "$WORK/control"
echo "--- data set ---"
tar -tzvf "$WORK/data.tar.gz"
