export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== numeric owners ==="
ls -ln /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
ls -ln /var/local/hisenseUI/cobalt_home/.cache/cobalt | head -6
echo "=== UhisUI / UhisApp ids ==="
grep -E 'UhisUI|UhisApp' /etc/passwd 2>/dev/null
$BB grep -E 'UhisUI|UhisApp' /etc/passwd 2>/dev/null
echo "=== startgui.sh ==="
cat /opt/hisenseUI/startgui.sh 2>&1
echo "=== DONE ==="
exit
