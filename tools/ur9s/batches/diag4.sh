#!/bin/sh
# diag4 — the serviceManager's service-list loading code
BB=/usr/local/bin/busybox
S=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA
echo '--- serviceManager.js lines 170-230 ---'
$BB sed -n '170,230p' $S/lib/serviceManager.js
echo ''
echo '--- lines 40-70 ---'
$BB sed -n '40,70p' $S/lib/serviceManager.js
echo ''
echo '--- BASIC_JS_LIB env in run_env.js ---'
$BB head -12 $S/run_env.js
echo '--- where is BASIC_JS_LIB set? ---'
$BB grep -rn 'BASIC_JS_LIB' /APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin 2>/dev/null | $BB head -3
$BB grep -rn 'BASIC_JS_LIB' $S 2>/dev/null | $BB head -5
