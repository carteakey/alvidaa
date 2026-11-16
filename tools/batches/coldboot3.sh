export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
echo "=== ID / BOOT ==="
$BB id
cat /proc/uptime
cat /proc/sys/kernel/random/boot_id
echo "=== BOOT LANE LOG ==="
$BB tail -6 "$D/boot.log"
echo "=== FIREWALL (fw) ==="
iptables -S INPUT | head -4
echo "=== OTA FREEZE (ota) ==="
iptables -S OUTPUT | head -3
echo "=== LAUNCHER ==="
md5sum /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
/bin/pidof SystemUI
grep -E '^(Uid):' /proc/$(/bin/pidof SystemUI | awk '{print $1}')/status 2>/dev/null
echo "=== SERVICES ==="
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.js' | head -4
echo "=== GATE ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/DebugPowerup
echo "=== DONE ==="
exit
