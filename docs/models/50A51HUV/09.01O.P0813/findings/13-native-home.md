# Native Home installed (operation-ui Launcher component)

**2026-11-09, owner-authorized, LAN-local.** The Free My TV native Home now
replaces the stock Home on the 50A51HUV. This is a component swap inside the
writable `operation-ui` module, not a SystemUI or root-page replacement. Stock
UI lifecycle, other routes, key dispatch, toasts and vendor services are
retained. Every change has a tested teardown path.

This is the **third** model with lane 3 working, and the first on the **generic**
SDK contract rather than a per-build port.

## Preconditions checked before overwriting anything

- `git log`: clean tree apart from the gitignored `firmware/` working copy, no
  other session mid-install.
- `/var/local`: the bridge and the canvas launcher were already live
  (`/var/local/alvidaa/`), so the native state lives in its own directory,
  `/var/local/alvidaa/native-home/`. No `/var/local/otaTest*` collision.
- OTA already frozen: `/OAD/AppUpgradeSwitch.json` has `upgradeFlag: "0"` for
  CAN, and `/OAD/pkgs/{download,backup}` hold no staged package. No OTA
  endpoints were poked.
- Stock baseline pinned and verified on both sides:
  - `/APPS/channelA/operation-ui/apps/launcher/js/app.js`
  - size `293317`, owner `305:305`, mode `0755`
  - md5 `2f175841081b9c20efd03c0c38b5b839`
  - sha256 `dc9836fed00d02a2b7399fd3b3daeba1f7d324a47431ccfa1a551ac5487ac01e`
  - private copy: `firmware/50a51huv/operationui/apps/launcher/js/app.js`
- Root SSH on `<tv-ip>:2222` with `server/keys/tv_root_ed25519`. No reboot was
  performed during this test.

## Architecture — and how it differs from the other two models

`hisenseUI` (`/opt/hisenseUI/bin/hisenseUI`, uid 311) is launched by
`/opt/hisenseUI/startgui.sh` with `--url=file:///hisenseUI/index.html`. The
writable UI module is **`/APPS/channelA/operation-ui/`** — not
`/APPS/pkgs/tv.vidaa.app.operationui/CHA/` as on the 75U8QTUK, and not the
`hisenseUI` tree that failed on the 55A7KAU.

`app.js` ends with
`(self._V_M_=self._V_M_||{}).launcher=()=>i("taIK").Z`, the same shape as the
75U8QTUK (`740m` there). The appended wrapper replaces **only**
`route[0].component` for `/Launcher`. `beforeEnter` guards, `meta.sourceInfo`,
the other routes, vendor key dispatch and toast/bui services are untouched.

### SDK contracts on this build: the generic set

| Concern | This build (`09.01O`) | 75U8QTUK (`09.60I`) |
|---|---|---|
| App list | `getCurrentShowApps("Launcher")` | `getAppList({sceneCode:"launcher"})` |
| Availability | `getAppInfoByAppId` | `getAppInfo({checkRange:1})` |
| Inputs | `getAllInputsData` | same |
| Input switch | `changeSourceTo` | same |
| Settings | `open("settings",{vk:"T"})` | `open("settings")`, no `vk` |
| App launch | `sdk.apc.start` + `CMDMETHOD.REMOTECONTROL` | `LAUNCHER_RECOMMEND` (`"52"`) |

So the **generic** `native-platform.js` is the correct adapter here; the
75U8QTUK port would be wrong on this unit. That is the whole per-model story in
one table: the mechanism is identical, the contracts are not.

## Two traps this build has that the 75U8QTUK does not

1. **APM supervises the launcher.** `/usr/local/etc/apm/application-config-na-sa.ini`
   has `[launcher] process_name = hisenseUI`, `isKeepAlive = true`,
   `restore_time_when_crash = 10`. But it restores on a **crash**, not after a
   clean `SIGTERM` — a deliberate stop is treated as intentional. So the
   restart still goes through `secure_exec hisenseUI /opt/hisenseUI/startgui.sh`,
   exactly as on the 75U8QTUK. Do not wait for APM after a kill.
2. **`pidof hisenseUI` is unreliable.** It also catches a short-lived child, so
   the first dry run captured the env of pid 5023, signalled it, and then
   correctly refused to continue because the real engine (352) was still alive.
   Match on `/proc/<pid>/exe` instead. This is why the dry gate exists.

Two smaller ones:

- **The bridge watcher fights the native Home.** With `watcher.enabled: true`
  the bridge bounces the TV to the canvas page whenever it sees the VIDAA home,
  which hides the native Home within a second. Set `watcher.enabled: false` for
  the test (`config.json` is re-read on every call, no restart needed) and put
  it back afterwards.
