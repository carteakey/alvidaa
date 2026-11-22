#!/bin/sh
# deploy_service.sh — copy the canonical re_sshd service source (from the repo)
# onto the TV. The file travels base64-encoded through the root shell: this
# build has no wget/curl.
BB=/usr/local/bin/busybox
S=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services

cat > /tmp/re_sshd_index.b64 <<'B64EOF'
__BASE64__
B64EOF

$BB base64 -d /tmp/re_re_sshd_index.b64 > /tmp/re_sshd_index.js 2>/dev/null || \
$BB base64 -d /tmp/re_sshd_index.b64 > /tmp/re_sshd_index.js
$BB wc -c /tmp/re_sshd_index.js
cp -f /tmp/re_sshd_index.js $S/re_sshd/index.js
chown 314:314 $S/re_sshd/index.js
chmod 640 $S/re_sshd/index.js

cat > /tmp/check_deployed.js <<'CHECK_EOF'
const fs = require('fs');
const vm = require('vm');
const P = '/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/index.js';
const src = fs.readFileSync(P, 'utf8');
try { new vm.Script(src); console.log('deployed index.js parses OK (' + src.length + ' bytes)'); }
catch (e) { console.log('SYNTAX ERROR: ' + e.message); }
console.log('has pid-file detection: ' + (src.indexOf('rshell.pid') !== -1));
console.log('has proc scan: ' + (src.indexOf("readdirSync('/proc')") !== -1));
CHECK_EOF
/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix /tmp/check_deployed.js

echo '--- firewall after the reboot (the postinst must have re-inserted them) ---'
/usr/local/bin/iptables -L INPUT -n | $BB grep 8008
/usr/local/bin/iptables -L FIREWALL_IN_EULAON -n | $BB grep 8008
