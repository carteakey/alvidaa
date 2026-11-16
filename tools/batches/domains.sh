export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== domain_list.json ==="
cat /APPS/domain/domain_list.json 2>&1
echo "=== nslookup test (busybox) ==="
$BB nslookup ota-tv.vidaahub.com 2>&1 | head -8
echo "=== DONE ==="
exit
