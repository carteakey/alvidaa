# 65A85QEVS / V0000.09.60A.Q0602 — findings

Numbered in the order they bit. Unit: MTK9618, aarch64 kernel, 32-bit ARM
userland, VIDAA `U09.60`, EU_A/CZE, LAN-local.

## 01 — The unit exposes almost nothing

`36669` (RemoteNow MQTT) and `7000` (AirPlay) answer; SSDP is silent, ICMP is
filtered, `7001`–`7014` and the rest of the AirPlay range are DROPped by
`FIREWALL_IN_EULAON`. Fingerprinting without a shell therefore relies on
`/APPS/ModelInfo.ini` and `/hidata/critical/config/critical.ini` — both
world-readable — not on the network.

`ModelInfo.ini` carries the running `SwVersion` (`V0000.09.60A.Q0602`) while
`critical.ini [System] Version` still holds the factory baseline
(`V0000.08.52A.P0409`). The vendor store agent repeats the baseline in
`agent.json.deviceFirmware`, so the two disagree by design. Read the
`ModelInfo.ini` value when recording a firmware id.

## 02 — Read traversal is array-only, writes are gated

`hiutils.fileRead` accepts a one-element **array** path and traverses:
`["../proc/uptime"]` → `ret:true`. A bare string is rejected. `fileWrite`
through `HiUtils_createRequest` is refused with
`ret:false, code:503 "client request permission check error, please check
appconfig"` — the identity gate. `WebSDK_createFileRequest` is absent on this
build, so that alternative lane does not exist here.

## 03 — `fetchFile` downloads but never creates directories

`vowOS.service.syncExecute("basic/fetcher", {api:"fetchFile", args:…})`
succeeds (`ret:true "download finished"`) and writes as uid 314, mode 644. It
refuses to overwrite root-owned files, and — the trap — it does not `mkdir`:

```
download failed: ENOENT: no such file or directory,
  open '/var/local/alvidaa_t/a/b/marker.txt'
```

Consequence: the "plant `PFMCheck` with the fetcher" shortcut (the 50A6Q
v15-style replant) is impossible on a clean unit, because
`/var/local/pfmParse/Data/` does not exist and nothing on the TV will create it
before root. The fetcher is still enough for the IPK lane, which needs
`/APPS` and one existing FaaS directory only.

## 04 — Superwatch takes the 55E75LEVS ids, not the 55E7QTUK ones

`basic/fetch` is live (`/function/basic/fetch/sw2` → 200), and `sw2.js` (a
4-byte LE length prefix to `/var/run/superwatch_socket`) accepted
`90:83:90;re.installer` and `91:82:91;/APPS/installer.ipk;re.installer;`.
The 55E7QTUK recipe (`53`/`54`) does **not** apply to 09.60A. The `Architecture`
field in the IPK `control` must be `mtk9618`.

Vein: the first install returned `IPK file: not exists` in an earlier profile
check; the file only becomes visible to superwatch after `fetchFile` finishes,
so the page uploads both files and only then sends `82`. Sending `82` early is
harmless but produces exactly that error, which is a useful dry-run signal.

## 05 — The opkg `postinst` environment has no `id` and no `uname`

First run executed correctly but `proof.txt` was written by a shell that could
not find `id` or `uname`:

```
/APPS/pkgs//opkgmeta/info/re.installer.postinst: line 16: id: command not found
Uid:	0	0	0	0
CapEff:	0000003fffffffff
```

So the postinst is genuinely uid 0, but the default PATH does not reach those
applets — they may not be installed as separate binaries at all. Use
`/usr/local/bin/busybox id`, `busybox uname -a`, or read
`/proc/self/status` directly. Verdict logic that greps for `uid=0` fails for
this reason alone; that is a false negative, not a failed exploit.

## 06 — No `nohup`, no `setsid`, no `nc`; busybox has no `nc` applet

`command -v` on the postinst: `wget/curl/nc/socat/setsid/nohup/telnet/httpd`
all `none`; `busybox=/usr/local/bin/busybox`, `bash=/bin/bash`,
`pidof=/bin/pidof`. And `busybox nc` answers **`nc: applet not found`**, so the
"busybox netcat listener" recipe from other guides silently produces nothing
(and a retry loop around it spins forever).

