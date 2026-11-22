#!/bin/sh
# Supervisor for the 65UR9S root shell (rshell.js) — 65UR9S / V0000.09.60V.Q0618.
#
# The Node runtime is the vendor's own binary: the phoenix host is Node
# 20.19.4 (the same binary the FaaS functions run in). Restarting it here keeps
# the root channel alive across crashes of the server process.
#
# TRAP (measured 2026-11-22): killing the supervisor does NOT kill its Node
# child. The orphan keeps port 8008 bound, the next supervisor then loops on
# EADDRINUSE every 3 s, and the log grows without bound. The child is
# therefore tracked and killed on exit, and the postinst kills any leftover
# rshell.js process before starting a new supervisor.
#
# This build has no `nohup` and no `pgrep`; busybox provides `setsid`, and the
# mkdir lock keeps duplicate supervisors from stacking up.
#
# Teardown: kill the pid in the lock directory, then rm -rf /APPS/.re_sshd.
D=/APPS/.re_sshd
L=$D/rshell.lock
NODE=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix
NPID=""

cleanup() {
    if [ -n "$NPID" ]; then kill -9 "$NPID" 2>/dev/null; fi
    rm -rf "$L"
}
trap cleanup EXIT INT TERM

if mkdir "$L" 2>/dev/null; then
    echo $$ > "$L/pid"
else
    # another supervisor is alive -> leave it alone
    PID=$(cat "$L/pid" 2>/dev/null)
    if [ -n "$PID" ] && [ -d "/proc/$PID" ]; then
        exit 0
    fi
    rm -rf "$L"
    mkdir "$L" 2>/dev/null || exit 1
    echo $$ > "$L/pid"
fi

echo "supervisor pid=$$ node=$NODE at $(date)" >> "$D/rshell.log"
while true; do
    if [ -x "$NODE" ]; then
        "$NODE" "$D/rshell.js" >> "$D/rshell.log" 2>&1 &
        NPID=$!
        # the boot service runs as uid 314 and cannot read another domain's
        # /proc entry, so the node pid is published in a world-readable file
        echo "$NPID" > "$D/rshell.pid"
        chmod 644 "$D/rshell.pid" 2>/dev/null
        wait $NPID
        echo "rshell exited rc=$? at $(date)" >> "$D/rshell.log"
    else
        echo "node runtime missing: $NODE" >> "$D/rshell.log"
    fi
    NPID=""
    sleep 3
done
