# Handoff — lane 3, 2026-11-09

Second handoff for the same day. The first
([HANDOFF-2026-11-09.md](HANDOFF-2026-11-09.md)) covers the canvas launcher
rework and the vendor exchange. This one covers only the native lane: what is
installed, what is proven, what is not, and how to get back.

## Where the TV is

| | |
| --- | --- |
| Model | 50A51HUV, MTK9602, `09.01O.P0813` |
| Address | `192.168.0.175` at handoff (DHCP shuffles; scan `:36669` if it moves) |
| Native Home | **alvidaa variant**, `1c503779c0caa92a9e6083e9578e74a9` |
| Engine | `hisenseUI`, restarted by the switch script, `PPid 1` |
| Bridge | still running on `8770`; **watcher disabled** (see below) |
| Stock backup | `/var/local/alvidaa/native-home/backup/` + `firmware/50a51huv/` |

## The one thing to know

**The bridge watcher is off, and it has to stay off while a native Home is
installed.** With `watcher.enabled: true` the bridge bounces the TV to the
canvas page the moment it sees the VIDAA home, which hides the native Home
within a second. The original config is at
`/var/local/alvidaa/config.json.bak-nativetest`.

So there are two coherent setups, not a mix:

- **Native Home installed** → watcher off (current state).
- **Canvas launcher** → roll back to stock Home first, then re-enable the
  watcher.

## What is proven

- Lane 3 works on this build. The writable module is
  `/APPS/channelA/operation-ui/`, not `pkgs/tv.vidaa.app.operationui`; the SDK
  contract is the **generic** one (`getCurrentShowApps`, `open("settings",{vk:"T"})`).
- Free My TV (generic) ran here and was owner-confirmed live.
- The alvidaa variant runs here. Layout verified from the HAL frame: clock and
  dock geometry, six tiles per page at 264×180, the focused tile's 3% lift, and
  the generated wallpaper's direction.
- Install, switch and rollback all work end to end through
  `native-install.cjs`, not just by hand.
- Dry gate, cache reset, hash checks, owner/mode preservation.

## What is NOT proven

**The action paths have not been exercised on screen**: switching to an input,
opening the Apps overlay, launching an app, opening TV Settings. These are what
prove the platform adapter rather than the layout. The owner was going to check
them; treat them as open until confirmed.

The app overlay's real icons are also unverified on screen. The icon policy is
covered by tests only.

## Operating it

```sh
# what is available
node tools/launcher-host/native-install.cjs list

# status / switch / rollback
node tools/launcher-host/native-install.cjs status   --model 50a51huv --host <ip>
node tools/launcher-host/native-install.cjs install free-my-tv --model 50a51huv --host <ip>
node tools/launcher-host/native-install.cjs install alvidaa     --model 50a51huv --host <ip>
node tools/launcher-host/native-install.cjs rollback --model 50a51huv --host <ip>
```

`install` reads the current bundle hash and picks `install` (stock) or `switch`
(another variant) itself. The stock backup is taken once by bootstrap and never
replaced, so rollback works whichever variant is in place.

Design and safety rules: [VARIANTS.md](../../tools/launcher-host/VARIANTS.md).
Variant details: [NATIVE-ALVIDAA.md](../../tools/launcher-host/NATIVE-ALVIDAA.md).
The install record: [findings 13](../models/50A51HUV/09.01O.P0813/findings/13-native-home.md).

## Traps, in the order they bit

1. **APM supervises the launcher but only restores after a crash.** A clean
   `SIGTERM` is treated as intentional and is never respawned. Restarts go
   through `secure_exec hisenseUI /opt/hisenseUI/startgui.sh`, always.
2. **`pidof hisenseUI` catches a transient child.** The first dry run captured
   the wrong pid's env and signalled it; the gate then refused to continue,
   correctly. Match on `/proc/<pid>/exe` instead.
