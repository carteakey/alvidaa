export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa

echo "=== PRE-REBOOT SNAPSHOT ==="
date
cat /proc/uptime
ls -l /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.js'
echo "--- boot.log ---"
$BB tail -4 "$D/boot.log"
echo "--- sync ---"
sync
sync
echo "=== SCHEDULING REBOOT in 3s ==="
(
    sleep 3
    /sbin/reboot 2>/dev/null || /bin/reboot 2>/dev/null || reboot 2>/dev/null
) >/dev/null 2>&1 < /dev/null &
echo "reboot scheduled"
exit
