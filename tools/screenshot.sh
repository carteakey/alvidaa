#!/bin/bash
# Capture the TV screen without touching the remote.
#
# Uses the vendor HAL capture binary (/usr/local/bin/screenshot, the same one
# login.sh menu 16 wraps) — /dev/fb0 has no readback path on this MTK display
# (read() and dd return ENODEV), so the sysctrlservice RPC is the only
# working capture lane. Zero persistent TV writes: the frame lands in /tmp
# (tmpfs, gone at reboot) and is pulled to the Mac in the same command.
#
# Usage: tools/screenshot.sh [output.png]     (default /tmp/alvidaa-<ts>.png)
# Requires: ./server/tv root-SSH lane (server/keys/tv_root_ed25519).
set -euo pipefail

OUT="${1:-/tmp/alvidaa-$(date +%Y%m%d-%H%M%S).png}"
TV="${TV_HOST:-192.168.0.11}"
KEY="$(cd "$(dirname "$0")" && pwd)/../server/keys/tv_root_ed25519"
NAME="alvidaa-shot.jpg"

# Same host-key policy as ./server/tv: the TV's dropbear key changes across
# firmware updates and re-provisions, and a pinned known_hosts entry turns a
# working lane into "Host key verification failed" with no way in. The lane is
# LAN-local and key-authenticated, so the host key adds nothing here.
SSH="ssh -p 2222 -i $KEY -o BatchMode=yes -o StrictHostKeyChecking=no \
     -o UserKnownHostsFile=/dev/null root@$TV"

# capture (async via sysctrlservice RPC — poll for the file). The HAL takes
# several seconds and occasionally longer; a fixed 3s wait produced a silent
# "No such file" on a healthy TV (2026-11-10), so poll for up to 20s.
$SSH "/usr/local/bin/screenshot /tmp $NAME >/dev/null 2>&1; \
      n=0; while [ \$n -lt 100 ] && [ ! -s /tmp/$NAME ]; do sleep 0.2; n=\$((n+1)); done; \
      ls -la /tmp/$NAME"

# pull (the HAL writes PNG bytes despite the .jpg name)
$SSH "cat /tmp/$NAME" > "$OUT" 2>/dev/null
$SSH "rm -f /tmp/$NAME" >/dev/null

file "$OUT"
echo "screenshot: $OUT"
