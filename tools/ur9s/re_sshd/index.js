'use strict';
/*
 * re_sshd — boot persistence for the 65UR9S root channel.
 *
 * Deployed to /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/ and
 * registered in that package's serviceList.json with autoStart: true, so the
 * service manager starts it at every boot of the basic jsservice package.
 *
 * The service runs as uid 314 (the phoenix host). It cannot do root work
 * itself, so it asks the root superwatch daemon to re-install the package:
 *
 *   "90:83:90;re.installer"                     -> uninstall (idempotency)
 *   "91:82:91;/APPS/.re_sshd/installer.ipk;re.installer;"  -> install
 *
 * The install re-runs the postinst as uid 0, which re-inserts the iptables
 * rules for port 8008 (iptables lives in RAM only and is empty after a
 * reboot) and restarts the rshell supervisor. The channel is therefore back
 * a few seconds after every boot, with no browser and no operator action.
 *
 * DETECTION (measured 2026-11-22): the node process runs as uid 0 and this
 * service runs as uid 314; the phoenix domain cannot read another domain's
 * proc entry, so scanning the cmdline of every pid for "rshell.js" never
 * succeeds and the service used to re-install the package forever. The
 * supervisor now publishes the node pid in /APPS/.re_sshd/rshell.pid (world
 * readable), and the service uses that, with a TCP probe of 127.0.0.1:8008
 * as a fallback.
 *
 * Teardown: remove the re_sshd entry from serviceList.json (a pristine copy
 * is kept next to it as serviceList.json.pristine), rm -r the re_sshd
 * service directory, and remove the package + /APPS/.re_sshd.
 */
Object.defineProperty(exports, "__esModule", { value: true });
const { BaseService } = require('@sdk/baseService.js');
const net = require('net');
const fs = require('fs');

const D = '/APPS/.re_sshd';
const MARKER = D + '/boot_marker.txt';
const PIDFILE = D + '/rshell.pid';
const SOCKET = '/var/run/superwatch_socket';
const IPK = '/APPS/.re_sshd/installer.ipk';
const PAYLOADS = [
    '90:83:90;re.installer',
    '91:82:91;' + IPK + ';re.installer;'
];

function log(msg) {
    try { fs.appendFileSync(MARKER, new Date().toISOString() + ' ' + msg + '\n'); } catch (e) {}
}

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
