export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
echo "=== ID / UPTIME ==="
$BB id
cat /proc/uptime
cat /proc/sys/kernel/random/boot_id
echo "=== FIREWALL (relevant) ==="
iptables -S INPUT
iptables -S FIREWALL_IN_EULAON | head -8
echo "=== 8008 ==="
grep -i ':1F48' /proc/net/tcp | head -4
echo "=== SERVICES ==="
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.sh|rshell\.js|phonehome\.sh'
echo "=== GATE ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/DebugPowerup
echo "=== BOOT LOG ==="
$BB tail -6 "$D/boot.log"
echo "=== PAYLOAD LOG ==="
$BB tail -4 "$D/payload.log"
echo "=== DONE ==="
exit
