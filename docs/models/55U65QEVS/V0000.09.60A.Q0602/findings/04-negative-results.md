# 04 — Approaches that do not work

Each entry is the observed behaviour, not an inference.

## A `file://` page has no network

A page at `file:///APPS/websdk/<name>.html`, launched as an app tile, issued:

- `POST https://localhost:9888/function/basic/fetch/sw2` with an `identifier` header
- the same without the header
- `POST http://localhost:9009/function/basic/fetch/sw2`
- `POST http://<lan-host>:<port>/collect`

None arrived: no request, no preflight, no error. Consequence: no logic that
depends on HTTP can run from page JavaScript on this build; the launcher bundle
cannot trigger the FaaS path.

## `servicelist.db` is the DVB channel table

`/var/tvservice/servicelist.db` contains `Service`, `Tuner`, `Dvb*Tuner`,
`FavoriteList`, `Lcn` — the channel database. Autostart is configured in
`tv.vidaa.jsservice.basic/CHA/services/serviceList.json`, a JSON array.

## `fileWrite` is refused regardless of content

`HiUtils_createRequest("fileWrite", {path:"websdk/Appinfo.json", writedata:<existing bytes>})`
returns `ret:false "client request permission check error, please check
appconfig"`. The check is on the caller, not the payload. `/opt/appconfigs`
contains one file (`2545_config.json`, `AppId 2545`, `mediamain`), so the browser's
permission list is not in that directory.

## opkg extracts the IPK data set under `/APPS/pkgs`

A `data.tar.gz` member `./APPS/.re_ssh/dropbear` lands at
`/APPS/pkgs/APPS/.re_ssh/dropbear`. A `postinst` referencing `/APPS/.re_ssh/…`
directly reports the file missing.

## `kill -9` on SystemUI wedges DirectFB

```
[DFB] dfb_core_create,292 ret=A general initialization error occured
(SystemUI) Failed creating base context during opening of kernel driver.
```

Killing the other display clients first does not prevent it. A reboot is the only
recovery.

## macOS `ar` produces an IPK that opkg rejects

BSD `ar` writes a `__.SYMDEF` member and does not match the expected container.
Build the archive explicitly: `!<arch>` header, 60-byte member headers, even
padding.

## `-g` is not a valid dropbear option without password auth

With `DROPBEAR_SVR_PASSWORD_AUTH=0`, `dropbear -g …` exits with `Invalid option -g`.
Key-only is already the only compiled-in method.
