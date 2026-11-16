export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== current symlink ==="
ls -l /APPS/pkgs/tv.vidaa.app.operationui/current 2>&1
readlink /APPS/pkgs/tv.vidaa.app.operationui/current 2>&1
echo "=== CHA vs CHB launcher ==="
ls -l /APPS/pkgs/tv.vidaa.app.operationui/CHA/apps/launcher/js/app.js 2>&1
ls -l /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js 2>&1
echo "=== GET_PKG_DEST ==="
cat /usr/local/scripts/get_pkg_dest.sh 2>&1 | head -30
echo "=== cobalt cache full ==="
ls -l /var/local/hisenseUI/cobalt_home/.cache/cobalt/ 2>&1
echo "=== DONE ==="
exit
