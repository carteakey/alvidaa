# 03 — Native Home (lane 3) on this build

## Bundle

```
/APPS/pkgs/tv.vidaa.app.operationui/current -> CHB
CHB/apps/launcher/js/app.js   323,476 B, owner UhisApp(305):909, mode 0640
md5 45626039103fb60060618545dba6f0f5
```

Stock md5 is the value pinned for `65a85qevs` in
`tools/launcher-host/models.json`, so that profile applies unchanged. Active
channel is `CHB`; no `CHA` directory exists for `operationui`.

`/opt/hisenseUI/startgui.sh` resolves the bundle via
`GET_PKG_DEST "tv.vidaa.app.operationui"`, exports `HI_UI_OPERATIONUI`, and execs
Cobalt on `file:///hisenseUI/index.html` with `--csp_mode=disable`.

## SDK contracts

```js
apps     me.req("app-service").getData("getAppList",  {sceneCode:"launcher"}).result
record   me.req("app-service").getData("getAppInfo",  {appId, url, checkRange:1}).result
launch   sdk.MP.start({name, appId, url, storeType, startMethod, typeCode:"600002"})
inputs   me.req("all-inputs").getData("getAllInputsData").result
switch   me.req("all-inputs").invoke("changeSourceTo", sourceId, "launcher")
settings me.req("setting").open("settings")
```

| Contract detail | Value |
|---|---|
| App list key | `getAppList` + `sceneCode:"launcher"`; `getCurrentShowApps` does not exist on this build (returns empty) |
| Launch `typeCode` | `"600002"` (`sF.APP`; `H5` = `"8002"`); omitting it makes `MP.start` a no-op |
| Launch path | `MP.start`; `sdk.apc.start` is not used by this bundle |
| URL assembly | replace `<VIDAA-ORIG-APP>` / `<VIDAA-ORIGN-POSITION>` in the app record's `url` |
| Events | `o2n://sdk/init-finished`, `o2n://app-service/all-apps-changed`, `o2n://all-inputs/inputs-data-changed`, `o2n://sdk/str-resuming` |

## Engine behaviour

| Behaviour | Consequence |
|---|---|
| `background-image` with an SVG data URI does not paint | icons must be PNG data URIs |
| one keypress arrives as both `key-down` and DOM `keydown` | register one listener; a 45 ms same-key debounce prevents double steps |
| the D-pad drives an on-screen pointer; OK emits a click at the pointer position | activation must come from the component's own key handling |
| the page is `file://` and has no network | all assets inline; no remote fonts or images |
| compositor output is 1920×1080 while `app_resolution` reports 720p | size type for 1080p; avoid hairlines |
| fonts | generic sans only; hierarchy from size and weight |

## Install and rollback

```sh
cp -p app.js /APPS/.re/backup/app.js.stock
# write candidate, then:
chown 305:909 /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
chmod 0640 /APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js
```

Applying a change requires a reboot. `kill -9` on `SystemUI` followed by a manual
start leaves DirectFB unable to create a base context
(`dfb_core_create … general initialization error`); the display is unusable until
the next boot.

Live bundle after a design revision (2026-11-21): md5 `f0e8defb19cf36319bf248b1e31aa749`,
450,402 B. The stock backup is unchanged.
