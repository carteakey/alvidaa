# 07 — OS map + root-avenue inventory (2026-11-08, post-root read-only)

The filesystem/OS survey over the root session, and the honest ledger of
other root lanes — measured or documented on this branch — for units that
do not have our dropbear running yet. All reads; `androidboot.serialno`
sits in the cmdline and is **redacted** here; no `shadow` content read.
Committed binaries: none.

## OS identity (verified)

- Kernel `5.15.167-gfb69e158f1f4-dirty`, Android clang 14.0.7/LLD,
  built **2025-10-01**, `SMP PREEMPT`; `/proc/1/comm` = plain `init`
  (busybox-style, runlevel 3, UART `getty` on `ttyS0`).
- Boot flags (verified root): **`androidboot.verifiedbootstate=green`,
  `androidboot.vbmeta.device_state=locked`, `veritymode=enforcing`**;
  dm-verity on the rootfs with FEC (hash tree + forward-error blocks,
  `restart_on_corruption`), **A/B slots**, current `slot_suffix=_a`
  (root `/dev/mmcblk0p20` squashfs ro → `/dev/dm-0` verity chain);
  `tee_mode=optee` (TEE supplicant init present in `init.d/fusion`);
  `bootreason=reboot` — this unit's current boot was our sysrq restart,
  matching the vendor's own boot-reason plumbing.
- Chip identifiers: `androidboot.vendor.cf.hardware=mt5873`,
  board `mmap_mt5873_mtk_2g_linux` — the boot-side family id for the
  userspace `MTK9603` bridge name.
- `/etc/profile` exports: `DTO_CHIP=mt5873`, `SYS_ODM=mtk`,
  **`SYS_MODEL_NAME=hisense_mt9603_linux`**, **`SYS_VERSION=Debug`**
  (a Debug-tagged ODM build — strings of the flag-wrapped shell set say
  the same).
- `/etc/init.d` tree splits into `common/`, `fusion/`, `merak/`
  (+ `mixed/` in the dir set) — per-chipset init module families.

## The vendor root-gate lane (verified structure)

`rootlogin.sh` (root's own shell, root-only readable) is the **factory
USB key gate**:

- enumerates USB partitions (`/proc/diskstats`), computes
  `seed_name = vendor_id . product_id . tv_model`, then
  `dst_file = md5(seed_name)`; a USB device whose key file carries that
  name satisfies the first stage;
- then execs `/usr/local/bin/check_usb_key` with
  `normal <vid> <pid> <tv_model> <file_name>` — the binary validates the
  file's CONTENT (the second stage);
- the sibling `cli_login.sh` (the serial-console login script) carries
  its own chain (`openssl` + `critical.ini` under `/hidata/critical/`),
  Chinese-header comments dated 2024 by the ODM author.

Both gates read rw-partition state (`critical.ini(_bak)`); **the USB key
is replayable hardware**: `lsusb` + the model at build time are all an
attacker needs for the filename half — recorded as the **hardware-free
root escape hatch** for this build family; the content-staging half needs
`check_usb_key`'s own audit (static, nodule-level; not disassembled
today).

## Other root avenues on THIS branch (measured / documented)

