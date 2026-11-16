export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
B=$D/backup
mkdir -p "$B"
cp -a /var/local/DebugPFM_Ctrl "$B/DebugPFM_Ctrl.vendor" 2>/dev/null
cp -a /var/local/DebugPowerup "$B/DebugPowerup.vendor" 2>/dev/null
cp -a /var/local/alpac-agent/boot-hook.sh "$B/alpac-boot-hook.sh" 2>/dev/null
cp -a /var/local/alpac-agent/boot-trigger "$B/alpac-boot-trigger" 2>/dev/null
cp -a /var/local/alpac-agent/agent.json "$B/alpac-agent.json" 2>/dev/null
cp -a /APPS/installer.ipk "$B/installer.ipk" 2>/dev/null
chmod 600 "$B"/* 2>/dev/null
echo "=== BACKUP ==="
ls -la "$B"
echo "=== GATE NOW ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup
echo "=== SERVICES ==="
$BB ps | grep -v grep | grep -E 'svc\.sh|rshell\.sh|rshell\.js|phonehome\.sh'
echo "=== LISTEN ==="
grep -ci ':1F48' /proc/net/tcp
echo "=== UPTIME ==="
cat /proc/uptime
echo "=== DONE ==="
exit
