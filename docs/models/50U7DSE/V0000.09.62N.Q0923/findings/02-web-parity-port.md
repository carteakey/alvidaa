# 02 — Free My TV web-parity port: installed on 50U7DSE / 09.62N

**Date:** 2026-11-12 · **Lane:** lane-3 component swap through
`switch-home-50u7dse.sh` · **Unit:** owned 50U7DSE (`50U73SEVS_01`, MTK9618,
`V0000.09.62N.Q0923`).

The 55A7KAU web-parity Free My TV variant (its findings 14–21) was ported to
this build on top of the probe results
([01-cobalt-capability-probe.md](01-cobalt-capability-probe.md)). This is the
*upstream* Free My TV web program running inside the stock launcher — not the
offline V1 clock/shelf variant (`free-my-tv-75u8qtuk`, still the rollback
target's previous occupant).

## Architecture

Everything is reused from the 55A7KAU trial; only the per-build facts differ.

| Piece | Source | Status on 50U7DSE |
| --- | --- | --- |
| upstream program | pinned snapshot `f2d984c5` via `build-native-web.cjs` | unchanged |
| platform adapter | `native-platform-75u8qtuk.js` | unchanged — this build's SDK contracts are the 75U8QTUK family (README §Native Home) |
| web runtime / scope / compat / screensaver / entry | shared parts | unchanged except two measured fixes (below) |
| per-build part | **new** `native-web-50u7dse.js` | zone constant, icon policy, direct-image gate |
| builder | **new** `build-native-web-50u7dse.cjs` | stock hash from `models.json`, artCache asset base, part order fixed by tests |
| settings skin | `native-settings-theme.js` | **not included** — TV Settings stays the stock vendor surface until a separate verified pass |

Per-build part contents (`native-web-50u7dse.js`):

- `AlvidaaNativeWebZone() → "Europe/Berlin"` — this build has no measured EU
  timezone enumeration (`kilby…tvset.location` reads `8`, semantics
  unestablished); the engine clock is CET. Upstream's own Home Settings city
  picker still overrides weather/city per TV.
- `AlvidaaWebIconPolicy` / `AlvidaaWebDirectImage` — allow exactly
  `https://img.vidaahub.com/…` app artwork (probe-verified to load). The
  shared TV adapter stays local-only for builds without the hook.

Shared-part fixes driven by measurement (both guarded so the 55A7KAU build
is byte-unchanged):

- `native-web-runtime.js`: `apc.CMDMETHOD` is **empty** on this build — the
  route guard now treats a missing `CMDMETHOD` as "no input-start query"
  instead of force-opening the inputs overlay on every route.
- `native-web-runtime.js`: timezone comes from `root.AlvidaaNativeWebZone`
  when a per-build part provides it (context records
  `zoneSource: "native-zone-hook"`).
- `native-web-compat.js`: `local()` accepts the `artCache/free-my-tv/` lane;
  a per-build `AlvidaaWebDirectImage` hook lets `LocalImage` resolve vendor
  CDN URLs (metadata-sized fallbacks still require worker-measured sizes).

## Assets

Built with `build-native-web-assets.py` (pinned upstream, instanced Inter
fonts `FMTVWeb14…32`, tinted material symbols, coin rasters — rendered via
a cairosvg shim for the absent `rsvg-convert`): **1727 files, 47 MB**,
content-addressed `assets.json` → asset id `79ff3ba121059de3ca85`.
Staged at `/APPS/hisenseUI_applications/UI/art/cache/free-my-tv/assets/<id>/`
(root, 0644/0755), served to the engine as
`file:///hisenseUI/var/local/artCache/free-my-tv/assets/<id>/…`.

## Deploy evidence (2026-11-12)

| Step | Evidence |
| --- | --- |
| candidate build | `build-native-web-50u7dse.cjs` → 629452 bytes, sha256 `e551642841781311…`, md5 `3d1ae0a2949790c0211df21268e34581`; stock gate `fbffe729…` verified |
| asset staging | tar stream over SSH; `assets.json` md5 identical both ends; spot-checks (fonts.css, `o14-w400.ttf`, symbol PNG) identical |
| install | `switch-home.sh install` → `OK mode=install new=23628`; `app.js` md5 `3d1ae0a2…` |
| runtime boots | `/APPS/free-my-tv/context.json` (6511 bytes, uid 314) written by the runtime through the bridge — the IPC lane is live without a worker |
| data collected | context: `version 1`, `zone Europe/Berlin`, `zoneSource native-zone-hook`, `error: none`, **47 apps** with icons (this TV's apps use the local `storeAppIcon` lane), prefs, language |
| screenshot | `img/free-my-tv-web-first-install.png` (HAL capture, no remote interaction) |

## The logo fix (same day, after on-screen review)

**Symptom:** the first install rendered shelf tiles as lettered placeholders
— app logos missing entirely.

**Root cause** — three coupled breaks, all "no feed worker" symptoms
(probe evidence in [findings 01 §v3](01-cobalt-capability-probe.md)):

1. `native-web-compat.js` `imageElement` load callback demanded a computable
   size or worker-measured pixel dimensions, else it raised the image's
   `onerror` — and this Cobalt reports *no* computed size for nodes that are
   not yet attached to the document (local icons load faster than the
   fragment attaches). Upstream's `onerror` then removes the icon and shows
   the app's first letter.
2. The same adapter's `lift()` returned the worker's analysis object from
   `snapshot.media` — `false` without a worker — so upstream's `showLogo()`
   never ran and the icon never received its `.logo` class (the explicit
   `70%×50%` tile box).
3. Once `lifted[url]` cached `false`, upstream skips even assigning `src` on
   later re-renders.

The V1 port had already hit this engine's quirks and documented it:
`free-my-tv-native.js` — *"The img-node path failed to paint cached icons on
this Cobalt build"* — and painted icons as explicit-pixel boxes with
`backgroundImage` instead.

**Fix** (shared compat, guarded, worker-optional — the 55A7KAU
worker-driven path is byte-equivalent when metadata exists):

- the load callback paints the background unconditionally when the engine
  reports a successful load; explicit pixel sizes are set **only** from
  worker metadata, and sizing is otherwise left to CSS (upstream's `.logo`
  rules);
- `lift()` without metadata returns `{src: <icon URL>}` — upstream's lifted
  shape minus the analysis — so `showLogo()` applies the `.logo` treatment
  and the tile keeps its preset/brand gradient.

Covered by two regression tests in `native-web-compat.test.cjs`. Fixed
candidate: md5 `612e5ad72b74aef94dd7d64b4722a350` (sha256 `0ed4b412…`),
installed → `OK mode=install new=25427`. Evidence the shelf changed: pixel
diff of the tile band shows changes across every tile column, and the
band's color population grew 332 → 525 quantized colors (brand logos are
far richer than flat letter placeholders). Screenshot:
`img/free-my-tv-web-icons-restored.png`. Final on-screen confirmation is the
owner's.

First install is the no-worker phase by design: the full Free My TV surface
(clock, city, app shelf with real tiles, placeholders for weather/picks,
screensaver coordination) renders from the SDK platform adapter alone.
Weather/TMDB picks/photos need the feed-worker suite (55A7KAU findings 16–17)
and a TMDB key under `server/keys/` — follow-up work, offline mode first.

## The lifted-logo snapshot (same day, phase two)

Upstream's signature button look is not the raw vendor badge: `web/home.js`
`lift()` measures an icon's background (64 edge samples, gradient/vignette
ramp fit when the background is not uniform), converts color-to-alpha, and
crops to the floating logo — the clean wordmark over the tile's brand
gradient. On TV that analysis runs in the feed worker's `native-image` Go
processor (Cobalt has no canvas readback), and the browser receives it as
`snapshot.media[iconURL].lift`. The no-worker fallback from the logo fix
renders the raw badge instead — recognizable, but not the repo's look.

