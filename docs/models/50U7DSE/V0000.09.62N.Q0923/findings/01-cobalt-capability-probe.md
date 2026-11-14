# 01 — Cobalt capability probe: the 09.62N home engine, measured before the web port

**Date:** 2026-11-12 · **Lane:** read-only probes through the reversible
`switch-home` install/rollback cycle · **Unit:** owned 50U7DSE
(`50U73SEVS_01`, MTK9618, `V0000.09.62N.Q0923`).

Before porting the 55A7KAU web-parity Free My TV variant
(findings 14–21 in the 55A7KAU tree), the engine had to be measured: the
MTK9602 Cobalt deadlocked on file-bridge preflights (50A51HUV findings 12 §3),
the MTK9618 generation was unproven, and this build keeps the `hisenseUI`
package read-only, so the asset lane had to be found first. Everything below
was measured live, on this unit, with the probe component
(`tools/launcher-host/probe-cobalt-50u7dse.js`, findings-15 pattern) installed
through `switch-home-50u7dse.sh` and rolled back after each run.

## Method

- Probe candidate = stock `app.js` (hash-pinned against `models.json`) +
  probe part + shared `native-entry.js`, built by
  `build-native-probe-50u7dse.cjs`. Install and rollback go through the
  supervised switch script only; `app.js` was verified stock
  (`md5 8b1c6193…`) after every cycle.
- Results render on screen and are mirrored through the vendor file bridge
  (hiutils, `localhost:9009`, uid 314) to `/APPS/free-my-tv/probe-report.json`
  — the bridge write is itself one of the probes.
- Probe assets staged under the writable vendor symlink target
  `/APPS/hisenseUI_applications/UI/art/cache/free-my-tv/probe/`:
  a 64×64 PNG and DejaVuSansMono.ttf (as `f.ttf` for a `@font-face` test).
- Two runs: v1 published its report before the async image/font probes
  settled (the report only counts bridge RPCs as pending — sequencing bug,
  fixed in v2 with a deadline force-publish). The v1 report still proves the
  write path; the complete v2 report carries everything else.

## Results (v2 report, 2026-11-12 10:46:54 CET)

| Probe | Result | Meaning |
| --- | --- | --- |
| viewport | `1920x1080` | full canvas |
| engine-date | `GMT+0100 (CET)`, offset `-60` | engine TZ = system TZ; `Europe/Berlin` build constant is right |
| `modeljs.location` | `8` | modeljs works; value semantics unestablished (no EU enumeration found in the bundle) |
| `modeljs.osd` | `1` | readable |
| `sdk.storage` | roundtrip ok | per-app storage works |
| keymap | `BACK=8 BACKSPACE=8 RETURN=undefined SOURCE=505 KEYPAD_INPUT=610 ENTER=13` | differs from 55A7KAU; the runtime reads the map at run time, so it self-adapts |
| `apc.CMDMETHOD` | `{}` — **empty** | `sdk.apc.CMDMETHOD.KEY_INPUT_START` is `undefined` here; an unguarded `===` would treat *any* `route()` query as "open inputs" (the guard in `native-web-runtime.js` is load-bearing, not defensive) |
| `localStorage` | object | storage-prefix design works |
| `dom-innerHTML` | ok | `innerHTML` + `querySelector` available |
| css.radius | `20px` | supported |
| css.shadow | `0px 0px 30px rgba(0,0,0,0.4980392)` | supported |
| css.transform | `translateY(4px)` | supported |
| css.opacity | `0.6` | supported |
| css.gradient | `2.356194rad, rgb(17,19,51), rgb(51,55,119)` | `linear-gradient` supported (richer than 55A7KAU, which avoided them) |
| css.transition | `opacity / 200ms` | transitions supported |
| image.artcache (`file:///hisenseUI/var/local/artCache/free-my-tv/probe/t.png`) | **loaded** | the vendor symlink (`/opt/pkgs/tv.vidaa.app.ui/hisenseUI/var/local/artCache` → `/APPS/hisenseUI_applications/UI/art/cache`) is the asset lane: writable ext4, served under the engine's own origin |
| image.absolute (`file:///APPS/...`) | **error** | direct `/APPS` URLs are rejected — the symlink lane is the *only* staged-asset path |
| image.vendor (`https://img.vidaahub.com/…png`) | **loaded** | vendor CDN artwork renders (the stock launcher already uses this host) |
| font.widths (`@font-face FMTVProbe` from artCache) | probe `288.98` vs fallback `317.44` — **applied** | font instancing from staged TTFs works; `offsetWidth` exists here |
| natural image sizes | absent | `naturalWidth/Height` undefined — sized elements still need worker-measured dimensions, as designed |
| xhr-read (`free-my-tv/probe-report.json`, mode 6) | `ret=true len=699` | bridge read of bridge-owned files works |
| xhr-read-vendor (`pkgs/tv.vidaa.app.operationui/CHA/packageinfo.json`) | `ret=false` | **permission boundary**: vendor files `0640 UhisApp:909` are unreadable by the bridge uid 314 — IPC stays inside our own `/APPS/free-my-tv/` namespace |
| xhr-write (`free-my-tv/probe-report.json`, mode 6) | `ret=true` — file present, `UhisPhoenix:UGhisPhoenix` (314) | bridge write works; the v1 report was written at ~2 s, proving `fileWrite` |
| XHR preflight | no deadlock | the MTK9602 trap is absent on this MTK9618 build — the 55A7KAU runtime's exact `Content-Type: application/json` POST works |