`busybox setsid` does exist and is the way to detach: plain `&` from an opkg
postinst is not enough, the child dies with the installer's process group.

## 07 — Node is the privileged runtime; use it for the shell

`/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix` is Node 20.19.4, runs as uid
0, and spawns children. `process.arch` is `arm` on an `aarch64` kernel, so a
static ARMv7 Dropbear from `tools/ur9s` would work if a toolchain existed —
none does on this host, and the TV ships no `dropbear`/`sshd` binary anywhere
under `/APPS`, `/opt`, `/usr` or `/var/local`.

The Node service (`tools/65a85q/rshell.js`) gives a real root shell on `:8008`
with no binary, no `suid` (all persistent filesystems are `nosuid`), and no
compile step. It is ~10 MB RSS and restarts through `rshell.sh`.

SELinux is `Permissive` on this unit, so spawning `/bin/sh` from Node is not a
policy problem. The vendor firewall needs an `ACCEPT` at the **head** of both
`INPUT` and `FIREWALL_IN_EULAON`: `:8008` and `:2222` are not in the DROP list,
but the chain ends with `-j DROP`, so appending is not enough.

## 08 — The PFM gate is powerful and self-destructing

`pfm-manager.sh` with no arguments takes the `continue` branch, requires
`PFMCheck` + `Data/platform.txt`, and **eval's every line of both files as
uid 0** (`getPFMCheck`, `getPlatform`) before it checks `runCount >=
runMaxCount`. With `runCount` dominant, that check then does
`rm -rf /var/local/pfmParse && rm -rf /var/local/DebugPowerup`.

So the payload must survive its own trigger. `tools/65a85q/boot.sh replant`
keeps the payload in exactly one place; `svc.sh` calls it every 30 s, and the
payload itself schedules a replant at +40 s. With `runCount=99` and
`runMaxCount=1`, neither `runCount < runMaxCount` nor the `switchSignal`
branch (`bizm …`) is reachable, so there is no reboot and no settings write.

Validated without rebooting by running `bash /usr/local/scripts/pfm-manager.sh`
as root:

```
PFMP-Run: runSignal=PFM, signalList=dtv-launcher, runCount=99, runMaxCount=1
PFMP-Run: over yet ---clear all …
alvidaa payload ran … uid=0
```

and 30 s later the gate and `DebugPowerup` were back, with the shell service
still listening.

## 09 — `DebugPowerup` content is a handshake, not a flag

The vendor store agent (`/var/local/alpac-agent`, "ALPAC persistent agent v3")
re-creates `DebugPFM_Ctrl` and `DebugPowerup` only when the existing files are
byte-identical to its own copies (`owned_rearm` + `same_file`). Writing junk
into `DebugPowerup` makes it give up quietly. Keeping the 26-byte
`ALPAC persistent agent v3` content and only `touch`ing the file keeps the
handshake happy while our `PFMCheck` still wins the `pfmDebug()` branch, so
the store agent does not start at boot and does not fight the gate.

## 10 — OTA was already off, and the update service still runs

`/OAD/AppUpgradeSwitch.json` is signed and carries `upgradeFlag: "0"` (country
`DEU` in the signed payload), and `/var/local/nightupdate.ini` has
`dcm_update=0`, `dcm_standby_update=0`, `dcm_tkgs_update=0`,
`dcm_digiturk_update=0`, `epg_capture=0`. `ota_upgrade` is nevertheless
running as `UhisOta`; that is the poller, not a pending update. No OTA write
was made — `/OAD` is on the never-touch list.

## 11 — Cold boot works, but iptables does not survive it

First real reboot (2026-11-13 22:05, `boot_id 7ea9bdaa…`) proved the PFM lane
end to end:

```
22:05:38  alvidaa payload ran … uid=0          (PFM payload, from start-kilby)
22:06:03  boot.sh start / svc started pid=7420
22:06:05  listen8008=1 boot.sh done            (node listening)
```

Yet from the LAN `:8008` was **closed**. The service was up; the rules were
not: `iptables` lives in RAM only, so after a reboot `INPUT` and
`FIREWALL_IN_EULAON` are back to the vendor policy, which ends in
`-j DROP`. The postinst inserts the two `ACCEPT`s, but nothing re-inserted
them at boot.

