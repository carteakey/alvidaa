#!/bin/sh
# reboot the TV from the root shell (the boot test for the persistence service)
BB=/usr/local/bin/busybox
echo "pre-reboot boot_id: $(cat /proc/sys/kernel/random/boot_id)"
echo "pre-reboot uptime:  $(cat /proc/uptime)"
sync
echo 'rebooting...'
/bin/sync
$BB reboot
sleep 5
echo 'the connection should be dead by now'
