# 55E7QTUK / V0000.09.09D.P1001 — launcher verified; root achieved via the superwatch chain (MTK9603, UK)

**Status:** Fingerprint, RemoteNow pairing, the full launcher lane, and
recon v1–v4 verified 2026-11-08 (own TV). Phase-3 started the same day: the
`otaTest` hook is written and verified on disk and `rc.local` runs at every
cold boot, **but the vendor SELinux blocks executing it pre-root** — the
boot chain enforces (never permissive) where the 09.01 reference builds
held `setenforce 0`. The superwatch chain then fired (owner-authorized): session root
(`Uid 0`, `CapEff 000001ffffffffff`) via keys-only dropbear 2026.94 on
8008, OTA freeze first in the postinst. Boot persistence armed the same
day and cold-boot verified (findings 06); teardown in findings/05 and 06.
> **Applies to `55E7QTUK` (internal `55E70QEVS_0002`, serial type `55E7QE`,
> MTK9603, VIDAA `U09.09`, region EU_A / GBR) running `V0000.09.09D.P1001`.**
> Same `09.09` OS branch as the 55A7KAU guide (`V0000.09.09O.P1015`, MTK9602,
> AU) but a different P-code letter and a different SoC. The hiutils
> `websdk/Appinfo.json` write gate compares as opened here vs closed on the
> 43A5LE (same SoC, `U09.60A.Q0707`) — see
> [findings/01](findings/01-launcher-install.md).

> **Contributed by [@damiennnnn](https://github.com/damiennnnn).**
> The record is the contributor's own unit (2026-11-08, same day as the
> work): fingerprint through boot-persistent root, the ad-block deployment
> and every teardown were carried out and published by the owner of the TV.

## What was measured

| Claim | Evidence | Label |
| --- | --- | --- |
| `transport_protocol=3290` | SSDP `:18400` renderer faceData | verified |
| Firmware `V0000.09.09D.P1001`, chip `MTK9603` | `Hisense_GetFirmWareVersion()` / `Hisense_GetChipSetName()` + UA (`Model/VIDAA-MTK9603 ... MTK9603/V0000.09.09D.P1001`) | verified |
| Broker pins the client-cert CA at TLS | self-signed stub → `tlsv1 alert unknown CA`; genuine `VidaaAppAndroidV01` completes | verified |
| Modern profile + colon-formatted `macWifi` pairs | PIN → `{"result":1}` → 2-day token | verified |
| Wrong MAC (12-hex or colon-formatted ethernet) is `rc=135` on all four profiles | pair.py logs, 2026-11-08 | verified |
| LAN surface = `:3366` stub + `:18400` blob + `:36669` MQTT; legacy `:1195` dead | curated port sweep | verified |
| Page-load lane (`/api/open`) works for recon pages | `fingerprint.html` + `identity.html` POSTed `/api/recon` | verified |
| hiutils `fileRead` mode 6 works, `msg` is shape-polymorphic (`{errno:-2, code:"ENOENT"}` object for missing paths) | `selfinstall.html` pre/post record | verified |
| `fileWrite` mode 6 to `websdk/Appinfo.json` — **open on this branch** | `ret:true "success"`; the 43A5LE `503` gate does not apply | verified |
| Launcher self-install → restart → tile in MQTT applist (52→53) → launcher canvas renders | `selfinstall.html` + WS snapshot + owner confirmation | verified |
| Bridge surface: 75 `Hisense_*` fns + `HiUtils_createRequest` only, no `WebSDK_*` | `recon-e7qtuk.html` v1 sweep | verified |
| Sandbox base `/APPS/` leaked by failed reads (full path in errno object); absolute paths join (`/APPS//etc/passwd`) | `recon-e7qtuk.html` v2 | verified |
| Single `../` escapes the base to `/`; extra `../` clamps; dirs `EISDIR` | `../etc/passwd` read returning real contents | verified |
| v3 dumps: mounts/inittab/passwd/rcS/profile shapes (partition layout p5/p27/p54/p55/p49-family; `wifitest uid 0`; SELinux labels; `SYS_VERSION=Debug`) | `recon-e7qtuk.html` v3 + `/tmp` bodies | verified |
| **`/etc/rc.d/rc.local` exists with the otaTest-hook stanza; `/etc/rc.local` absent** | micro-probe at the rcS-referenced paths | verified |
| `/var/local/otaTest.sh` absent (hook lane free); `/APPS/euladpp/current/versionInfo.json` absent (lane unchecked on this branch — [07](findings/07-os-map-alternate-avenues.md)) | micro-probe + root re-read | verified |
| Device resolver: dnsmasq 2.91 static armv7 over loopback, `address=` block on the adsfw families, lane W (`/etc/resolv.conf` symlink → rw `/var/local/etc`), NXDOMAIN verified | postinst stage (re.installer 1.0.4) + `nslookup` probes, 2026-11-09 (findings [09](findings/09-device-dns-resolver.md)) | verified |
| Boot re-arm after forced reboot: serviceList service loads but never starts (`boot_marker` ENOENT), otaTest hook exec blocked, superwatch 53/54 replies 0 with no install; `reboot -f` darkens the network stack | page-lane diagnostic reads + installer_log mtimes, 2026-11-09 | verified |
| v4 wire: `POST localhost:9009/service/hiutils` `{"api","args"}`; phoenix binary under `/APPS`, script `jsservice.basic/phoenix.server.js` | XHR prototype patch + stir | verified |
| Page host: uid/gid 314, groups with **616 + 713**, `CapEff 0` | `../proc/self/{cmdline,status}` | verified |


