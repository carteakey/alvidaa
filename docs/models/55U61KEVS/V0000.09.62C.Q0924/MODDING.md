# 55U61KEVS V0000.09.62C.Q0924 — modding notes

## What was changed (all additive, all on rw partitions)

- **Root:** patched static ARMv7 Dropbear (key-only) at `/APPS/.re_sshd/`, port 8008,
  package `re.installer`, `/APPS/shell` whitelist, one `FIREWALL_IN_EULAON` ACCEPT
  rule for 8008, `/dev/ptmx` + `/dev/pts/ptmx` chmod 666.
- **Persistence:** `re_sshd` service + one `serviceList.json` entry in
  `tv.vidaa.jsservice.basic/CHA/services/`.
- **Launcher:** `operation-ui` `app.js` route-swapped (component for `/Launcher`
  only). Stock backup at `/var/local/alvidaa/backup/app.js.stock`.

The read-only rootfs and `/OAD` staging are never written; verified boot stays green.

## Teardown (failure-safe, idempotent)

Restores and **verifies** the stock launcher + `serviceList.json` *before*
removing root. Full script (with a read-only `check` mode) lives in the
`launcher-dev/` kit; the essence:

```sh
# 1. rollback launcher, verify md5
/bin/sh /var/local/alvidaa/switch-home.sh rollback
# 2. restore serviceList.json from .pristine, verify
# 3. rm -rf services/re_sshd ; rm /APPS/.re_sshd/boot_marker.txt
# 4. opkg remove re.installer
# 5. rm -rf /APPS/.re_sshd ; rm -f /APPS/installer.ipk /APPS/shell …/functions/fetch/sw2.js
# 6. iptables -D FIREWALL_IN_EULAON -p tcp --dport 8008 -j ACCEPT
# 7. chmod 660 /dev/ptmx ; chmod 000 /dev/pts/ptmx   # originals (660 root:509 / 000)
# 8. rm -rf /var/local/alvidaa
# 9. kill <dropbear pid>   # last — ends SSH
```

## Re-arm after a kill (without reboot)

`re_sshd` re-arms dropbear at boot automatically. Manually: superwatch
`83` (uninstall) then `82` (install of `/APPS/installer.ipk`).

## OTA

`/OAD/AppUpgradeSwitch.json` `upgradeFlag: "0"` (already frozen at install time).
