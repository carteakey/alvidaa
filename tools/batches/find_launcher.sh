export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== /APPS/pkgs ==="
ls /APPS/pkgs 2>&1
echo "=== /APPS/channelA ==="
ls /APPS/channelA 2>&1
echo "=== find launcher app.js ==="
find /APPS -maxdepth 5 -name app.js -path '*launcher*' 2>/dev/null
echo "=== find operationui ==="
find /APPS -maxdepth 2 -iname '*operation*' 2>/dev/null
echo "=== DONE ==="
exit
