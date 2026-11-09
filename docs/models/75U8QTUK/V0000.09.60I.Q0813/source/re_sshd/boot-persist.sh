#!/bin/sh
# 75U8QTUK boot-persistence hook — deploy / teardown / status on the TV.
#
# Invoke through /bin/sh explicitly: /var/local is mounted seclabel and a
# direct shebang exec there fails with "bad interpreter: Permission denied".
#   /bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh deploy
#   /bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh teardown
#   /bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh status
#
# All writes are confined to /APPS (rw) and /var/local (rw). Nothing on /
# (erofs + dm-verity) or /OAD staging is touched.
PATH=/basic/bin:/bin:/usr/bin:/sbin:/usr/sbin
export PATH

STAGE=/var/local/alvidaa/boot-persist
BASE=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services
LIST=$BASE/serviceList.json
PRISTINE=$BASE/serviceList.json.pristine
SVC=$BASE/re_sshd
MARKER=/APPS/.re_sshd/boot_marker.txt

case "${1:-}" in
  deploy)
    for f in index.js package.json serviceList.json; do
      [ -f "$STAGE/$f" ] || { echo "FAIL missing staged $f"; exit 1; }
    done
    # Keep a byte-identical pristine copy; never overwrite another session's.
    if [ ! -f "$PRISTINE" ]; then
      /bin/cp -p "$LIST" "$PRISTINE" || { echo "FAIL pristine backup"; exit 1; }
    fi
    /bin/mkdir -p "$SVC" || exit 1
    /bin/cp "$STAGE/index.js" "$SVC/index.js" || exit 1
    /bin/cp "$STAGE/package.json" "$SVC/package.json" || exit 1
    /bin/chown 314:314 "$SVC" "$SVC/index.js" "$SVC/package.json" || exit 1
    /bin/chmod 0750 "$SVC" || exit 1
    /bin/chmod 0640 "$SVC/index.js" "$SVC/package.json" || exit 1

    /bin/cp "$STAGE/serviceList.json" "$LIST.new" || exit 1
    /bin/chown 314:314 "$LIST.new" || exit 1
    /bin/chmod 0640 "$LIST.new" || exit 1
    /bin/mv -f "$LIST.new" "$LIST" || exit 1

    # The marker's parent is root:root 0755, so pre-create the file and give
    # the uid-314 service ownership of the file itself (append needs no dir
    # write permission).
    if [ ! -f "$MARKER" ]; then : > "$MARKER" || exit 1; fi
    /bin/chown 314:314 "$MARKER" || exit 1
    /bin/chmod 0664 "$MARKER" || exit 1
    echo "DEPLOYED (reboot required to activate; no hot-reload)"
    ;;

  teardown)
    [ -f "$PRISTINE" ] || { echo "FAIL no pristine backup"; exit 1; }
    /bin/cp -p "$PRISTINE" "$LIST.new" || exit 1
    /bin/chown 314:314 "$LIST.new" || exit 1
    /bin/chmod 0640 "$LIST.new" || exit 1
    /bin/mv -f "$LIST.new" "$LIST" || exit 1
    /bin/rm -rf "$SVC" || exit 1
    /bin/rm -f "$MARKER" || exit 1
    echo "TORN DOWN (takes effect at next boot; current dropbear unchanged)"
    ;;

  status)
    echo "== serviceList.json =="; /bin/cat "$LIST"
    echo "== pristine =="; /bin/ls -l "$PRISTINE" 2>&1
    echo "== service dir =="; /bin/ls -la "$SVC" 2>&1
    echo "== marker tail =="; /bin/sed -n '1,12p' "$MARKER" 2>&1
    echo "== 8008 listener (1F48 / 0A) =="; /bin/grep -i ':1F48 ' /proc/net/tcp 2>&1
    echo "== dropbear =="; /bin/pidof dropbear-root 2>&1
    ;;

  *)
    echo "usage: $0 {deploy|teardown|status}"; exit 2 ;;
esac
