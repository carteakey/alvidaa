#!/bin/sh
# restore_ipk.sh — put the current installer IPK back where the boot service
# looks for it. No wget/curl on this build, so the file travels base64-encoded
# through the root shell.
BB=/usr/local/bin/busybox
D=/APPS/.re_sshd

echo '=== before ==='
ls -l $D

cat > /tmp/installer.b64 <<'B64EOF'
__BASE64__
B64EOF

$BB base64 -d /tmp/installer.b64 > $D/installer.ipk
echo '=== after ==='
ls -l $D/installer.ipk
$BB md5sum $D/installer.ipk
echo '--- keep the old copy for reference ---'
ls -l $D/installer.ipk.off 2>/dev/null
echo '--- is the boot service looping? ---'
$BB tail -6 $D/boot_marker.txt
