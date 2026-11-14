export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
D=/var/local/alvidaa
mkdir -p "$D"
echo "=== deploy ==="
echo "=== boot.sh ==="
cat > "$D/boot.sh" <<'BATCH_EOF'
#!/bin/sh
# alvidaa boot persistence (uid 0). Called from the PFM lane after boot:
#   sh /var/local/alvidaa/boot.sh            -> firewall + start the supervisor
#   sh /var/local/alvidaa/boot.sh replant     -> restore the PFM gate only
#   sh /var/local/alvidaa/boot.sh fw          -> re-open 8008/2222 (idempotent)
#
# The PFM payload below is the single source of truth: the boot hook, the
# post-wipe repair (svc.sh) and manual re-seeding all call `replant`.
BB=/usr/local/bin/busybox
LOG=/var/local/alvidaa/boot.log
export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
say() { echo "$(date) $*" >> "$LOG"; }

# iptables rules live only in RAM: every reboot starts from the vendor policy
# again, where INPUT/FIREWALL_IN_EULAON end in DROP. The postinst inserts the
# same two ACCEPTs at the head of both chains; boot.sh re-applies them because
# the service is useless if the LAN cannot reach :8008.
fw() {
    for P in 8008 2222; do
        iptables -C INPUT -p tcp --dport "$P" -j ACCEPT 2>/dev/null ||
            iptables -I INPUT 1 -p tcp --dport "$P" -j ACCEPT 2>/dev/null
        iptables -C FIREWALL_IN_EULAON -p tcp --dport "$P" -j ACCEPT 2>/dev/null ||
            iptables -I FIREWALL_IN_EULAON 1 -p tcp --dport "$P" -j ACCEPT 2>/dev/null
    done
}

# OTA freeze, the 55E7QTUK recipe: REJECT the CDN IP behind
# ota-tv.vidaahub.com and upgrade-plc-tv-eu.vidaahub.com (both resolve to
# 131.189.69.51; no AAAA). The store's own APIs are elsewhere
# (appstore/odinstore on CloudFront, auth on 131.189.128.123), so this cuts
# only the firmware-upgrade lane. /OAD is never touched — this is network
# level, and the signed upgradeFlag is already 0.
OTA_IP=131.189.69.51
ota() {
    iptables -C OUTPUT -d "$OTA_IP" -j REJECT 2>/dev/null ||
        iptables -I OUTPUT 1 -d "$OTA_IP" -j REJECT 2>/dev/null
}

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
    fw
    ota
    ps 2>/dev/null | grep -v grep | grep -q 'svc\.sh' || {
        $BB setsid /bin/sh /var/local/alvidaa/svc.sh >/dev/null 2>&1 < /dev/null &
        say "svc started pid=$!"
    }
    [ -f /var/local/pfmParse/PFMCheck ] || replant
    [ -f /var/local/DebugPowerup ] || { touch /var/local/DebugPowerup; chmod 644 /var/local/DebugPowerup; }
    sleep 2
    say "fw8008=$(iptables -S INPUT 2>/dev/null | grep -c 'dport 8008') listen8008=$(grep -ci ':1F48' /proc/net/tcp 2>/dev/null) boot.sh done"
}

case "$1" in
    replant) replant ;;
    fw) fw ;;
    ota) ota ;;
    *) say "boot.sh start uptime=$(cut -d' ' -f1 /proc/uptime 2>/dev/null)"; start ;;
esac
BATCH_EOF
echo "=== svc.sh ==="
cat > "$D/svc.sh" <<'BATCH_EOF'
#!/bin/sh
# Single supervisor. Every 30 s it makes sure the root shell service is up and
# the PFM gate still exists; pfm-manager wipes /var/local/pfmParse and
# /var/local/DebugPowerup after every run, so this is the repair loop that
# makes the lane self-healing.
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
    /bin/sh "$D/boot.sh" fw   >/dev/null 2>&1
    /bin/sh "$D/boot.sh" ota  >/dev/null 2>&1
    [ -f /var/local/pfmParse/PFMCheck ] || /bin/sh "$D/boot.sh" replant >/dev/null 2>&1
    [ -f /var/local/DebugPowerup ] || { touch /var/local/DebugPowerup; chmod 644 /var/local/DebugPowerup; }
    sleep 30
done
BATCH_EOF

chmod 755 "$D"/*.sh
chmod 644 "$D/alive.sh" "$D/rshell.js" 2>/dev/null
echo "--- syntax ---"
for f in "$D"/svc.sh "$D"/boot.sh; do
    sh -n "$f" && echo "ok $f" || echo "SYNTAX FAIL $f"
done
echo "=== DONE ==="
exit
