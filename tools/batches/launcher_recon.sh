export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== SystemUI / engine process ==="
$BB pidof SystemUI 2>/dev/null || echo "no SystemUI"
$BB ps | grep -v grep | grep -iE 'SystemUI|hisenseUI|startgui|operationui' | head -8
echo "=== engine assets ==="
ls -l /opt/hisenseUI/startgui.sh 2>&1
ls /opt/hisenseUI 2>/dev/null | head -10
echo "=== cobalt cache ==="
ls -ld /var/local/hisenseUI/cobalt_home/.cache/cobalt 2>&1
ls -l /var/local/hisenseUI/cobalt_home/.cache/cobalt 2>&1 | head -6
echo "=== launcher app.js (CHB) ==="
ls -l /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js 2>&1
md5sum /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js 2>&1
echo "=== secure_exec ==="
ls -l /usr/local/bin/secure_exec 2>&1
echo "=== DONE ==="
exit
