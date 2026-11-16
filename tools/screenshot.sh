#!/bin/bash
# Capture the TV screen without touching the remote.
#
# Uses the vendor HAL capture binary (/usr/local/bin/screenshot, the same one
# login.sh menu 16 wraps) — /dev/fb0 has no readback path on this MTK display
# (read() and dd return ENODEV), so the sysctrlservice RPC is the only
# working capture lane. Zero persistent TV writes: the frame lands in /tmp
# (tmpfs, gone at reboot) and is pulled to the Mac in the same command.
#
# What comes out (measured on a 55U61KEVS, docs/research/11-screen-capture.md):
# the composed picture, video + UI, always 1920x1080; HDMI sources work;
# rarely no file arrives at all (seen during a slow app start). HDR sources come out on the
# raw PQ curve and look flat: --hdr adds a tone-mapped copy.
#
# Usage: tools/screenshot.sh [--hdr] [output.png]   (default /tmp/alvidaa-<ts>.png)
#   --hdr  also write <output>-sdr.png, PQ -> SDR (Mobius), via ffmpeg + zscale
# Requires: ./server/tv root-SSH lane (server/keys/tv_root_ed25519).
set -euo pipefail

HDR=0
if [ "${1:-}" = "--hdr" ]; then HDR=1; shift; fi
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
      ls -la /tmp/$NAME" \
  || { echo "no frame after 20 s" >&2; exit 1; }

# pull (the HAL writes PNG bytes despite the .jpg name)
$SSH "cat /tmp/$NAME" > "$OUT" 2>/dev/null
$SSH "rm -f /tmp/$NAME" >/dev/null

file "$OUT"
echo "screenshot: $OUT"

# HDR sources: the PNG holds the PQ curve with BT.709 colours (tagging it as
# BT.2020 gives a green cast). Mobius matched the TV best for films.
if [ "$HDR" = 1 ]; then
  ffmpeg -hide_banner -loglevel error -y -i "$OUT" -vf \
    "setparams=color_primaries=bt709:color_trc=smpte2084:colorspace=gbr:range=pc,zscale=t=linear:npl=100,format=gbrpf32le,tonemap=tonemap=mobius:param=0.5:desat=0,zscale=t=bt709:m=bt709:r=pc,format=rgb24" \
    "${OUT%.png}-sdr.png"
  echo "tone-mapped: ${OUT%.png}-sdr.png"
fi
