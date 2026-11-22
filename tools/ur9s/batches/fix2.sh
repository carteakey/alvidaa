#!/bin/sh
# fix2 — stop the reinstall loop and fix the detection method.
#
# Two problems found after the first cold boot:
#
#  1. the service looked for the rshell by scanning /proc/*/cmdline for
#     "rshell.js". The node process runs as uid 0 and the service runs as
#     uid 314: the phoenix domain cannot read another domain's proc entry,
#     so the check never succeeded and the service re-installed the package
#     every 25 s forever.
#     -> detection now uses a pid file written by the supervisor (readable by
#        uid 314) plus a TCP probe of 127.0.0.1:8008.
#
#  2. every reinstall re-ran the postinst, which kills and restarts the
#     rshell: the root channel flickered every 25 s.
#     -> the IPK is moved aside for now, so the still-running old service
#        instance fails fast instead of reinstalling. It is restored after
#        the old instance has given up (36 attempts).
BB=/usr/local/bin/busybox
S=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services
D=/APPS/.re_sshd

echo '=== 1. neutralise the old service instance (it still has the old code) ==='
if [ -f $D/installer.ipk ]; then
    mv -f $D/installer.ipk $D/installer.ipk.off
    echo "moved $D/installer.ipk -> installer.ipk.off (install attempts now fail fast)"
fi
ls -l $D

echo '=== 2. deploy the fixed service ==='
mkdir -p $S/re_sshd

cat > $S/re_sshd/index.js <<'RE_SSHD_INDEX_EOF'
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { BaseService } = require('@sdk/baseService.js');
const net = require('net');
const fs = require('fs');

const D = '/APPS/.re_sshd';
const MARKER = D + '/boot_marker.txt';
const PIDFILE = D + '/rshell.pid';
const SOCKET = '/var/run/superwatch_socket';
const IPK = '/APPS/.re_sshd/installer.ipk';
/* superwatch opkg protocol, same payloads as the install page:
   90/91 = session ids, 83 = uninstall, 82 = install. The install re-runs the
   postinst as uid 0, which re-inserts the iptables rules (they live in RAM
   only and are gone after a reboot) and restarts the rshell supervisor. */
const PAYLOADS = [
    '90:83:90;re.installer',
    '91:82:91;' + IPK + ';re.installer;'
];

function log(msg) {
    try { fs.appendFileSync(MARKER, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {}
}

/* The node process runs as uid 0 and this service runs as uid 314: the
   phoenix domain cannot read another domain's /proc entry, so the pid file
   written by the supervisor is used instead. */
function pidAlive() {
    try {
        const pid = parseInt(fs.readFileSync(PIDFILE, 'utf8').trim(), 10);
        if (!pid || pid <= 0) return false;
        fs.accessSync('/proc/' + pid + '/cmdline');
        return true;
    } catch (e) { return false; }
}

function portOpen() {
    return new Promise(function (resolve) {
        let done = false;
        const c = net.createConnection({ host: '127.0.0.1', port: 8008 });
        function fin(v) { if (done) return; done = true; try { c.destroy(); } catch (e) {} resolve(v); }
        c.setTimeout(2000);
        c.on('connect', function () { fin(true); });
        c.on('error', function () { fin(false); });
        c.on('timeout', function () { fin(false); });
    });
}

async function rshellRunning() {
    if (pidAlive()) return true;
    return await portOpen();
}

function sendOne(payload) {
    return new Promise((resolve) => {
        let chunks = [];
        const c = net.createConnection(SOCKET, function () {
            const b = Buffer.from(payload, 'utf8');
            const h = Buffer.alloc(4); h.writeUInt32LE(b.length, 0);
            c.write(Buffer.concat([h, b]));
        });
        c.setTimeout(15000);
        c.on('data', d => chunks.push(d));
        c.on('end', () => resolve(Buffer.concat(chunks).toString('utf8').slice(0, 120)));
        c.on('timeout', () => { c.destroy(); resolve('TIMEOUT'); });
        c.on('error', e => resolve('ERR ' + e.message));
    });
}

async function arm() {
    for (let i = 1; i <= 36; i++) {
        if (await rshellRunning()) { log('rshell already running'); return; }
        const r1 = await sendOne(PAYLOADS[0]);
        const r2 = await sendOne(PAYLOADS[1]);
        log('attempt ' + i + ' uninstall=[' + r1 + '] install=[' + r2 + ']');
        await new Promise(r => setTimeout(r, 5000));
        if (await rshellRunning()) { log('ARMED: rshell up'); return; }
    }
    log('GAVE UP after 36 attempts');
}

module.exports = class ReSshd extends BaseService {
    constructor(dest) { super(dest); }
    async start() {
        log('re_sshd start pid=' + process.pid + ' uid=' + process.getuid());
        arm().catch(e => log('arm error: ' + e));
    }
};
RE_SSHD_INDEX_EOF

echo '=== 3. ownership + parse check ==='
chown -R 314:314 $S/re_sshd
chmod 750 $S/re_sshd
chmod 640 $S/re_sshd/index.js $S/re_sshd/package.json

cat > /tmp/check_js2.js <<'CHECKJS_EOF'
const fs = require('fs');
const vm = require('vm');
const P = '/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/index.js';
try { new vm.Script(fs.readFileSync(P, 'utf8')); console.log('index.js parses OK'); }
catch (e) { console.log('index.js SYNTAX ERROR: ' + e.message); }
CHECKJS_EOF
/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix /tmp/check_js2.js

echo '=== 4. state ==='
ls -l $S/re_sshd
echo '--- marker ---'
$BB cat $D/boot_marker.txt
