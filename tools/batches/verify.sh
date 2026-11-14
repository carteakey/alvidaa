export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
echo "=== GATE AFTER REPLANT ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup 2>&1
echo "--- payload.log ---"
$BB tail -3 "$D/payload.log" 2>&1
echo "--- proof.txt ---"
cat "$D/proof.txt" 2>&1
echo "--- boot.log ---"
$BB tail -5 "$D/boot.log" 2>&1
echo "=== SERVICES (must be one each) ==="
$BB ps | grep -v grep | grep -E 'rshell\.sh|phonehome\.sh|svc\.sh|rshell\.js'
echo "=== DONE ==="
exit
