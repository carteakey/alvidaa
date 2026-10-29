# Reverse-engineering findings: Hisense VIDAA (2024+ firmware)

Everything below was verified live on a Hisense VIDAA TV ("Living Room TV",
`transport_protocol=3290`, 2024+ firmware generation) in October 2026 while
building this launcher. Sources that helped: the classic
[Bananamafia hisensehax](https://bananamafia.dev/post/hisensehax/) writeup,
[d3nd3/Hisense-mqtt-keyfiles](https://github.com/d3nd3/Hisense-mqtt-keyfiles),
[Krazy998/mqtt-hisensetv](https://github.com/Krazy998/mqtt-hisensetv), and
especially the [stevene1919/hisense_vidaa issue #6](https://github.com/stevene1919/hisense_vidaa/issues/6)
thread, which cracked the modern auth problem.

## 1. Discovery

- SSDP M-SEARCH (`ssdp:all`) finds the TV: a DLNA **MediaRenderer** on a
  random port (e.g. `:38400/MediaServer/rendererdevicedesc.xml`). The device
  descriptor's `modelDescription` leaks a gold mine:
  `mac=`, `macWifi=`, `macEthernet=`, `region=`, `brand=his`,
  `vidaa_support=1`, `transport_protocol=3290`.
- `transport_protocol` predicts which auth generation the MQTT broker uses
  (3290 = modern, see §3).
- The TV answers SSDP/RemoteNow only while powered on; deep standby takes the
  network stack down completely.

## 2. RemoteNow control channel

- MQTT over TLS on **port 36669**, broker = built-in `hisenseservice`.
- The TV requests a **client certificate** at the TLS layer but (on our
  firmware) does not validate it — any cert completes the handshake. The
  identity check happens at MQTT CONNECT (§3).
- All traffic: publish actions to `/remoteapp/tv/<service>/<client_id>/actions/<action>`,
  receive pushes on `/remoteapp/mobile/<client_id>/data/<action>` and
  `/remoteapp/mobile/broadcast/...`.
- Useful actions: `gettvstate`, `sourcelist`, `applist`, `launchapp`,
  `changesource`, `sendkey`, `authenticationcode`.

## 3. The 2024 authentication gate (the big one)

Old guides use static MQTT credentials (`hisenseservice` / `multimqttservice`)
plus the 2018 RemoteNOW certificate. On 2024+ firmware that fails with
**MQTT rc 5 (Not authorized)** at CONNECT, and the TV pops
*"your TV mode is no longer compatible with the version of the app"*.

What actually matters, in order:

1. **Client certificate identity.** The broker checks the client cert's
   subject and only accepts the current app's cert:
   `CN=VidaaAppAndroidV01, OU=multimedia, O=hh` (issued by `CN=RemoteCA`,
   valid 2024→2034). TLS handshake succeeds with any cert — the refusal is at
   the MQTT layer, which is why the popup appears per attempt.
2. The cert lives inside the official **VIDAA Smart TV** Android APK
   (`com.universal.remote.multi`):
   - newer builds: `res/raw/client_mobile_android.p12` (un-obfuscated)
   - older builds: `res/El.p12` (obfuscated name, same 2565-byte keystore)
   - keystore password: `186e990688070325a1c4b0ce275d2388`
   - convert: `openssl pkcs12 -legacy -in client_mobile_android.p12 -passin pass:… -clcerts -nokeys -out cert.pem` (and `-nocerts -nodes` for the key). The `-legacy` flag matters — legacy RC2/3DES ciphers.
3. **Dynamic credentials** (per-connect):
   ```
   digest    = md5("38D65DC30F45109A369A86FCE866A85B$" + mac).upper()
   client_id = "<MAC>$his$" + digest[:6] + "_vidaacommon_001"
   username  = "his$" + (timestamp ^ 6239759785777146216)     # modern profile
   digit_sum = sum(int(d) for d in str(timestamp)) % 10
   salt_hash = md5("his" + digit_sum + "h!i@s#$v%i^d&a*a").upper()
   password  = md5(timestamp + "$" + salt_hash[:6]).upper()
   ```
   Older firmware generations use the same shape without the XOR mask and/or
   with the RemoteNOW salt `h*i&s%e!r^v0i1c9` — hence the 4-profile cascade
   in `pair.py`.
4. **After the PIN**, the TV issues real credentials
   (`platform_service/data/tokenissuance`): `accesstoken` (2 days) +
   `refreshtoken` (30 days). Subsequent CONNECTs use the dynamic username +
   access token as password; refresh via `platform_service/data/gettoken`
   with `{"refreshtoken": …}`.

## 4. Pairing flow quirks

- Trigger the PIN dialog with `ui_service/vidaa_app_connect`
  `{"app_version":2,"connect_result":0,"device_type":"Mobile App"}`.
- The "dialog is showing" push arrives on `…/data/authentication` (empty
  payload) — *not* on `authenticationcode`. Some firmware never sends it.
- **Re-triggering rotates the PIN.** A keepalive that republishes
  `vidaa_app_connect` every few seconds guarantees the code you read is stale
  by the time you submit it (`result:100, "illegal authNum!!"`). Trigger once,
  wait, submit.
- PIN submission: `ui_service/actions/authenticationcode` `{"authNum": 1234}`
  (int, not string). Reply on `…/data/authenticationcode` with `result: 1`.
- Submitting a wrong/expired PIN returns `result: 100 "illegal authNum!!"`.
- Two clients with the **same client_id** kick each other off the broker
  (classic MQTT takeover) — diagnostic scripts must not reuse the paired
  client_id while the server runs.

## 5. Firmware broker quirks

- **Wildcard subscriptions are denied.** `SUBACK` returns *Unspecified error*
  for `/remoteapp/mobile/…/#`; you must subscribe to **exact topics**. This
  silently breaks every naive client (you publish fine, hear nothing back).
- Responses are JSON; lists (applist/sourcelist) are JSON **arrays**, dicts
  (state/token) are objects — filter carefully or you drop half the traffic.
- TV state: `broadcast/ui_service/state` with `statetype` —
  `remote_launcher` = VIDAA's own home screen (the home watcher's trigger),
  `sourceswitch` on input change, etc.
- Source objects carry both `is_signal` and `has_signal`; `is_signal` is 0 for
  every non-active input, `has_signal` reflects actual presence. OR them.

## 6. Installing a web app as a native app

Three generations of installers:

1. `hisense://debug` in the TV browser — the 2021-era hidden installer.
   **Closed on this firmware** (URL does nothing).
2. `Hisense_installApp(appId, name, thumb, iconS, iconL, url, storeType, cb)`
   — the JS bridge function from the Bananamafia era. May still exist.
3. **`HiUtils_createRequest`** — the modern one, verified working on this TV:
   ```js
   const cur = HiUtils_createRequest("fileRead", {path: "websdk/Appinfo.json", mode: 6});
   const list = cur.ret ? JSON.parse(cur.msg) : {AppInfo: []};
   list.AppInfo.push({
     Id: "vidaa-home", AppName: "Home", Title: "Home",
     URL: "http://<server>:8765/", StartCommand: "http://<server>:8765/",
     IconURL: icon, Icon_96: icon, Image: icon, Thumb: icon,
     Type: "Browser", InstallTime: "2026-10-29",
     RunTimes: 0, StoreType: "custom", PreInstall: false
   });
   HiUtils_createRequest("fileWrite", {path: "websdk/Appinfo.json", mode: 6,
                                       writedata: JSON.stringify(list)});
   ```
   Restart the TV afterwards; the app appears at the end of the app list.

Both JS bridge functions are exposed to **any page the TV browser opens** —
no `hisense://debug` needed. This project's launcher page detects them and
offers a self-install tile, so the TV installs itself from a plain
`http://<server>:8765/` visit. (This is also the silent-install attack the
Bananamafia post demonstrated — one more reason to DNS-block TV telemetry and
not browse the open web on the TV.)

## 7. The VIDAA browser (Chrome 77)

- One canvas at 960×540 (720p-class) upscaled by the TV renders fine; layered
  DOM/CSS effects blank out. Draw everything, repaint cheaply.
- ES2018 max: no optional chaining, no nullish coalescing.
- **The D-pad moves an on-screen pointer** and OK emits a **click** — keyboard
  events are not the primary input. Support both: hit-test `click` on canvas
  tiles *and* `keydown` arrows/Enter.
- `Cache-Control: no-store` on everything, or firmware caching will serve
  stale pages after you fix bugs.
- Full-screen offscreen canvases render empty; pre-render shadows/sprites if
  you need effects.

## 8. Operations

- Run the server on an always-on host (the Pi here — the original
  vidaa-launcher author's launcher died every time his Mac slept).
- The page degrades gracefully: server down → clock keeps drawing, tiles show
  dead state, auto-reconnects (exponential backoff capped at 8s).
- `keys/` (certs, tokens.json) must never be committed.
- Preset apps (TV Channels, VIDAA Kids, APP STORE…) cannot be truly deleted
  via known APIs — this launcher hides them via `config.json` instead.

## 9. Open questions

- True deletion of preset apps (probably `preset.txt`/database territory —
  brick-adjacent, not attempted).
- Boot-time takeover is a 3s poll, not a real launcher. A cleaner hook would
  need the `Appinfo.json` "preset" slot — untested.
- Whether `HiUtils_createRequest` survives firmware updates (the installed
  app entry should survive regardless).

## 10. Recon deep-dive (Oct 2026): the bridge is a local HTTP API

Probed live with `launcher/recon.html` (v1→v5), which self-reports to the server's
`/api/recon` endpoint. Per-run snapshots: `server/recon-report-v*.json`. The page
POSTs its report incrementally after every section — needed, because the bridge
backend can die mid-run (§10.3).

### 10.1 Device identity

- SoC **MTK9602** (MediaTek — *not* HiSilicon), 4K panel (3840×2160),
  model `50A51HUV` / serial type `50A5HU`, region US / country CAN.
- Firmware `V0000.09.01O.P0813`, OS `U09.01`, capability code `2025011014`.
- Browser "odin" = **Chromium 111**, 32-bit ARM (`armv7l`) UA. §7's "Chrome 77" is
  stale on this firmware; modern JS works (recon pages still ship ES2018 out of habit).

### 10.2 The JS bridge is three layers

1. Page JS: ~81 `Hisense_*` functions + `HiUtils_createRequest` — enumerable with
   `Object.getOwnPropertyNames(window)`. They are plain JS shims.
2. The shims POST JSON to **`http://localhost:9009/service/hiutils`** (file ops and
   utility APIs) and **`/service/tvinfo`** (`Hisense_Get*` info), with body
   `{"api":"<name>","args":{...}}` and a header `identifier: <base64 16-byte token>`
   that **rotates on every request**. Response shape: `{"ret":bool,"msg":...,"session":-1}`.
   Wrong api names get a clean `{"ret":false,"msg":"Not supported api"}` — a perfect
   fuzzing oracle.
3. The backend is **phoenix** — a Node.js server: `/opt/pkgs/tv.vidaa.app.phoenix/bin/phoenix`
   (Node flags incl. `--report-uncaught-exception --report-on-fatalerror`,
   report to `/var/local/log.phoenix.report`) running
   **`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/phoenix.server.js`** — i.e. the file
   bridge's own source lives on the writable `/APPS` partition.

### 10.3 The file sandbox — and the hole in it

- `fileRead`/`fileWrite` resolve relative paths against **`/APPS`**; absolute paths
  fail with an errno leak that proves it: `open("/APPS//etc/passwd") → ENOENT`.
- **`../` escapes to the real root.** `../etc/passwd`, `../proc/mounts`,
  `../etc/inittab` read fine; `../tmp/...` writes succeed. Net effect: arbitrary
  read+write as uid 314, filesystem-wide.
- Root-owned 0600/0700 files still deny (EACCES): `/etc/shadow`,
  `/usr/local/scripts/rootlogin.sh`, `/etc/cli_login.sh` — plain DAC, because
  **SELinux is permissive**: `/sys/fs/selinux/enforce` = 0, and `rcS.utopia.linux`
  explicitly calls `setenforce 0` when `/openbox/bin/load_policy` exists.
- `mode: 0` resolves against `/tmp` instead (errno leak `/tmp/../etc/`);
  `mode: 6` is the Appinfo-flow convention.
- No directory listing: `fileRead` on a directory → `EISDIR`. Enumeration is
  path-guessing fed by anything that names files (boot scripts, package names).
- **Reading a binary (ELF) crashes the phoenix backend.** Reproduced twice
  (`../bin/sh`); text files are fine. The backend is back by the next page run —
  supervised restart — but everything queued after the crash in one run is lost
  (hence the incremental POSTs).

### 10.4 Who runs what (privilege map)

- **Verified boot is active**: rootfs is dm-verity squashfs (ro), cmdline carries
  `androidboot.vbmeta.device_state=locked`, `verifiedbootstate=green`, and ro
  partitions are mounted via MTK `mtk_mount` with a vbmeta reference partition.
  System partitions are off-limits — the lane is rw mounts only.
- **rw + exec-flagged**: `/APPS` (p41), `/data` (p27), `/var/local` (p39),
  `/var/tvservice` (p35), `/OAD` (p42, OTA staging — and `/OAD` sits on
  `login.sh`'s PATH), plus tmpfs (`/dev/shm`, `/var/run`, `/var/log`).
  rw + `noexec`: `/cache`, `/certificate`. Everything else ro.
- Accounts of interest (`/etc/passwd`): `root` shell = `/usr/local/scripts/rootlogin.sh`
  (root-only readable); **`cli` is UID 0**, shell = `/etc/cli_login.sh` (also
  root-only) — the classic Hisense debug shell, gate contents unknown;
  `television` (uid 300, the UI) shell = `/usr/local/scripts/login.sh`;
  an `sshd` account exists (uid 999) — server presence unconfirmed;
  phoenix = `UhisPhoenix` uid 314, **no capabilities, no seccomp**, PPid 306.
- **The UART console is live**: `inittab` respawns `getty -L ttyS0 115200` —
  a USB-TTL adapter on the service port reaches a real login prompt gated only by
  the (unreadable) login scripts.
- Boot chain: `rcS` → `mount -a` → `rcS.utopia.linux` (mounts, insmods, then
  `/usr/local/scripts/start-hisense.sh`, `setenforce 0`, sources
  `/config/daemon_profile` and `/application/network`) → `rcS.ko.linux`;
  `otaflag=170` in cmdline switches the tail to `rcS.OTA`/`rc.ota` — the `/OAD` lane.

### 10.5 Raw API probing

- The shim's request is reproducible directly from any page: XHR to
  `localhost:9009` with the captured shape (v4 `report.wire` has it verbatim).
  Fuzzing api names against that shape cleanly separates supported from
  unsupported (`"Not supported api"`).
- `phoenix.server.js` — the backend's own source, on our writable `/APPS` — is
  readable via `../APPS/pkgs/tv.vidaa.jsservice.basic/CHA/phoenix.server.js`;
  it contains the complete action table (v5 dump pending).

### 10.6 Lane assessment

1. **Persistent code exec as uid 314**: phoenix runs JS from our writable `/APPS`.
   If the package isn't re-extracted at boot, augmenting `phoenix.server.js` =
   arbitrary code exec at every service restart. Pending: the v5 dump + verifying
   `/APPS` package persistence across reboots.
2. **Root**: needs a root-run service that consumes attacker-controlled files from
   a rw mount (map pending from `start-hisense.sh`), the `/OAD`/OTA lane
   (`otaflag=170` → `rcS.OTA`/`rc.ota`), a kernel route on the MTK box, or the
   UART gate (physical; scripts are root-only readable).
3. Everything alvidaa does today minus MQTT: uid-314 read/write already covers
   app install and config without the RemoteNow channel.

### 10.7 v5 results: the backend source, the boot map, and the root trigger

- **The raw API needs no auth**: `POST http://localhost:9009/service/hiutils` with
  `{"api":"fileRead","args":{...}}` works with **no identifier header at all** from
  any page. The OPTIONS handler answers `Access-Control-Allow-Origin: *` — any page
  the TV browser ever opens can use the full file bridge. (One more reason the
  TV browser should never see the open web.)
- phoenix.server.js is just a framework (Router + `ServiceManager` + WS on 9888
  with `./cert/cert.{key,pem}`); the real action table lives in service packages
  loaded by `ServiceManager.init()` from paths set by env vars (`BASIC_JS_LIB`,
  `PHOENIX_LIB`). Those env vars are readable via `/proc/self/environ` — fileRead
  runs *as* phoenix, so it can read its own process env (v6).
- No dir-listing or exec-class api exists in the guessed-name space (17 names,
  all `"Not supported api"`); the authoritative table is in the service JS, not
  the guessed list.
- **The boot map** (`start-hisense.sh`, run as root): mounts the rw partitions,
  then `/usr/local/bin/deploy` (MW-deploy), `deploy_oem_data.sh` (OEM-deploy),
  `start-security.sh`, `start-network.sh`, `superwatch` (the supervisor that
  respawns phoenix — explains the crash recovery), `secure_exec`-wrapped
  `masman`/`systemserver`/`tvmain`/`startgui.sh`, and three background watchers:
  `check_usb_key.sh`, `checkEmergentOTA.sh`, and the IPK trigger:
  ```sh
  if [ -e "/APPS/pkgs/NewUpdatedIPK.txt" ]; then
      /usr/local/scripts/set_ipk_path.sh || true
      rm -f "/APPS/pkgs/NewUpdatedIPK.txt"
  fi
  ```
  `/APPS` is the partition the bridge can write. If `set_ipk_path.sh` executes or
  sources anything from `/APPS/pkgs`, that is **root code exec at next boot,
  no hardware** (v6 reads it). Also: `/var/tvservice/reset_working` (rw for us)
  triggers a root factory-reset flow — do not create that file casually.
- `chmod 777 /var/local` at boot; `/dev/ttyS0` is `chown root:808` — the UART
  login prompt is group-accessible, still gated by the login scripts.

### 10.8 v6 results: the root-side consumers of our writable mounts

- **`set_ipk_path.sh` is a symlink flipper, not an installer**: it reads
  `/APPS/pkgs/NewUpdatedIPK.txt` (writable by us) and, as root, for each listed
  existing dir creates `<dir>/current → <basename>` (the A/B `CHA`/`CHB` scheme).
  No script exec — but any boot-time consumer that resolves a package through
  `current` can be repointed at a directory we control. `SSL_CERT_FILE` already
  resolves via `current`; whether JS-service pkgs load via `current` or fixed
  `CHA/` is what `start-kilby.sh` will answer (v7).
- **`deploy_oem_data.sh` is a root-run arbitrary file deployer**: it copies
  everything under `/var/local/oem/…` — and `start-hisense.sh` does
  `chmod 777 /var/local`, i.e. the bridge can write it directly — into
  `/hidata/factory`, `/hidata/model`, `/var/local/dataModule/current`,
  `/vendor/tvconfig/config` (remounted rw by the script itself!) and
  `/serialdata/common/{logos,EPOS}`, then runs `security-dac-oem.sh`. The guarded
  import path (`import_oem_data.sh`: encrypted `OEM*.zip` via `dectool`, MD5,
  white-name ini) only applies to USB import — irrelevant, since the bridge
  writes the staging dir directly. Open question: what *executes* from those
  destinations; `oem_files_white_name.ini` enumerates the legitimate ones (v7).
- **The UART console gate is a readable script**: `check_usb_key.sh` sources
  `/usr/local/scripts/key_check.sh` and calls `check_key_to_open_console`
  (v7 reads it — if the gate is a flag file on rw storage, the console opens
  without hardware).
- **`checkEmergentOTA.sh`** only fires `rescueOTA` when the UI fails to flag
  ready within 60s — emergency lane, not primary.
- phoenix env (`/proc/self/environ`, readable by the bridge since it runs as
  phoenix): `ROOT_SYSTEM_JS=/APPS/pkgs/tv.vidaa.jsservice.system/CHA/` (the
  second JS service pkg — where the real fileRead implementation lives),
  `PHOENIX_BIN_PKG=/opt/pkgs/tv.vidaa.app.phoenix/`,
  `SSL_CERT_FILE=/APPS/pkgs/tv.vidaa.phony.keystore/current/common/cacerts.pem`
  (a `current` consumer), WSS certs at
  `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/cert/cert.{key,pem}` (readable text),
  `PWD` = the CHA dir, and `start-security.sh` is root-only (EACCES).

### 10.9 v7 results: the console gate, and the root primitive

- **The UART root shell gate is `key_check.sh` and it is fully understood.**
  `main()` = USB-key auth → `source /etc/profile; /bin/sh` (root shell). The key
  file must sit in the root of a mounted FAT32 USB (`/tmp/lo_*/`), named
  `md5(vendorID + productID + tvModel)` (model from
  `/hidata/critical/config/critical.ini`), content validated by
  `/usr/local/bin/check_usb_key` (binary, not yet exfiltrated — binary reads
  crash the bridge). There is an interactive **`dummy`** fallback (error codes
  2/9/12 → type `dummy`, `auth`, PIN, key) that also ends in `check_usb_key`.
  Success also calls `envAccess UARTOnOff on` — UART output is env-gated.
  `/tmp` is a tmpfs the bridge can write, so key *placement* is no obstacle —
  the content check is the only gate.
- **The OEM white-name map is data-only** (pic/sound/panel/EDID .ini/.bin/.jpg
  destinations) — the OEM deployer is a root file-write into middleware-parsed
  configs, not an exec primitive. `security-dac-oem.sh` shows the expected DAC
  of those destinations.
- **`rc.local` (root, every boot) executes `/var/local/otaTest.sh` if present** —
  and `/var/local` is bridge-writable. That is the root code-exec primitive:
  write the script through the bridge, reboot, root. (Presumably an OTA
  auto-test hook left in production.)
- rc.local also: starts `sshd`+`telnetd` from `/usr/local/bin/openssh/` scripts
  if that dir exists (conditions unknown — v8), runs root-side
  `OEMfacstart.sh`, and sets `HI_UI_HOME=/APPS/channelA|channelB` — the UI's
  code lives on our writable `/APPS` too.
- `/proc/uptime` read: 26.3 h — no reboot has occurred during the session, so
  cross-reboot `/APPS` persistence (marker test) is still formally unverified;
  `/APPS` is an e2fsck'd ext4 data partition, so it persists.
