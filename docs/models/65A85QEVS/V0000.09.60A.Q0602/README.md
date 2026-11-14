# 65A85QEVS / V0000.09.60A.Q0602 — root via superwatch IPK + PFM lane (MTK9618, EU_A/CZE)

**Status:** root achieved on 2026-11-13 and **boot-persistent by design**; the
cold-boot leg is validated by replaying `pfm-manager.sh` by hand (payload runs
as uid 0, the vendor script wipes the gate, the repair loop restores it) but a
real power cycle was not performed yet. Pairing was not used (no client cert on
this host) and the browser self-install lane is closed by the `503 appconfig`
identity gate, so the chain is the **FaaS fetcher → superwatch 83/82 → IPK
postinst** family already confirmed on `55E75LEVS`/09.61B and
`50U7DSE`/09.62N.

> **Applies to `65A85QEVS` (internal `65A8QE`, serial `65A8QE`; SoC MTK9618;
> aarch64 kernel 5.4.302 with 32-bit ARM userland — Node reports
> `process.arch=arm`; VIDAA `U09.60`; region `EU_A`, country `CZE`, Czech
> Republic; a personal unit set to a non-default friendly name) running
> `V0000.09.60A.Q0602`.** Factory baseline in
> `critical.ini` is `V0000.08.52A.P0409`; `ModelInfo.ini` reports the current
> `V0000.09.60A.Q0602`. This pair is not in the inventory before this entry;
> the same build may ship on other MTK9618 units, none were tested.

> **Owner-run, own TV only.** No key material or vendor bundle is published
> with this guide; the payloads stay in the owner's tree.

## What the chain rests on

1. **Network surface is minimal.** Only TCP `36669` (RemoteNow MQTT) and
   `7000` (AirPlay) answer; SSDP is silent, so the fingerprint came from
   `/APPS/ModelInfo.ini` and `critical.ini` once a shell existed.
2. **`hiutils.fileRead` traverses with a one-element array path.**
   `["../proc/uptime"]` → `ret:true`; a bare string is rejected. Read-only
   probe, no writes.
3. **The browser `fileWrite` is gated.**
   `HiUtils_createRequest` returns `ret:false, code:503 "client request
   permission check error, please check appconfig"`. `WebSDK_createFileRequest`
   does not exist on this build.
4. **The FaaS fetcher is the write primitive — but it does not `mkdir`.**
   `vowOS.service.syncExecute("basic/fetcher", {api:"fetchFile", args:…})`
   downloads as uid 314 and returns `ret:true "download finished"`, yet a
   nested target fails with `download failed: ENOENT … open
   '/var/local/alvidaa_t/a/b/marker.txt'`. That kills the "plant
   `PFMCheck` with the fetcher" shortcut: `fetchFile` cannot create
   `/var/local/pfmParse/Data/`.
5. **Superwatch 83/82 → uid-0 postinst.** The `basic/fetch` FaaS function is
   present (`/function/basic/fetch/sw2` → 200) and `sw2.js` speaks
   `4-byte LE length + payload` to `/var/run/superwatch_socket`:
   `"90:83:90;re.installer"` (uninstall) then
   `"91:82:91;/APPS/installer.ipk;re.installer;"` (install). The same ids as
   55E75LEVS; `Architecture:` must be `mtk9618`.
6. **The PFM lane is the boot hook.** `/var/local/DebugPowerup` makes
   `start-kilby.sh` call `pfmDebug()`, which runs
   `bash /usr/local/scripts/pfm-manager.sh &` whenever
   `/var/local/pfmParse/PFMCheck` exists. `pfm-manager.sh` **eval's every
   line of `PFMCheck` and `Data/platform.txt` as uid 0**, and only afterwards
   checks `runCount >= runMaxCount`, which wipes `/var/local/pfmParse` and
   `DebugPowerup`. So the payload must re-plant itself — see below.
7. **No binary is needed for the shell.** There is no `dropbear`, `sshd`,
   `nc`, `socat`, `wget`, `curl`, `nohup` or `setsid` on this build, and
   busybox has **no `nc` applet**. What exists is the vendor Node runtime
   (`/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix`, Node 20.19.4) which
   runs as uid 0; the root channel is a Node TCP server on `:8008` that spawns
   `/bin/sh` per connection.

## What was measured

