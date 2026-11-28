#!/bin/sh
# 43E7HQ (43A56FEVS) / V0000.09.09G.P0930 — supervised hisenseUI restart.
#
# Adapted from switch-home-50a51huv.sh. Differences on this build:
#   - stock app.js md5 e988dfe7992a8d2eecea72c24896de05, mode 0664 (not 0755)
#   - grep ALWAYS exits 0 here, so live_engine() matches /proc/<pid>/exe with
#     `case` instead of `grep -q` (the original listed every pid as the engine)
#   - APM did not respawn the engine after SIGTERM; the secure_exec fallback
#     starts it (observed on every dry/install/switch run)
#
# Original header (50A51HUV / V0000.09.01O.P0813):
#
# Same shape as switch-home-75u8qtuk.sh, adapted to this build:
#   - the UI engine is `hisenseUI`, not `SystemUI`
#   - the launcher bundle lives at /APPS/channelA/operation-ui/...
#   - app.js is 305:305 mode 0755 (not 305:909 / 0640)
#   - the cache is /var/local/hisenseUI/cobalt_home/.cache/cobalt
#   - **APM supervises the launcher** (`[launcher]` in
#     /usr/local/etc/apm/application-config-na-sa.ini: isKeepAlive = true,
#     restore_time_when_crash = 10). So the restart is: kill, mutate while it
#     is down, then let APM bring it back. secure_exec is only a fallback.
#
# Run detached, as root, over the SSH lane. /var/local is mounted seclabel,
# so a direct shebang exec fails ("bad interpreter: Permission denied"):
# invoke through /bin/sh explicitly.
#   /bin/sh -c 'trap "" HUP; exec /bin/sh /var/local/alvidaa/native-home/switch-home.sh MODE' \
#     >/dev/null 2>&1 </dev/null &
#
# MODES:
#   status    print the current bundle hash and engine pid; changes nothing
#   dry       stock-only restart; no file or cache changes (the gate)
#   install   stock -> candidate: atomic swap + JS-cache reset, then restart
#   switch    candidate -> another candidate: same swap, keeps the stock backup
#             and the original cache backup intact, so rollback still works
#   rollback  restore stock app.js + JS-cache, then restart
#
# Teardown: MODE=rollback restores everything. Files are written only under
# the writable /APPS operation-ui module and /var/local; / stays read-only
# with dm-verity green.
PATH=/usr/local/bin:/usr/local/scripts:/bin:/usr/bin:/sbin:/usrbin:/opt/bin
export PATH
trap "" HUP

MODE="${1:-status}"
DIR=/var/local/alvidaa/native-home
APP=/APPS/channelA/operation-ui/apps/launcher/js/app.js
CACHE=/var/local/hisenseUI/cobalt_home/.cache/cobalt
BACKUP=$DIR/backup
CANDIDATE=$DIR/candidate-native-home.js
ENVF=$DIR/engine.env
LOG=$DIR/switch.log
DONE=$DIR/switch.done
STOCK_MD5=e988dfe7992a8d2eecea72c24896de05
CANDIDATE_MD5=$(/bin/cat "$DIR/candidate.md5" 2>/dev/null)

log() { printf '%s\n' "$*" >> "$LOG"; }
fail() { log "FAIL $*"; printf '%s\n' "FAIL $*" > "$DONE"; exit 1; }
md5of() { /bin/md5sum "$1" | /bin/sed 's/[^0-9a-f].*//'; }

# Non-zombie engine pids, matched on the binary rather than the process name.
# `pidof hisenseUI` also catches short-lived children, which made the first
# dry run signal the wrong pid and then refuse to continue (correctly).
live_engine() {
  out=""
  for d in /proc/[0-9]*; do
    p=${d#/proc/}
    [ -e "$d/exe" ] || continue
    # grep exits 0 even without a match on this firmware: never branch on its
    # status. Compare the exe link target with case instead.
    e=$(/bin/ls -l "$d/exe" 2>/dev/null)
    case "$e" in *" -> /opt/hisenseUI/bin/hisenseUI") ;; *) continue ;; esac
    st=$(/bin/grep '^State:' "$d/status" 2>/dev/null)
    case "$st" in *Z*) continue ;; esac
    out="$out $p"
  done
  set -- $out
  printf '%s\n' "$*"
}

stop_engine() {
  pids=$(live_engine)
  [ -n "$pids" ] || return 0
  /bin/kill -TERM $pids 2>/dev/null
  i=0
  while [ "$i" -lt 20 ]; do
    [ -z "$(live_engine)" ] && return 0
    /bin/sleep 1
    i=$((i + 1))
  done
  return 1
}

wait_engine() {
  limit=${1:-30}
  i=0
  while [ "$i" -lt "$limit" ]; do
    p=$(live_engine)
    if [ -n "$p" ]; then
      set -- $p
      printf '%s\n' "$1"
      return 0
    fi
    /bin/sleep 1
    i=$((i + 1))
  done
  return 1
}

if [ "$MODE" = status ]; then
  printf 'app.js md5 %s\n' "$(md5of "$APP")"
  printf 'stock md5  %s\n' "$STOCK_MD5"
  printf 'engine pid %s\n' "$(live_engine)"
  printf 'phase      %s\n' "$(/bin/cat "$DIR/phase" 2>/dev/null || echo unknown)"
  exit 0
fi

/bin/rm -f "$DONE"
log "=== switch-home mode=$MODE ==="