## The bridge contract, from source (read-only)

`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/hiutils/fileOperation.js`:
`readFile`/`writeFile` take `{path, mode}` (plain strings, `../` rejected),
write as the service uid (314), and prefix from a fixed table:

```
0 /tmp/                4 /data/
1 /APPS/varlocal/applications/UI/   5 /vddt/
2 /APPS/channelA/      6 /APPS/        7 /OAD/   ← never touched
3 /APPS/varlocal/
```

Mode 6 (`/APPS/`) is the port's IPC namespace, exactly as on 55A7KAU. Note
`/APPS/varlocal/` (modes 1/3) is a *different* tree from `/var/local/` — the
switch state dir stays private to the SSH lane. Reads are utf8-only; binary
assets never go through the bridge.

## Traps hit while probing

- **`scp` silently fails on this TV's dropbear** — files transfer as zero
  bytes with no error. Use `ssh 'cat > path' < local` (stdin is clean; the
  banner contaminates only stdout) and verify with md5.
- **`wc` does not exist** on this build's stripped busybox — probe scripts
  must not depend on it.
- **SSH stdout banner** (`/etc/profile`) — strip everything before the PNG
  magic when pulling binaries; `tools/screenshot-50u7dse.sh` does this.

### v3: the shelf-logo rendering traps (2026-11-12, after the first install)

The first web-port install showed lettered placeholder tiles instead of app
logos. A third probe pass measured the rendering chain directly, with a real
`storeAppIcon` URL in a tile-shaped structure (`[data-fmtv-image]` div,
absolute position, `width:70%; height:50%`):

| Probe | Result | Meaning |
| --- | --- | --- |
| image.storeappicon (Netflix `storeAppIcon` UUID) | **loaded** | the engine loads the vendor icon files fine — the data lane was never the problem |
| tile.attached | `loaded natural=absent sizeAtOnload=70%x50% bg=url(…)` | computed styles on this Cobalt return **raw percentage strings**, never used pixel sizes |
| tile.detached | `loaded natural=absent sizeAtOnload=x` | a node not yet in the document reports **empty** computed size — `parseFloat('')` is NaN |

Consequence: upstream sets `img.src` immediately after creating the tile
fragment, a local `file://` icon loads before the fragment attaches, and the
image adapter's load callback sees no computable size. With no feed worker
there is also no measured metadata — see findings 02 §logo-fix for the
three coupled breaks this produced and the guarded fix.

## What this unlocked

The web-parity port could proceed exactly as designed (see
[02-web-parity-port.md](02-web-parity-port.md)): assets under the artCache
symlink, IPC under `/APPS/free-my-tv/`, vendor-CDN app icons, instanced
fonts, `Europe/Berlin` zone constant, and the `CMDMETHOD` guard.
