export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== operationui tree (3 levels) ==="
find /APPS/pkgs/tv.vidaa.app.operationui -maxdepth 3 2>/dev/null | head -40
echo "=== all app.js under operationui ==="
find /APPS/pkgs/tv.vidaa.app.operationui -name '*.js' -size +100k 2>/dev/null | head
echo "=== launcher dirs anywhere ==="
find /APPS -maxdepth 6 -type d -name launcher 2>/dev/null
echo "=== vidaapp.store tree (2) ==="
find /APPS/pkgs/tv.vidaapp.store -maxdepth 2 2>/dev/null | head -20
echo "=== DONE ==="
exit
