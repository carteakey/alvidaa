# alvidaa native Home

Our design, as a lane-3 component. Written against the shared scaffold; **not yet
run on hardware**. Nothing here is verified by tests alone.

## What it is

`native-alvidaa.js` is a Vue component that replaces only the `/Launcher` route
component, exactly like Free My TV. It is not a second product: the route swap,
the SDK adapter, the install/restore machinery and the rollback path are the
shared ones.

The design is the canvas launcher's r4 layout, ported to DOM:

| Piece | Where |
| --- | --- |
| clock and date | top left, hours/minutes hierarchy, uppercase date |
| inputs dock | bottom edge, five 320×176 tiles per page |
| big label | the focused input's real name above the dock, `connected` / `no signal` under it |
| Apps tile | one door; opens the app list as an overlay, 5-column grid |
| Settings tile | opens the real stock TV Settings |
| toast HUD | bottom center, floating glass pill for action feedback and alerts (default 2500ms, timed expiry) |
| number hotkeys | remote keys 1-9 focus & activate dock tiles 1-9; key 0 focuses dock 0 without activating |
| auto-switch HUD | floating glass pill counting down boot switch when exactly one input has signal |

Two views, panned vertically like the canvas: view 1 is the dock, view 2 is the
apps row. ArrowDown pans, ArrowUp or Back pans back. Back at the dock is handed
to the vendor, so the stock behaviour from Home still works.

No canvas, no iframe, no global CSS. Everything is inline style plus CSS
gradients, which the 75U8QTUK findings confirmed paint on this engine. The
wallpaper is a PNG generated at build time and inlined as a data URI, so the
candidate stays one self-contained file and the repo carries no image asset.

The one network path is the vendor's own icon host, and only that host. See
*Icons* below.

## Data contracts

The component consumes `native-platform.js`, which is where builds differ:

- apps: `app-service.getCurrentShowApps("Launcher")` on 55A7KAU builds,
  `getAppList({sceneCode:"launcher"})` on 75U8QTUK builds
- inputs: `all-inputs.getAllInputsData()`
- input name order: `displayname2` → `rename` → `name` → `sourceId`, with an
  `LA####` translation id resolved through `sdk.i18n.t` (same order as the
  bridge, so the dock reads "PlayStation 5", not "HDMI2")
- signal: `is_signal` / `has_signal` as `1`, `"1"` or `true`
- launch: `sdk.apc.start` through the platform adapter; APC keeps PIN, EULA and
  hotel-mode checks
- settings: `setting.open("settings")`

### Toast HUD

Feedback and error messages are displayed via a floating glass HUD pill rendered in the root layer above the stage:

- `toast` (message text) and `toastUntil` (epoch timestamp deadline) live in the component's reactive data.
- `showToast(text, ms)` sets the active message and deadline, defaulting to 2500ms if unspecified.
- Action failures from `run()`, empty overlay notices ("No apps reported"), and activation notices route through `showToast`.
- The 1s clock interval drives toast expiry, clearing expired messages and triggering smooth opacity and transform transitions.

### Remote number hotkeys

Hardware remote number keys `0` through `9` are mapped from `sdk.key.KEYMAP` (`NUM_0` .. `NUM_9`), guarded against undefined values:

- In the dock zone, keys `1`–`9` focus and activate the corresponding dock index (`digit - 1`) when it exists.
- Key `0` focuses dock index `0` without activating, resetting focus to the first input.
- Out-of-range digits (or digits when no inputs exist) are not swallowed and pass through unhandled (`return false`).
- Digits do not fire when the app list overlay is open.
- Dock tiles render a subtle numeral keycap badge for inputs 1–9.

### Boot auto-switch countdown

When opt-in preference `alvidaa_auto_switch` is enabled in `sdk.storage` (default `false`), the launcher monitors inputs on the first platform payload:

- If exactly one input reports active signal, a 3500ms countdown begins.
- The countdown renders in the floating glass HUD pill: `Switching to <name> in Ns - press any key to stay`.
- When the countdown reaches zero, `changeSource` automatically switches to that input.
- Any handled remote navigation or number key cancels the countdown and displays a toast notice (`auto-switch cancelled`).
- If no inputs or multiple inputs have signal, or if `alvidaa_auto_switch` is false, no countdown starts.
- The countdown cancels immediately on `stop()`.

