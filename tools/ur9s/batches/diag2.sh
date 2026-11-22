#!/bin/sh
# diag2 — what the boot-persistence service needs to look like
BB=/usr/local/bin/busybox
S=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services

echo '--- services dir ---'
ls -la $S
echo '--- serviceList.json (verbatim) ---'
$BB cat $S/serviceList.json
echo ''
echo '--- package.json of an existing service (fetcher) ---'
$BB cat $S/fetcher/package.json 2>/dev/null
echo ''
echo '--- baseService.js location ---'
ls -la /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/lib/ 2>/dev/null | $BB head -20
echo '--- node_modules sdk ---'
ls /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/node_modules/ 2>/dev/null | $BB head -20
echo '--- sdk/baseService.js ---'
ls -la /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/node_modules/@sdk/ 2>/dev/null | $BB head -20
echo '--- /APPS/.re_sshd perms ---'
ls -lad /APPS/.re_sshd
echo '--- id of the app context (uid 314) ---'
$BB cat /etc/passwd | $BB grep -E 'phoenix|hisense|app' | $BB head -6
