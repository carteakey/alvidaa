# 01 — OS exploration: /usrlocal inventory, vendor backdoor, service surface

> Measured 2026-11-07 over the root SSH lane. Read-only pass: no TV state
> changed. Companion to the model [README](../README.md).

## 1. System overview

| Item | Value |
|---|---|
| SoC / build id | MT9655, `SYS_MODEL_NAME=hisense_mt9655_linux_fde`, `SYS_VERSION=Debug` (per `/etc/profile`) |
| Root FS | erofs ro (dm-4 ← p53) at `/mnt/tvroot`, dm-verity; `/usr/local → /mnt/tvroot/usrlocal` symlink |
| Writable | `/APPS` (4 GB), `/var/local` (1.4 GB), `/data`, `/var/tvservice`, `/OAD` (chmod 777 by `security-dac-OTA`), `/Customer`, `/vendor/uuenv`, `/certificate`, tmpfs `/var/run`, `/var/log`, `/var/crash` |
| SELinux | Enforcing |
| Serial console | `getty -L ttyS0 115200` running; **root's login shell is `/etc/rootlogin.sh`** (`/etc/passwd`) |
| `/bin` | mostly symlinks into `//openbox/bin` (toybox); the real vendor binaries live in `/usr/local/bin` |
| Vendor canonical PATH | `/etc/profile` line 28: `/usr/local/bin/openssh/sbin:/usr/local/bin:/usr/local/scripts:/basic/bin:/bin:/usr/bin:/sbin:/usrbin:/3rd/bin/wpa_supplicant/common` |

## 2. `/usrlocal/bin` (119 entries) — the useful ones

- **Debug/forensics:** `getlogTool`, `syslogviewer`, `kilbylogger`, `rotatelog`,
  `log.on/off/emmc/mem`, `procrank`, `procmem`, `perf`, `showmap` (in `/`),
  `dfbdump` (`/basic/bin`), `screenshot` (HAL capture — the repo
  `tools/screenshot.sh` lane), `capture` (needs `libHui.so`), `kiunwind`,
  `kcomd`, `bt_log_test`, `ra_getlog`
