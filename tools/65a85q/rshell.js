// alvidaa root shell service for 65A85QEVS / V0000.09.60A.Q0602.
//
// This build has no dropbear, no nc, no wget/curl, and its busybox has no
// `nc` applet at all. What it does have is the vendor's Node runtime
// (`/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix`, Node 20.19.4), which
// boots as uid 0 from /var/local. So the persistent root channel is a tiny
// TCP server that spawns /bin/sh per connection.
//
// Deployed as /var/local/alvidaa/rshell.js and supervised by svc.sh.
// Port 8008 is allowed inbound by an ACCEPT rule injected at the head of both
// INPUT and FIREWALL_IN_EULAON (the vendor DROP list does not cover 8008).
const net = require('net');
const cp = require('child_process');
const PORT = 8008;
const ENV = Object.assign({}, process.env, {
  PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin'
});
net.createServer(function (sock) {
  var sh = cp.spawn('/bin/sh', [], { stdio: ['pipe', 'pipe', 'pipe'], env: ENV });
  sock.pipe(sh.stdin);
  sh.stdout.pipe(sock);
  sh.stderr.pipe(sock);
  sh.on('exit', function () { try { sock.end(); } catch (e) {} });
  sock.on('error', function () { try { sh.kill(); } catch (e) {} });
}).listen(PORT, '0.0.0.0', function () {
  console.log('alvidaa rshell listening on ' + PORT);
});
