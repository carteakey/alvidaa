#!/bin/sh
# postinst-65ur9s.sh — the root part of the 65UR9S installer IPK.
#
# Runs as uid 0 (superwatch 82 -> /usr/local/scripts/ipk_install.sh -> vendor
# opkg --force-reinstall install -> this script). It does exactly five things:
#
#   1. create /APPS/.re_sshd (the root channel's home)
#   2. move the shipped rshell.js / rshell.sh into place and write the
#      profile wrapper (the root shell: source /etc/profile, then bash)
#   3. open port 8008 inbound with an ACCEPT rule at the HEAD of INPUT and
#      FIREWALL_IN_EULAON (the vendor chains end in -j DROP, so appending
#      would never be reached)
#   4. start the supervisor detached (busybox setsid — a plain & dies with
#      the installer's process group, measured on the 65A85QEVS lane)
#   5. prove it: the listening socket in /proc/net/tcp and the log
#
# Idempotent: re-running replaces the files, dedupes the iptables rules and
# restarts the supervisor.
#
# Teardown (documented in docs/models/65UR9S/V0000.09.60V.Q0618/README.md):
#   opkg remove re.installer
#   rm -rf /APPS/.re_sshd
#   iptables -D INPUT -p tcp --dport 8008 -j ACCEPT
#   iptables -D FIREWALL_IN_EULAON -p tcp --dport 8008 -j ACCEPT
D=/APPS/.re_sshd
SRC=/APPS/pkgs/APPS/.re_sshd
mkdir -p "$D" 2>/dev/null

{
  echo "=== 65UR9S installer $(date) ==="
  echo "--- identity (shell builtins only: id/uname are not on this PATH) ---"
  grep -E '^(Uid|Gid|Groups|CapEff):' /proc/self/status 2>&1
  grep -E '^(Selinux|SELinux):' /proc/self/status 2>&1

  echo "--- step: stop previous rshell processes ---"
  # Killing the supervisor does not kill its Node child: the orphan keeps port
  # 8008 bound and the next supervisor then loops on EADDRINUSE forever.
  # Every process whose cmdline mentions rshell.js is therefore stopped first.
  for p in /proc/[0-9]*; do
      pid=${p#/proc/}
      cmd=$(/bin/cat "$p/cmdline" 2>/dev/null)
      case "$cmd" in
          *rshell*) kill -9 "$pid" 2>/dev/null && echo "killed rshell process $pid" ;;
      esac
  done
  if [ -f "$D/rshell.lock/pid" ]; then
      P=$(cat "$D/rshell.lock/pid" 2>/dev/null)
      if [ -n "$P" ] && [ -d "/proc/$P" ]; then
          kill -9 "$P" 2>/dev/null && echo "killed supervisor pid=$P"
      fi
  fi
  rm -rf "$D/rshell.lock"
  sleep 1

  echo "--- step: install the payload ---"
  [ -f "$SRC/rshell.js" ] && mv -f "$SRC/rshell.js" "$D/rshell.js"
  [ -f "$SRC/rshell.sh" ] && mv -f "$SRC/rshell.sh" "$D/rshell.sh"

  # The root shell: mirror the vendor serial login (/etc/rootlogin.sh does
  # `source /etc/profile; /bin/sh`) so every session gets the vendor PATH and
  # LD_LIBRARY_PATH. /etc/profile's stdout is a banner, not environment, so
  # it is sunk to keep the output clean.
  printf '#!/bin/sh\n. /etc/profile >/dev/null 2>&1\nexec /bin/bash "$@"\n' > "$D/sh"
  chmod 755 "$D/sh" "$D/rshell.sh" 2>&1
  chmod 644 "$D/rshell.js" 2>&1
  ls -l "$D" 2>&1 | head -12

  echo "--- step: firewall (8008) ---"
  for CH in INPUT FIREWALL_IN_EULAON; do
      if iptables -C "$CH" -p tcp --dport 8008 -j ACCEPT 2>/dev/null; then
          echo "$CH: rule already present"
      else
          iptables -I "$CH" 1 -p tcp --dport 8008 -j ACCEPT 2>&1 && echo "$CH: ACCEPT inserted at head"
      fi
  done
  iptables -L INPUT -n 2>&1 | head -6
  iptables -L FIREWALL_IN_EULAON -n 2>&1 | head -6

  echo "--- step: start the supervisor ---"
  busybox setsid /bin/sh "$D/rshell.sh" >/dev/null 2>&1 </dev/null &
  sleep 3
  echo "lock pid: $(cat "$D/rshell.lock/pid" 2>/dev/null)"

  echo "--- step: proof ---"
  grep -i ':1F48' /proc/net/tcp 2>&1 && echo "8008 LISTENING" || echo "8008 NOT LISTENING"
  # keep the log bounded: a crash loop must not fill /APPS
  if [ -f "$D/rshell.log" ]; then
      SZ=$(/bin/cat "$D/rshell.log" 2>/dev/null | /bin/wc -c 2>/dev/null)
      if [ -n "$SZ" ] && [ "$SZ" -gt 262144 ] 2>/dev/null; then
          : > "$D/rshell.log"
          echo "rshell.log truncated (was $SZ bytes)"
      fi
  fi
  tail -20 "$D/rshell.log" 2>/dev/null
  echo "--- end ---"
} > "$D/installer_log.txt" 2>&1

chmod 644 "$D/installer_log.txt" 2>/dev/null
exit 0