| # | Lane | State here | Notes |
| --- | --- | --- | --- |
| 1 | `NewUpdatedIPK.txt` symlink-flipper (`start-kilby.sh:319` → `set_ipk_path.sh`) | **present, untested** | same A/B `current` flicker as the reference: a writable `/APPS/pkgs/NewUpdatedIPK.txt` lists dirs; each line creates `<dir>/current → <basename>` as root at boot. Requires a boot to apply — a candidate lane but untested here (our dropbear path already covers; recorded for community pre-root work). |
| 2 | `euladpp` untar lane | **absent on this branch** | `/APPS/euladpp/current/` holds only `eula_dpp_status.ini(+_bak)`; **`euladpp-init-check` is not in this build's init tree** (no boot-time consumer greps clean in `init.d/{common,merak,mixed,fusion}`); only `migrate_scripts/ota_migrate_package_eula_dpp.sh`, `reset-factory.sh`, `security-firewall-start.sh`, `getlog` read the eula files. The reference's arming condition (`current/versionInfo.json` missing) **cannot fire** here. (Correction to our pre-root [04](04-selinux-and-hook.md) wording: the checked path is `/APPS/euladpp/current/versionInfo.json`, not `/var/local/versionInfo.json`.) |
| 3 | OEM staging deployer (`deploy_oem_data.sh` + `deploy_oem_common.sh`) | **present** | same copy-from-`/var/local/oem/…` shape; a root-run whole-tree deployer. Not exercised (our lane didn't need it); it is the vendor's own root writer — candidate. |
| 4 | `masman` (root, `secure_exec` run) `127.0.0.1:12321` | **present** | boot invocation `masman -d -p dvb -u 127.0.0.1:12321 -i -P 0x000003 -l 3000 -R usb3/…` (from `start-masman.sh`); loopback command interface ("Available commands" in the static record) — **not probed blind** (unknown lexical commands; too risky to fuzz on the user's unit). Method option: controlled disassembly or a documented vendor command list from the static audit. |
| 5 | superwatch_server per-command auth matrix | **partially measured** | the UDS command registry is **runtime-built** (`std::unordered_map<string,string>` in strings; the id→class table has no static strings on this stripped ARM build). `Run{IpkInstall,IpkUninstall,IpkBackup,IpkRestore,IpkClearBackup}Command`, `RunCheckPkgsUsdCommand`, `RunRecreateSoftlinkCommand`, `MkDirForPVRCommand`, `GetDirUsageCommand`, `IrGetLogCommand`, `EnterWifiTestmodeCommand`, `DropCacheCommand` enumerated (C++ typenames); per-wire `unauthorized` TRACE exists. **Method option: disassembly of the map construction** (43Q60SEVS's `80`/`82`/`85` set vs our `53`/`54` map suggests per-branch renumbering). |
| 6 | `adbd` (Android debug bridge daemon) | **boot-enabled lane present** | `/etc/init.d/common/init_adbd.rc` runs `/bin/adbd` with the functionfs mount (`uid=2000,gid=2000`); the USB gadget-side is the reachable surface — **USB-only on this build** (checked the init lines; no `tcp:5555`/`tcp:` listener flags). A root sidecar IF a USB host link is used — hardware-free once a USB link exists. |
| 7 | UART console (`ttyS0 getty`) | **live at boot** | the login lands in `rootlogin.sh`/`cli_login.sh` (gate section above) — the hardware-free path depends on the gate script; recorded against the family. |
| 8 | `/OAD` staging + `/OAD/pkgs/backup` (rw) | present, untouched | OTA staging partition (our ground rule: never write); the `AppUpgradeSwitch.json` here carries `"upgradeFlag": "0"` for `country: GBR` — the cloud-side app-upgrade switch is already **off** for this market. |
| 9 | `recoverOTA`/`checkEmergentOTA.sh` | present | the emergency lane fires when the UI fails to flag READY in 60 s (reference static audit) — emergency-only; noted for completeness. |

## The firewall plane (verified)

`init_iptables.rc` restores `/etc/iptables/iptables.conf` at boot — the
vendor's own policy file is small:

```
-A INPUT -p tcp --match multiport --dports 0:1023 -j DROP
```

(the two OUTPUT lines about the `root` uid are commented out), then
`FIREWALL_IN_EULAON`
builds up during boot; on this unit it contained **no debug-port
blacklist** — the pre-root unit reads (our postinst listing) show only
the localhost/mark ACCEPTs. Kernel-resident rules (including our OTA
freeze) come back only through the boot-time postinst — the firewall
plane is rebuilt from this config file at every boot.

## Package surface (root read)

- `opkg` status db at `/APPS/pkgs/opkgmeta/status`;
  `re.installer 1.0.0` (ours — verifiable in `/APPS/pkgs/opkgmeta/info/`).
- `/usr/local/scripts/ipk_install.sh` reads as a plain bash wrapper
  (uses `session_id`, `ipk_path`, `pkg_name`, `options_string`; calls
  `ipk-update -n` after a clean `--force-reinstall`).
- The **app context installs from this bridge are unauthenticated** —
  confirmed on 50A51HUV first, measured here too (root + the tables).

## What this changes for the family record

- Pre-root inventory [04](04-selinux-and-hook.md) gets two fixes: the
  `euladpp` probe path and the real bridge floor.
- The root-avenues ledger belongs on every future 09.09-family unit:
  with the hook lane closed by SELinux on this branch, the *community
  pre-root set* is: FaaS fetcher → socket → install (this PR's lane), or
  NewUpdatedIPK/A–B flipper (untested here), or the OEM depot copy trick
  (documented), or the USB gate (hardware-free replay shape, dst stage
  unverified), or adbds' USB function line — while `euladpp` is NOT a
  lane on this branch at all.
