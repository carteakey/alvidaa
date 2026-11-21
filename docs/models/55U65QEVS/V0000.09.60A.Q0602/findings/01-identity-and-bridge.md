# 01 — Identity, bridge surface and what the browser can call

Measured on one retail `55U7QTUK` (platform `55U65QEVS`), `V0000.09.60A.Q0602`,
2026-11-20, from the TV's own browser and from a uid-0 shell.

## Identity

| Field | Value | Source |
| --- | --- | --- |
| Retail SKU | `55U7QTUK` | About screen |
| **Platform model** | **`55U65QEVS`** | `critical.ini [Critical] Model`, `Hisense_GetModelName()` |
| Serial type | `55U6QE` | `critical.ini [Critical] Serial`, `GetSerialType()`, `ModelInfo.ini Name` |
| SoC | **MTK9618** | `critical.ini [Hardware] ChipVersion`, `ModelInfo.ini SocModel`, `GetChipSetName()`, `GetPlayerFeatureInfo()` = `009006000.VD9618O_GL` |
| Kernel / userland | `5.4.302` aarch64; `process.arch=arm`; cmdline `androidboot.vendor.cf.hardware=mt5879` | `/proc/version`, cmdline |
| Family string | `hisense_mt5870_linuxDB` in `ModelInfo.ini` (legacy); kernel says `mt5879` | both |
| OS / API / browser | VIDAA `U09.60`, API `3.0.1`, Chromium 111 `WebExplorer/5.2.1`, engine `odin` | getters, UA |
| Region | `EU_A`, `GBR` | `critical.ini` |
| Factory baseline | `[System] Version=V0000.09.09P.P0930` (running build is 09.60A.Q0602 — they differ by design) | `critical.ini` |
| Panel | `3840*2160`, app compositing `720p`; HDR10 / HLG / HDR10+ / DV | `GetPictureInfo()`, `GetSupportForHDRInfo()` |

## The bridge on this build

95 `Hisense_*` globals, callable from **any page the browser loads** (no origin
restriction), plus:

| Symbol | State |
| --- | --- |
| `HiUtils_createRequest(action, params)` | present, arity 2 |
| `vowOS.service.syncExecute` (+ `execute`, `httpRequest`, `socket*`) | present |
| `WebSDK_createFileRequest` | **absent** |
| `Hisense_installApp` | **absent** |
| `hiutils.fileRead` as a *symbol* | absent — `fileRead` is an **action string** |

Call shapes that work:

```js
HiUtils_createRequest("fileRead", {path: ["../proc/uptime"], mode: 6})   // ret:true
HiUtils_createRequest("fileRead", {path: "ModelInfo.ini", mode: 6})      // relative to /APPS
HiUtils_createRequest("fileWrite", {path:"websdk/Appinfo.json", …})      // 503 appconfig
vowOS.service.syncExecute("basic/fetcher",
    {api:"fetchFile", args: JSON.stringify({url, directory, permission})})
```

Reading a **directory** returns `EISDIR`, which is a free `ls`; `EACCES` vs
`ENOENT` distinguishes permission from absence. That is how the launcher bundle
and its owner/mode were located without a shell.

## What is installed

19 packages in `/APPS/pkgs/opkgmeta/status`, every one `Architecture: mtk9618`,
including `tv.vidaa.app.operationui 9.61.00-a20260727u` — which is exactly the
"Minor Version" string on the About screen (`A.Q0602.9.61.00-a20260727u`). The
About screen's "Minor Version" is a **package version**, not a firmware
revision. No `re.installer`, no ALPAC agent: a clean unit.

`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/` has `fetcher`, `hiutils`,
`ipchandler`, `tvinfo` services and `functions/fetch` (**no** `sw2.js` until one
is planted), on channel `CHA` only.