| Claim | Evidence | Source |
| --- | --- | --- |
| Fingerprint | `ModelInfo.ini` `SwVersion=V0000.09.60A.Q0602`, `SocModel=MTK9618`; `critical.ini` `[Hardware] ChipVersion=MTK9618`, `[Market] RegionStr=EU_A` | live |
| Kernel / userland | `uname -a` → `Linux 5.4.302 aarch64`; `process.arch` → `arm` | live |
| Read traversal | `["../proc/uptime"]` → `ret:true` | live |
| `fileWrite` gated | `503 appconfig` | live |
| `fetchFile` writes, no `mkdir` | `ret:true "download finished"`; nested path → `ENOENT` | live |
| FaaS `sw2` route | `/function/basic/fetch/sw2` → HTTP 200 JSON | live |
| Superwatch ids accepted | `83` then `82` returned 200; opkg ran `--force-reinstall install /APPS/installer.ipk` | live |
| `postinst` is uid 0 | installer log: `uid=0(root)`, `Uid: 0 0 0 0`, `CapEff: 0000003fffffffff` | live |
| `postinst` environment | `id`, `uname` missing from PATH; `busybox=/usr/local/bin/busybox`, `bash=/bin/bash`, everything else `none` | live |
| PFM payload runs as root | `pfm-manager.sh` → `alvidaa payload ran … uid=0`, `proof.txt` | live (manual replay) |
| PFM wipe + self-repair | after the eval the script removed `pfmParse` + `DebugPowerup`; `svc.sh` restored both within 30 s | live (manual replay) |
| Root shell on `:8008` | `grep :1F48 /proc/net/tcp` → LISTEN, uid 0; `python tools/tvsh.py "…"` from the LAN host returns uid-0 output | live |
| Cold boot restores the lane | reboot 1 (`7ea9bdaa…`): `boot.log` `22:05:38 payload uid=0`, `22:06:05 listen8008=1` — service up, firewall gone (see 11). Reboot 2 after the `fw()` fix (`32a81ac0…`): `fw8008=1 listen8008=1`, LAN `tvsh` → `uid=0` ~35 s after reboot, no page, no manual step | live |
| Firewall is RAM-only | right after that boot `:8008` was closed from the LAN while node was listening; re-running the postinst's two `ACCEPT`s restored it. Fixed: `boot.sh fw` at start + every 30 s in `svc.sh` | live |
| OTA freeze active | `iptables -S OUTPUT` → `REJECT 131.189.69.51` at the head, re-applied at boot (`boot.sh ota`) | live (post cold boot) |
| Lane-3 survives cold boot | reboot 3 (`0a7fc8c6…`): SystemUI up on the candidate via the vendor boot chain (uid 311), app.js md5 = candidate, root shell back ~30 s | live |
| OTA already off | `/OAD/AppUpgradeSwitch.json` `upgradeFlag 0` (signed), `/var/local/nightupdate.ini` all `0` | live |

## Chain summary (the commands, not the payloads)

```text
TV Browser page (launcher/probes/08-ipk.html)
  └─ fetchFile writes sw2.js + installer.ipk (uid 314, no mkdir needed)
       └─ superwatch 83 (uninstall) + 82 (install)
            └─ opkg postinst uid 0 (CapEff 0000003fffffffff)
                 ├─ proof / recon → /var/local/alvidaa
                 ├─ firewall: ACCEPT 8008 + 2222 at the head of INPUT and
                 │  FIREWALL_IN_EULAON (re-applied at boot by boot.sh fw —
                 │  iptables is RAM-only)
                 ├─ PFM gate: /var/local/pfmParse/PFMCheck + Data/platform.txt
                 │  + /var/local/DebugPowerup   → root at every boot
                 └─ shell service: node rshell on :8008 (tools/65a85q)
                      └─ svc.sh repairs the gate every 30 s, so the wipe in
                         pfmAutorun cannot disarm the lane
```

The kit is [tools/65a85q](../../../../tools/65a85q/README.md): `boot.sh`
(single source of truth for the PFM payload), `svc.sh`, `rshell.sh`,
`rshell.js`, `phonehome.sh`, `alive.sh`. The IPK builder is
`tools/tv_ipk.py` with `tools/alvidaa_ipk/postinst.sh`; the page is
[launcher/probes/08-ipk.html](../../../../launcher/probes/08-ipk.html);
the shell client is `tools/tvsh.py`.

## Behaviour of the vendor store agent (`alpac-agent` v3)

