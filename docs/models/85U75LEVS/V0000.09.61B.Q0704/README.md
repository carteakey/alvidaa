# 85U75LEVS / V0000.09.61B.Q0704 — root SSH over the package manager, boot-persistent (MTK9618, EU_B/RUS)

**Status:** root SSH (uid 0, `CapEff 0000003fffffffff`, PTY, key-only) and
boot persistence were **verified on this unit on 2026-11-27**, including a
real kernel reboot (`/sbin/reboot`, uptime reset 507791 s → 42 s). Second
recorded unit on this exact firmware string after the 55E75LEVS report
([TESTED-MODELS.md](../../../research/TESTED-MODELS.md), `gh:mustafaGlobal`) —
same chain family, independently replayed from the published probes and
build recipes.

> **Applies to `85U75LEVS` (SerialType `85U7LE`, SoC MTK9618, VIDAA `U09.61`,
> region `EU_B`, country `RUS`) running `V0000.09.61B.Q0704`, kernel build
> `2026-07-03` (`Linux 5.4.302`, aarch64).** The 55E75LEVS record covers the
> same build on EU_A/BIH; this unit confirms the chain also holds on the
> EU_B/RUS variant. Other models on this build are untested.

> **Contributed by [@vitokornelio](https://github.com/vitokornelio)** (own
> device, AI-session driven). No key material, session, IPK, or vendor binary
> is published with this guide.

## What the chain rests on

Same family as [100U7Q](../../100U7Q/V0000.09.60I.Q0813/README.md) and the
55E75LEVS record on this same build: fetcher write →
superwatch IPK install → root `postinst`. Properties measured on this unit,
in dependency order:

1. **Browser bridge surface.** TV Browser (Chromium 111, UA
   `Linux aarch64 … SurfMaster/4.5.20`) exposes 95 `Hisense_*` functions,
   `vowOS.service.syncExecute`, and `HiUtils_createRequest`.
   `WebSDK_createFileRequest` is absent.
2. **Fetcher is the write primitive.** `basic/fetcher` starts over
   `wss://localhost:9888`; `fetchFile` writes to absolute paths as uid 314
   (`ret:true "download finished"`), including the FaaS function tree
   `tv.vidaa.jsservice.basic/CHA/functions/fetch/`.
3. **Array-path read traversal.** `hiutils.fileRead` reads `../` paths only
   with a one-element array path (`["../proc/uptime"]` → content); bare
   strings are rejected `invalid path`.
4. **Superwatch socket is app-reachable.** `/var/run/superwatch_socket` is
   `660 root:616`; gid 616 is in uid 314's supplementary groups. Read-only
   command `85` (GetDirUsage) answered `901:0`. Install/uninstall ids on this
   branch are **82/83** (the 09.09-era 53/54 pair does not apply).
5. **Root postinst.** `opkg install` runs the IPK's `postinst` as uid 0 with
   `CapEff 0000003fffffffff`. IPK `Architecture: mtk9618`.
6. **armhf userland under an aarch64 kernel.** `process.arch = "arm"` — the
   kit is static ARMv7 (EABI5), not aarch64, despite the aarch64 UA.
7. **`/var/local` is writable** from the app context (write/read/unlink
   probe passed) — boot-state and backups live there.
8. **Vendor service manager autostart.** A `re_sshd` BaseService in
   `tv.vidaa.jsservice.basic/CHA/services/` plus one `serviceList.json`
   `autoStart` entry re-arms the installed IPK through the superwatch socket
   at every boot.

## What was measured

All rows **verified** on this unit, 2026-11-27, via the published read-only
probes (`launcher/recon-fetcher.html`, `launcher/recon-superwatch.html`),
the install page's captured reports, and the root SSH lane.

| Claim | Evidence |
| --- | --- |
| Fingerprint: model/SerialType/firmware/SoC/region as stated above | `fingerprint-full` report from the TV browser |
| phoenix alive: WS 9888 open, HTTP 9009 answers | fingerprint probe |
| fetcher writes `/APPS` and the CHA function tree as uid 314 | `ret:true "download finished"` for both markers and for `sw2.js` + IPK |
| FaaS function exec: `/function/basic/fetch/<name>` runs placed JS | probe function returned uid/gid/groups/arch |
| App context uid 314, gid 616 present; `process.arch "arm"` | probe `/proc`-based report |
| Superwatch socket `660 root:616`; cmd 85 → `901:0` | probe stat + socket reply |
| Array-path traversal open; bare string rejected | `["../proc/uptime"]` read; `invalid path` on strings |
| `/var/local` writable from app context | write/read/unlink probe |
| Install 82 / uninstall 83 accepted | `90:0`, `91:0` replies |
| postinst uid 0, `CapEff 0000003fffffffff` | `installer_log.txt` `/proc/self/status` lines |
| Key-only root SSH on **:22**, PTY works | `ssh -p 22` login from LAN host; `ssh -tt` echo |
| Boot persistence: SSH back ~45–50 s after `/sbin/reboot`, no browser | `boot_marker.txt`: re_sshd start uid 314 → attempt 1 uninstall `90:0` → ARMED; fresh dropbear pid, uid 0 |
| Verified boot green; `/` squashfs ro; OTA flags off (`RUS`) | `/proc/cmdline` `androidboot.verifiedbootstate=green`; `/dev/dm-0` ro squashfs; `/OAD/AppUpgradeSwitch.json` `upgradeFlag: "0"`, `/var/local/nightupdate.ini` `dcm_update=0` |

