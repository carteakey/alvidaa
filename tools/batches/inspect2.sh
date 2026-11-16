export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== KILL DUPLICATE PHONEHOME ==="
for p in 8309 11464 13800 17891; do
    kill -9 "$p" 2>/dev/null && echo "killed $p"
done
sleep 1
$BB ps | grep phonehome | grep -v grep
echo "=== ALPAC AGENT ==="
cat /var/local/alpac-agent/agent.json 2>&1
echo "--- boot-hook.sh ---"
cat /var/local/alpac-agent/boot-hook.sh 2>&1
echo "--- boot-trigger ---"
cat /var/local/alpac-agent/boot-trigger 2>&1
echo "--- current ---"
cat /var/local/alpac-agent/current 2>&1
echo "--- health ---"
cat /var/local/alpac-agent/health 2>&1
echo "--- identity ---"
cat /var/local/alpac-agent/identity 2>&1
echo "--- public.pem (head) ---"
head -2 /var/local/alpac-agent/public.pem 2>&1
echo "--- supervisor.sh (head 60) ---"
head -60 /var/local/alpac-agent/supervisor.sh 2>&1
echo "=== BOOT REFS TO ALPAC ==="
grep -rl 'alpac' /etc/init.d /usr/local/scripts 2>/dev/null | head -10
echo "=== OTA SERVICE ==="
$BB ps | grep -Ei 'ota|upgrade' | grep -v grep
echo "=== TMP DEBUGPFM ==="
cat /tmp/DebugPFM_Data 2>&1
echo "=== DONE ==="
exit
