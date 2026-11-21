# 03 — Native Home (lane 3) on this build

## The bundle is byte-identical to a build this repo already supports

```
/APPS/pkgs/tv.vidaa.app.operationui/current -> CHB
CHB/apps/launcher/js/app.js   323 476 B, UhisApp(305):909, 0640
md5 45626039103fb60060618545dba6f0f5
```

That hash is the pinned stock value in `tools/launcher-host/models.json` for
**`65a85qevs`**. So the `switch-home-65a85qevs.sh` profile applies unchanged, and
a candidate built for `65A85QEVS` is a candidate for this unit.

`/opt/hisenseUI/startgui.sh` resolves the bundle via
`GET_PKG_DEST "tv.vidaa.app.operationui"`, exports `HI_UI_OPERATIONUI`, and
execs Cobalt on `file:///hisenseUI/index.html` with `--csp_mode=disable`. The
active channel is **CHB**; no CHA directory exists for `operationui`.

## SDK contracts (read out of the stock bundle, not guessed)

```js
apps    me.req("app-service").getData("getAppList",     {sceneCode:"launcher"}).result
record  me.req("app-service").getData("getAppInfo",     {appId, url, checkRange:1}).result
launch  sdk.MP.start({name, appId, url, storeType, startMethod, typeCode:"600002"})
inputs  me.req("all-inputs").getData("getAllInputsData").result
switch  me.req("all-inputs").invoke("changeSourceTo", sourceId, "launcher")
settings me.req("setting").open("settings")
```

Four things that cost deploys:

1. **`getCurrentShowApps` does not exist here.** The repo's `native-platform.js`
   calls it; on this build it yields an empty list and every tile renders as
   "not installed". Use `getAppList {sceneCode:"launcher"}`.
2. **`typeCode` is required by `MP.start`.** `sF.APP = "600002"` (also `H5 =
   "8002"`). Without it the call is accepted and nothing happens.
3. **`sdk.apc.start` is not the launcher's path on this build** — the bundle calls
   `MP.start`. Keep `apc` as a fallback only.
4. **`assembleUrl`** replaces `<VIDAA-ORIG-APP>` / `<VIDAA-ORIGN-POSITION>` in an
   app record's `url` — pass the appId's record, not a hand-built url.

## Cobalt quirks on this build

| Quirk | Consequence |
| --- | --- |
| `background-image` with an **SVG data URI** does not paint | rasterise every icon to PNG before embedding |
| `<img>` for cached icons did not paint either (per the repo's own notes) | use `background-image` with PNG |
| a single remote press arrives as **both** `key-down` and DOM `keydown` | register one listener only, plus a ~45 ms same-key debounce, or every step moves twice |
| the D-pad moves an on-screen pointer and OK emits a **click at the pointer** | rely on the component's own `key-down` handling for activation; treat DOM clicks as optional |
| file:// pages have **no network** (see [04](04-negative-results.md)) | nothing that needs HTTP can live in the bundle |

## Install / rollback

```sh
# candidate = stock app.js + our parts (platform, icons, component, entry)
cp -p app.js /APPS/.re/backup/app.js.stock          # once
# write candidate, then:
chown 305:909 …/js/app.js && chmod 0640 …/js/app.js
```

Restarting `SystemUI` **in place** after a `kill -9` leaves DirectFB unable to
create a base context (`dfb_core_create … general initialization error`) — the
display master must be the first client. A reboot is the reliable restart; do not
`setsid` a second SystemUI.