case "$MODE" in
  dry)
    [ "$(md5of "$APP")" = "$STOCK_MD5" ] || fail "dry run requires stock app.js"
    ;;
  install)
    [ "$(md5of "$APP")" = "$STOCK_MD5" ] || fail "install requires stock app.js"
    [ "$(md5of "$CANDIDATE")" = "$CANDIDATE_MD5" ] || fail "candidate hash mismatch"
    [ -f "$BACKUP/app.js.stock" ] || fail "stock backup missing"
    [ ! -e "$BACKUP/compiled_js" ] || fail "cache backup already present"
    ;;
  switch)
    [ "$(md5of "$CANDIDATE")" = "$CANDIDATE_MD5" ] || fail "candidate hash mismatch"
    [ -f "$BACKUP/app.js.stock" ] || fail "stock backup missing"
    [ -d "$BACKUP/compiled_js" ] || fail "no stock cache backup; run install first"
    ;;
  rollback)
    [ -f "$BACKUP/app.js.stock" ] || fail "stock backup missing"
    ;;
  *) fail "unknown mode: $MODE" ;;
esac

old=$(live_engine)
set -- $old
old=$1
[ -n "$old" ] && [ -r "/proc/$old/environ" ] || fail "no live engine to capture"
creds_before=$(/bin/grep -E '^(Uid|Gid|Groups|CapEff):' "/proc/$old/status")
/bin/cat "/proc/$old/environ" > "$ENVF" || fail "cannot capture engine env"
printf '\0' >> "$ENVF"
log "captured env from pid=$old"

stop_engine || fail "SIGTERM did not clear hisenseUI; refusing to launch a second engine"
log "engine stopped"

# Mutate files only while the UI engine is down (55A7KAU lesson).
if [ "$MODE" = install ] || [ "$MODE" = switch ]; then
  tmp="$APP.alvidaa-tmp"
  /bin/cp "$CANDIDATE" "$tmp" || fail "cannot stage candidate"
  /bin/chown 305:305 "$tmp" || fail "cannot set owner 305:305"
  /bin/chmod 0664 "$tmp" || fail "cannot set mode 0664"
  /bin/mv -f "$tmp" "$APP" || fail "cannot install candidate"
  for d in compiled_js uncompiled_js; do
    if [ "$MODE" = install ]; then
      /bin/mv "$CACHE/$d" "$BACKUP/$d" || fail "cannot back up $d"
    else
      /bin/rm -rf "$CACHE/$d" || fail "cannot clear $d"
    fi
    /bin/mkdir "$CACHE/$d" || fail "cannot recreate $d"
    /bin/chown 311:311 "$CACHE/$d" || fail "cannot own $d"
    /bin/chmod 0751 "$CACHE/$d" || fail "cannot chmod $d"
  done
  printf '%s\n' "$MODE" > "$DIR/phase"
  log "$MODE complete; JS cache dirs reset"
elif [ "$MODE" = rollback ]; then
  tmp="$APP.alvidaa-tmp"
  /bin/cp -p "$BACKUP/app.js.stock" "$tmp" || fail "cannot stage stock app.js"
  /bin/chown 305:305 "$tmp" || fail "cannot set owner 305:305"
  /bin/chmod 0664 "$tmp" || fail "cannot set mode 0664"
  /bin/mv -f "$tmp" "$APP" || fail "cannot restore stock app.js"
  for d in compiled_js uncompiled_js; do
    if [ -d "$BACKUP/$d" ]; then
      /bin/rm -rf "$CACHE/$d" || fail "cannot clear $d"
      /bin/mv "$BACKUP/$d" "$CACHE/$d" || fail "cannot restore $d"
    else
      log "WARN no backup for $d; leaving regenerated cache"
    fi
  done
  printf '%s\n' restored > "$DIR/phase"
  log "restored stock app.js and JS cache dirs"
fi

# An engine that appeared while we were swapping may have loaded the old file.
if [ -n "$(live_engine)" ]; then
  log "engine appeared during the swap; stopping it once more"
  stop_engine || fail "could not clear the engine that appeared during the swap"
fi

# APM restores the launcher after a crash, not after a clean SIGTERM, so this
# is a short courtesy wait before the real restart path.
new=$(wait_engine 5)
if [ -z "$new" ]; then
  log "APM did not restore the engine; launching through secure_exec"
  (
    cd /opt/hisenseUI || exit 1
    while IFS= read -r -d '' item; do
      case "$item" in *=*) export "$item" ;; esac
    done < "$ENVF"
    trap "" HUP
    exec /usr/local/bin/secure_exec hisenseUI /opt/hisenseUI/startgui.sh \
      >/dev/null 2>&1 </dev/null
  ) >/dev/null 2>&1 </dev/null &
  new=$(wait_engine) || fail "engine did not start; SSH stays up, retry launch manually"
fi

printf '%s\n' -1000 > "/proc/$new/oom_score_adj" 2>/dev/null || true
creds_after=$(/bin/grep -E '^(Uid|Gid|Groups|CapEff):' "/proc/$new/status")
[ "$creds_after" = "$creds_before" ] || log "WARN restarted credentials differ"
ppid=$(/bin/grep '^PPid:' "/proc/$new/status" | /bin/sed 's/[^0-9]*//g')
log "OK mode=$MODE old=$old new=$new ppid=$ppid"
log "app.js md5 now $(md5of "$APP")"
printf '%s\n' "OK mode=$MODE new=$new" > "$DONE"