- **Crypto/keys:** `keystore` (a `bin_guardian`: "execvp signtool and check
  md5"), `openssl`, `enctool`/`dectool` (`enctool|dectool oem|vidaa [zip
  command]` — OEM/VIDAA zip encryption), `inithitast`
  (`<decrypt|rm file> <key_num> <file>`), `ipk-decrypt` (decrypts app
  packages via `pkgAppInfo.json`), `ipk-update`, `dataModuleCrc`,
  `check_usb_key` (validates the USB debug key); `hashkey.sign` in `/opt/key`
  (root-only, 306 B)
- **Package/OTA:** `opkg`, `bspatchtool` (needs `libbootctrl.so` from
  `/vendor/lib`), `ota_upgrade`, `rcotatool`, `rescueOTA/`, `deploy`/
  `deploytool`, `cleanfiles`
- **Property/system:** `kprop` (dumps all properties), `getkprop`, `setkprop`
  (writes properties, e.g. `sys.watchdog.enabled`), `waitkprop`,
  `postsema`/`waitsema`, `initspecialenv`, `kinit`, `kireg` (crash-report
  uploader, `-s server_prefix`), `lmkd`, `write_stat`, `genSerialSelection`
- **Input/UI injection:** `inputkeyevent`, `inputtext` (inject key events /
  text into the TV UI from the shell)
- **Network:** `wpa_supplicant`, `wpa_cli`, `hostapd`/`hostapd_cli`,
  `dnsmasq`, `dhcpcd`, `dibbler-client`, `dnsproxy` (10 MB),
  `https_dns_proxy`, `apmbond`, `btmanager`/`btservice`/`btut`/
  `gatt-*-test`, `wifitest` (full Wi-Fi test mode: MCR read/write, `-O`),
  `usbtest`
- **Archive/util:** `7za`, `unzip`, `zip`, `busybox` (`vi`/`wc`/`bootchartd`
  symlink to it), `jq`, `cksum`, `od`, `split_lite`
- **Daemons (running):** `chassis`, `sysmain`, `systemserver`, `tvmain`
  (32 MB), `avmain`, `mediamain`, `biz`, `knode`, `masman` (Mi IPC on
  12321), `mdharvester`, `HamService`, `hi_logreport_service`, `dlna_service`,
  `avserver`, `superwatch_server` (the root-privilege socket),
  `superwatch_clientExec` (its client), `ota_upgrade`, `btmanager`
## 3. `/usrlocal/scripts` (149 entries) — highlights

- **`rootlogin.sh`** — the serial-console root gate. USB-key auth:
  `md5(vid+pid+model)` filename on the USB stick, content verified by
  `check_usb_key`. **⚠ Vendor backdoor:** on failure codes 2/9/12 (e.g.
  answering `N` to the warning prompt), `check_dummy_login` accepts the
  literal input `dummy` then `auth` and drops straight into `/bin/sh` as
  root. Reachable on ttyS0; scriptable as
  `printf 'N\ndummy\nauth\n' | /etc/rootlogin.sh`.
- **`login.sh`** — the non-root "hidden page" menu (log on/off, copy log to
  USB, tcpdump menu, ftpput/wget, screenshot, and **package import/export:
  `echo 13 > /var/run/superwatch` (import) / `echo 12 > /var/run/superwatch`
  (export)** — a *file* interface to the same package ops the socket uses).
- **`security-dac-*`** (20 files) — the DAC permission map: which groups get
  which `/proc`, `/sys` and partition perms; `security-dac-OTA` chmods
  `/OAD` 777. Documents the whole privilege model.
- **`pfm-manager.sh` / `pfm-config.sh` / `pfm-parse.sh`** — power/factory-mode
  management.
- **`checkEmergentOTA.sh`** — if the UI is not up in 60 s:
  `setkprop sys.watchdog.enabled 0` + `rescueOTA` (the brick-recovery path).
- **`getlog`, `getlog-pii`, `replace-pii.sh`** — log collection / PII scrubbing.
- **`ipk_install.sh`, `ipk_uninstall.sh`, `ipk_backup.sh`,
  `ipk_restore_backup.sh`** — the package-manager plumbing.
- **`hotelclone.sh`, `reset-factory.sh`, `OEMfacstart.sh`,
  `start-ctvfactory_*.sh`** (per-region factory modes), `wifi_login.sh`,
  `fakeStandby_onoff.sh`, **`init.rc`** (service classes early/second/
  deployed/post/custom-mediamain; every daemon wrapped in `secure_exec`),
  `env.sh`, `ext4_mount_his_part.sh`, `update_serialsdata.sh`,
  `usbMountChmod.sh`, `oqc_broker_whitelist.sh`, `run_nodejs.sh`,
  `restorephoenix.sh`.

## 4. Other measured areas

- **`/etc/passwd`** — 70+ dedicated users (netflix, alexa, airplay,
  playready, widevine, tts, dialserver, factoryservice…). `cli` is **uid 0**
  with shell `/etc/cli_login.sh` — a second root login script (for
  `wifitest` CLI).
- **`/APPS/pkgs`** — 22 packages incl. `tv.vidaa.phony.keystore`
  (cobalt/common/iot/remotecontrolservice), `tv.vidaa.app.browser` (Cobalt;
  cmdline carries a leftover `--bypass-insecure-origin=http://tv.cellcom.co.il`),
  `tv.vidaa.app.phoenix` (the FaaS host).
- **`/certificate`** — `Production/Production.ini`, `hashkey.sign`, `tee/`,
  `netflix/`, `qjy/`, `sraf/` (DRM certs).
- **`/var/local/iot`** — **Matter** (`matter-tv-app`, chip KVS, PAA certs,
  port 5552), plus `control4`, `airplay`, `dialserver`, `mosquitto` (MQTT
  1883), `ai_manager`.