### Deltas and traps found on this unit

- **`-E` is invalid in a `--disable-syslog` build.** The first postinst used
  `-F -E` (foreground + stderr logging); Dropbear rejected the option and
  never started. Plain daemonizing start (`-r hostkey -p 22 -P pidfile`)
  works. Same class as the `-s` trap on no-password-auth builds.
- **Postinst PATH has no `id`/`uname`/`tail`** — proof comes from
  `/proc/self/status`; busybox is at `/usr/local/bin/busybox`.
- **`/APPS/websdk/Appinfo.json` does not exist** on this build (ENOENT via
  the read traversal). The tile registry lives elsewhere; lane-3 native Home
  (operation-ui component swap) does not need it.
- **No `otaTest` hook residue**: `../var/local/otaTest.log` is ENOENT (the
  traversal reaches the FS; the file is absent) — this unit never had the
  MTK9602-style boot hook.
- **`/sbin/reboot` is a real kernel reboot**; remote-control power is
  standby and does not re-run the boot chain. Use it for persistence tests.
- **Firewall**: vendor chain `FIREWALL_IN_EULAON` needed explicit ACCEPTs for
  22 and 8008 (added by the postinst, deduped on re-arm). Port 22 answered
  `Connection refused` while idle (allowed, nothing listening) — unlike
  100U7Q where 22 is dropped.

## What this guide includes and leaves out

| Included | Left out |
| --- | --- |
| fingerprint and firmware constants | the packaged IPK and one-command arming page |
| the chain at architecture level, with measured deltas | the postinst script body |
| evidence for every claim (all verified on this unit) | key material, sessions, certificates |
| the teardown path | vendor binaries |

The mechanism is already public in the sibling guides (100U7Q, 55E75LEVS,
75UR9S); this guide adds a second-unit confirmation on the EU_B/RUS variant
and the build traps above, not a new turnkey payload
([DISCLOSURE.md](../../../DISCLOSURE.md)).

## Teardown

Operator checklist (each item verifiable over the SSH lane before removal):

1. Restore the service list: copy
   `/var/local/alvidaa/re_sshd-backup/serviceList.json.pristine` over
   `tv.vidaa.jsservice.basic/CHA/services/serviceList.json`; remove
   `CHA/services/re_sshd/`.
2. Uninstall the package through the superwatch socket (command 83,
   `re.installer`).
3. Stop dropbear (`/APPS/.re_sshd/dropbear.pid`), then remove
   `/APPS/.re_sshd/`, `/APPS/shell`, `/APPS/installer.ipk`.
4. Remove the two `FIREWALL_IN_EULAON` ACCEPT rules for ports 22 and 8008.
5. `/dev/ptmx` modes were set 666 by the postinst; restore `0620 root:tty`
   if the exact pre-run state matters.

Residual state after all steps: none known; the package status DB entry is
removed by the uninstall. Full cleanup was not replayed on this unit —
treat the checklist as the documented path, not a measured one.

## Open items

- **Launcher lanes untested**: pairing (MQTT 36669), lane-1/2 bridge, and
  lane-3 native Home were not exercised on this unit. The 55E75LEVS record
  shows lane 3 (Free My TV component swap) working on this exact build.
- `transport_protocol` not read (no SSDP capture yet); the 55E75LEVS unit on
  this build reports 3290.
- Whether the EU_B/RUS variant gates browser `fileWrite` (503 appconfig)
  differently from EU_A — not probed; the chain does not depend on it.
- OTA is already off in stock config (`/OAD/AppUpgradeSwitch.json` `upgradeFlag: "0"`
  for `RUS` and `/var/local/nightupdate.ini` `dcm_update=0`), but explicit
  firewall/DNS OTA freeze was not applied on this unit; freeze OTA endpoints
  before any UI work (repo ground rule).

## Cross-reference

- Same firmware, first unit: the 55E75LEVS row in [TESTED-MODELS.md](../../../research/TESTED-MODELS.md)
- Chain family: [100U7Q](../../100U7Q/V0000.09.60I.Q0813/README.md),
  [75UR9S re_sshd blueprint](../../75UR9S/V0000.09.60W.Q0624/source/re_sshd/README.md)
- Same SoC, sibling builds: [65A85QEVS](../../65A85QEVS/V0000.09.60A.Q0602/README.md),
  [55U61KEVS](../../55U61KEVS/V0000.09.62C.Q0924/README.md)
- Method catalogue: [EXPLOITS.md](../../../research/EXPLOITS.md)
- Publication policy: [DISCLOSURE.md](../../../DISCLOSURE.md)