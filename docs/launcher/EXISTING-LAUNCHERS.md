# Existing launcher candidates for a native VIDAA port

Research only: nothing installed or changed on the TV. Repositories and source
files were inspected, not just search snippets. This snapshot is anchored to
the commits below; upstream branches may change.

## Bottom line

**Free My TV's web frontend is the strongest external starting point.**
It has a real DOM UI, older-TV-compatible CSS and a separate platform adapter.
It still needs a Cobalt port; it is not a ready-made VIDAA native launcher.

No independently verified, drop-in replacement for this TV's Cobalt Home
module was found. Reuse a project's frontend inside our working native module,
not its Android/Tizen/webOS installer, platform services or home interception.
Keep our verified app/input integration, lifecycle and stock restore path.

## Ranked candidates

### 1. Free My TV — best practical frontend donor

- [Repository](https://github.com/felipericardo/tv-launcher)
- [Visual preview](https://github.com/felipericardo/tv-launcher/blob/main/.github/preview.webp)
- Inspected: `f2d984c51edca1544e39f2d44cdf86b75b0b6703` (2026-10-24).
- Code license: [MIT](https://github.com/felipericardo/tv-launcher/blob/f2d984c/LICENSE).
- Features: app shelf/reordering, all-apps view, clock, light/dark themes,
  settings, screensaver, plus optional recommendations/weather/market data.

Important distinction: its **Android** UI is hand-drawn on Android Canvas.
The reusable part is the separate **webOS/Tizen `web/` frontend**, not the APK.

Source evidence:

- [`web/home.js`](https://github.com/felipericardo/tv-launcher/blob/f2d984c/web/home.js):
  DOM creation, TV navigation and view behavior (~1179 lines).
- [`web/home.css`](https://github.com/felipericardo/tv-launcher/blob/f2d984c/web/home.css):
  ~545 lines, explicitly avoids CSS variables, grid and backdrop-filter for
  older webOS TVs. Mostly absolute/inline-block layout, transform and opacity.
- [`web/tv.js`](https://github.com/felipericardo/tv-launcher/blob/f2d984c/web/tv.js):
  platform API adapter for app listing/launching, inputs, settings and Back.
- [`web/index.html`](https://github.com/felipericardo/tv-launcher/blob/f2d984c/web/index.html):
  app/clock/tiles are DOM, but background layers include two canvas elements.
- Canvas calls in home.js include logo processing (~130–187) and background
  rendering (~431). These cannot be carried into our Cobalt runtime unchanged.
- [`web/data.js`](https://github.com/felipericardo/tv-launcher/blob/f2d984c/web/data.js)
  uses XHR for external services including TMDB, Open-Meteo and Binance.

Port work (moderate; assessment, not a measured estimate):

1. Replace canvas background/logo processing with images or plain DOM styling.
2. Adapt `TV` operations to our on-TV bridge and native SDK; retain SDK key
   handling instead of adding competing window-level listeners.
3. Mount/unmount within our Home route; scope element IDs, timers and listeners.
4. Remove direct external requests for the offline baseline. Recommendations,
   weather and market data are not offline features; do not silently add them.
5. Test SVG, CSS masks, transforms, fonts and storage on Cobalt; pre-render icons
   where necessary. Old Chromium compatibility does not prove Cobalt compatibility.
6. Retain MIT notices and separately check font/image/icon asset permissions.

This is the best *external* donor; it is not necessarily less work than porting
our existing browser design, whose desired features and integration are known.

### 2. Aura TV — visual donor, not a verified native replacement

- [Repository and demo](https://github.com/cralex11/aura-tv)
- Inspected: `9ab04c1bb273a354e10bb46d044b7f2293b0fff6` (2026-10-27),
  identified as an initial release.
- README declares MIT; no standalone LICENSE file was present in the snapshot.
  Clarify/retain the licensing grant before incorporating its code or assets.

A single ~1158-line HTML page has a styled app interface and remote navigation.
No canvas calls were found in that page. But it uses extensive flex/grid,
SVG and Web Audio, all needing Cobalt testing or substitutions.

Crucially, [`index.html`](https://github.com/cralex11/aura-tv/blob/9ab04c1/index.html)
launches URLs with `window.location.href` (~1030, 1057, 1066). Its frontend has
no real app/source enumeration through Hisense APIs or our bridge. Sideloading
an app tile is not evidence of replacing the native Home module. README claims
such as “60FPS Native” are not measurements on our TV.

Use as a visual/layout reference only unless those gaps are implemented. Do
not use its injection tooling or bundled client material; our native integration
already solves the TV side.

### 3. FLauncher — good UI reference, expensive code port

- [Upstream](https://gitlab.com/flauncher/flauncher)
- [Upstream README](https://gitlab.com/flauncher/flauncher/-/raw/master/README.md)
- [Inspectable fork](https://github.com/zompinc/flauncher), examined at
  `9188d9b` (2026-07-11).
- License: GPL-3.0. Follow its redistribution obligations if deriving code.

A real Android TV launcher written in Flutter, with app categories, row/grid
layouts, ordering and wallpapers. Android/Flutter application code cannot run
as a Cobalt DOM module. Installing an APK on VIDAA is not a path here, and a
Flutter renderer is not a drop-in replacement for our shared UI shell.

Its design is worth borrowing; porting the implementation means replacing both
platform integration and rendering. Less practical than a DOM frontend.

### 4. Flex Launcher — genuinely native Linux, wrong integration layer

- [Repository](https://github.com/complexlogic/flex-launcher)
- Inspected: `cc0d98734518af897f6c2af86abd94d0790c0661` (2026-07-07).
- License: [Unlicense](https://github.com/complexlogic/flex-launcher/blob/cc0d987/UNLICENSE).

A TV-friendly application frontend for Linux/Windows PCs and Raspberry Pi.
Its [build](https://github.com/complexlogic/flex-launcher/blob/cc0d987/CMakeLists.txt)
requires SDL2, SDL2_image and SDL2_ttf. It launches host applications rather
than being a web module.

ARM support alone does not establish a working display/input backend on the
MTK vendor stack. A TV port would need graphics integration, TV app/source
control, Home routing and lifecycle management outside Cobalt. That reopens
problems our working native module already avoids. Better for an external
HTPC/Pi than this firmware.

### 5. KDE Plasma Bigscreen — complete TV desktop, not a small launcher port

- [Official project](https://plasma-bigscreen.org/)
- [Source](https://invent.kde.org/plasma/plasma-bigscreen)
- [Inspected mirror](https://github.com/KDE/plasma-bigscreen), `3ce7d9e`
  (2026-11-05).
- Mixed GPL/LGPL and asset licenses, recorded per file and under LICENSES.

A Wayland TV desktop with Qt/KDE/Plasma dependencies, remote input, settings
and applications. It is a whole desktop environment for HTPCs/SBCs, not
something we can load into the TV's existing Home engine. Not recommended
for this native-module approach.

## Other results worth excluding explicitly

- [Borealis](https://github.com/Alogus/Borealis), inspected `024ea5b`:
  based on Free My TV and includes web sources, but its own changes are
  [PolyForm Noncommercial 1.0.0](https://github.com/Alogus/Borealis/blob/024ea5b/LICENSE).
  This is source-available with noncommercial restrictions, not the same
  permissive licensing as the MIT upstream. Prefer Free My TV for shared code.
- [Zfinix/vidaa-launcher](https://github.com/Zfinix/vidaa-launcher), `ca622fd`:
  MIT canvas-based VIDAA browser launcher with a companion server. It has
  the same no-canvas native-port blocker as our existing polished browser UI.
- [ferdj40/samsung-tv-launcher](https://github.com/ferdj40/samsung-tv-launcher),
  `86a7231`: MIT HTML/CSS/JS examples in a README with images, not a complete
  packaged launcher source tree. Useful small examples, not a polished donor.
- [tsynik/LeanbackLauncher](https://github.com/tsynik/LeanbackLauncher), `77fd883`:
  Android/Gradle source, not a web UI; no top-level license file was found in
  the inspected snapshot. Not a better fit than the candidates above.

## The Android debloat launchers — the design reference, not port candidates

[dumbtv](https://github.com/humblemuzzu/dumbtv) and
[CleanMyTV](https://github.com/wingedpanther/cleanmytv) are the two most
popular projects in this space, and they are a different category from every
candidate above: not port candidates, but the **product reference**. Both are
Android work — Fire OS, Android TV, Google TV — so an APK or an ADB session
cannot load into a Cobalt home module. What they prove is the demand and the
shape: an ad-free TV, a home screen that stays out of the way, per-device
data that stays maintainable, and rollback as a first-class verb. Inspected
read-only at `dumbtv` `2882820` and CleanMyTV `944079e` (both 2026-11-07);
the deep audits are separate work. Reference shorthand below: `dR:n` /
`cR:n` are lines in their READMEs; other files are in the respective clones.

### Comparison

| | dumbtv | CleanMyTV | alvidaa (this repo) |
| --- | --- | --- | --- |
| Platform | Fire TV / Fire OS 6–8, plus Android TV / Google TV devices (`dR:9,205`; 49 device entries + a template) | Android TV and Google TV (`cR:3`) | Hisense VIDAA, one row per model+firmware ([inventory.json](../research/inventory.json)) |
| Root required | no — ADB debugging only (`dR:61,76`) | no — ADB over Wi-Fi from a Mac/Windows app (`cR:3–5,119`) | lanes 1–2 no; lane 3 yes ([README](../../README.md)) |
| Home screen replaced by | the dumbtv home APK; HOME taken over via an accessibility service (Fire OS 7/8) or a UsageStats keeper (Fire OS 6) (`dR` launcher/README:354,373; `scripts/launcher.sh:4–5`); `set-home-activity` on Android TV (`catalog/devices/_template.yaml`) | the CleanMyTV Home APK, handed Home; rolls back if it does not land (`cR:122`) | lane 3 swaps the `/Launcher` route component inside the vendor home engine and restarts it ([switch-home-50a51huv.sh](../../tools/launcher-host/switch-home-50a51huv.sh)) |
| Debloat approach | ~50 Amazon packages disabled per user, never deleted; protected ones lose background running (`dR:126–127`) | packages switched off for your user, nothing uninstalled; list picked by scoring model/device/manufacturer (`cR:130`; `src/main/debloat.ts:169`) | none — not attempted |
| Ad / tracking blocking | personalDNSfilter on the TV blocks ~400 Amazon telemetry/ad/update hosts (`dR:129`) | Ad-blocking Private DNS (`cR:123`) | none built in |
| Update control | Fire OS updates blocked while the DNS filter runs (`dR:248`) | none; instead it lists packages that came back after a firmware update (`cR:58`) | manual only: freeze OTA endpoints before editing UI code ([AGENTS.md](../../AGENTS.md); [findings/09](../models/50A51HUV/09.01O.P0813/findings/09-endpoints.md)) |
| Rollback | `restore.sh` re-enables packages and restores the settings snapshot taken at preflight (`dR:236–240`) | Restore re-enables every package; stock launcher put back if Home does not return (`cR:124,130`) | stock backup taken once at bootstrap; `rollback` restores app.js and the JS cache ([native-install.cjs](../../tools/launcher-host/native-install.cjs)) |
| Launcher size | 107 KB APK (`dR:70`) | unknown from the source snapshot — built from `home/` with Gradle, no prebuilt APK inspected | the vendor bundle with ~225 KB generated on top: 48 KB platform/UI + wallpaper art inlined as base64 ([build-native-alvidaa.cjs](../../tools/launcher-host/build-native-alvidaa.cjs)) |
| Works offline | the launcher has no internet access (`dR:70`) | mostly — only opt-in weather and Bing wallpaper reach the internet (`cR:187–188`) | yes — no external requests in the native parts; wallpaper generated at build ([native-alvidaa.js](../../tools/launcher-host/native-alvidaa.js)) |
| Theming | accent colours, tile sizes, rows or grid, wallpapers, renaming (`dR:143`) | 28 themes as `.cmtvtheme` files, icon redraws, focus styles, slideshows (`cR:155`) | storage-backed prefs: hidden/renamed apps, favorites, auto-switch ([native-alvidaa.js](../../tools/launcher-host/native-alvidaa.js):100); no settings UI on the TV yet ([handoff](../project/HANDOFF-2026-11-09-LANE3.md)) |
| Input / source handling | an Inputs row beside the apps (`dR:143`) | Inputs menu, Live TV first (`cR:51`) | the core feature: inputs dock with live signal, auto-focus, source switch via the vendor SDK ([native-platform.js](../../tools/launcher-host/native-platform.js):37,95) |
| App install | no — explicitly not (`dR:118`) | yes — an install step for `.apk` files (`cR:32`) | no — apps come from the vendor SDK's installed list ([native-platform.js](../../tools/launcher-host/native-platform.js):35) |
| Screensaver | none found in the inspected snapshot | Google Ambient screensaver managed; idle screen and fireplace can take the slot (`cR:56,155`) | none yet |
| VIDAA support | no | no | yes — the project's purpose |

What this class teaches that the port candidates above do not: the port
candidates offer a frontend; these offer a product brief. dumbtv shows the
value of a launcher small enough to audit (107 KB, three permissions,
CI-enforced: `.github/workflows/validate.yml`) and of treating "undo
everything" as the feature that makes the aggressive parts acceptable.
CleanMyTV shows per-device data maintained across thousands of TVs without
per-TV heroics: inherit, pin, verify, generate the human table. Both keep
their aggressive steps reversible by construction, which is the same bar
[this repo's ground rules](../../AGENTS.md) set for itself.

### The per-device data model

Both projects face the question this repo faces: what to do on device X, kept
maintainable as devices accumulate.

**dumbtv** splits description from payload. One YAML per device under
`catalog/devices/` (49 devices plus `_template.yaml`, one JSON Schema in
`catalog/schema.json`): how to reach the TV (ADB port, transport,
first-connection prompts), the human menu paths (`developer_mode`,
`ip_location`), quirks, known limits, a `status` of tested/partial/untested,
and *pointers* to the shared per-platform lists in `data/` it should use.
`catalog/validate.py` enforces the schema and runs in CI
(`.github/workflows/validate.yml`), and `scripts/contribute.sh` writes the
entry *from a live session* — the device facts are read off the TV, the human
is only asked what cannot be read.

**CleanMyTV** inherits its data. `upstream.json` pins the upstream
`Gathin23/cleanyourtv` repo, commit, and content tree-hashes; `scripts/sync-upstream.mjs`
refuses to bundle anything whose hash does not match the pin, and
`scripts/pin-upstream.mjs` is run on purpose after reviewing upstream
changes. The app scores each bundled `examples/<id>/debloat.txt` list against
the probed TV (`src/main/debloat.ts:169`), falls back to the TV's brand when
no list matches, and `docs/KNOWN-DEVICES.md` is generated from the list
headers so the coverage table cannot drift from the data.

**What we have is a different, stricter shape.** The
[inventory](../research/inventory.json) is one row per model+*firmware string*
— the unit at which VIDAA actually changes — with SoC, region, build date,
evidence-graded capability tokens and prose detail, and every table in the
repo regenerates from it under `scripts/check.sh`. [models.json](../../tools/launcher-host/models.json)
holds the per-build facts the installer needs (paths, pinned hashes, owner,
engine), and [variants.json](../../tools/launcher-host/variants.json) records
which variant has run on which build.

Against that, concretely:

1. **They model what we do not:** a schema with CI validation for the
   per-device file (models.json's shape is enforced only by
   `native-install.test.cjs` assertions), a capture tool that writes the
   entry from a live session, and a stated coverage fallback for unlisted
   devices.
2. **We model what they do not:** firmware-level granularity, capability
   claims with evidence, and per-build install facts. That is better *for
   our problem*, not just different: their platform is homogeneous enough
   that "Android TV" is a safe unit, while the same VIDAA model breaks
   across firmware strings.
3. **What we would steal:** the *validation* and the *capture*, not the
   inheritance. A JSON schema for models.json checked in CI, and a command
   that fingerprints a rooted TV and emits the inventory row / models.json
   entry (the deploy path already pulls and hash-verifies the stock bundle —
   [native-install.cjs](../../tools/launcher-host/native-install.cjs) does
   the verification half). Both are code changes outside this docs task;
   they belong on the backlog. The one thing **not** to steal is
   CleanMyTV's brand-fallback: with firmware pins, "close enough" is how a
   build lands against a moved bundle, so the rule stays *record, never
   inherit*.

This section is folded in here rather than a separate
`docs/research/DEVICE-LISTS.md`: it is short, it belongs next to the port
comparison it extends, and the repo's device-data conventions are already
documented in [TESTED-MODELS.md](../research/TESTED-MODELS.md) — a third
device-data doc would risk drifting from the inventory.

## Recommended decision

If choosing a pre-existing project, prototype **Free My TV's web frontend**
inside our current native module, offline first. Keep the installed N02 build
and stock backups untouched until a local port has removed canvas/external
requests and its basic rendering is ready for a supervised test.

No third-party install script, APK or binary was executed. No candidate was
deployed, and no claims of its performance on this TV are made.