### Per-input wallpaper art

Focused inputs can display dedicated backdrop art behind the contrast wash:

- Configured at build time via `self.AlvidaaNativeInputArt`, a map of `sourceId` (string or number) to image URI.
- `allowedInputArt()` restricts art sources strictly to local files (`file:///...`, `var/local/storeAppIcon/...`, absolute paths) or inline data URIs (`data:image/(png|jpeg|webp);base64,...`). Remote network URLs (including `vidaahub.com`) are rejected.
- Smooth 300ms opacity cross-fade via two stacked art layers during focus transitions: the outgoing layer fades from 1 to 0 while the incoming layer fades from 0 to 1, driven by the focused `sourceId` with a 300ms cleanup timer.
- Completely omitted when `self.AlvidaaNativeInputArt` is absent, preserving default background behavior.

### Icons: local files, then the vendor host

App records are checked in order for `img`, `presetImg`, `icon`, `appIcon`,
`icon_local_url`, `iconLocalUrl`, `localIcon`, `httpIcon` and `icon_web_url`.
A `data:image…iconDownload<url>` trampoline is unwrapped first, because some
builds wrap the URL that way.

Two kinds of value are accepted:

- **local** — `var/local/storeAppIcon/…`, `file:///…`, an absolute path, or an
  inline `data:image` PNG/JPEG/WebP
- **the vendor's icon host** — `https://*.vidaahub.com/…` only

Anything else is refused, so this cannot become a general web client. That is
the same host the stock launcher and the 75U8QTUK port load, and it is what
gives real app icons on builds that expose no local files.

When neither is available, the overlay draws a letter badge in the app's brand
colour (Netflix red, YouTube red, Prime blue, Spotify green, Plex gold, and so
on) rather than a random hue.

If you want zero network access, drop the vidaahub rule in `allowedIcon()`.
Every app then falls back to its badge, which is the trade the first version
made.

### Preferences

`native-alvidaa.js` reads preferences backed by `sdk.storage` with safe defaults
and a no-op fallback when storage is absent. Preferences are loaded during
`start()` and re-read on `activated()`. Custom names explicitly override
vendor values (precedence: `sourceId` map -> lowercased trimmed name/label
map -> `displayname2` -> `rename` -> `name` -> `sourceId` -> i18n translation);
note that static custom names can go stale if the physical device changes.

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `alvidaa_hidden_apps` | array of strings | `[]` | App IDs or names excluded from the apps overlay. |
| `alvidaa_only_apps` | array of strings | `[]` | Allowlist of app IDs or names; when non-empty, only matching apps are kept. |
| `alvidaa_custom_names` | object | `{}` | Map of `sourceId` (or input label) to custom display name applied in `sourceName()`. |
| `alvidaa_last_used` | string / number | `null` | Last activated input `sourceId`, persisted on dock activation and used as `smartIndex()` fallback when no input has signal. |
| `alvidaa_auto_switch` | boolean | `false` | Opt-in toggle for automatic input switching on boot. |
| `alvidaa_favorites` | array of strings | `[]` | Pinned favorite app IDs in view 2 (max 5), launched directly. Stale IDs dropped silently. |


## Parity audit against watcher UI (launcher/index.html r4)

Feature-by-feature walk comparing the canvas watcher UI (`launcher/index.html` r4) against the native Home component (`native-alvidaa.js`):

