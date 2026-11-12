#!/bin/bash
# Capture the 50U7DSE screen without touching the remote.
#
# Same vendor HAL lane as tools/screenshot.sh (sysctrlservice RPC into /tmp,
# /dev/fb0 has no readback on this MTK display), adapted for this unit:
#   - SSH lives on port 8008 (not the server/tv wrapper's 2222), and
#   - /etc/profile prints a banner over SSH stdout before any command output,
#     which corrupts a naive `ssh cat file > out.png`. The frame is therefore
#     pulled through a strip that keeps everything from the PNG magic bytes.
# Zero persistent TV writes: the frame lands in tmpfs and is removed after.
#
# Usage: tools/screenshot-50u7dse.sh [output.png]
# Env:   TV_HOST (default 192.168.20.165)
set -euo pipefail

OUT="${1:-/tmp/alvidaa-50u7dse-$(date +%Y%m%d-%H%M%S).png}"
TV="${TV_HOST:-192.168.20.165}"
KEY="$(cd "$(dirname "$0")" && pwd)/../server/keys/tv_root_ed25519"
NAME="alvidaa-shot.jpg"

SSH="ssh -p 8008 -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null root@$TV"

$SSH "/usr/local/bin/screenshot /tmp $NAME >/dev/null 2>&1; \
      n=0; while [ \$n -lt 15 ] && [ ! -s /tmp/$NAME ]; do sleep 0.2; n=\$((n+1)); done; \
      ls -la /tmp/$NAME" 2>/dev/null

$SSH "cat /tmp/$NAME" 2>/dev/null | python3 -c '
import sys
data = sys.stdin.buffer.read()
magic = data.find(b"\x89PNG\r\n\x1a\n")
if magic < 0:
    sys.stderr.write("no PNG magic in SSH stream\n")
    sys.exit(1)
sys.stdout.buffer.write(data[magic:])
' > "$OUT"
$SSH "rm -f /tmp/$NAME" >/dev/null 2>&1 || true

file "$OUT"
echo "screenshot: $OUT"
