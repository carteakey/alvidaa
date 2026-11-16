export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== operationui launcher on this fw ==="
ls -ld /APPS/pkgs/tv.vidaa.app.operationui/CHA/apps/launcher/js 2>&1
ls -l /APPS/pkgs/tv.vidaa.app.operationui/CHA/apps/launcher/js/app.js 2>&1
echo "=== OTA hostnames: search configs ==="
grep -rhoE '[a-zA-Z0-9.-]*ota[a-zA-Z0-9.-]*\.(com|net|cn|io)' /OAD/pkgs /var/local/dcms 2>/dev/null | sort -u | head
grep -rhoE 'https?://[a-zA-Z0-9.-]+' /var/log/messages 2>/dev/null | sort -u | head -20
echo "=== ota_upgrade strings (urls) ==="
OTA=$($BB ps | grep -v grep | grep -i 'ota_upgrade' | awk '{print $5}')
echo "ps-name-match: $OTA"
for p in $($BB ps | grep -v grep | awk 'tolower($0) ~ /ota/ {print $1}'); do
  echo "--- pid $p ---"
  $BB strings /proc/$p/exe 2>/dev/null | grep -iE 'http|ota.*\.com' | head -10
done
echo "=== external peers now ==="
awk 'NR>1 && $4=="01" {split($3,a,":"); if (a[1] != "0100007F") print $2 "-> " a[1]}' /proc/net/tcp 2>/dev/null
echo "=== dns server ==="
cat /etc/resolv.conf 2>&1
echo "=== DONE ==="
exit
