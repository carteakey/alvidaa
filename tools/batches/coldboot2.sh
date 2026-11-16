export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
echo "=== ID ==="
$BB id
echo "=== UPTIME / BOOT_ID ==="
cat /proc/uptime
cat /proc/sys/kernel/random/boot_id
echo "=== BOOT LOG ==="
$BB tail -8 "$D/boot.log"
echo "=== PAYLOAD LOG ==="
$BB tail -3 "$D/payload.log"
echo "=== FIREWALL ==="
iptables -S INPUT | head -4
iptables -S FIREWALL_IN_EULAON | head -3
echo "=== SERVICES ==="
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.sh|rshell\.js|phonehome\.sh'
echo "=== GATE ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/DebugPowerup
echo "=== DONE ==="
exit
