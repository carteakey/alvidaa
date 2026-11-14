# 02 — Native Home (Lane 3) install (2026-11-12)

Free My TV component swap in the writable `operation-ui` bundle. The tested SDK
interfaces **match those of the 75U8QTUK**, so the `free-my-tv-75u8qtuk` adapter
was reused unchanged.

## Bundle

`/APPS/pkgs/tv.vidaa.app.operationui/CHA/apps/launcher/js/app.js` (engine SystemUI,
`current -> CHA`). Ends `(self._V_M_=self._V_M_||{}).launcher=()=>i("740m").Z` — the
same module id as 75U8QTUK. Routes: `/Launcher`, `/Search`, `/KidsLauncher`,
`/GameLauncher`. The swap replaces only `route[0].component` for `/Launcher`.

## SDK contracts (match 75U8QTUK)

- apps: `me.req("app-service").getData("getAppList",{sceneCode:"launcher"})`
- inputs / switch: `getAllInputsData` / `me.req("all-inputs").invoke("changeSourceTo",sourceId,"launcher")`
- settings: `me.req("setting").open("settings")` (no `vk`)
- launch: `sdk.apc.start` with `CMDMETHOD.LAUNCHER_RECOMMEND` / `KEY_INPUT_START`, `storeType`/`openMode`
- events: `init-finished`, `all-apps-changed`, `inputs-data-changed`, `str-resuming`, `str-suspending`
- keymap: `KEYMAP`/`LAUNCHER`/`SOURCE`/`ALLAPP`/`KEYPAD_INPUT`

`getCurrentShowApps` (55A7KAU-only) is absent — confirms the 75U8QTUK-style surface.

## Install + restart mechanics

Stock pin (size `323596`, `305:909`, `0640`, md5 `8b1c6193…`, sha256 `fbffe729…`)
verified on both sides, then the switch script (dry → install) captured the SystemUI
env, killed SystemUI, atomically swapped `app.js`, reset only `compiled_js`/
`uncompiled_js`, and relaunched via `secure_exec SystemUI /opt/hisenseUI/startgui.sh`.
A fresh `compiled_js` set proved the candidate was recompiled, not cache-served.

## Verification

Home, Home button, Input button + HDMI switch, stock TV Settings, AirPlay, and app
launch all owner-confirmed. The swap survived a cold boot byte-identically.
Rollback is one command (`switch-home.sh rollback`).

## Note

YouTube lost its sign-in at some point — attributed to the firmware update
(`09.61 → 09.62C`, same day), not the launcher: YouTube is a separate native app
(`tv.vidaa.app.youtube`) whose data the launcher never touches.
