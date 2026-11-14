# Handoff — lane-3 native Home parity, and the deploy that did not happen

Session date: 2026-11-09/10. Written for resuming on the m2 Mac. Delete this
file once the deploy is done and the checklist is walked.

## Where things stand

The parity work is **finished, reviewed and on main**. The deploy is **not
done**: the TV never became reachable from the machine the session ran on.

| Item | State |
| --- | --- |
| Parity work (7 tasks) | landed on `main`, pushed to origin |
| `node --test tools/launcher-host/native-alvidaa.test.cjs` | 32 pass, 0 fail |
| `./scripts/check.sh` | exit 0 |
| Deploy to TV | **blocked — TV not on the network** |
| Hardware verification | **not started** (every behaviour is still a claim) |

## What landed

| Commit | Change |
| --- | --- |
| `bdeaebe` | toast HUD replaces the raw status line |
| `0c139ef` | storage-backed preferences: hidden/only apps, custom names, last-used |
| `40c638f` | remote number hotkeys 1–9 and 0 |
| `1b4977c` | pinned favorites row in view 2 |
| `d89eecf` | opt-in auto-switch countdown on boot |
| `eeb96dc` | per-input wallpaper art, two-layer cross-fade |
| `3d914f3` | parity audit table + on-TV verification checklist in `NATIVE-ALVIDAA.md` |

All seven were reviewed at diff level (tests re-run by the supervisor in a
non-`/tmp` worktree), rebased where a later task had landed first, and
fast-forwarded. Nothing was merged on a worker's word.

## Why the deploy stopped

The TV was reported on, but from the session host:

- `192.168.0.11` ARP-fails (the old lease);
- a full `/24` scan found 19 hosts up and **none** listening on dropbear
  `2222`, MQTT `36669`, `8008` or `8770`;
- SSDP `M-SEARCH` got exactly one responder — the router at `192.168.0.1`.

So the TV is on another SSID/VLAN, or its network is down. Nothing else is
blocking: the root key was restored to `server/keys/` (pulled from m2, which
already has it), and the install path was verified against the code.

## The deploy, exactly

Run this on a host that can reach the TV. m2 already holds
`~/repos/alvidaa/server/keys/`, so it is the natural place.

```sh
cd ~/repos/alvidaa
export TV_HOST=<tv-ip>          # Settings -> Network -> Network Information

# 0. the TV must answer, and the lane must be root
./server/tv 'grep -E "^Uid" /proc/self/status'      # Uid: 0 0 0 0
# NOT `id` — this build has no id binary (2026-11-10). It also has no curl,
# wget, nc or sha256sum. md5sum, sed, awk, grep, head, sleep, ps are there.

# 1. the launcher bundle is operation-ui on this build, NOT hisenseUI
./server/tv 'ls -ld /APPS/channelA/operation-ui/apps/launcher/js'

# 2. pin the stock bundle before touching it
./server/tv 'md5sum /APPS/channelA/operation-ui/apps/launcher/js/app.js'
# this build has no sha256sum, so the pinned sha256 is computed on the Mac from
# the pulled file in step 3. The md5 above is the quick check; the model profile
# pins both (tools/launcher-host/models.json).

# 3. pull it and build the candidate (output stays in firmware/ or /tmp)
./server/tv 'cat /APPS/channelA/operation-ui/apps/launcher/js/app.js' > firmware/stock-app.js
shasum -a 256 firmware/stock-app.js
# expect dc9836fed00d02a2b7399fd3b3daeba1f7d324a47431ccfa1a551ac5487ac01e
# a mismatch means the bundle moved: re-pin, do not build against it
node tools/launcher-host/build-native-alvidaa.cjs \
  firmware/stock-app.js firmware/candidate-alvidaa.js \
  046b41aee0242ced3d3fcd9d5e0c0adb68e17ea3bfe14efa13d6225b6050bfad
# argument order is <stock> <output> <expected-sha256>; the hash is last, and a
# build that cannot state its stock revision refuses to run at all

# 4. the bridge is NOT required by this path. native-install.cjs drives the
# on-TV switch script over SSH; only the older native-home.cjs installer wanted
# 127.0.0.1:8770 alive. Check it only if you also want /api/open or screenshots
# through the bridge — and note this build has no curl, so probe the port from
# /proc/net/tcp instead.

# 5. install or switch, in one command. It builds from the pinned stock, uploads
# over the SSH lane (scp does NOT work here: no sftp-server), runs the on-TV
# switch script, waits for its verdict, and owns the watcher.
node tools/launcher-host/native-install.cjs install alvidaa \
  --model 50a51huv --host "$TV_HOST"
# mode is chosen for you: stock -> install, another variant -> switch. The stock
# backup is taken once by bootstrap and never replaced, so rollback works
# whichever variant is in place. Measured 2026-11-10: ~40s, engine pid changes,
# app.js md5 becomes the candidate's.

# 6. verify
node tools/launcher-host/native-install.cjs status --model 50a51huv --host "$TV_HOST"
tools/screenshot.sh /tmp/native-home.png
# the HAL capture takes 6-8s and the tool now polls for it; a black frame while
# the engine restarts is not proof of a black screen, poll again
```

Notes that save a debugging round:

- **The watcher is handled.** Both install paths own it now: `native-home.cjs`
  sets `config.watcher.enabled = false` itself (`native-trial.cjs:152`), and
  the variant picker CLI (`native-install.cjs`) does the same on
  install/switch and restores the pre-native config from
  `config.json.bak-native-home` on rollback. There is no manual step left;
  see [VARIANTS.md](../../tools/launcher-host/VARIANTS.md), "What the
  installer guarantees".
- **Rollback** is `native-home.cjs restore` on the TV (root, no host argument):
  it restores from the state manifest in `/var/local/alvidaa/native-home/` and
  restarts the engine.
- **Do not** copy the audit's old `hisenseUI/dist/app.js` path — it was wrong
  and is corrected in this handoff's commit.

## Open items

1. **Deploy + walk the checklist** (`NATIVE-ALVIDAA.md`, steps 1–14). Every
   claim there is unverified until observed.
2. **Preferences cannot be set on hardware.** No in-launcher UI, and no
   reachable JS console in the hisenseUI origin on `09.01O.P0813` (port 9666
   is on the cmdline but does not listen). So checklist steps 3, 12 and 13
   cannot be exercised yet, and auto-switch/filtering/custom names/favorites
   all sit at defaults. Recorded as a high-confidence team finding; it wants a
   GitHub issue and a decision: a settings surface, or a supported way to seed
   `sdk.storage`.
3. **Hardware-only gaps the audit already names:** favorites render a star
   glyph rather than the app icon; focusing an input with no art holds the
   outgoing art for 300 ms and then cuts to the wallpaper.

## Team state (this machine)

Team `alvidaa`, ID `b1ce9793-08ea-44a8-bdb0-cd98960c0352`. All seven tasks are
`done`; workers `worker` and `worker2` were stood down. The team store is
session-adjacent — it does not travel to m2, and the board here is history
only. The durable record is this file plus the commits.