3. **The HAL screenshot is asynchronous and sometimes slow.** It can take
   several seconds, and it returns a black frame while the engine is
   restarting. Poll for the file, do not assume a fixed delay; a black frame is
   not proof of a black screen.
4. **No DevTools or WebDriver.** `--remote_debugging_port=9666` and
   `--webdriver_port=4445` are passed to the engine, but no listener opens on
   this build. The HAL frame plus the owner's eyes are the verification lane.
5. **`scp` does not work** (no `sftp-server` on the TV). Upload with
   `ssh 'cat > path' < local`.
6. **The TV's busybox is trimmed**: no `wc`, `tail`, `tr`, `strings`, `readlink`,
   `sha256sum`. `md5sum`, `sed`, `awk`, `head`, `grep`, `cat`, `kill`, `sleep`
   are there. Compute sha256 on the Mac.
7. **`/var/local` is `seclabel`**, so scripts there cannot be exec'd by shebang.
   Invoke through `/bin/sh` explicitly.
8. **The TV naps.** All ports close in deep standby, including SSH. The MAC
   stays in the ARP table, so the IP is still right; wait rather than rescan.

## Pending

- **Confirm the action paths** (input switch, Apps overlay, app launch, TV
  Settings) and flip findings 13 from "pending" to verified.
- **Decide the watcher's long-term home.** The footgun half of this is closed:
  `native-install.cjs` owns the watcher now — it disables the watcher on
  install/switch, restores the once-taken `config.json.bak-native-home` on
  rollback, and `--no-watcher` opts out loudly. What remains open is only the
  policy question: which of the two setups is the default.
- **Real icons**: the variant now accepts `https://*.vidaahub.com/…` for icons.
  If the owner would rather keep zero network access, delete that rule in
  `allowedIcon()` and every app falls back to its brand badge.
- **Quality**: the owner's read was "a bit behind" before the v3 pass. The
  remaining gap is real app icons and a more Apple-TV-like app grid; both are
  now in, but unverified on screen.
- **75U8QTUK**: `switch-home-75u8qtuk.sh` still uses the old manual flow. It
  works, but it has not been ported to the `switch` mode or the CLI's model
  profile beyond the manifest entry.

## Rollback, if everything else is confusing

```sh
node tools/launcher-host/native-install.cjs rollback --model 50a51huv --host <ip>
```

Restores the pinned stock `app.js` (`2f175841…`), restores both original JS
cache dirs, and restarts the engine — and it hands the watcher back too, from
`/var/local/alvidaa/config.json.bak-native-home` (taken by the first
CLI-managed install, never replaced), so the canvas launcher works again
without a manual `cp`. This TV was installed before the installer owned the
watcher, so its backup will be taken from the current (watcher-off) config on
the next `install`; until then, re-enable the watcher by hand if the canvas
launcher is wanted:

```sh
ssh ... 'cp -p /var/local/alvidaa/config.json.bak-nativetest /var/local/alvidaa/config.json'
```

The bridge re-reads `config.json` on every call, so no restart is needed.

## Files added or changed this session

| Path | What |
| --- | --- |
| `tools/launcher-host/native-alvidaa.js` | our component |
| `tools/launcher-host/wallpaper.cjs` | build-time wallpaper generator |
| `tools/launcher-host/build-native-alvidaa.cjs` | build, inlines the wallpaper |
| `tools/launcher-host/switch-home-50a51huv.sh` | on-TV install/switch/rollback |
| `tools/launcher-host/variants.json` | the variant list |
| `tools/launcher-host/models.json` | per-build facts |
| `tools/launcher-host/native-install.cjs` | the picker CLI |
| `tools/launcher-host/VARIANTS.md` | picker design and rules |
| `tools/launcher-host/NATIVE-ALVIDAA.md` | component details |
| `docs/models/50A51HUV/.../findings/13-native-home.md` | the install record |
| `tools/launcher-host/native-entry.js` | one entry, picks the variant |
