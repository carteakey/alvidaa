export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
echo "=== ID ==="
$BB id; $BB uname -a
grep -E '^(Uid|Gid|CapEff):' /proc/self/status
echo "=== UPTIME ==="
cat /proc/uptime
echo "=== VARLOCAL ==="
ls -la /var/local
echo "=== PFM ==="
ls -la /var/local/pfmParse /var/local/pfmParse/Data 2>&1
head -4 /var/local/pfmParse/PFMCheck 2>&1
cat /var/local/pfmParse/Data/platform.txt 2>&1
cat /var/local/alvidaa/payload.log 2>&1
echo "=== PROOF ==="
cat /var/local/alvidaa/proof.txt 2>&1
echo "=== MOUNTS ==="
cat /proc/mounts
echo "=== IPTABLES ==="
iptables -S
iptables -L FIREWALL_IN_EULAON -n | head -20
echo "=== TCP ==="
cat /proc/net/tcp | head -20
echo "=== APPS ==="
ls -la /APPS | head -40
echo "=== CHANNELS ==="
ls -la /APPS/.alvidaa 2>&1
echo "=== PROCS ==="
$BB ps
echo "=== BIN ==="
ls /bin | head -100
echo "=== USRBIN ==="
ls /usr/bin 2>/dev/null | head -100
echo "=== USRSBIN ==="
ls /usr/sbin 2>/dev/null | head -100
echo "=== VENDOR ==="
ls -la /var/local/alpac* 2>&1
echo "=== DONE ==="
exit
