export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== ALPAC agent files ==="
ls -la /var/local/alpac-agent 2>&1
echo "--- agent.json ---"
cat /var/local/alpac-agent/agent.json 2>&1
echo "--- supervisor.sh (head 60) ---"
head -60 /var/local/alpac-agent/supervisor.sh 2>&1
echo "=== STORE / ALPAC processes now ==="
$BB ps | grep -v grep | grep -iE 'alpac|store|lifeaa|market|appmarket' 
echo "=== OTA config / logs ==="
ls -la /OAD 2>&1 | head -30
echo "--- nightupdate.ini ---"
cat /var/local/nightupdate.ini 2>&1
echo "--- AppUpgradeSwitch ---"
cat /OAD/AppUpgradeSwitch.json 2>&1
echo "=== OTA log locations ==="
ls -la /tvlogs /var/log 2>&1 | head -20
ls -la /OAD/log /OAD/Log 2>&1 | head -20
echo "=== ota_upgrade cmdline ==="
for p in $($BB ps | grep -v grep | grep -i ota | awk '{print $1}'); do echo "pid $p:"; tr '\0' ' ' < /proc/$p/cmdline; echo; done
echo "=== DONE ==="
exit