The unit ships a persistent root agent under `/var/local/alpac-agent`
(`supervisor.sh`, `boot-hook.sh`, `boot-trigger`, `agent.json`). It re-arms
`/var/local/DebugPFM_Ctrl` and `/var/local/DebugPowerup` only while both still
match its own copies (`owned_rearm`, `same_file`). Because the PFM gate exists,
`pfmDebug()` takes the PFM branch and the agent's `DebugPFM_Ctrl` branch never
runs, so **the store agent does not start at boot while our lane is armed**.
The trigger file keeps its original 26-byte content (`ALPAC persistent agent
v3`) because the payload only `touch`es it, which keeps `owned_rearm` quiet.

## OTA freeze (network level)

`/OAD` is never touched. The freeze is the 55E7QTUK recipe against this
unit's own domain map (`/APPS/domain/domain_list.json`):
`ota-tv.vidaahub.com` and `upgrade-plc-tv-eu.vidaahub.com` both resolve to
`131.189.69.51` (no AAAA), so `boot.sh ota` (and `svc.sh` every 30 s) keeps

```sh
iptables -I OUTPUT 1 -d 131.189.69.51 -j REJECT
```

at the head of `OUTPUT`. The store's own APIs are elsewhere
(`appstore-vidaa`/`odinstore-vidaa` on CloudFront, auth on
`131.189.128.123`), so app downloads keep working; the store host
(`/var/local/vidaapp-native-store`) runs normally and is deliberately left
alone. Resolution still succeeds — only the connection is refused.

## Lane-3 native Home (Free My TV)

Active channel is **CHB** (`current -> CHB`; no CHA exists on this build):
`/APPS/pkgs/tv.vidaa.app.operationui/CHB/apps/launcher/js/app.js`, owner
`305:909`, mode `0640`, same SystemUI engine, `secure_exec` and cobalt
JS-cache layout as 50U7DSE. The port is:

- `tools/launcher-host/models.json` → `65a85qevs` profile (CHB path, pinned
  stock md5 `456260…` / sha256 `5c9e0aea…`)
- `tools/launcher-host/switch-home-65a85qevs.sh` — the 50u7dse switch with
  the CHB path and this unit's stock md5
- `tools/65a85q/native_install.py` — the installer flow of
  `native-install.cjs` over the **tvsh** lane (no SSH on this TV):
  `bootstrap` (verify live stock, once-only backup, switch script), `dry`
  gate (stock-only SystemUI restart — passed: old 2146 → new 16275),
  `install` (candidate from the `free-my-tv-75u8qtuk` variant, built against
  this unit's stock sha256), `rollback`, `status`
- No bridge watcher exists on this unit, so there is nothing to disable
  (`--no-watcher` is the default state here)

Cold-boot leg verified 2026-11-13 23:24 (`boot_id 0a7fc8c6…`): SystemUI came
up on the candidate through the **vendor boot chain** (pid 2366, uid 311 — no
switch-script launch involved), app.js md5 still the candidate's, root shell
back ~30 s after reboot.

## Teardown

Every step is reversible; the rootfs (squashfs, dm-verity) is never written.

```sh
# 1. launcher lane (stock app.js + JS cache back)
python tools/65a85q/native_install.py rollback
# 2. shell service
/usr/local/bin/busybox pkill -f /var/local/alvidaa/
# 3. boot lane
rm -rf /var/local/pfmParse /var/local/alvidaa /var/local/DebugPowerup
# 4. firewall + OTA freeze
for P in 8008 2222; do
  iptables -D INPUT -p tcp --dport $P -j ACCEPT 2>/dev/null
  iptables -D FIREWALL_IN_EULAON -p tcp --dport $P -j ACCEPT 2>/dev/null
done
iptables -D OUTPUT -d 131.189.69.51 -j REJECT 2>/dev/null
# 5. package + dropped files
opkg remove re.installer 2>/dev/null
rm -f /APPS/installer.ipk /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/sw2.js
```

Without the PFM gate the stock `DebugPFM_Ctrl` branch takes over again at the
next boot, which is exactly the vendor behaviour.

## Open items

- Pairing / `tokens.json` (no client cert on the host) — lane 1 not
  exercised; lane 3 replaces it on this unit.
- Key-only Dropbear on `:8008` via the armhf kit in `tools/ur9s` (userland is
  32-bit ARM, so the static ARMv7 build fits) — not done; the Node service
  covers the need today.

## Cross-reference

- Sibling chains: [55E75LEVS / 09.61B](../../../research/TESTED-MODELS.md),
  [50U7DSE / 09.62N](../../50U7DSE/V0000.09.62N.Q0923/README.md).
- Deltas and traps on this build: [FINDINGS.md](FINDINGS.md).
- Method catalogue: [EXPLOITS.md](../../../research/EXPLOITS.md).
