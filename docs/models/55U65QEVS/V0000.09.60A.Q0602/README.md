# 55U65QEVS / V0000.09.60A.Q0602 — root, boot persistence, always-on ACR (MTK9618, EU_A/GBR)

Firmware reference for the Hisense platform model **55U65QEVS** (retail
`55U7QTUK`, serial type `55U6QE`, `ProjectId 140`), build `V0000.09.60A.Q0602`,
build stamp `a20260727u`.

- Browser write lane: closed (`503 appconfig`).
- Read traversal: open, array path only.
- Write primitive: FaaS fetcher (`fetchFile`, uid 314).
- Root: achieved via `fetcher → superwatch 83/82 → opkg postinst` (uid 0).
- Boot persistence: vendor js-service autostart (`BaseService`), no boot-chain
  writes, no `eval` at boot.
- Launcher: lane-3 component swap, `operationui` channel CHB.
- Background telemetry: `HamService` (Nexxen ACR SDK) fingerprints the TV's
  decoded audio continuously and on every input, HDMI included, and matches it
  against a fingerprint server; `voicesdk_server` runs the always-on
  microphone pipeline; usage logs are tagged with serial and MAC.

## Platform

| | |
|---|---|
| SoC | MTK9618 (kernel `mt5879`) |
| CPU | 4× Cortex-A73 (`CPU part 0xd09`), aarch64 kernel 5.4.302 |
| Userland | 32-bit ARM (armhf), glibc 2.31; compiled binaries must be armv7 EABI5 |
| OS | VIDAA U09.60, JS API 3.0.1, Chromium 111 (`odin`), Cobalt shell engine |
| Display | 3840×2160 panel; framebuffer 1920×1080; app surface reports 720p |
| Graphics | OpenGL ES via DirectFB; no `/dev/dri`, no KMS/DRM |
| Video | hardware decode inside the vendor `mediamain` GStreamer process |
| Verified boot | dm-verity + AVB, `verifiedbootstate=green`, A/B slots (`_b` live) |
| SELinux | permissive (`enforce=0`) |

## Chain

1. **`fileRead`** — `HiUtils_createRequest("fileRead", {path:["../proc/uptime"], mode:6})`
   → `ret:true`. A bare-string path returns `invalid path`. Relative paths resolve
   against `/APPS`.
2. **`fileWrite`** — `HiUtils_createRequest("fileWrite", …)` → `ret:false`,
   `client request permission check error, please check appconfig`.
   `Hisense_SupportAppConfig()` → `true`.
3. **FaaS write** — `vowOS.service.syncExecute("basic/fetcher",
   {api:"fetchFile", args:JSON.stringify({url,directory,permission})})` writes as
   uid 314. No `mkdir`: the target directory must exist.
4. **FaaS exec** — `POST https://localhost:9888/function/basic/fetch/<name>` runs a
   module placed in `tv.vidaa.jsservice.basic/CHA/functions/fetch/` as uid 314
   (Node 20.19.4, group `616(superwatch)`). `http://localhost:9009` also answers.
5. **Superwatch** — `sw2.js` sends `4-byte LE length + payload` to
   `/var/run/superwatch_socket`; ids `83` (uninstall) and `82` (install) run
   `opkg --force-reinstall install <ipk>`; the IPK `postinst` executes as uid 0
   (`CapEff 0000003fffffffff`). Control fields required: `Architecture: mtk9618`,
   `AppId`, `AppName`.
6. **Boot persistence** — `BaseService` + one `serviceList.json` entry; the vendor
   service manager starts it at uid 314 on every boot and it re-arms step 5 when
   nothing listens on `:8008`. [findings/02](findings/02-base-service-persistence.md)

## Measurements

| Item | Value | Source |
|---|---|---|
| `critical.ini [Critical]` | `Model=55U65QEVS`, `Serial=55U6QE`, `ProjectId=140` | live |
| `critical.ini [Hardware]` | `ChipVersion=MTK9618` | live |
| `ModelInfo.ini` | `SocModel=MTK9618`, `Name=55U6QE`, `SwVersion=V0000.09.60A.Q0602` | live |
| `critical.ini [System]` | `Version=V0000.09.09P.P0930` (factory baseline) | live |
| `GetChipSetName()` | `MTK9618` | live |
| `GetPlayerFeatureInfo()` | `009006000.VD9618O_GL` | live |
| `fileWrite` | `503 appconfig` | live |
| fetcher `fetchFile` | `ret:true "download finished"`, uid 314 | live |
| superwatch `83`/`82` | `ret:true`, `ipk_install_status → step:finish` | live |
| `postinst` identity | `Uid: 0 0 0 0`, `CapEff 0000003fffffffff` | live |
| boot persistence | root shell listening ~20 s after a power cycle | live |

## Partitions

rw: `/APPS` p54 · `/APPS2` p46 · `/var/local` p49 · `/OAD` p55 · `/data` p12 ·
`/vendor/persist` p33 · `/Customer` p27 · `/certificate` p5 · `/vendor/uuenv` p4 ·
`/var/tvservice` p44 · `/cache` p11

ro: `/` (squashfs + dm-verity) · `/vendor/tvconfig` + `/config` p25 ·
`/vendor/lib` dm-1 · `/application` dm-2 · `/hidata/{critical,factory,model,common}`
p42/43/45/51 · `/oemdata` p52 · `/project_id` p35 · `/serialdata` p50 · `/3rd` dm-5

tmpfs: `/var/run`, `/var/log` (4 MB), `/var/crash`

`/APPS`, `/APPS2`, `/var/local` and `/OAD` are mounted `nosuid`; all are `0777` at
the top level.

## Findings

| | |
|---|---|
| [01](findings/01-identity-and-bridge.md) | identity, bridge surface, installed packages |
| [02](findings/02-base-service-persistence.md) | boot persistence via the vendor js-service autostart |
| [03](findings/03-native-home-port.md) | native Home (lane 3): bundle, SDK contracts, engine quirks |
| [04](findings/04-negative-results.md) | approaches that do not work, with the observed error |
| [05](findings/05-media-stack.md) | CPU, display layers, graphics, decoder, runtimes |
| [06](findings/06-jellyfin-and-media-apps.md) | Jellyfin web/desktop/Android options; measured playback |
| [07](findings/07-ssh-shell.md) | static dropbear shell: requirements and constraints |

## Teardown

```sh
cp -p /APPS/.re/backup/serviceList.json.pristine \
      /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json
rm -rf /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/hearthd
kill $(pidof dropbear) 2>/dev/null
umount /etc/passwd 2>/dev/null
rm -rf /APPS/.re /APPS/.re_ssh /APPS/home/root /APPS/bin/tvsh /APPS/shell
rm -f /APPS/installer.ipk /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/sw2.js
opkg remove re.installer
cp -p /APPS/.re/backup/app.js.stock \
      /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
chown 305:909 /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
chmod 0640 /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
```