- **The HAL screenshot is black while the engine restarts.** `/usr/local/bin/screenshot`
  returned an 8 KB near-black frame during the restart and a 159 KB real frame
  once the engine settled. A black capture is not proof of a black screen.
  `--remote_debugging_port=9666` and `--webdriver_port=4445` are passed to the
  engine but **no listener is opened** on this build, so there is no DevTools or
  WebDriver verification lane. Owner eyes are the verification.

## Install

`tools/launcher-host/switch-home-50a51huv.sh`, same shape as the 75U8QTUK
script and run detached through `/bin/sh` (`/var/local` is `seclabel`, so a
direct shebang exec fails):

```
/bin/sh -c 'trap "" HUP; exec /bin/sh /var/local/alvidaa/native-home/switch-home.sh MODE' \
  >/dev/null 2>&1 </dev/null &
```

`MODE=dry` restarts stock-only as the gate. `MODE=install` verifies hashes,
kills the engine, stages the candidate, `chown 305:305` / `chmod 0755`, `mv -f`,
moves `compiled_js` and `uncompiled_js` into the backup and recreates them
`311:311` / `0751`, then restarts. `MODE=rollback` reverses all of it.

Candidate: `315765` bytes, md5 `eba638da2ee81a9f9d4177598881b25b`, built from
the pinned stock bundle plus `native-platform.js`, `free-my-tv-native.js` and
`native-entry.js`.

## Verification

- **Owner-confirmed: the Free My TV Home is live.** Clock, shelf and top nav,
  not the stock VIDAA home.
- `app.js` is `315765` bytes, md5 `eba638da…`, owner `305:305`, mode `0755`.
- `compiled_js` holds fresh entries written at install time, proving the new
  bundle was compiled rather than served from a stale cache.
- Engine restarted `12567 → 15010`, `PPid 1`, uid/gid unchanged, stable after
  the restart.
- Dry run before install: engine `7327 → 12567`, stock file untouched.

Not yet exercised on this unit: **Inputs**, **TV Settings** and **app launch**.
Those are the three paths that actually prove the platform adapter, so they are
the next thing to confirm.

## Our own variant, same build

After Free My TV was confirmed live, the alvidaa design was switched in with
`MODE=switch` (same swap, keeps the stock backup and the original cache backup
so rollback still works).

- Candidate `322294` bytes, md5 `df541eb3484ccff7378ce0be133f9612`, built from
  the same pinned stock plus `native-platform.js`, `native-alvidaa.js` and
  `native-entry.js`.
- Engine restarted `15010 → 17383`, `PPid 1`, stable.
- Fresh `compiled_js` entries at install time, so the new bundle compiled.
- **Rendering verified objectively** from the HAL frame, since the build has no
  DevTools/WebDriver lane: white clock text in the top-left region, nothing in
  the regions where Free My TV puts its clock and top nav, and tile edges at
  x = 112, 456, 800, 1144, 1488 (320 px wide, 24 px gaps) — the dock geometry
  as coded. The big label measured `#64748b`, the no-signal colour, which is
  correct with no HDMI source live.
- Action paths (input switch, apps overlay, Settings) still to be exercised.

The two variants are interchangeable on this build because they share the
platform adapter and the entry. Only the component file changes, which is the
shape the variant picker should preserve.

### Quality pass (same day)

Three changes, deployed through `native-install.cjs` rather than by hand:

- **Real icons where the build has them.** The component now accepts local icon
  fields and the vendor's own host (`https://*.vidaahub.com/…`), and unwraps the
  `data:image…iconDownload<url>` trampoline some builds use. Nothing else is
  fetched. Apps with neither fall back to a brand-coloured letter badge.
- **A generated wallpaper.** `wallpaper.cjs` renders a 1920×1080 PNG at build
  time and the build inlines it as a data URI, so the candidate stays one file
  and the repo carries no image asset.
- **A denser dock.** Six tiles per page at 264×180 (was five at 320×176), and a
  6×4 app grid (was 5×3). Focused tiles lift 3%.

Verified from the frame: tile edges at 112→376 and 396→660 (264 wide, 20 gap),
the focused tile extending ~4 px past its bounds (the 1.03 scale), and the
wallpaper measurably brighter bottom-right than top-left. The app overlay's
icons were not exercised on screen; they are covered by tests only.

## Teardown / rollback

```
/bin/sh -c 'trap "" HUP; exec /bin/sh /var/local/alvidaa/native-home/switch-home.sh rollback'
```

restores `app.js` with `305:305` / `0755`, restores both original JS-cache
directories, and restarts the engine with the captured vendor environment.
Backups live in `/var/local/alvidaa/native-home/backup/` and, privately, in
`firmware/50a51huv/`.

