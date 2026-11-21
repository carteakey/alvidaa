# 55U65QEVS / V0000.09.60A.Q0602 — root, boot-persistent via BaseService (MTK9618, EU_A/GBR)

**Status:** verified on 2026-11-20 on one retail unit. The browser write lane is
**closed** by the `503 appconfig` identity gate; root is **achieved** through the
`fetcher → superwatch → IPK postinst` chain (same family as `55E75LEVS`/09.61B,
`50U7DSE`/09.62N, `65A85QEVS`/`09.60A`), and is **boot-persistent** through the
vendor js-service autostart — a `BaseService` in
`tv.vidaa.jsservice.basic/CHA/services/` plus one `serviceList.json` entry, which
re-runs the install ~20 s after every cold boot. Root survives a wall-plug power
cycle with no page, no PC and no pairing.

> **Applies to the retail `55U7QTUK`**, whose platform identity is **`55U65QEVS`**
> (serial type `55U6QE`, `ProjectId 140`; SoC **MTK9618**, kernel 5.4.302
> aarch64 with 32-bit ARM userland, VIDAA `U09.60`, region `EU_A`, country
> `GBR`) running `V0000.09.60A.Q0602` (build stamp `a20260727u`).
> `55U7QTUK`, `55U65QEVS` and `55U6QE` appear nowhere else in this repo: the
> retail SKU is not the platform model, and searching only the retail string
> finds nothing.

> **Owner-run, own TV only.** No key material or vendor bundle is published with
> this guide. The IPK builder here is a minimal proof-of-root; the shell is the
> vendor Node runtime, not a patched Dropbear.

## What the chain rests on

1. **The browser write lane is closed.** `HiUtils_createRequest("fileWrite", …)`
   returns `ret:false` with `client request permission check error, please check
   appconfig`, and `Hisense_SupportAppConfig()` is `true` — the same gate as
   `65A85QEVS` on the identical build string.
2. **Read traversal is array-only.** `{path:["../proc/uptime"]}` → `ret:true`;
   a bare string is rejected `invalid path`. Relative paths resolve against
   `/APPS`, so `ModelInfo.ini` is readable without traversal at all.
3. **The fetcher is the write primitive.** `vowOS.service.syncExecute("basic/fetcher",
   {api:"fetchFile", args:"{\"url\",\"directory\",\"permission\"}"})` writes as
   uid 314 with no appconfig check; it does not `mkdir`, so the target directory
   must exist.
4. **FaaS exec.** `POST https://localhost:9888/function/basic/fetch/<name>` runs a
   module written into `CHA/functions/fetch/` as uid 314 (Node 20.19.4,
   `process.arch=arm`, group `616(superwatch)`). `http://localhost:9009` works as
   a fallback.
5. **Superwatch 83/82 → uid-0 postinst.** `sw2.js` writes `4-byte LE length +
   payload` to `/var/run/superwatch_socket`; ids `83` (uninstall) and `82`
   (install) are accepted; `opkg --force-reinstall install <ipk>` runs the IPK's
   `postinst` as uid 0 (`CapEff 0000003fffffffff`). The IPK `control` must carry
   `Architecture: mtk9618` and `AppId`/`AppName`.
6. **Boot persistence is the vendor js-service autostart** — see
   [findings/02](findings/02-base-service-persistence.md). This is the part worth
   reading: it does not use PFM, does not eval anything at boot, and fails
   benignly.

## What was measured

