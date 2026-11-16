export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== syslog ota/upgrade lines (last 25) ==="
$BB grep -i 'ota\|upgrade' /var/log/messages 2>/dev/null | $BB tail -25
echo "=== who references app-tv / ota-tv in store configs ==="
$BB grep -rl 'app-tv\|ota-tv' /APPS/pkgs/tv.vidaapp.store 2>/dev/null
$BB grep -o 'https://[a-z.-]*' /APPS/pkgs/tv.vidaapp.store/appconfig.json 2>/dev/null | head
echo "=== current conns to 131.189.69.51 (3345BD83) ==="
$BB grep -i '3345BD83' /proc/net/tcp 2>/dev/null
echo "--- sleep 20, recheck ---"
sleep 20
$BB grep -i '3345BD83' /proc/net/tcp 2>/dev/null
echo "=== dcm config ==="
ls /var/local/dcms 2>&1 | head -5
echo "=== DONE ==="
exit
