export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa

echo "=== WHO AM I ==="
$BB id
$BB uname -a
grep -E '^(Uid|Gid|CapEff):' /proc/self/status
echo "=== UPTIME (small = fresh boot) ==="
cat /proc/uptime
echo "=== HOSTNAME / BOOT ID ==="
$BB hostname
cat /proc/sys/kernel/random/boot_id
echo "=== GATE ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup 2>&1
echo "=== PAYLOAD LOG ==="
$BB tail -5 "$D/payload.log" 2>&1
echo "=== BOOT LOG ==="
$BB tail -10 "$D/boot.log" 2>&1
echo "=== SERVICES ==="
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.sh|rshell\.js|phonehome\.sh'
echo "=== LISTEN 8008 ==="
grep -i ':1F48' /proc/net/tcp | head -3
echo "=== ALPAC (store agent: should be absent) ==="
$BB ps | grep -v grep | grep -E 'alpac|supervisor\.sh' || echo "no alpac processes"
echo "=== PROOF ==="
cat "$D/proof.txt" 2>&1
echo "=== DONE ==="
exit
