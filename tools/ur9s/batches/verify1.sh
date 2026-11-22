#!/bin/sh
# verify1 — confirm a single supervisor, a single node, and a stable log.
BB=/usr/local/bin/busybox
D=/APPS/.re_sshd

echo '--- identity ---'
grep -E '^(Uid|Gid|CapEff):' /proc/self/status
echo "PATH=$PATH"

echo '--- rshell processes (expect exactly 1 supervisor + 1 node) ---'
for p in /proc/[0-9]*; do
    c=$($BB cat $p/cmdline 2>/dev/null)
    case "$c" in
        *rshell*) echo "$p : $c" ;;
    esac
done

echo '--- supervisor lock ---'
cat $D/rshell.lock/pid

echo '--- listening on 8008 ---'
$BB grep -i ':1F48' /proc/net/tcp

echo '--- log size / last lines ---'
$BB wc -c $D/rshell.log
$BB tail -8 $D/rshell.log

echo '--- uptime / boot id ---'
cat /proc/uptime
cat /proc/sys/kernel/random/boot_id

echo '--- packages (re.installer) ---'
/usr/local/bin/opkg list-installed 2>/dev/null | $BB grep -i installer
$BB grep -A3 -i 'Package: re.installer' /APPS/pkgs/opkgmeta/status 2>/dev/null | $BB head -8
