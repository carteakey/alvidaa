#!/bin/sh
# Single-instance launcher for the Node root shell (rshell.js).
# This build has no `nohup`, `setsid` binary or `pgrep`; busybox provides
# `setsid`, and the lock below keeps duplicate supervisors from stacking up.
. /var/local/alvidaa/alive.sh
L=/var/local/alvidaa/rshell.lock
if mkdir "$L" 2>/dev/null; then
    echo $$ > "$L/pid"
else
    alive "$(cat "$L/pid" 2>/dev/null)" rshell.sh && exit 0
    rm -rf "$L"; mkdir "$L" 2>/dev/null || exit 1; echo $$ > "$L/pid"
fi
trap 'rm -rf "$L"' EXIT INT TERM
NODE=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix
while true; do
    "$NODE" /var/local/alvidaa/rshell.js >> /var/local/alvidaa/rshell.log 2>&1
    echo "rshell exited $(date)" >> /var/local/alvidaa/rshell.log
    sleep 3
done