**Method** — run the worker's own pipeline offline, feed the result in as a
static snapshot (`tools/launcher-host/build-icon-snapshot-50u7dse.cjs`):

1. Pull the 47 shelf icons read-only (`launcher/cache/<UUID>`, the
   `storeAppIcon` symlink target) over the SSH lane. One icon on this TV is
   WebP — the on-TV worker cannot decode that, but the offline pass can:
   converted to PNG locally (`Pillow`), noted in the tool's header.
2. Build `native-image` for the host that generates it (Go tarball in
   `~/.local/go`, no sudo on the workstation; the TV never needs Go).
3. The generator reuses `native-feed-images.cjs` `createMedia()` verbatim —
   `update({apps})` → `icon()` → `prepare()` → the processor — so the lifted
   PNGs and `bg`/`ink` metadata are byte-identical in kind to what the
   on-TV worker produced on 55A7KAU. Media lands on the artCache symlink
   lane (`…/art/cache/free-my-tv/media/`, URIs
   `file:///hisenseUI/var/local/artCache/free-my-tv/media/…`), which the
   compat layer already accepts.
4. Snapshot JSON: `{version:1, cache:{}, error:'', keyConfigured:false,
   images:{}, media:{…}, imageFailures:0}` — the worker's publishable shape.
   The runtime polls `free-my-tv/snapshot.json` every second, so no code
   changes were needed to consume it. Prefs are untouched: they live in the
   runtime's storage/context, not the snapshot (the engine publishes only
   `fmtv.weather/prices/recs`).
5. **One launcher restart** after staging: upstream's `lifted[]` cache is
   per-scope-lifetime, and a first-render miss (`{src: raw}` fallback) stays
   cached across snapshot arrivals. Cold cache + hot snapshot = first
   `face()` consults `lift()` → worker-shaped metadata → `showLogo()` paints
   the brand gradient from the measured `bg` and floats the lifted logo.

