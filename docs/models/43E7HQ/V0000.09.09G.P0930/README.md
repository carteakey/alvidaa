# 43E7HQ / V0000.09.09G.P0930 — root via the stock `otaTest.sh` hook, native lane-3 Home installed (MTK9602, EU/FR)

**Status:** verified on the contributor's own unit on 2026-11-26: RemoteNow
pairing, browser file-bridge reads and writes, root at every boot through the
stock `rc.local` → `/var/local/otaTest.sh` hook (cold boot and `/bin/reboot`),
and a **native lane-3 Home** (generic `native-platform.js` contract) rendering
in place of the stock Home; the owner launched apps from it and returned with
the Home key (input switching with a live source was not specifically
confirmed). The lane-1 bridge launcher was only started, not
installed. SSDP `transport_protocol` was not read (see Open items).

> **Applies to `43E7HQ` (internal model `43A56FEVS`, MediaTek MTK9602, armv7l,
> region France) running `V0000.09.09G.P0930`** (extended version
> `H.P0930.X0005.W01.Y01.J01`, kernel `4.19.79+` built 2025-09-30). This is the
> same `09.09x.P0930` build family as the [43A6K](../../43A6K/V0000.09.09C.P0930/README.md)
> (`09.09C`, `43A53FEVS`) and the [43A5FE](../../43A5FE/V0010.09.09A.P0930/README.md)
> (`09.09A`); the chain below is the 43A6K one, replayed unchanged on another
> board of the family. No other model was tested.

