export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
echo "=== apply OTA freeze now ==="
/bin/sh "$D/boot.sh" ota
echo "=== verify ==="
iptables -S OUTPUT | head -5
echo "--- probe ota host from the TV (should fail/refuse) ---"
$BB nslookup ota-tv.vidaahub.com 2>&1 | tail -4
echo "=== restart svc with new loop ==="
P=$(cat "$D/svc.lock/pid" 2>/dev/null)
if [ -n "$P" ] && grep -qa 'svc\.sh' "/proc/$P/cmdline" 2>/dev/null; then
    kill -9 "$P" && echo "killed old svc pid=$P"
fi
rm -rf "$D/svc.lock"
/bin/sh "$D/boot.sh"
sleep 3
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.js'
$BB tail -3 "$D/boot.log"
echo "=== DONE ==="
exit
