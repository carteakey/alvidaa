# 04 — Negative results: what does not work on this build

Each of these cost at least one deploy cycle. Recorded so the next person does not
repeat them.

## 1. A page inside the launcher bundle cannot reach the network

**Hypothesis:** the native Home component can arm root by POSTing to
`https://localhost:9888/function/basic/fetch/sw2` on mount, giving
bundle-resident persistence with no service and no boot hook.

**Measured:** a real `file://` page on the TV (`file:///APPS/websdk/<test>.html`,
launched as an app tile) attempting three transports —
`https://localhost:9888` with the `identifier` header, the same without the
header, and `http://localhost:9009` — **none of them reached the network**. A
parallel XHR to the LAN collector did not arrive either: no request, no CORS
preflight, nothing in the server log. A `file://` origin on this build has no
usable network path at all.

**Consequence:** the arm call cannot live in the launcher. Persistence must come
from something the vendor starts (see
[02](02-base-service-persistence.md)), not from page JavaScript.

## 2. `servicelist.db` is not a service autostart list

`/var/tvservice/servicelist.db` is the **DVB channel table** (`Service`, `Tuner`,
`DvbTTuner`, `FavoriteList`, `Lcn`), empty on an unscanned unit. "serviceList"
in the repo means `CHA/services/serviceList.json` — a plain JSON array — not this
SQLite database. Do not go looking for autostart there.

## 3. `HiUtils_createRequest("fileWrite", …)` is gated, and not by anything local

`ret:false`, `client request permission check error, please check appconfig`, with
`Hisense_SupportAppConfig()` returning `true`. The only file in
`/opt/appconfigs` is `2545_config.json` for `mediamain`, so the browser's
permission list is not in that directory. Editing the registry byte-identically
also fails — this is a permission check on the caller, not a validation of the
content.

## 4. `opkg` extracts the IPK data set under `/APPS/pkgs`

A `data.tar.gz` member `./APPS/.re/rshell.js` lands at
`/APPS/pkgs/APPS/.re/rshell.js`, **not** `/APPS/.re/rshell.js`. A postinst that
expects the latter reports its helper as missing. Copy from the extraction path
in `postinst`, or ship the payload separately.

## 5. Killing `SystemUI` wedges the display

`kill -9` on SystemUI and then starting it again fails forever with
`[DFB] dfb_core_create,292 ret=A general initialization error occured` /
`Failed creating base context during opening of kernel driver`. Killing the
other display clients first does not help. **A reboot is the only reliable
restart**; a candidate bundle must be validated on a cold boot, not on a
hot-swapped SystemUI.

## 6. `ar` from macOS produces an IPK that opkg rejects

BSD `ar` writes a `__.SYMDEF` member and mangles the archive. Build the `!<arch>`
container by hand (60-byte headers, even padding) — that is what
`ipk/build_ipk.py` in the owner's tree does.

## 7. The PFM lane exists but is not needed here

`start-kilby.sh` honours `/var/local/DebugPowerup` → `pfm-manager.sh` → `eval` of
`PFMCheck` and `Data/platform.txt` as uid 0, then wipes both. It is identical to
the documented `65A85QEVS` behaviour and would work, but it puts attacker-written
lines into the boot path. The BaseService autostart achieves the same persistence
with a benign failure mode, so PFM was left alone.
