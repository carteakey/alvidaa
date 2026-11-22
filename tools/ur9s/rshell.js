// alvidaa root shell service — 65UR9S / V0000.09.60V.Q0618.
//
// This build has no sshd, no dropbear, no nc, and its busybox has no `nc`
// applet at all (findings 01 §3). What it does have is the vendor's Node
// runtime: /APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix is Node 20.19.4,
// the same runtime the 65A85QEVS lane uses (tools/65a85q/rshell.js).
//
// The persistent root channel is therefore a tiny TCP server that spawns a
// root shell per connection. The shell is /APPS/.re_sshd/sh, a wrapper that
// sources /etc/profile (the vendor's single source of truth for PATH and
// LD_LIBRARY_PATH) and execs bash — the same design as the 75UR9S root
// shell wrapper.
//
// Port 8008 is opened inbound by the postinst with an ACCEPT rule at the
// head of INPUT and FIREWALL_IN_EULAON (the vendor chains end in -j DROP).
//
// Teardown: kill the supervisor, remove /APPS/.re_sshd, remove the two
// iptables rules, opkg remove re.installer.
const net = require('net');
const fs = require('fs');
const cp = require('child_process');

const PORT = 8008;
const DIR = '/APPS/.re_sshd';
const LOG = DIR + '/rshell.log';
const WRAP = DIR + '/sh';

function log(m) {
  try { fs.appendFileSync(LOG, new Date().toISOString() + ' ' + m + '\n'); } catch (e) {}
}

const SHELL = fs.existsSync(WRAP) ? WRAP : '/bin/bash';
log('rshell start pid=' + process.pid + ' uid=' + process.getuid() + ' shell=' + SHELL);

net.createServer(function (sock) {
  log('connection from ' + sock.remoteAddress);
  var sh;
  try {
    sh = cp.spawn(SHELL, [], { stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    log('spawn failed: ' + e);
    try { sock.end('spawn failed: ' + e + '\n'); } catch (e2) {}
    return;
  }
  sock.pipe(sh.stdin);
  sh.stdout.pipe(sock);
  sh.stderr.pipe(sock);
  sh.on('exit', function (code) { log('shell exit code=' + code); try { sock.end(); } catch (e) {} });
  sh.on('error', function (e) { log('shell error: ' + e); try { sock.end(); } catch (e2) {} });
  sock.on('error', function (e) { log('socket error: ' + e); try { sh.kill(); } catch (e2) {} });
  sock.on('close', function () { log('connection closed'); });
}).listen(PORT, '0.0.0.0', function () {
  log('listening on ' + PORT + ' as uid ' + process.getuid());
  console.log('alvidaa rshell (65UR9S) listening on ' + PORT);
});