- **Listening ports** (decoded from `/proc/net/tcp`, 2026-11-07): 1883 MQTT,
  8008 dropbear, 9888 phoenix-wss, **8993** phoenix file bridge (the model
  README's "9009" is not what this build answers on — measured 8993), 36669
  RemoteNow, 9999, 18400 (LAN-bound), 12321–12345 MI-IPC, 2121–2125,
  3822–3827, 1969, 7000, 4445, 11599/11600, 11669/11679, 20529,
  26641/26642, 59781, 3366/3367 (Netflix).
- **`/proc/boottime`** is a writable control file (`facinfo=test`,
  `factory_mode=off`, `deploy_finish=false`, `boot_slot_index=0`…).
- **Contradicts the model README:** `iptables` **is** present
  (`/usr/local/bin/iptables`, 687 KB, also `/basic/bin/iptables`) — the
  "absent" note was only true for `/sbin`.

## 5. Exploit-potential assessment

1. **Vendor backdoor (biggest find):** `rootlogin.sh` dummy-login → root
   shell over serial. The USB-key scheme is `md5(vid+pid+model)` filename;
   the key *file* lives on the USB stick — `check_usb_key`'s content check is
   the next thing to reverse (no physical USB needed if it's bypassable).
2. **superwatch surface is wider than we use:** `login.sh` shows ops `12`
   (export package) and `13` (import package) via `/var/run/superwatch` as a
   *file*. Package import = postinst-as-root: a second, simpler entry point
   to our existing privilege lane.
3. **`setkprop`/`kprop`** — full property system readable/writable as root;
   `init.rc` `on property:` triggers mean boot-phase services can be driven
   on demand.
4. **`inputkeyevent`/`inputtext`** — programmatic UI control from the shell
   (no remote needed; complements the launcher lane).
5. **`ipk-decrypt` + `enctool`/`dectool` + `inithitast`** — the OEM/VIDAA
   content-encryption toolchain runs as root; usable to inspect/decrypt app
   packages and OEM zips offline.
6. **`keystore`/`bin_guardian` + `/opt/key/hashkey.sign`** — the signature/MD5
   guard for tools; tells us which binaries the TV will refuse to run
   (relevant when deploying new binaries outside `/APPS`).
7. **Matter/Control4/AirPlay/DIAL/MQTT** — a dozen LAN-facing IoT services;
   each is a potential unauthenticated LAN attack surface (worth a later
   port-scan + protocol probe pass from the PC).
8. **`/OAD` is 777** and `rescueOTA`/`rcotatool`/`bspatchtool` live there —
   the OTA lane is fully scriptable from the shell (A/B slot switching via
   the `libbootctrl.so`-based tools).

## 6. SSH session environment — final design (2026-11-08)

**Design.** Mirror the vendor's own serial login (`/etc/rootlogin.sh` does
`source /etc/profile; /bin/sh`): the uid-0 login shell is a wrapper script,
`/APPS/.re_sshd/sh` (written by the IPK postinst, `make_installer.py`):

```sh
#!/bin/sh
. /etc/profile >/dev/null 2>&1
exec /bin/bash "$@"
```

`/etc/profile` is the single source of truth for the vendor environment:
`PATH`, `LD_LIBRARY_PATH` (this TV has **no `/etc/ld.so.cache`** — dynamic
vendor binaries like `jq`/`opkg`/`kprop` resolve only via it), `DTO_CHIP`,
`UTOPIA_LINUX`. No per-variable dropbear patching, and it stays correct across
firmware updates without recompiling.

**Banner suppression (2026-11-10).** The profile's *stdout* is a login banner,
not environment: line 1 `echo "Loading /etc/profile..."` and, near the bottom,
`cat /basic/build.macro | grep 2102` which prints the `USB_UPG_VERSION=...`
and `VERSION=...` lines. Those two are **display-only** — `VERSION`/
`USB_UPG_VERSION` are never `export`ed (verified: they are absent from the
session env). The original wrapper redirected only stderr (`2>/dev/null`), so
the banner leaked into every remote/one-shot session. Sinking stdout
(`>/dev/null 2>&1`) removes all three lines while every real export is
unaffected — and it stays correct if a future firmware adds more echoes.
Remaining side effects are harmless (`stty`, `umask`, sourcing
`init_coredump.rc`). Verified on TV 2026-11-10: clean one-shot **and**
`ssh -tt` PTY sessions, full `PATH`/`LD_LIBRARY_PATH`, `jq`/`opkg`/`kprop`
run unmodified.

**Build recipe** (`tools/ur9s/scripts/build_dropbear_a7k.sh`): identical to
the U7Q parent (`tools/u7q/scripts/build_dropbear_a7k.sh`), differing only in
the shell paths:

- key-only: `DROPBEAR_SVR_PASSWORD_AUTH 0`, `DROPBEAR_SVR_PUBKEY_AUTH 1`,
  `DROPBEAR_CLIENT 0` → `make PROGRAMS="dropbear dropbearkey"`. With
  `PASSWORD_AUTH 0` the `crypt()` reference disappears (it is entirely inside
  `#if DROPBEAR_SVR_PASSWORD_AUTH` in `svr-authpasswd.c`), so no libxcrypt is
  needed.
- `fill_passwd` patch in `common-session.c`: uid 0 →
  `/APPS/.re_sshd/root_home` + `/APPS/.re_sshd/sh`; unknown user → fixed
  uid-314 identity with `/bin/bash` (present on this build).
- `/etc/shells` → `/APPS/shell` literal patch (byte search, same length);
  postinst whitelists `/bin/bash` and the wrapper in `/APPS/shell`.

**Build trap (do not "improve" the recipe).** A rebuild combining **all four**
of `-O0`, PIE (`-static` without `-no-pie`), the `--disable-pam/shadow/
pututline/pututxline` configure extras, and `PUBKEY_AUTH 1` + `CLIENT 0`
corrupts ed25519 verification (`Permission denied (publickey)`); dropping any
one of the four fixes it. The U7Q recipe (three of the four, with `-Os`) is
the proven-safe corner — verified on TV 2026-11-08.

**Verified on TV (2026-11-08):** pubkey auth OK, `CapEff
000001ffffffffff`, full vendor `PATH` and `LD_LIBRARY_PATH`, `jq`/`opkg`
(0.7.0)/`kprop` run unmodified, `ssh -tt` PTY sessions work.