## Ground rules honoured

- Owner's own TV, LAN-local, no DRM circumvention, no OTA writes.
- `/` stays read-only with dm-verity green; only `/APPS` (writable module) and
  `/var/local` were written.
- One MQTT server per TV: the existing bridge session was left alone.
- Vendor bundle and screenshots stay in gitignored `firmware/50a51huv/`.

## 8. What actually paints on this engine (2026-11-11)

Measured on the reference unit while chasing an input icon that would not
appear. Four mechanisms, four answers. This is the expensive part of the
finding: each one looked correct in the DOM and produced nothing on screen, and
there is no DevTools on this build to say why.

| Mechanism | Result |
| --- | --- |
| SVG data URI in an `<img>` | **does not paint** |
| the same SVG data URI in `background-image` | **does not paint** |
| the vendor icon-font class the SDK reports (`v-op-ic-videoplay`, rendered as `<i class="v-icon-op …">`) | **does not paint** outside the vendor's own components |
| a PNG data URI in `background-image` | paints — the generated wallpaper has always rendered this way |
| a `div` with a `border` or `background-color` | paints — this is how the fallback hardware icon was drawn |

So: **raster or shapes, never SVG, and do not count on the vendor icon font
from a component we inject.** The dock's device icons are now drawn as divs
(rects, bars, circles) for that reason.

Two traps found alongside it, both in our own code:

- **`box()` always emits `position: absolute`**, so a panel built with it is the
  containing block for its children. Positioning a child at `panelX + 56` inside
  a panel at `panelX` double-counts the offset. The app-list grid sat 64 px right
  and 140 px down, with its last row at y=1056 on a 1080 screen. The settings
  layer used panel-relative coordinates and never showed it.
- **The SDK and the MQTT sourcelist name the same fact differently.** The vendor
  JS SDK (`all-inputs.getAllInputsData`) reports the device on a port as
  `deviceName`; the MQTT sourcelist the bridge reads calls it `displayname2`.
  The native lane only sees the SDK, so reading `displayname2` left HDMI3
  labelled "HDMI3" while the canvas lane showed "Fire TV Stick".
- The SDK's per-source `icon` is an **icon-font class name**, not a URL
  (`v-op-ic-videoplay`). Treating it as an image path yields a broken `<img>`
  that suppresses any fallback.

Verification lane for anything visual on this build: `tools/screenshot.sh`, then
a pixel diff against the previous frame to prove a change happened, and an
ink-count over the region of interest to prove *what* changed. Both were run
here; the diff is what showed that two earlier "fixes" had changed only the
clock.

## 9. Key injection: two lanes measured, both dead (2026-11-13)

The CLI's `alvidaa key` was built to replace "press a key on the TV and tell me
what you see" with a script. It does not work, and the reason is worth recording
because the obvious fix is the wrong one.

**Lane 1 — write to `/dev/input/eventN`: does nothing.** Those nodes are
read-only for consumers; the kernel discards writes to them. The CLI's first
device lane did exactly this, so every key it reported sending was dropped. Its
own output flags HOME and ENTER as guesses, and marks RIGHT and DOWN as
"verified on the reference unit" — that claim is wrong for this lane and has been
corrected.

**Lane 2 — a `/dev/uinput` virtual keyboard: registers, then is ignored.** A
static armv7 emitter (`tools/tvkey/tvkey.c`, built with zig) creates the device
and the kernel logs it:

```
input: alvidaa-key as /devices/virtual/input/input14
```

and it appears in `/proc/bus/input/devices`. But no key it emits moves the
launcher: DOWN, RIGHT, ENTER and HOME each produced zero frame change over a
12-second sample, measured by pixel diff outside the clock band.

So the vendor's key handling reads its own physical devices (the `Hisense` BT
device on event3, the MStar IR receiver on event1, the MTK keypad on event0) and
ignores virtual ones. Injection has to arrive through a device the vendor already
owns, or through the vendor's own API.

**The lane that should work, and is untested:** the MQTT `ui_service` `sendkey`
action — the vendor's own path, the one the remote-now client uses. It needs
either a running bridge that exposes it, or a direct MQTT session with the paired
identity. Nobody has tried the direct session, because the one-session rule means
it would kick whatever holds the identity; with the bridge down it is free to try.

**What this cost:** an hour of measurement, and one ambiguous moment where the
apps drawer was open on screen and it was not clear whether a key had opened it
or the owner had. The lesson is the same one the preview harness taught: a test
that exercises the command builder is not a test that the command works. A
hardware-gated check, or an honest "unverified on hardware" marker, would have
prevented the claim.
