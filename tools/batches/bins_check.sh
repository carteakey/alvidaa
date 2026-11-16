export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== /bin binaries the switch script needs ==="
for b in cat cp chown chmod mv mkdir rm sleep kill grep sed md5sum pidof dd base64 gzip; do
  if [ -x "/bin/$b" ]; then echo "ok  /bin/$b"; elif command -v "$b" >/dev/null 2>&1; then echo "alt $(command -v $b)"; else echo "MISSING $b (busybox: $($B --list | grep -x $b || echo no))"; fi
done
echo "=== bridge watcher config present? ==="
ls -l /var/local/alvidaa/config.json 2>&1
ls -l /var/local/bridge 2>&1
echo "=== CONFIG paths ==="
$BB find /var/local -maxdepth 2 -name 'config.json' 2>/dev/null
echo "=== /bin/sh identity ==="
ls -l /bin/sh
echo "=== DONE ==="
exit
