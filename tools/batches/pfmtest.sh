export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa

echo "=== BEFORE ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/DebugPowerup 2>&1
echo "=== RUN pfm-manager.sh (boot path dry-run) ==="
/bin/bash /usr/local/scripts/pfm-manager.sh 2>&1 | head -20
echo "rc=$?"
sleep 2
echo "=== RIGHT AFTER (gate should be wiped) ==="
ls -ld /var/local/pfmParse 2>&1
ls -l /var/local/DebugPowerup 2>&1
echo "=== PAYLOAD LOG ==="
cat "$D/payload.log" 2>&1
echo "=== DONE ==="
exit
