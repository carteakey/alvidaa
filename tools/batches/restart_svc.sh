export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa

P=$($BB ps | grep -v grep | grep 'rshell\.js' | awk '{print $1}' | head -1)
echo "current node pid=$P"
(
    sleep 2
    [ -n "$P" ] && kill -9 "$P" 2>/dev/null
    sleep 2
    rm -rf "$D/svc.lock" "$D/rshell.lock" "$D/phonehome.lock"
    $BB setsid /bin/sh "$D/svc.sh" >/dev/null 2>&1 < /dev/null &
    sleep 6
    {
        echo "--- restart $(date) ---"
        $BB ps | grep -v grep | grep -E 'rshell|phonehome|svc\.sh'
        echo "listen=$(grep -ci ':1F48' /proc/net/tcp)"
    } >> "$D/svc.log" 2>&1
) >/dev/null 2>&1 < /dev/null &
echo "restart scheduled in 2s"
exit
