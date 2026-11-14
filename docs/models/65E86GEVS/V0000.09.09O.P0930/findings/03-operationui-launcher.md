# Finding 03 — the launcher Home is `tv.vidaa.app.operationui` (AppId `launcher`)

Device: 65E86GEVS / V0000.09.09O.P0930 (MTK9618, U09.09). Read straight from
the pulled OS (package backup ipk + `startgui.sh`), 2026-11-14 — no TV writes,
no live probing.

## Why this matters

The stock home screen is **not** the `hisenseUI` bundle people usually point
at. On this MTK9618 U09.09 build the launcher is a *separate component
package* — `tv.vidaa.app.operationui` — mounted into the SystemUI (Cobalt /
hisenseUI) engine. Same finding the
[50U7DSE guide](../../../50U7DSE/V0000.09.62N.Q0923/README.md) recorded for
09.62; this confirms it on the U09.09 branch and adds the per-build constants.

## Evidence

**Package identity** (`tv.vidaa.app.operationui_9.00.02-a20250912h_all.ipk`,
control file):

```
AppId: launcher
AppName: ui
Userid: 305:909
Persistent: true
DualChannel: true
PackageType: Property
CodeBranch: VIDAA_UI_MT9618_U902_EUAU_MP_20250708
```

**Engine wiring** (`/opt/hisenseUI/startgui.sh`):

```sh
HI_UI_HOME=$(GET_PKG_DEST "tv.vidaa.app.ui")              # the hisenseUI shell
HI_UI_OPERATIONUI=$(GET_PKG_DEST "tv.vidaa.app.operationui")
#                    fallback: /APPS/pkgs/tv.vidaa.app.operationui/CHA
exec .../SystemUI --url=file:///hisenseUI/index.html
```

So `tv.vidaa.app.ui`/hisenseUI is the *shell* the engine loads; the launcher
component set is the operationui package, and at runtime its writable copy is
the `CHA/` tree under `/APPS/pkgs/` (or `/opt/pkgs/` on a stock-only unit).

**Bundle structure** — webpack runtime `self.webpackChunk_MODULE_LAUNCHER_`
with a per-sub-app registry under `apps/` (17 entries):

```
apps/{launcher, all-inputs, app-service, ads, screen-saver, search,
     notification, vidaa-channels, kids-mode, kids-setting, epg,
     vidaa-tv, virtual-input, web-service, vidaa-plus, …}
```

The launcher component itself: `apps/launcher/js/app.js` (293 KB) plus 24
numbered chunks — the same shape as the 50U7DSE `operationui` row (there with a
`(self._V_M_=…)` tail; here the runtime is named `MODULE_LAUNCHER` — build
difference, same family).

**SDK contracts present** (grep): `changeSourceTo`, `getAllInputsData`
(`apps/all-inputs/js/app.js`), `getAppList`, `LAUNCHER_RECOMMEND`
(`apps/launcher/js/*`, `apps/app-service/js/app.js`) — matching the 50U7DSE
claims for this SoC generation.

## Bonus: where the launcher's ad/telemetry calls live

Useful to whoever strips the sponsored/telemetry side on this branch
([LAUNCHER_V2](../../../../launcher/LAUNCHER_V2.md)): they are concentrated in the launcher
chunks, not scattered across `sdk.js` (which is the 50A51HUV MTK9602 pattern):

- `apps/launcher/js/378.js` — `clickLogReport` → `jhkRecommendClickReport`
- `apps/launcher/js/456.js` — `getAdDatas` (ads tile fetch)
- `apps/launcher/js/567.js`, `869.js` — `RECOMMEND_CLICK_LOG_REPORT`,
  `MEDIA_IMPRESSION` (recommend/exposure telemetry)

plus the standalone `apps/ads` sub-app.

## Open

- The *live* runtime tree of operationui (which of `/APPS/pkgs/…/CHA` vs
  `/opt/pkgs/…` is active, and its md5) was not recorded at contribution time.
- `tv.vidaa.app.ui` vs operationui contract boundaries on this branch (which
  sub-apps the shell mounts vs which the launcher owns) not exhaustively
  mapped; the registry list above is from the package content.