So `boot.sh` now owns the firewall step too (`fw()`: the same
`iptables -C || -I 1` pair for `8008`/`2222` on both chains), `start()` calls
it and `svc.sh` re-runs `boot.sh fw` every 30 s. `boot.log` records
`fw8008=1 listen8008=…` after each start.

Second trap on the same reboot: `08-ipk.html` re-runs the postinst, and the
old postinst wrote its own inline `PFMCheck` (1588 B) — a payload that
phones home but never starts `svc.sh`. Re-installing therefore silently
replaced the kit gate (759 B) with a weaker one. The postinst now ends with
`boot.sh replant && boot.sh` when the kit is deployed, so `boot.sh` stays the
single source of truth and a re-install cannot down-grade the lane.

Fix verified with a second controlled reboot (`reboot` from the root shell,
2026-11-13 23:01, `boot_id 32a81ac0…`):

```
23:01:38  alvidaa payload ran … uid=0
23:02:03  boot.sh start / svc started pid=7347 / replant done
23:02:05  fw8008=1 listen8008=1 boot.sh done
```

From the LAN, `python tools/tvsh.py "…"` answered as `uid=0` ~35 s after the
reboot, with no page opened and no manual step. Boot persistence is green.

## 12 — OTA freeze at the network level; the store stays untouched

`/APPS/domain/domain_list.json` is this unit's own domain map (no `dohServers`
key on this branch — the resolver is the LAN router, so there
is no DoH lane to block). `tv.ota` and `tv.upgrade-plc` both point at
`ota-tv.vidaahub.com` / `upgrade-plc-tv-eu.vidaahub.com`, and both resolve to
**`131.189.69.51`** (no AAAA) — the same CDN IP as the 55E7QTUK freeze. The
store's own traffic is elsewhere: `appstore-vidaa`/`odinstore-vidaa` are on
CloudFront and auth/file-ul on `131.189.128.123`, so an `OUTPUT REJECT` for
`131.189.69.51` cuts only the upgrade lane. Applied by `boot.sh ota`
(idempotent `iptables -C || -I OUTPUT 1 … -j REJECT`), re-run every 30 s from
`svc.sh`, same pattern as `fw()`. `/OAD` was not touched; resolution of the
host still works, only the connection is refused. The REJECT was verified
present after the 23:24 cold boot (boot lane `ota()` re-applies it).

The store host `/var/local/vidaapp-native-store` (installed from the store
itself on 2026-11-13, together with Moonlight) keeps running: it was alive two
minutes after our 23:01 cold boot (pid 21161, uid 0, PPid 1) **without** the
ALPAC boot branch (no `runtime/<boot_id>` dir for that boot) — so app
downloads do not depend on the vendor agent we disarmed.

## 13 — Lane 3 works, but the active channel is CHB, and there is no SSH

The operationui package is dual-channel and `current -> CHB` (no `CHA`
directory exists at all): the live launcher bundle is
`/APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js` (323 476 B,
owner `305:909`, mode `0640`). Everything else matches the 50U7DSE profile:
SystemUI engine, `/opt/hisenseUI/startgui.sh` (its own `pidof` guard),
`secure_exec`, cobalt cache `compiled_js`/`uncompiled_js` owned `311:311`.
The 50u7dse switch script needed exactly three edits: the CHB path, this
unit's stock md5, and the transport — `native-install.cjs` drives it over
SSH, which this TV does not have, so `tools/65a85q/native_install.py` drives
the identical flow over the tvsh lane (gzip+base64 upload with md5 gates,
detached switch, `switch.done` polling).

The full stack came through the 23:24 cold boot green: boot lane, firewall,
OTA freeze, and the launcher — SystemUI was started by the vendor boot chain
directly on the candidate (no switch-script launch), which is the cleanest
proof that the swap is a normal state of the TV, not something we hold up.

Two rshell-lane notes for anyone pulling bundles through it: a raw
`base64` stream of a 323 KB file truncated non-deterministically twice
(307 KB / 224 KB, no marker) — **gzip the payload first** (~98 KB base64
went through in one shot, md5-verified); and the standalone binaries missing
from PATH elsewhere (`tail`, `tr`, `head`) do exist in `/bin` — the switch
script's `/bin/*` calls all resolve.



