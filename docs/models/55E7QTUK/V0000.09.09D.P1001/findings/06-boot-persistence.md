# 06 — Root re-arms itself at cold boot (2026-11-08)

Owner-requested boot persistence on the 55E7QTUK (`09.09D.P1001`). Deployed
the 55A7KAU-verified `re_sshd` pattern (same `09.09` OS branch, identical
superwatch ids `54`/`53`) into the basic package's service tree and verified
it on a genuine cold boot (kernel sysrq restart, no PC in the loop).

## What is deployed (verified)

| Path | What |
| --- | --- |
| `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/index.js` | the service (1:1 the `source/re_sshd/` blueprint from the `55A7KAU/V0000.09.09O.P1015` guide): `PHOENIX_LIB`-based `BaseService` require (the 09.09 idiom), module-load line to `/tmp/re_sshd_boot.log`, `dropbearRunning()` via `/proc/net/tcp :1F48 LISTEN` (never the uid-314-unreadable pidfile), arm loop 36×5 s attacking the superwatch socket with `sid:54:sid;re.installer` + `sid:53:sid;/APPS/installer.ipk;re.installer;` framing |
| `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/package.json` | `main: index.js`, `type: commonjs`, `selfStart: true` |
| `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json` | fourth entry `{"id":"re_sshd","autoStart":true,"isKeepAlive":false}` appended; owner/mode preserved (`314:314`, 640); **pristine copy at `/APPS/.re_sshd/serviceList.json.pristine`** (teardown: `cp` it back) |
| `/APPS/installer.ipk` | in place — the service reinstalls from it each boot |

## Cold-boot evidence (verified)

After `sync; echo b > /proc/sysrq-trigger` (the initctl path refused
`/run/initctl: Permission denied` under SELinux — also note `/sbin/reboot`
is a symlink to `halt` and needs initctl too; sysrq is enabled, `sysrq:1`;
systemd-style plain `init` confirmed via `/proc/1/comm`):

```
uptime 241 s (fresh boot)
installer_log.txt mtime 19:52:49 (this boot's postinst run)
dropbear pid 2479 (fresh; the previous pid 5969 was the pre-reboot session)
iptables OUTPUT freeze rules: 3 (re-applied by this boot's postinst)
ssh -p 8008 root@192.168.0.246 → ROOT-OK, Uid 0, CapEff 000001ffffffffff
```

No PC touched the TV during that boot — the arm chain runs from the boot's
own service tree.

## Traps of the day (this persistence layer)

- **Appending the serviceList entry from `grep -v` + `printf` lost the
  comma between the last pre-existing object and the new one** — the file
  would have parsed broken and taken the whole basic service set down at
  boot. Caught by a cat-back before the reboot; replaced the file with a
  fully-formed, base64-delivered version. **Rule: serviceList edits are
  delivered as whole-file writes** (base64 over ssh), never in-place
  string surgery with busybox text tools (which on this box also lack
  `tail`/`id`/`uname`).
- The service's own log/marker files (`/tmp/re_sshd_boot.log`,
  `/APPS/.re_sshd/boot_marker.txt`) came back **absent/empty after the
  successful boot**: postinst leaves `/APPS/.re_sshd` root-owned 755, so
  the uid-314 service cannot create the markers (its `log()` swallows
  EACCES). Evidence therefore reads from the postinst artifacts instead
  (fresh `installer_log.txt` mtime, fresh pid file, live freeze rules).
  If the owner wants the service's log kept, add a 314-writable dir
  (`mkdir -p /APPS/.re_sshd/logs && chown 314:314 ...`) inside the
  postinst — not needed for arm correctness.
- `/sbin/reboot` → symlink to `halt`, which needs `/run/initctl`
  (Permission denied under SELinux for root). The kernel sysrq restart is
  the working route on this unit (and roughly matches a mains cycle).

## Teardown (verified commands, persistence layer)

```sh
cp -f /APPS/.re_sshd/serviceList.json.pristine \
      /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json
chown 314:314 /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json
chmod 640      /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json
rm -rf /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd
```
Then the root teardown from [05](05-root-ssh.md) (dropbear kill, package
uninstall, file cleanup, freeze rules) — all as root over 8008.

## State after this session

- **Root is boot-persistent on this TV.** Every cold boot ends with:
  dropbear key-only on 8008 authorized with `server/keys/e7qtv-root.pub`,
  OTA freeze rules live, the apks/launcher tile intact. Verified boot
  untouched (all writes stay in rw mounts; `/OAD` never written).
- The launcher server lane (Mac, 8770) remains the normal launcher lane;
  the TV now re-roots independent of it.
