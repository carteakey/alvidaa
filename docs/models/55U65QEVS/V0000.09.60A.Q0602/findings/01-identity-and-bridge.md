# 01 — Identity and bridge surface

## Identity

| Field | Value | Source |
|---|---|---|
| Platform model | `55U65QEVS` | `critical.ini [Critical] Model`, `Hisense_GetModelName()` |
| Retail SKU | `55U7QTUK` | About screen |
| Serial type | `55U6QE` | `critical.ini [Critical] Serial`, `GetSerialType()`, `ModelInfo.ini Name` |
| ProjectId | `140` (`projectid=1` in cmdline) | `critical.ini` |
| SoC | `MTK9618` | `critical.ini [Hardware] ChipVersion`, `ModelInfo.ini SocModel`, `GetChipSetName()`, `GetPlayerFeatureInfo()` = `009006000.VD9618O_GL` |
| Family strings | `hisense_mt5870_linuxDB` (ModelInfo), `mt5879` (kernel cmdline) | both |
| Kernel | `5.4.302` aarch64, built 2026-06-01 | `/proc/version` |
| Userland | 32-bit ARM, glibc 2.31 (`process.arch=arm`) | shell |
| OS / API / engine | VIDAA `U09.60`, API `3.0.1`, Chromium 111 `WebExplorer/5.2.1` (`odin`) | getters, UA |
| Region | `EU_A`, `GBR`, `Great_Britain` | `critical.ini` |
| Running / factory version | `V0000.09.60A.Q0602` / `V0000.09.09P.P0930` | `ModelInfo.ini SwVersion` / `critical.ini [System] Version` |
| Panel | `3840*2160`; `app_resolution` reports `720p` | `GetPictureInfo()` |
| HDR | HDR10, HLG, HDR10+, Dolby Vision | `GetSupportForHDRInfo()` |
| DRM | widevine, playready, clearkey | `GetDrmInfo()` |

## Bridge

95 `Hisense_*` globals, available to any page the browser loads. Relevant symbols:

| Symbol | State |
|---|---|
| `HiUtils_createRequest(action, params)` | present (arity 2) |
| `vowOS.service.syncExecute` + `execute`, `httpRequest`, `socketon*` | present |
| `WebSDK_createFileRequest` | absent |
| `Hisense_installApp` | absent |
| `hiutils.fileRead` (as a symbol) | absent — `fileRead` is an action string |

```js
HiUtils_createRequest("fileRead",  {path: ["../proc/uptime"], mode: 6})   // ret:true
HiUtils_createRequest("fileRead",  {path: "ModelInfo.ini",   mode: 6})    // relative to /APPS
HiUtils_createRequest("fileWrite", {path: "websdk/Appinfo.json", …})      // 503 appconfig
vowOS.service.syncExecute("basic/fetcher",
    {api: "fetchFile", args: JSON.stringify({url, directory, permission})})
```

Error shapes: a rejected path returns `ret:false, "invalid path:<path>"`; a
directory read returns `{"errno":-21,"code":"EISDIR"}`; a missing file returns
`{"errno":-2,"code":"ENOENT","path":…}`; a restricted path returns
`{"errno":-13,"code":"EACCES"}` — the last two distinguish absence from
permission without a shell.

## Installed packages

19 entries in `/APPS/pkgs/opkgmeta/status`, all `Architecture: mtk9618`:

```
tv.vidaa.app.browser      9.6.0-r20260602a    tv.vidaa.jsservice.basic   1.0.0-r20260602a
tv.vidaa.app.phoenix      1.0.0-r20260602a    tv.vidaa.jsservice.system  1.0.0-r20260602a
tv.vidaa.app.operationui  9.61.00-a20260727u  tv.vidaa.cfg.setting       9.05.00-a20251030l
tv.vidaa.app.osconfig     1.0.0-r20260602a    tv.vidaa.lib.odin          9.6.0-r20260602a
tv.vidaa.app.tvbrowser    9.6.0-r20260602a    tv.vidaa.lib.mediamain     3.6.0-r20260601w
tv.vidaa.app.youtube      1.0.0-r20260602a    tv.vidaa.res.webengine     9.6.0-r20260602a
tv.vidaa.res.{odin,youtube,iot,matter}        tv.vidaa.phony.{btrc,pkglimit,keystore}
```

`operationui 9.61.00-a20260727u` is the string the About screen labels
"Minor Version" (`A.Q0602.9.61.00-a20260727u`): a package version, not a firmware
revision.

`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/` contains services `fetcher`,
`hiutils`, `ipchandler`, `tvinfo`, a `functions/` tree, and `serviceList.json`.
Channel `CHA` only; no `CHB`.
