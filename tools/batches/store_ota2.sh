export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== store host.log ==="
cat /var/local/vidaapp-native-store/host.log 2>&1
echo "=== journal dir ==="
ls -la /var/local/vidaapp-native-store/journal 2>&1 | head
find /var/local/vidaapp-native-store/journal -type f 2>/dev/null | head -5
echo "=== who else autostarts the store host (search boot refs) ==="
grep -rl 'vidaapp-native-store' /usr/local/scripts /etc/init.d /APPS/channelA 2>/dev/null | head -10
echo "=== ota_upgrade lines in syslog (last 30) ==="
grep -i 'ota' /var/log/messages 2>/dev/null | tail -30
echo "=== ota_upgrade peers now ==="
for p in $($BB ps | grep -v grep | grep -i ota | awk '{print $1}'); do
  echo "pid $p inodes:"; ls -l /proc/$p/fd 2>/dev/null | grep socket | awk '{print $NF}' | tr -d 'socket()'
done
echo "=== current ESTABLISHED peers (non-local) ==="
awk 'NR>1 && $4=="01" {print $2, $3}' /proc/net/tcp 2>/dev/null | head -20
echo "=== hosts file ==="
cat /etc/hosts 2>&1
echo "=== launcher bundle paths on this fw ==="
ls -ld /APPS/channelA/operation-ui/apps/launcher/js 2>&1
ls /APPS/channelA/operation-ui/apps 2>/dev/null | head -10
ls -ld /APPS/channelA/hisenseUI 2>&1
echo "=== DONE ==="
exit
