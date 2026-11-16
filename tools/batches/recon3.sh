export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
NODE=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix

echo "=== ARCH ==="
$NODE -e 'console.log("arch="+process.arch, "platform="+process.platform, "version="+process.version)' 2>&1 | grep -v Warning
$BB uname -m
echo "=== CRITICAL.INI ==="
cat /hidata/critical/config/critical.ini 2>&1 | head -60
echo "=== MODELINFO ==="
cat /APPS/ModelInfo.ini 2>&1
echo "=== BROWSER APPINFO ==="
cat /APPS/pkgs/tv.vidaa.app.browser/CHA/appinfo.json 2>&1 | head -20
echo "=== OTA STATE ==="
ls -l /OAD/AppUpgradeSwitch.json 2>&1
cat /OAD/AppUpgradeSwitch.json 2>&1
echo "--- nightupdate ---"
cat /var/local/nightupdate.ini 2>&1
echo "--- ota history ---"
cat /APPS/ota_history.ini 2>&1
echo "=== BIZM / CLI ==="
which bizm 2>&1
ls -l /usr/local/bin/bizm /usr/bin/cli 2>&1
echo "=== SETTINGS DUMP (autoupdate keys) ==="
/usr/bin/cli 2>&1 | head -5
echo "=== DONE ==="
exit