## What this guide includes and leaves out

Includes: the fingerprint, the pairing recipe and its matrix, the launcher
self-install and its rollback, the recon ladder (v1–v4) with the bridge
and traversal measurements, the SELinux pre-root blocker family-divergence
finding, the superwatch/IPK root chain as executed on this unit (wire,
ids, gauntlet), the boot-persistence deployment with its cold-boot
evidence, and teardown paths for both the root and persistence layers.

Leaves out: private keys, tokens, serials, MACs, Device IDs, vendor
binaries and working payload artefacts (the IPK builder is source-only;
binaries must be assembled per the published recipe); the service function
`require` cache and the community-wall details of `opkg` beyond what the
root documents; the launcher's second-lane (Pi) port; any claim that the
root persists beyond the teardown state described here.

## Where to go next

[findings/00](findings/00-fingerprint.md) — pairing; [01](findings/01-launcher-install.md)
— launcher self-install; [02](findings/02-recon-ladder.md) — bridge/traversal;
[03](findings/03-recon-v3-v4.md) — dumps/wire/self-proc;
[04](findings/04-selinux-and-hook.md) — the SELinux-imposed hook-blocker
family divergence; [05](findings/05-root-ssh.md) — the root chain, its
gauntlet (kernel arch, multiuser flag, `-D` dir semantics, firewall
chain), the protocol framing per id, and the flashback teardown;
[06](findings/06-boot-persistence.md) — the cold-boot re-arm and its
verifier evidence; [07](findings/07-os-map-alternate-avenues.md) — the
post-root OS identity map, the alternate root avenues, and the euladpp
lane-absence record; [08](findings/08-ad-removal.md) — the adsfw
ad/telemetry block, boot-native on every cold boot;
[09](findings/09-device-dns-resolver.md) — the dnsmasq device resolver
(lane W, NXDOMAIN on the ad families), the deploy recipe, and the
same-day boot re-arm failure states (serviceList silent, hook
exec-blocked, superwatch silent, bad reboot recipe) with the recovery
playbook.

Root re-arms at every cold boot through the `re_sshd` serviceList
autostart (the 75U8QTUK route, owner mains-cycle verified), and the
adsfw ad/telemetry block rides the same boot-timed postinst. The
launcher tile stays functional; the server-side `selfinstall.html`
remains the reversible landing point.