| Claim | Evidence | Source |
| --- | --- | --- |
| Identity | `critical.ini [Critical] Model=55U65QEVS`, `Serial=55U6QE`, `ProjectId=140`; `[Hardware] ChipVersion=MTK9618`; `[Market] RegionStr=EU_A` | live |
| SoC, three ways | `ModelInfo.ini SocModel=MTK9618`; `GetChipSetName()`→`MTK9618`; `GetPlayerFeatureInfo()`→`009006000.VD9618O_GL` | live |
| Kernel / userland | `5.4.302` aarch64, `process.arch=arm`, `mt5879` in cmdline | live |
| Verified boot | `verifiedbootstate=green`, `device_state=locked`, `veritymode=enforcing`, dm-verity with FEC + `restart_on_corruption`, **A/B slots** (`slot_suffix=_b`) | live |
| `fileWrite` gated | `503 appconfig`, `SupportAppConfig()=true` | live |
| `fileRead` traversal | array path only, bare string `invalid path` | live |
| Fetcher write | `ret:true "download finished"` as uid 314 | live |
| FaaS exec | `probe.js` → `uid 314`, `node 20.19.4`; `/var/run/superwatch_socket` present `0660` | live |
| Superwatch | `83`/`82` → `ret:true`; `ipk_install_status` → `step:finish` | live |
| `postinst` uid 0 | `Uid: 0 0 0 0`, `CapEff 0000003fffffffff` | live |
| Root shell on 8008 | Node `rshell.js`, uid 0, reachable from the LAN | live |
| **Boot persistence** | `hearthd start … ARMED: root shell up on 8008` 19 s after a **wall-plug** power cycle; `boot_id` changed | live |
| Native Home (lane 3) | `app.js` md5 **45626039103fb60060618545dba6f0f5** — byte-identical to the `65A85QEVS` stock bundle this repo already pins | live |

## Deltas worth knowing

- **`/var/local` is `drwxrwxrwx`**, `/APPS` and `/OAD` likewise. That is why the
  fetcher needs no help creating files at the top level.
- **`/var/log` is tmpfs** (4 MB); runtime logs die at reboot. `/var/local` is a
  real ext4 and persists — a factory reset does not clean it.
- **No `alpac-agent`** on this unit (`/var/local/alpac-agent` absent), so nothing
  re-arms `DebugPowerup` from the vendor side.
- **The `rc.local` `otaTest.sh` hook is commented out** on this build, so that
  root lane (used on the `50A51HUV`) does not exist here.
- **SELinux is permissive** (`enforce=0`).
- **`inittab` runs `getty` on `ttyS0,115200`** — a serial console exists.
- **No `sshd`/`dropbear`/`nc`/`socat`/`wget`/`curl`**, and every persistent
  filesystem is `nosuid`, which is why the shell is Node, not a binary.

## Teardown

```sh
# 1. persistence: restore the pristine list and drop the service
cp -p /APPS/.re/backup/serviceList.json.pristine \
      /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json
rm -rf /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/hearthd
# 2. shell + payloads
/usr/local/bin/busybox pkill -f rshell.js
rm -f /APPS/.hearthd.log /APPS/installer.ipk
rm -rf /APPS/.re
rm -f /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/sw2.js
# 3. package (if the IPK is still installed)
opkg remove re.installer
# 4. launcher, if it was replaced
cp -p /APPS/.re/backup/app.js.stock \
      /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
chown 305:909 /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
chmod 0640 /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
```

The rootfs, `/vendor/*`, `/OAD` and the boot chain are never written.

## Cross-reference

- Boot persistence mechanism and its failure modes:
  [findings/02](findings/02-base-service-persistence.md)
- Native Home port specifics (SDK contracts, Cobalt quirks):
  [findings/03](findings/03-native-home-port.md)
- What did **not** work, so nobody repeats it: [findings/04](findings/04-negative-results.md)
- Hardware and media stack (A73, framebuffer vs app surface, GLES-over-DirectFB): [findings/05](findings/05-media-stack.md)
- Jellyfin and packaged media apps, with a playback matrix: [findings/06](findings/06-jellyfin-and-media-apps.md)
- A key-only SSH shell (dropbear) and its four traps: [findings/07](findings/07-ssh-shell.md)
- Identity and bridge evidence: [findings/01](findings/01-identity-and-bridge.md)
