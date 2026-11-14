export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa

echo "=== KILL OLD WRAPPERS (\$BB ps) ==="
for pat in 'rshell\.sh' 'phonehome\.sh' 'watchdog\.sh' 'svc\.sh'; do
    $BB ps | grep -v grep | grep "$pat" | awk '{print $1}' | while read p; do
        kill -9 "$p" 2>/dev/null && echo "killed $pat pid=$p"
    done
done
rm -rf "$D/svc.lock" "$D/rshell.lock" "$D/phonehome.lock"
: > "$D/rshell.log"
echo "--- remaining wrappers ---"
$BB ps | grep -v grep | grep -E 'rshell|phonehome|watchdog|svc\.sh'
echo "--- node ---"
$BB ps | grep -v grep | grep 'rshell\.js'
echo "=== DONE ==="
exit