| Feature | Watcher UI (`launcher/index.html` r4) | Native Home (`native-alvidaa.js`) | Status | Notes |
| --- | --- | --- | --- | --- |
| **Clock and date** | Top-left hours/minutes hierarchy (weight 300, dimmed `:`) and uppercase date | Top-left 116px hours/minutes hierarchy (weight 300, negative letter spacing, dimmed `:`) and uppercase date with bullet separator | `parity` | Driven by 1s interval; scales with viewport |
| **Inputs dock and signal dot** | Bottom dock with 5 cards per page; emerald green dot & `LIVE` pill for active signal, `STANDBY` for no signal; display icon / glyph fallback | Bottom dock with 6 cards per page; emerald green dot & `LIVE` pill for active signal, `STANDBY` for no signal; minimal hardware display icon or glyph fallback | `divergence` | Dock geometry differs (native displays 6 tiles/page `DOCK_PAGE = 6` vs watcher's 5 tiles/page); card scaled for 1080p |
| **Focused big label** | Large 42px header above dock showing input device name with `connected` / `no signal` sub-label | Large 84px header above dock showing resolved input name with `connected` (emerald) / `no signal` (slate) sub-label | `parity` | Follows focused dock selection |
| **Name resolution** | Server-driven name resolution falling back to port ID | Strict bridge hierarchy: `alvidaa_custom_names` -> `displayname2` -> `rename` -> `name` -> `sourceId` -> `sdk.i18n.t` translation | `parity` | Custom names explicitly override vendor values |
| **Apps overlay** | Modal dark glass backdrop; 5-column grid; web/local icons with brand color fallback; keyboard navigation; Back/Esc closes | Modal dark glass backdrop; 6-column grid; `appIcon()` with local file + `*.vidaahub.com` vendor host allowlist; brand color letter badge fallback; Back closes | `divergence` | Grid geometry differs (native is 6-column grid `OVERLAY_COLS = 6` vs watcher's 5-column `OV_COLS = 5`); native adds vendor icon host allowlist |
| **Stock settings** | Not present (watcher operates over remote MQTT) | Dedicated "Settings" tile in view 2 (`⚙`, "TV settings") opening TV settings via `platform.openSettings()` | `native-only` | Calls `setting.open("settings")` |
| **Smart focus** | Active signal input preferred; falls back to `localStorage` last-used; falls back to dock 0 | Active signal input preferred; falls back to `sdk.storage` `alvidaa_last_used`; falls back to dock 0 | `parity` | Executed on `routeFocus()` (`mounted`, `activated`, route change) |
| **Auto-switch countdown** | 3500ms countdown when exactly 1 live input detected; bottom HUD; cancels on keypress; triggers source change | Opt-in via `alvidaa_auto_switch`; 3500ms countdown on first payload if exactly 1 live input; shared HUD pill; cancels on any handled key; triggers `changeSource` | `parity` | Disabled by default; cancel shows toast notice |
| **Remote number hotkeys** | Digits 1–9 focus & activate dock tile; digit 0 resets to dock 0 | Digits 1–9 focus & activate dock tile; digit 0 focuses dock 0 without activating; numeral keycaps 1–9 on tiles; guarded by `sdk.key.KEYMAP` | `parity` | Guarded against open overlay; unhandled digits pass through |
| **Pinned favorites / shortcuts** | View 2 displays `shortcuts` array (URL shortcuts with `★` glyph) | View 2 displays up to 5 pinned favorite apps from `alvidaa_favorites`; activates app directly without opening overlay; clamped safely | `parity` | *Design note:* Favorites render with a star glyph (`★`), not the full app icon |
| **Per-input wallpaper art** | Daily rotating wallpaper images or ambient gradients; no per-input art mapping | Build-time map `self.AlvidaaNativeInputArt` (local/data URI only); two-phase stacked cross-fade (incoming 0->1, outgoing 1->0) over 300ms | `native-only` | *Edge case:* Switching to an input without configured art holds outgoing art at opacity 1 for 300ms, then cuts to wallpaper |
| **Toast HUD** | Viewport-fixed bottom glass capsule for action status and error messages | Viewport-fixed bottom floating glass pill HUD with opacity/transform transitions; drives action feedback, failure alerts, auto-switch notices | `parity` | Replaced legacy raw status text line |
| **App filtering and custom names** | Server-side configuration | Storage-backed `alvidaa_hidden_apps`, `alvidaa_only_apps`, and `alvidaa_custom_names` with no-op fallback | `parity` | *Product gap:* No in-launcher settings UI exists to write these keys; preferences are currently read-only consumers of `sdk.storage` |
| **Last-used focus persistence** | Saved to `localStorage` on activation; restored on cold boot | Persisted to `sdk.storage` key `alvidaa_last_used` on dock activation; restored on cold launch | `parity` | Used as smart index fallback when no input has signal |
| **Offline paint / cache** | `localStorage` cold cache (`alvidaa_cache_v1`); shows reconnecting/offline indicator when disconnected | Runs offline natively inside the TV browser runtime; bundled directly into vendor package; requires no network or server connection | `parity` | Inherently offline by architecture |
| **Diagnostics** | On-canvas text line (`NEXT r2+...`), red composite pixel test square, error overlay banner, `/api/probe` beacon | Old diagnostic line ("Native - N apps - M inputs", "Waiting for TV data") was **deliberately removed** with the toast HUD; errors surface as toast alerts; `announce()` provides TTS | `divergence` | Deliberate divergence: diagnostic text line removed in favor of clean consumer HUD |
| **System setup / install tile** | Row 2 "INSTALL AS APP" webapp installer calling `HiUtils_createRequest` / `Hisense_installApp` | Not applicable; native Home is installed directly as the `/Launcher` route component in lane 3 | `missing` | Intentional divergence: lane 1 installer pattern not applicable to lane 3 |


## Build

```sh
node tools/launcher-host/build-native-alvidaa.cjs \
  <private-stock-app.js> <expected-sha256> <private-output.js>
```

The expected hash is a required argument. A build that cannot state which stock
revision it targets cannot be rolled back safely, so the script refuses to
guess. Output must stay under `firmware/` or `/tmp/`, same as the Free My TV
build.

The candidate is: stock bundle, then `native-platform.js`, `native-alvidaa.js`,
`native-entry.js`. `native-entry.js` picks the variant from
`AlvidaaNativeComponent`, which `native-alvidaa.js` sets; Free My TV builds have
no such global and fall back to `AlvidaaFreeMyTV`.

## On-TV verification checklist

> [!IMPORTANT]
> **Hardware Status Discipline**: Every behavior listed below is a **claim (pending hardware verification)** until physically executed and observed on target TV hardware per [AGENTS.md](../../AGENTS.md). Node VM tests verify state machines and contracts, not TV rendering or vendor driver quirks.

### 0. Preflight, bundle check and safety

1. **Root access & network preflight**: Verify TV IP and root shell wrapper:
   ```sh
   ./server/tv id
   ```
   *Claim: Root shell responds with uid=0(root) gid=0(root).*
2. **Writable bundle verification**: Check the target model's launcher bundle. On the
   reference `50A51HUV` / `09.01O.P0813` that is the writable `operation-ui`
   module, not `hisenseUI` — `native-trial.cjs` pins `APP` to it:
   ```sh
   ./server/tv 'ls -ld /APPS/channelA/operation-ui/apps/launcher/js'
   ```
   *Claim: the build exposes a writable launcher bundle at that path. If it does
   not, lane 3 does not apply to that build.*
3. **Preflight and pin stock bundle**: Record exact size, owner, permissions, and hashes before modifying:
   ```sh
   ./server/tv 'md5sum /APPS/channelA/operation-ui/apps/launcher/js/app.js; sha256sum /APPS/channelA/operation-ui/apps/launcher/js/app.js'
   ```
   The reference build's pinned sha256 is
   `046b41aee0242ced3d3fcd9d5e0c0adb68e17ea3bfe14efa13d6225b6050bfad`
   (`HASHES` in `native-trial.cjs`). A mismatch means the bundle moved: stop and
   re-pin rather than building against it.

### Numbered verification sequence

1. **First paint & layout structure**
   - **What to press**: Restart the UI engine: `./server/tv 'killall -9 hisenseUI'` (or reboot TV).
   - **What to expect** *(Claim)*:
     - Screen renders deep obsidian OLED background (`#07080c`) with wallpaper/ambient gradient and contrast wash (`rgba(6,8,12,0.55)`).
     - Top-left displays hours/minutes typography (`116px`, weight 300, negative letter spacing, dimmed `:`) and uppercase date with bullet separator.
     - Bottom dock displays inputs horizontally with 28px rounded corners and 1px borders.
     - Top-right displays no web status pill or reconnection banner.
     - Legacy diagnostic text ("Native - N apps...", "Waiting for TV data") does NOT appear anywhere on screen.

2. **Smart initial focus on active signal**
   - **What to press**: Boot TV with one active HDMI source transmitting video (e.g., PS5 on HDMI2). Do not touch the remote.
   - **What to expect** *(Claim)*:
     - Initial focus automatically selects the active HDMI2 card without remote interaction.
     - Focused dock card scales up (`scale(1.03)` with 140ms ease-out).
     - Live signal badge displays emerald green dot with `LIVE` pill; inactive cards show `STANDBY`.
     - Big label above dock displays resolved input name ("PlayStation 5" via `displayname2`) with emerald `connected` sub-label.

3. **Opt-in boot auto-switch countdown**
   - **What to press**: Enable `alvidaa_auto_switch` in storage. Note that `sdk.storage` is a browser global inside the `hisenseUI` runtime origin; shell node (`./server/tv node`) cannot access it. Furthermore, on this firmware (`09.01O.P0813`), while the engine launches with `--remote_debugging_port=9666`, findings 12 confirmed that port 9666 does not actually listen on the TV. Because `native-alvidaa` does not yet expose an on-screen settings editor UI, **there is currently no supported way to evaluate JS or write preference keys in the `hisenseUI` origin on this build** (*product gap*). If testing in an environment with page console access:
     ```js
     sdk.storage.set("alvidaa_auto_switch", true);
     ```
     Restart UI with exactly one live input connected. Do not press any keys.
   - **What to expect** *(Claim)*:
     - Shared floating glass HUD pill appears at bottom center: `Switching to <name> in 4s - press any key to stay`.
     - HUD displays smooth countdown ticking down once per second.
     - At zero, HUD disappears and TV switches to that source via `platform.changeSource()`.

4. **Auto-switch cancellation on user keypress**
   - **What to press**: Trigger auto-switch countdown (as above). During the 3.5s countdown window, press any navigation key (`ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `OK`) or number key (`1`–`9`).
   - **What to expect** *(Claim)*:
     - Countdown terminates immediately and source switch is cancelled.
     - Floating HUD pill transitions to toast notice: `auto-switch cancelled`.
     - Toast expires and hides smoothly after 2.5s.
     - TV remains on Home without switching away.

5. **Dock navigation, scaling and edge clamping**
   - **What to press**: Press `ArrowRight` repeatedly across the dock to the end, then press `ArrowLeft` back to the start.
   - **What to expect** *(Claim)*:
     - Focus shifts tile by tile with 140ms scale and border transition.
     - Big label and connection sub-label update immediately with the focused input's resolved name.
     - Dock smoothly pages 6 cards at a time when navigating past card 6 (`DOCK_PAGE = 6`).
     - Pressing `ArrowLeft` on the first card or `ArrowRight` on the last card clamps safely without throwing, vibrating, or losing focus.

6. **Remote number hotkeys (1–9 and 0)**
   - **What to press**: While on dock view, press digit keys `1`, `2`, `3` on the remote control.
   - **What to expect** *(Claim)*:
     - Dock cards 1–9 display small numeral keycap badges in their top-right corner.
     - Pressing `1`–`9` immediately shifts focus to dock index `digit - 1`, displays toast `Switching to <name>…`, and activates `changeSource`.
     - Pressing `0` moves focus to dock index 0 without activating or switching sources.
     - Pressing an out-of-range digit (e.g. `8` when only 3 inputs are present) does nothing and passes through unhandled (`return false`).

7. **Per-input wallpaper art cross-fade**
   - **What to press**: Build bundle with `self.AlvidaaNativeInputArt` mapping two inputs to valid local/data URIs. Navigate between the two inputs on the dock.
   - **What to expect** *(Claim)*:
     - Outgoing input art stays at opacity 1 while incoming art starts at opacity 0 and fades to 1 over 300ms.
     - After 300ms, outgoing art layer unmounts cleanly from DOM.
     - Switching to an input with *no* configured art holds outgoing art for 300ms and cuts cleanly to the wallpaper gradient.

8. **View 2 vertical panning (Apps row and pinned favorites)**
   - **What to press**: From dock view, press `ArrowDown`.
   - **What to expect** *(Claim)*:
     - Stage pans vertically upward by 1080px over a 350ms ease-out transition.
     - View 2 renders `APPS` row: up to 5 pinned favorite apps (star glyph `★`, "Favorite" sub-label), followed by the `Apps` door card (`▦`) and `Settings` card (`⚙`).
     - Pressing `ArrowUp` or `Back` from view 2 pans stage smoothly back down to dock view.

9. **Direct launch of pinned favorites**
   - **What to press**: In view 2, focus a pinned favorite card and press `OK/Enter`.
   - **What to expect** *(Claim)*:
     - Toast HUD pill displays `Opening <AppName>…`.
     - Target app launches directly via `platform.launchApp(appId)`.
     - The full apps overlay does NOT open.

10. **Apps overlay grid & launch**
    - **What to press**: In view 2, focus the `Apps` tile (`▦`) and press `OK/Enter`.
    - **What to expect** *(Claim)*:
      - Full-screen modal dark glass overlay (`rgba(3,5,9,0.86)`) fades in over the stage.
      - 6-column grid displays all installed apps with local/vendor icons or brand color letter badges.
      - Remote arrow keys navigate the grid (UP/DOWN steps by 6, LEFT/RIGHT steps by 1).
      - Pressing `Back` closes the overlay and returns focus to view 2.
      - Pressing `OK/Enter` on an app displays toast `Opening <AppName>…` and launches the app via APC.

11. **Stock TV Settings door**
    - **What to press**: In view 2, focus the `Settings` tile (`⚙`) and press `OK/Enter`.
    - **What to expect** *(Claim)*:
      - Toast HUD displays `Opening Settings…`.
      - TV opens real stock Settings menu via `setting.open("settings")`.

12. **Storage preferences & filtering (Product Gap)**
    - **What to press**: As identified above, there is currently no supported mechanism on this build to inject JS into the `hisenseUI` origin (port 9666 does not listen; node on TV has no DOM/SDK reach) and `native-alvidaa` provides no in-launcher settings UI. In an environment with browser context access:
      - `alvidaa_hidden_apps`: `sdk.storage.set("alvidaa_hidden_apps", ["Netflix"])` -> verify Netflix is hidden from Apps overlay.
      - `alvidaa_only_apps`: `sdk.storage.set("alvidaa_only_apps", ["YouTube", "Plex"])` -> verify only those two apps appear in overlay.
      - `alvidaa_custom_names`: `sdk.storage.set("alvidaa_custom_names", {"HDMI2": "Nintendo Switch"})` -> verify dock card and big label display "Nintendo Switch".
    - **What to expect** *(Claim)*:
      - Changes take effect upon returning to Home (`activated()`). On hardware today without page injection, preferences remain at their defaults.

13. **Last-used focus fallback**
    - **What to press**: Activate HDMI2, turn off all HDMI video sources so no input has signal, and restart UI.
    - **What to expect** *(Claim)*:
      - `smartIndex()` reads `alvidaa_last_used` from storage.
      - Initial focus lands on HDMI2 instead of defaulting to dock index 0.

14. **Back key ownership hierarchy**
    - **What to press**: Test `Back` key in three contexts:
      1. Inside Apps overlay: press `Back`.
      2. In view 2: press `Back`.
      3. In dock view: press `Back`.
    - **What to expect** *(Claim)*:
      1. Overlay closes; focus remains in view 2.
      2. View 2 pans back to dock view (view 1).
      3. At dock view, `handleKey()` returns `false` — key event is not consumed and reaches the vendor shell cleanly.

### Rollback procedure

If any test fails or TV exhibits instability, execute the rollback immediately on the TV via the root wrapper:

```sh
./server/tv 'LD_LIBRARY_PATH=/lib:/usr/local/lib:/basic/lib /opt/pkgs/tv.vidaa.app.phoenix/bin/phoenix /var/local/alvidaa/native-home/native-home.cjs restore'
```

`native-home.cjs restore` is the single supported rollback path. It requires root execution on the TV (`process.getuid() === 0`), uses the variant's home directory `/var/local/alvidaa/native-home`, and restores files atomically from the state manifest backup (`entry.backup` in `/var/local/alvidaa/native-home/state.json`), then restarts the vendor engine.
*Claim: Pinned stock bundle is restored byte-for-byte; stock VIDAA launcher restarts cleanly.*

## Tests

```sh
node --test tools/launcher-host/native-alvidaa.test.cjs
```

Covers start/stop idempotence, app and input filtering, storage preferences
(hidden/only apps, custom input names, last-used fallback, pinned favorites,
absent storage), name precedence, smart focus, dock and overlay navigation,
Back ownership, action failures, toast HUD timing and expiry, remote number
hotkeys (0-9), boot auto-switch countdown (firing, cancel, live input guards),
per-input wallpaper art cross-fade and URL rejection policy,
render structure and scaling, the entry's variant selection, and the build's
hash and output guards.
