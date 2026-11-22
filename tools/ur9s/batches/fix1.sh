#!/bin/sh
# fix1 — stop the orphaned node + the looping supervisor, start exactly one.
BB=/usr/local/bin/busybox
D=/APPS/.re_sshd

echo '--- before ---'
for p in /proc/[0-9]*; do
    c=$($BB cat $p/cmdline 2>/dev/null)
    case "$c" in
        *rshell*) echo "RUNNING $p : $c" ;;
    esac
done

echo '--- stop the looping supervisor ---'
P=$(cat $D/rshell.lock/pid 2>/dev/null)
if [ -n "$P" ] && [ -d "/proc/$P" ]; then kill -9 "$P" 2>/dev/null; echo "killed supervisor $P"; fi
rm -rf $D/rshell.lock

echo '--- stop every rshell.js process (supervisor + orphaned node) ---'
for p in /proc/[0-9]*; do
    pid=${p#/proc/}
    c=$($BB cat $p/cmdline 2>/dev/null)
    case "$c" in
        *rshell*)
            kill -9 "$pid" 2>/dev/null && echo "killed $pid : $c"
            ;;
    esac
done
sleep 2

echo '--- confirm the port is free ---'
$BB grep -i ':1F48' /proc/net/tcp || echo "8008 free"

echo '--- start exactly one supervisor ---'
busybox setsid /bin/sh $D/rshell.sh >/dev/null 2>&1 </dev/null &
sleep 4
echo "lock pid: $(cat $D/rshell.lock/pid 2>/dev/null)"

echo '--- after ---'
for p in /proc/[0-9]*; do
    c=$($BB cat $p/cmdline 2>/dev/null)
    case "$c" in
        *rshell*) echo "RUNNING $p : $c" ;;
    esac
done
echo '--- listening ---'
$BB grep -i ':1F48' /proc/net/tcp
echo '--- log ---'
$BB tail -6 $D/rshell.log
