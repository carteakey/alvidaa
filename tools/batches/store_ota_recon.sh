export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== who started the store host ==="
ls -ld /proc/21161 2>&1
grep -E '^(Name|Pid|PPid|Uid):' /proc/21161/status 2>&1
echo "--- cmdline ---"
$BB cat /proc/21161/cmdline 2>&1 | tr '\0' ' ' 2>/dev/null || $BB cat /proc/21161/cmdline
echo ""
echo "--- parent chain ---"
PP=$(awk '/^PPid:/{print $2}' /proc/21161/status 2>/dev/null)
while [ -n "$PP" ] && [ "$PP" != "1" ] && [ "$PP" != "0" ]; do
  echo "parent $PP: $(grep '^Name:' /proc/$PP/status 2>/dev/null)"
  PP=$(awk '/^PPid:/{print $2}' /proc/$PP/status 2>/dev/null)
done
echo "=== alpac health/bootstrap ==="
cat /var/local/alpac-agent/health 2>&1
cat /var/local/alpac-agent/bootstrap.log 2>&1
echo "--- runtime dirs (did supervisor run this boot?) ---"
ls -la /var/local/alpac-agent/runtime 2>&1
echo "=== vidaapp-native-store dir ==="
ls -la /var/local/vidaapp-native-store 2>&1 | head -15
echo "=== OTA hosts in logs ==="
grep -hoE 'https?://[a-zA-Z0-9.-]+' /var/log/messages 2>/dev/null | sort -u | head -30
echo "--- ota process log (sep 13) hosts ---"
grep -hoE 'https?://[a-zA-Z0-9.-]+|OTA[A-Z_]*URL=[^ "]*' /OAD/ota_single_upgradeprocess_log.txt 2>/dev/null | sort -u | head -20
echo "--- leak_log ---"
head -20 /OAD/leak_log 2>&1
echo "=== DONE ==="
exit
