#!/bin/sh
# diag3 — how a service is declared and loaded on this build
BB=/usr/local/bin/busybox
S=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA

echo '--- fetcher service index.js (head) ---'
$BB head -30 $S/services/fetcher/index.js
echo ''
echo '--- tvinfo service index.js (head) ---'
$BB head -20 $S/services/tvinfo/index.js
echo ''
echo '--- serviceManager: selfStart / autoStart / require ---'
$BB grep -n -E 'selfStart|autoStart|require\(|@sdk|baseService' $S/lib/serviceManager.js | $BB head -40
echo ''
echo '--- module-alias mapping ---'
$BB grep -n -E '@sdk|_moduleAliases|paths' $S/run_env.js $S/phoenix.server.js 2>/dev/null | $BB head -20
echo ''
echo '--- any @sdk dir anywhere in the package ---'
find $S -maxdepth 4 -name 'baseService.js' 2>/dev/null
find /APPS/pkgs -maxdepth 6 -path '*@sdk*' -name '*.js' 2>/dev/null | $BB head -10
echo '--- services with a package.json ---'
for d in $S/services/*/; do echo "$d : $($BB cat $d/package.json 2>/dev/null | $BB tr -d '\n' | $BB head -c 200)"; done