**Result** (41/47 lifted, evidence in `img/`): `lift()` correctly refuses 6
icons — Prime Video, HBO Max, JOYN, WOW, ToonGoggles and the placeholder —
transparent-background wordmarks already float on the gradient with nothing
to strip; upstream's own design keeps those raw. A/B screenshots (same
boot sequence, snapshot off vs on):
`img/free-my-tv-web-icons-raw-baseline.png` vs
`img/free-my-tv-web-lifted-logos.png` — the diff localizes to the shelf row
(rows 900–1000, ~23% of that band changes; the rest of the screen stays
~1%), white/green full-bleed badges replaced by brand-gradient tiles (Netflix
black, light boxes with floating logos). Two restart cycles confirm the
lifted state is stable and reproducible; the TV is left in it.

The generator is covered by four tests (CLI contract with a fake
`native-image` processor, context validation, icon namespace containment,
and a loud failure when the pipeline drops icons) plus a compat-side test
locking the snapshot-with-lift consumption contract.

## Reversibility

- `switch-home.sh rollback` restores the stock bundle and the original JS
  cache (verified stock `8b1c6193…` after every probe cycle today).
- Staged assets live only under
  `/APPS/hisenseUI_applications/UI/art/cache/free-my-tv/` (namespaced vendor
  art-cache dir); the runtime writes only `/APPS/free-my-tv/*.json`.
  Teardown: `rm -rf` both after rolling back the launcher.
- The probe dir (`…/free-my-tv/probe/`) and the probe report are removed;
  the probe component never persisted.

## The curated shelf (phase three, after on-screen review)

The owner's verdict on the lifted logos: recognizable, but not the repo's
look, and poor quality at tile size — the lifted crops come from the TV's
own 255 px store badges, so the wordmarks are small rasterizations of small
rasterizations. The repo's actual button icons are its curated wordmarks
(`web/icons/`, Simple Icons CC0 "cropped and tinted for the tiles"), which
its `tv.js` tables (`SAMSUNG_ICONS`/`KNOWN`, by id or name) substitute on
platforms whose own artwork is unusable — plus `SHELF` in `home.js`, the
per-brand tile gradients (Netflix near-black, Disney deep blue `#173584`,
HBO Max purple `#5C30E8` …), and `CONFIG.shelfApps`/`hideApps`, the
config.properties knobs that pick the shelf in order and hide the rest.

What the owner asked for: the five that matter — Netflix, Apple TV,
Disney+, HBO Max, YouTube — in that order; the other 42 apps expendable.
Nothing was uninstalled (VIDAA Home still lists and launches everything);
upstream's own knobs do the curating:

- `native-web-runtime.js` gained a guarded `root.AlvidaaWebConfig` merge
  over the CONFIG defaults — builds without the part keep them.
- `native-web-tv.js` gained a guarded `root.AlvidaaWebAppPolicy` on the
  finished platform entry — resolution order (local store icons first,
  vendor lane second) is untouched, so the 55A7KAU/75U8QTUK behavior stands.
  The first attempt put the curation in the artwork lane
  (`AlvidaaWebIconPolicy`) and the TV's local icons won before the policy
  ran — the finished-entry hook is the seam that works.
- The per-build part sets `shelfApps` (the owner's order), `hideApps` (the
  other 42 full titles — substring semantics forbid bare brand words like
  "max"), and maps the five to curated wordmarks staged under
  `artCache/free-my-tv/curated/`: the repo's `netflix.svg` (red N),
  `youtube.png` (red wordmark), `max.svg` (white) and `appletv.svg` (white)
  rasterized to PNG (Cobalt decodes PNG, not SVG), plus the Disney+
  wordmark from Wikimedia Commons (official logo, a Disney trademark —
  private tile use on the owner's TV, not for redistribution; Simple Icons
  refuses Disney+ by brand policy).
- Phase two's snapshot lane was removed (snapshot.json + `media/`):
  superseded — curated wordmarks are already floating logos, so upstream's
  `lift()` is not in their path, and `lift()`'s own refusals (transparent
  wordmarks) were why 6 tiles stayed raw. The offline generator stays
  committed for no-worker deployments that want lifted vendor badges.

Evidence (`img/free-my-tv-web-curated-shelf.png`): the five tiles render on
the SHELF gradients in the owner's order — black + red N, black + white
apple-tv wordmark, deep blue + white Disney+ wordmark, purple + white max
wordmark, black + red YouTube wordmark — and `context.json` carries exactly
5 apps with `curated/` icon URLs. Candidate: md5 `351235f480b279c164789fdb3c9910a8`.
Six tests cover the seams (config merge invariants, app policy, adapter
mapping); suite 193 pass, the 4 pre-existing release failures remain.

## Open items

- On-screen owner verification of the curated shelf (five tiles, shelf nav,
  app launch, back, screensaver handoff).
- Feed-worker suite port (weather card, TMDB picks, photo saver media):
  needs `native-feed-boot.sh`/phoenix lane parameters for this build and a
  TMDB read token in `server/keys/` (0600, `eyJ…`); offline mode is the
  default until then.
- `modeljs` `kilby.sl2.i32.basic.settings.tvset.location` (= 8) semantics —
  if it ever maps to a country/region table, the zone can become measured.
