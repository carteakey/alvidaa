export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa

echo "=== 1. restore the v3 gate (boot.sh source of truth) ==="
/bin/sh "$D/boot.sh" replant
ls -l /var/local/pfmParse/PFMCheck /var/local/DebugPowerup

echo "=== 2. restart the supervisor with the new loop ==="
P=$(cat "$D/svc.lock/pid" 2>/dev/null)
if [ -n "$P" ] && grep -qa 'svc\.sh' "/proc/$P/cmdline" 2>/dev/null; then
    kill -9 "$P" && echo "killed old svc pid=$P"
fi
rm -rf "$D/svc.lock"
/bin/sh "$D/boot.sh"
sleep 3

echo "=== 3. verify ==="
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.sh|rshell\.js'
echo "--- firewall head ---"
iptables -S INPUT | head -4
iptables -S FIREWALL_IN_EULAON | head -3
echo "--- listen ---"
grep -i ':1F48' /proc/net/tcp | head -2
echo "--- gate ---"
ls -l /var/local/pfmParse/PFMCheck /var/local/DebugPowerup
echo "--- boot.log ---"
$BB tail -6 "$D/boot.log"
echo "=== DONE ==="
exit
