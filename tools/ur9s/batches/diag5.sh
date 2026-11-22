#!/bin/sh
# diag5 — compare the deployed service file with the intended source
BB=/usr/local/bin/busybox
S=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/index.js
echo '--- deployed size + md5 ---'
$BB wc -c $S
$BB md5sum $S
echo '--- first 12 lines ---'
$BB head -12 $S
echo '--- lines with for( ---'
$BB grep -n 'for (' $S
echo '--- lines 100-120 ---'
$BB sed -n '100,120p' $S
echo '--- tail ---'
$BB tail -6 $S
echo '--- hexdump of the first bytes (BOM?) ---'
$BB od -c $S | $BB head -3
