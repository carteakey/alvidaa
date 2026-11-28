#!/usr/bin/env bash
# qs_reset.sh — reset the 75UR9S Quick Menu to its factory default layout.
#
# Removes the two saved-list keys (setting.qsEditList, setting.qsBakList) from
# the SystemUI starboard storage, so the next menu load falls back to the
# embedded factory preset. This is the clean recovery for "items missing from
# the Quick Menu" (findings 03, §9). Reversible: a timestamped backup is kept
# on the TV and the exact rollback command is printed at the end.
#
#   ./scripts/qs_reset.sh --tv <tv-ip> [--port 8008] [--key <ssh-key>]
#                         [--backup-dir <tv-dir>] [--dry-run]
#
#   --tv          TV LAN IP (required)
#   --port        dropbear port (default 8008)
#   --key         root ssh key (default server/keys/tv_root_ed25519)
#   --backup-dir  backup dir ON THE TV (default /var/local/alvidaa/qs-reset-<ts>)
#   --dry-run     print the plan, touch nothing
#
# Procedure (every step reversible): stop SystemUI -> pull the storage file ->
# back it up -> strip the two list keys (qs_storage.py factory) -> push it back
# with the SystemUI owner (311:311, mode 600) -> restart SystemUI -> verify.
#
# The storage filename (a base64 origin) is resolved by glob on the TV, never
# hardcoded. The file is edited only while SystemUI is stopped, because the
# engine rewrites the whole file on every write.
set -uo pipefail

TOOLROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$TOOLROOT/../.." && pwd)"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
QS_PY="$SCRIPT_DIR/qs_storage.py"

TV=""
PORT=8008
KEY="$REPO/server/keys/tv_root_ed25519"
BACKUP_DIR=""
DRY=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tv) TV="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --key) KEY="$2"; shift 2 ;;
    --backup-dir) BACKUP_DIR="$2"; shift 2 ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
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
TS="$(date +%Y%m%d-%H%M%S)"
[ -n "$BACKUP_DIR" ] || BACKUP_DIR="/var/local/alvidaa/qs-reset-$TS"

# Resolve the storage filename on the TV (glob; exclude any .bak).
STOR_REMOTE="$("${SSH[@]}" "cd $CBL && ls -1 .starboard.*.storage 2>/dev/null | grep -v '\.bak' | head -1")"
[ -n "$STOR_REMOTE" ] || { echo "ERROR: no .starboard.*.storage in $CBL" >&2; exit 1; }
STOR_PATH="$CBL/$STOR_REMOTE"

echo "Quick Menu factory reset -> $TV:$PORT"
echo "  storage : $STOR_PATH"
echo "  backup  : $BACKUP_DIR (on TV)"
if [ "$DRY" = 1 ]; then
  echo "  [dry-run] would: stop SystemUI, pull, backup, factory, push (chown 311:311/600), restart, verify"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "[1/6] stopping SystemUI"
"${SSH[@]}" 'kill $(pidof SystemUI) 2>/dev/null; sleep 1; if pidof SystemUI >/dev/null; then echo "  WARN: SystemUI still up"; else echo "  stopped"; fi'

echo "[2/6] pulling storage"
"${SCP[@]}" "root@$TV:$STOR_PATH" "$TMP/storage" || { echo "ERROR: pull failed" >&2; exit 1; }
echo "  $(wc -c < "$TMP/storage") bytes"

echo "[3/6] backing up -> $BACKUP_DIR"
"${SSH[@]}" "mkdir -p '$BACKUP_DIR' && cp '$STOR_PATH' '$BACKUP_DIR/storage.bak'" || { echo "ERROR: backup failed" >&2; exit 1; }
cp "$TMP/storage" "$TMP/storage.bak"

echo "[4/6] stripping the two list keys (factory)"
python3 "$QS_PY" factory "$TMP/storage" "$TMP/storage.factory"

echo "[5/6] pushing back (owner 311:311, mode 600)"
"${SCP[@]}" "$TMP/storage.factory" "root@$TV:$CBL/.qs_reset_tmp" || { echo "ERROR: push failed" >&2; exit 1; }
"${SSH[@]}" "cd '$CBL' && mv .qs_reset_tmp '$STOR_REMOTE' && chown 311:311 '$STOR_REMOTE' && chmod 600 '$STOR_REMOTE' && ls -l '$STOR_REMOTE'"

echo "[6/6] restarting SystemUI"
"${SSH[@]}" 'busybox setsid /bin/sh -c "/opt/hisenseUI/startgui.sh" >/dev/null 2>&1 </dev/null & sleep 2; if pidof SystemUI >/dev/null; then echo "  SystemUI up (pid $(pidof SystemUI))"; else echo "  WARN: SystemUI not up"; fi'

echo "verifying (re-pull + report)"
"${SCP[@]}" "root@$TV:$STOR_PATH" "$TMP/storage.after" 2>/dev/null && python3 "$QS_PY" report "$TMP/storage.after" || echo "  (verify pull skipped — check the menu on the TV)"

echo
echo "done."
echo "rollback: ${SSH[*]} \"cd $CBL && cp '$BACKUP_DIR/storage.bak' '$STOR_REMOTE' && chown 311:311 '$STOR_REMOTE' && chmod 600 '$STOR_REMOTE'\"  (SystemUI stopped)"
echo "          then restart SystemUI or reboot."