#!/usr/bin/env bash
# qs_inspect.sh — read-only report of the 75UR9S Quick Menu layout.
#
# Pulls the SystemUI starboard storage and reports the two saved rows
# (setting.qsEditList = "Displayed Items", setting.qsBakList = "More"), the
# clear flag, and integrity (duplicates, overlap between rows, and — with
# --universe — ids present in neither row, i.e. possible losses). Touches
# nothing on the TV.
#
#   ./scripts/qs_inspect.sh --tv <tv-ip> [--port 8008] [--key <ssh-key>]
#                           [--universe <json-file>]
#
#   --tv         TV LAN IP (required)
#   --port       dropbear port (default 8008)
#   --key        root ssh key (default server/keys/tv_root_ed25519)
#   --universe   a JSON array of all valid item ids (the factory preset,
#                findings 03 §5); ids in this set but in neither saved row are
#                reported as possible losses.
set -uo pipefail

TOOLROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$TOOLROOT/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QS_PY="$SCRIPT_DIR/qs_storage.py"

TV=""
PORT=8008
KEY="$REPO/server/keys/tv_root_ed25519"
UNIVERSE=""

while [ $# -gt 0 ]; do
  case "$1" in
    --tv) TV="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --universe) UNIVERSE="$2"; shift 2 ;;
    -h|--help) sed -n '2,18p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

[ -n "$TV" ] || { echo "ERROR: --tv is required (TV LAN IP)" >&2; exit 1; }
[ -f "$KEY" ] || { echo "ERROR: ssh key not found: $KEY" >&2; exit 1; }
[ -f "$QS_PY" ] || { echo "ERROR: qs_storage.py not found: $QS_PY" >&2; exit 1; }
command -v python3 >/dev/null || { echo "ERROR: python3 not found locally" >&2; exit 1; }

SSH=(ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEY" -p "$PORT" "root@$TV")
SCP=(scp -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -i "$KEY" -P "$PORT")

CBL=/var/local/hisenseUI/cobalt_home
STOR_REMOTE="$("${SSH[@]}" "cd $CBL && ls -1 .starboard.*.storage 2>/dev/null | grep -v '\.bak' | head -1")"
[ -n "$STOR_REMOTE" ] || { echo "ERROR: no .starboard.*.storage in $CBL" >&2; exit 1; }
STOR_PATH="$CBL/$STOR_REMOTE"

echo "Quick Menu layout on $TV:$PORT  ($STOR_PATH)"
echo "--------------------------------------------------------------------"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
"${SCP[@]}" "root@$TV:$STOR_PATH" "$TMP/storage" || { echo "ERROR: pull failed" >&2; exit 1; }
if [ -n "$UNIVERSE" ]; then
  python3 "$QS_PY" report "$TMP/storage" --universe "$UNIVERSE"
else
  python3 "$QS_PY" report "$TMP/storage"
fi