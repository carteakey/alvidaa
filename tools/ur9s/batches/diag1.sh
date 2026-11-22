#!/bin/sh
# diagnostic batch — 65UR9S root shell, run with tools/ur9s/win-tvsh.ps1 -File
BB=/usr/local/bin/busybox
echo '--- /etc/profile (PATH / LD_LIBRARY lines) ---'
$BB grep -n -E 'PATH|LD_LIBRARY' /etc/profile
echo '--- /bin sample ---'
ls /bin | $BB head -20
echo '--- /usr/local/bin sample ---'
ls /usr/local/bin | $BB head -20
echo '--- applet links tail/cat/sed/head ---'
ls -l /usr/local/bin/tail /usr/local/bin/cat /usr/local/bin/sed /usr/local/bin/head 2>&1
echo '--- processes running rshell.js ---'
for p in /proc/[0-9]*; do
    c=$($BB cat $p/cmdline 2>/dev/null)
    case "$c" in
        *rshell*) echo "$p : $c" ;;
    esac
done
echo '--- supervisor lock pid ---'
cat /APPS/.re_sshd/rshell.lock/pid
echo '--- iptables :8008 ---'
/usr/local/bin/iptables -L INPUT -n | $BB grep 8008
/usr/local/bin/iptables -L FIREWALL_IN_EULAON -n | $BB grep 8008
echo '--- /etc/profile full ---'
$BB cat /etc/profile