> **Contributed by [@AlexBsrd](https://github.com/AlexBsrd).** Own
> device, LAN-local, done with an AI coding session following
> [AGENTS.md](../../../../AGENTS.md) and the 43A6K / 43A5FE / 50A51HUV guides.

## What the chain rests on

Same family as the 43A6K. Nothing here is new as a method; what is new is that
the `09.09G` letter of the build keeps every property open.

1. **The browser file bridge escapes its base with `../`.** `fileRead` /
   `fileWrite` (mode 6, `writedata`) from an ordinary page opened in the stock
   TV Browser resolve against `/APPS/` and accept `../`. The page itself does
   not use the RemoteNow pairing and was not installed as an app (the TV had
   been paired beforehand, so a never-paired set was not tested). Reads of `/etc/rc.d/rc.local`,
   `/proc/*` and `/sys/fs/selinux/enforce` succeed; text writes under
   `/var/local` succeed and read back byte-identical.
2. **The stock `rc.local` still executes `/var/local/otaTest.sh` as root.**
   The "OTA auto test" block (`chmod +x` then run in background) is present and
   uncommented on this build, so one text file under `/var/local` becomes root
   code at the next boot.
3. **SELinux is not enforcing.** `/sys/fs/selinux/enforce` reads `0` (and
   `/proc/self/attr/current`, read through the bridge, i.e. in the process that
   serves it, is `user_u:object_r:unconfined_process`). This is the
   property that stopped the same hook on the
   [55E7QTUK](../../55E7QTUK/V0000.09.09D.P1001/README.md) (`09.09D`, MTK9603,
   enforcing); on this MTK9602 `09.09G` build it is permissive.

## What was measured

| Claim | Evidence | Source |
| --- | --- | --- |
| Firmware `V0000.09.09G.P0930`, chip `MTK9602`, model `43A56FEVS` | verified | `Hisense_GetFirmWareVersion()`, `Hisense_GetChipSetName()`, `Hisense_GetModelName()` from the read-only `launcher/fingerprint.html` page |
| Browser Chromium 111 (`Linux armv7l`) | verified | page user agent |
| RemoteNow pairing works with the 2024 app certificate, profile `modern` | verified | `server/pair.py`; PIN accepted, tokens issued |
| `../` traversal, read | verified | `fileRead` of `../etc/rc.d/rc.local`, `../proc/version`, `../sys/fs/selinux/enforce` from a TV Browser page |
| `../` traversal, write under `/var/local` | verified | write → read-back → overwrite of a scratch file |
| `rc.local` runs `/var/local/otaTest.sh` as uid 0, early | verified | hook log: `Uid: 0 0 0 0`, written at uptime ≈ 6 s (system clock still at 2000-01-01) |
| Root persists across cold boot and `/bin/reboot` | verified | hook re-ran after a mains pull and after a remote reboot |
| SELinux not enforcing | verified | `enforce` = `0` |
| Native lane-3 Home (generic contract) renders and launches apps | verified | HAL screenshots; owner launched apps and came back with Home |
| JPEG `data:` URI as `background-image` paints in the injected component | verified | HAL screenshot (extends [50A51HUV findings 13 §8](../../50A51HUV/09.01O.P0813/findings/13-native-home.md), which had verified PNG only) |
| `XMLHttpRequest` from the native Home to a LAN host and to `127.0.0.1` works when the server sends `Access-Control-Allow-Origin` | verified | live data rendered on screen |
| SSDP `transport_protocol` | untested | M-SEARCH got no answer through the host firewall; not retried |

## Traps on this build (recorded the same day)

1. **`grep` exits 0 without a match.** With piped input, both `/bin/grep`
   (→ `/openbox/bin/grep`) and BusyBox `grep` returned status 0 when nothing
   matched (`echo abc | grep -q zzz; echo $?` → `0`, while `false` gives `1`
   and `-c` counts are correct). So `… | grep -q PATTERN || continue` passes
   for everything. The 50A51HUV `switch-home` script's `live_engine()` relies
   on exactly that; on this TV its `status` mode listed ~200 PIDs (every
   process) as the UI engine, before any `kill`. The adapted script
   (`switch-home-43e7hq.sh`, separate tools PR) matches the
   `/proc/<pid>/exe` link with `case` instead. Do not branch on a `grep`
   exit code on this firmware.
2. **Write, then cut power quickly = empty file.** The first hook written
   through the bridge was followed by a mains pull about a minute later; after
   boot `otaTest.sh` existed but was **0 bytes** (data never flushed). Waiting
   ~2 minutes before pulling power (or `sync` once you have a shell) fixed it.
3. **`id`, `tr`, `df`, `readlink`, `pgrep`, `sort`, `uniq`, `od` are absent**
   from the shell / BusyBox applet set; read `Uid:` from `/proc/$$/status`.
4. **`busybox reboot` is ignored.** `/bin/reboot` (→ `/basic/mtk_reboot`)
   works; the set comes back in standby and needs the remote's Power key.
5. **An in-kernel OTA freeze by hostname also cuts your own sessions.** An
   `iptables -m string` REJECT on the update hostnames matches any TCP segment
   carrying that text, including a shell session that prints `iptables -S`
   or a file containing the names: the connection just dies silently.
   Mask the names in output (`sed`) or read such files locally.
6. **`hiddenApps.json` is not a user "hide" list on this build.**
   `/APPS/hisenseUI_shared_data/launcher/hiddenApps.json` is written by
   `apc-service` from a cloud call (`getHiddenAllAppsFromCloud`) and maps
   remote hot-key buttons (`button: 0xFB23` …); the stock row is built from
   `appsSeqInfo.json` plus vendor rules. Editing it is not a way to declutter
   the stock Home here (the [43A5FE guide](../../43A5FE/V0010.09.09A.P0930/README.md)
   describes it differently for `U07.51`).
7. **After boot the load average stays very high (40+)** for several minutes
   and does not prevent normal use; it is not a sign of a problem.

## Native Home (lane 3)

- Bundle: `/APPS/channelA/operation-ui/apps/launcher/js/app.js`, stock size
  `293330`, owner `305:305`, **mode `0664`** (not `0755` as on the 50A51HUV),
  md5 `e988dfe7992a8d2eecea72c24896de05`. It ends with
  `(self._V_M_=self._V_M_||{}).launcher=()=>i("taIK").Z`, same module id as
  the 50A51HUV.
- Engine `hisenseUI` (uid 311), cache `/var/local/hisenseUI/cobalt_home/.cache/cobalt`,
  APM did **not** respawn it after a clean `SIGTERM`; the `secure_exec`
  fallback started it every time (`dry`, `install`, `switch` all OK).
- **The generic [`native-platform.js`](../../../../tools/launcher-host/native-platform.js)
  contract is correct here** (`getCurrentShowApps("Launcher")`,
  `getAllInputsData`, `changeSourceTo`, `open("settings",{vk:"T"})`,
  `sdk.apc.start` + `REMOTECONTROL`), with the shared
  [`native-entry.js`](../../../../tools/launcher-host/native-entry.js) route swap.
- Precaution, not a measured failure: `native-platform.js` `launchApp()`
  refuses apps absent from `getCurrentShowApps("Launcher")`, and **Orange TV**
  (appId `2554`) is absent from the stock `appsSeqInfo.json`. The component
  here resolves apps with `getAppInfoByAppId` and calls `sdk.apc.start`
  itself, which launches Orange TV; whether `getCurrentShowApps` lists it was
  not checked.
- The component used on this unit is a private design (owner photo); it is not
  part of this PR. Any of the repo's variants should work with the generic
  adapter.

## What this guide includes and leaves out

| Included | Left out |
| --- | --- |
| fingerprint and firmware constants | the hook script and any payload |
| the chain at the architecture level (same as 43A6K) | the exact write sequence and page used to plant the hook |
| evidence for each claim and the traps | pairing tokens, certificates, device identifiers |
| the lane-3 constants and the script changes (script itself: separate tools PR) | vendor bundles, screenshots of the owner's Home |
| teardown | |

The chain is already public through the 43A6K guide; this page records that it
holds on `09.09G` and what differs, without adding an artefact that executes it.

## Teardown

- Native Home: `switch-home-43e7hq.sh rollback` (the 50A51HUV script with the
  changes above; separate tools PR) restores the pinned stock
  `app.js` (`305:305`, `0664`) and the original JS cache directories, then
  restarts the engine. **Rollback itself was not run on this unit** (`dry`,
  `install` and `switch` were); the stock copy (md5 checked) is kept in
  `/var/local/alvidaa/native-home/backup/`.
- Root: delete `/var/local/otaTest.sh` (and anything it started) and reboot;
  the stock `rc.local` then does nothing. A factory reset also clears
  `/var/local`. Neither was run here (the unit stays rooted). No read-only
  partition was written.

## Open items

- SSDP `transport_protocol` (expected `3290`, as on the 43A6K) — not read.
- OTA freeze was done in-kernel (owner disabled auto-update in the menu, plus
  `iptables` `string` matches on the update hostnames); `/OAD/AppUpgradeSwitch.json`
  was not inspected.
- Lane-1 bridge launcher: started and paired, not installed as an app (the
  owner did not want a Home that depends on another box).
- Whether `09.09G` ships on other `43E7`/`A5x` boards.

## Cross-reference

- Same chain: [43A6K / 09.09C.P0930](../../43A6K/V0000.09.09C.P0930/README.md), [43A5FE / 09.09A.P0930](../../43A5FE/V0010.09.09A.P0930/README.md)
- Same lane-3 layout: [50A51HUV findings 13](../../50A51HUV/09.01O.P0813/findings/13-native-home.md)
- Hook blocked by SELinux on a sibling build: [55E7QTUK / 09.09D.P1001](../../55E7QTUK/V0000.09.09D.P1001/README.md)
- Method catalogue: [EXPLOITS.md](../../../research/EXPLOITS.md)
- Publication policy: [DISCLOSURE.md](../../../DISCLOSURE.md)
