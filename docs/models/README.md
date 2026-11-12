# Model and firmware guides

This directory holds **model- and firmware-specific** root and modding guides.
A guide is published only for the exact model *and* firmware string it was
recorded on. Cross-model material lives in `docs/research/`.

- [43A5FE / MTK9602 guide](43A5FE/V0010.09.09A.P0930/README.md)
- [50A51HUV / MTK9602 guide](50A51HUV/09.01O.P0813/README.md)
- [50A51HUV findings](50A51HUV/09.01O.P0813/FINDINGS.md)
- [method inventory](../research/EXPLOITS.md)
- [inventory](../research/inventory.json)

## Which guide applies to my TV?

Only the one whose **model and firmware both match**. Check the firmware string
in the TV's system information and compare it character by character.

| Model | Firmware | SoC class | Result | Persistence | Guides |
|---|---|---|---|---|---|
| `43A5FE` | `V0010.09.09A.P0930` (VIDAA `U07.51`, SDK 6.1.2) | MediaTek MTK9602 | root via browser path traversal + `otaTest.sh` boot hook; native Node v20; native UI debloat | `rc.local` hook, observed across cold reboots | [README](43A5FE/V0010.09.09A.P0930/README.md) |
| `50A51HUV` | `09.01O.P0813` (VIDAA `U09.01`, US/CAN) | MediaTek MTK9602 | root via browser `../` traversal + `otaTest.sh` boot hook; key-only SSH | `rc.local` hook, observed across boot | [README](50A51HUV/09.01O.P0813/README.md) · [FINDINGS](50A51HUV/09.01O.P0813/FINDINGS.md) |
| `50C350LS` (Toshiba OEM, `brand=tos`) | `V0000.09.09M.P1124` (VIDAA `U09.09`, SA/Brazil) | MediaTek MTK9602 | root via superwatch FaaS family (same as `09.09O` / `09.09D`); pairing requires `brand=tos`; fetcher is a service | **none automatic**; manual re-arm; not tested across reboot | [README](50C350LS/V0000.09.09M.P1124/README.md) |
| `HE40E5600FFWTS` | `V0100.01.00A.N0410` | MediaTek MT53xx / MT5863 class, ARMv7 Cortex-A53 | root via browser + loader shadow; key-only Dropbear SSH on 22; PTY | `HamService` wrapper; owner-verified across reboots (2026-11-04) | [README](HE40E5600FFWTS/V0100.01.00A.N0410/README.md) · [EVIDENCE](HE40E5600FFWTS/V0100.01.00A.N0410/EVIDENCE.md) · [MODDING](HE40E5600FFWTS/V0100.01.00A.N0410/MODDING.md) |
| `100U7Q` (`100U70QEVS`) | `V0000.09.60I.Q0813` (VIDAA `U09.60`, EU_A) | MediaTek MT9655, 32-bit ARM userland | root via `fetcher` write + package `postinst`; key-only root SSH on 8008; PTY | **none automatic**; re-arm with uninstall `83` + install `82` after each reboot | [README](100U7Q/V0000.09.60I.Q0813/README.md) · [EVIDENCE](100U7Q/V0000.09.60I.Q0813/EVIDENCE.md) · [MODDING](100U7Q/V0000.09.60I.Q0813/MODDING.md) |
| `75UR9S` | `V0000.09.60W.Q0624` (VIDAA `U09.0`, EU — Czech Republic) | MediaTek MT9655, 32-bit ARM userland | same chain as 100U7Q on the `09.60W` build; key-only root SSH on 8008; PTY | **boot-persistent** (verified 2026-11-06): `re_sshd` serviceList autostart service re-arms dropbear via the superwatch trigger at every cold boot | [README](75UR9S/V0000.09.60W.Q0624/README.md) |
| `43Q60SEVS` (`43E7DS`, serial type `43E7SE`) | `V0000.09.60W.Q0612` (VIDAA `U09.60`, EU_A) | MediaTek MTK9603 | root via the same fetcher write + package `postinst`; no Dropbear on this build | **vendor service manager** (`serviceList.json` entry + two-file service) | [README](43Q60SEVS/V0000.09.60W.Q0612/README.md) |
| `43A5LE` (internal `43A60LEVS_0002`) | `V0000.09.60A.Q0707` (VIDAA `U09.60`, EU_A/ITA) | MediaTek MTK9603 | launcher only: pairing, page/WS, and home-watcher bounce verified; native `Appinfo.json` self-install blocked at `fileWrite` 503; root not attempted | external server (Lane 1); TV unchanged | [README](43A5LE/V0000.09.60A.Q0707/README.md) |
| `50A6Q` (`50A60QXVT`) | `V0000.09.61B.Q0721` (VIDAA `U09.61`, UAE/intl) | Novatek NT72690, aarch64 kernel + armhf userland | root via the vendor PFM debug framework (`DebugPowerup` gate → `pfm-manager.sh` evals `PFMCheck` lines as root); key-only Dropbear SSH on 2222 | **boot-persistent + self-healing** (10 s re-plant loop, 15 s firewall-strip loop) | [README](50A6Q/V0000.09.61B.Q0721/README.md) · [FINDINGS](50A6Q/V0000.09.61B.Q0721/FINDINGS.md) |
| `65U8HAU` (`65E83GAVT`, serial type `65U8H` / intl `65U8HQ`) | `V0000.06.29X.P0813` (VIDAA `U06.29`, AU / `EM_C` / `AUS`) | MediaTek MTK9900 (`aarch64`) | MQTT pairing + actions (`state`, `sourcelist`, `applist`, `launchapp`), launcher web UI + WS, and `WebSDK_*` / `Hisense_Get*` bridge surface verified; `/file/*` and `/hiSecurity/*` gated on LAN HTTP origins | n/a (launcher lane active; server-side `config.json` registration fallback) | [README](65U8HAU/V0000.06.29X.P0813/README.md) · [EVIDENCE](65U8HAU/V0000.06.29X.P0813/EVIDENCE.md) · [MODDING](65U8HAU/V0000.06.29X.P0813/MODDING.md) |
| `55A7KAU` (`55U66GAVT`) | `V0000.09.09O.P1015` (VIDAA `U09.09`, AU/AUS) | MediaTek MTK9602 | root over the superwatch chain (fetcher write → `sw2` → `ipk_install.sh`), same family as 100U7Q/75UR9S with `09.09O` constants | **boot-persistent** (`re_sshd` serviceList autostart, offline re-arm, verified 2026-11-06) | [README](55A7KAU/V0000.09.09O.P1015/README.md) · [EVIDENCE](55A7KAU/V0000.09.09O.P1015/EVIDENCE.md) · [MODDING](55A7KAU/V0000.09.09O.P1015/MODDING.md) |
| `55S7NEVS` (S7N family: 55U75LEVS / 65S7NAVS / 75S7NAVS same build) | `V0000.09.60X.Q0609` (VIDAA `U09.60`, EU) | MediaTek MTK9618 (`mt5879`), aarch64 Cortex-A72 | root via `fetcher` write + pkgmgr hook + vendor package path (same family as 100U7Q) — contributed docs-only by possibly_matt; payload not republished | **boot-persistent** (cold-boot re-fire verified 2026-11-03 on the contributor's unit; deep mirror in `/vendor/persist`) | [README](55S7NEVS/V0000.09.60X.Q0609/README.md) · [FINDINGS](55S7NEVS/V0000.09.60X.Q0609/findings/10-boot-chain.md) |
| `65U7H` (board `65A65GAVT`) | `V0000.06.29X.P0813` (VIDAA `U06.29X`, India/EM_C) | MediaTek MTK9900, aarch64 | bridge read/write verified (WebSDK file bridge, origin-gated to `vidaahub.com`, `../` traversal); MQTT pairing issues tokens but actions stay silent; **no exec door found — root not achieved (WIP)** | none — no root (WIP) | [README](65U7H/V0000.06.29X.P0813/README.md) |
| `50A7HAU` (`50A6GA`) | `V0000.06.12X.N1212` (VIDAA `U06.12`, AU) | MediaTek MTK9602, armv7l | fingerprint only, read-only recon; `transport_protocol` 3290 (newer handshake than the 3160 U6 report) | untested | [README](50A7HAU/V0000.06.12X.N1212/README.md) |
| `75U8QTUK` | `V0000.09.60I.Q0813` (VIDAA `U09.60`, UK/GBR) | MediaTek MTK9655, aarch64 kernel | [root achieved](75U8QTUK/V0000.09.60I.Q0813/README.md) — the 100U7Q fetcher → superwatch → IPK postinst chain armed (uid 0, CapEff `000001ffffffffff`), key-only SSH on 8008; native DOM Home installed and owner-verified (findings/07, /09, /10) | **verified** — the `re_sshd` service autostart re-armed SSH after a supervised reboot (uptime 84000 s → up again at uptime 16.39 s), [findings/11](75U8QTUK/V0000.09.60I.Q0813/findings/11-boot-persistence.md) | [README](75U8QTUK/V0000.09.60I.Q0813/README.md) · [EVIDENCE](75U8QTUK/V0000.09.60I.Q0813/EVIDENCE.md) · [MODDING](75U8QTUK/V0000.09.60I.Q0813/MODDING.md) |
| `32A35HUV` | `V0000.09.01O.P0814` (VIDAA `U09.01`, CAN) | MTK9602 | [root achieved](32A35HUV/V0000.09.01O.P0814/README.md) — the [50A51HUV reference chain](50A51HUV/09.01O.P0813/README.md) replayed unchanged on a second MTK9602 board: bridge traversal open, `fileWrite` of `/var/local/otaTest.sh`, proof hook logged `uid=0` at uptime ~6 s, dropbear 2025.88 key-only on 2222 | **verified** — `/etc/rc.d/rc.local` → `otaTest.sh` boot hook proven after a real power cycle (standby does not re-run `rc.local`) | [README](32A35HUV/V0000.09.01O.P0814/README.md) · [EVIDENCE](32A35HUV/V0000.09.01O.P0814/EVIDENCE.md) · [MODDING](32A35HUV/V0000.09.01O.P0814/MODDING.md) |
| `55E7QTUK` (internal `55E70QEVS_0002`, serial type `55E7QE`) | `V0000.09.09D.P1001` (VIDAA `U09.09`, UK/GBR) | MediaTek MTK9603, armv7 | **root achieved — boot-persistent** (2026-11-08, owner-authorized): launcher self-install verified; recon v1–v4; pre-root hook lane blocked by enforcing SELinux (first measured `09.09D` divergence); the superwatch chain fired instead — wire `4B-LE length+payload`, install id `53` / uninstall `54`, opkg `mtk9603`; static ARMv7 dropbear 2026.94 (own build; aarch64 ENOEXEC + MULTIUSER flag traps), keys-only `0.0.0.0:8008` with `-D authorized_keys dir`, `Uid 0` `CapEff 000001ffffffffff`; OTA freeze (DoH lane + ota CDN IP) first in the postinst, then adsfw ad block and a dnsmasq device resolver on the same boot-timed postinst | **boot-persistent** (`re_sshd` serviceList autostart, cold-boot verified 2026-11-08 via kernel sysrq; ad block + OTA freeze re-apply every cold boot). Every-boot DNS coverage has a same-day re-arm failure mode — see findings/09 for the states and the no-SSH recovery playbook | [README](55E7QTUK/V0000.09.09D.P1001/README.md) · [EVIDENCE](55E7QTUK/V0000.09.09D.P1001/EVIDENCE.md) · [MODDING](55E7QTUK/V0000.09.09D.P1001/MODDING.md) · [00](55E7QTUK/V0000.09.09D.P1001/findings/00-fingerprint.md) · [05](55E7QTUK/V0000.09.09D.P1001/findings/05-root-ssh.md) · [06](55E7QTUK/V0000.09.09D.P1001/findings/06-boot-persistence.md) · [09](55E7QTUK/V0000.09.09D.P1001/findings/09-device-dns-resolver.md)
| `43A6K` (internal `43A53FEVS_0011`) | `V0000.09.09C.P0930` (VIDAA `U09.09`, EU_A) | DevKit MTK9602, armv7l | root via native file bridge + stock `otaTest.sh` hook; password/key SSH commands and SFTP on 2222; ordinary PTY remains broken | observed across kernel restart and owner Power-on without browser re-arm; separate mains-removal test unconfirmed | [README](43A6K/V0000.09.09C.P0930/README.md) |
| `50U7DSE` (internal `50U73SEVS_01`, serial type `50U7SE`) | `V0000.09.62N.Q0923` (VIDAA `U09.62`, EU_A/DEU) | MediaTek MTK9618 (mt16587/mt5879), aarch64 kernel + armhf userland | root via `fetcher` write → superwatch 83/82 → IPK postinst uid 0; key-only static ARM32 Dropbear on 8008; native lane-3 Home (Free My TV 75U8QTUK adapter); browser self-install gated (503 appconfig) | **boot-persistent** (`re_sshd` serviceList autostart, re-arms ~30 s after each of two cold boots; native Home survives reboot byte-identically) | [README](50U7DSE/V0000.09.62N.Q0923/README.md) |

New guides start from [_TEMPLATE.md](_TEMPLATE.md), which carries the
fingerprint, the evidence labels and the required *What this guide includes
and leaves out* section.

This table is hand-maintained; the [tested-model matrix](../../README.md#tested-models)
is generated from `inventory.json` and wins if the two disagree. `scripts/check.sh`
fails if a guide exists here without a row.

These chains are **different and not interchangeable**:

| | 50A51HUV | HE40 | 100U7Q |
|---|---|---|---|
| Entry point | browser file bridge `../` | browser runs as root; file-API whitelist bypass | app-context FaaS write + privileged package socket |
| Root execution | `rc.local` `otaTest.sh` hook | shadow library `DT_INIT` in the browser | IPK `postinst` via the root package daemon |
| Boot persistence | `rc.local` hook, observed across boot | `HamService` wrapper (owner-verified) | none; manual re-arm |
| Recovery | remove the hook + reboot | `rollback.sh` + reboot | uninstall `83` + operator cleanup |

The 50A51HUV entry is the original MTK9602 record; it shares no steps with the
other two. Do not apply one model's paths to another.

**75UR9S is the same chain as 100U7Q**, not a fourth one — same entry point,
same `postinst`, same 8008 daemon. Only the FaaS package that hosts `fetch`
differs (`tv.vidaa.jsservice.basic` instead of `...system`). Read the 100U7Q
guide first, then the [75UR9S deltas](75UR9S/V0000.09.60W.Q0624/README.md).

**43Q60SEVS is the same entry point again** (fetcher write → `/function` exec →
superwatch install), on MTK9603. What differs is the exit: this build ships no
Dropbear, so persistence comes from the vendor's own service manager instead of
a shipped daemon. See the [43Q60SEVS guide](43Q60SEVS/V0000.09.60W.Q0612/README.md).

## How to read the labels

Every guide uses the same vocabulary:

| Label | Meaning |
|---|---|
| **CONFIRMED live (recorded)** | the author's record reports a device observation, usually with output or an artifact. A record claim, not an independent re-test. |
| **CONFIRMED host/build** | reproduced on a build host, not on the TV. |
| **owner-verified** | stated by the device owner after the record; no file in the record set contains the observation. |
| **documented code** | quoted device source/configuration or a build recipe. |
| **UNVERIFIED** | not tested, or explicitly open. Never a recipe. |
| **DEAD END** | tried and rejected; listed so nobody repeats it. |

The HE40 and 100U7Q pages carry an EVIDENCE.md claim matrix with a `file:line`
basis and short quotes; the 50A51HUV record uses FINDINGS.md as its lab-notebook
index. The README page carries the procedure. The MODDING page carries the
system layout and the modding surface, with its own verified/unverified table.

## Ground rules

These guides are for **hardware you own**, on your own LAN.

- **No flashing, no `.pkg`, no UART, no case opening** is the design property of
  these chains. Read-only partitions stay untouched; verified boot stays green.
- **No vendor binaries and no keys are shipped.** Payloads and SSH binaries are
  rebuilt from your own device and the documented patches. Private keys never
  leave your machine.
- **Keep a recovery path.** A root shell or command loop is the way back from a
  broken UI or boot hook. Do not close it until you are done.
- **One change at a time.** Back up every file you replace. Reboot to test.
- **Do not expose debug interfaces to the internet.** The HE40 recon server is
  unauthenticated and drives a root browser; the SSH daemons are key-only root
  access on your LAN.
- **A failed observation applies to one route and one device.** It is not proof
  that a firmware is safe in general.

See [SECURITY.md](../../SECURITY.md) for the disclosure stance and
[AGENTS.md](../../AGENTS.md) if an AI session is doing the work.

## Tools

The scripts referenced by the guides live under [tools/](../../tools/):

| Tree | Contents |
|---|---|
| [tools/he40/](../../tools/he40/) | USB prep, recon server/page, payload and Dropbear builds, TV-side deploy/verify/rollback, templates |
| [tools/u7q/](../../tools/u7q/) | pairing, installer and trigger scripts, install/trigger pages, FaaS helper |
| [tools/fw/](../../tools/fw/) | firmware inventory/map/OTA tooling (not used by the device chains) |
| [tools/tvshell.py](../../tools/tvshell.py) | generic SSH wrapper |
| [tools/deploy-overlay.sh](../../tools/deploy-overlay.sh) | launcher deployment helper |

`tools/*/bin` and `tools/*/tools/pub` are **drop points**, not binary
distributions. Build or supply your own.

## Contributing a model

Add the model to [inventory.json](../research/inventory.json) first, then report
the method result in [exploits.json](../research/exploits.json) — the generated
tables in the repository README and [EXPLOITS.md](../research/EXPLOITS.md) come
from those files. A model guide is worth writing only when the firmware string
is exact and the observations are separable from the inferences. Follow the
status vocabulary above; keep unknowns unknown.

Field definitions for a device report:
[TESTED-MODELS.md](../research/TESTED-MODELS.md).

## Attribution

The 50A51HUV / MTK9602 research and original write-up is by
[@carteakey](https://github.com/carteakey). The HE40 and 100U7Q research is by
[@oOHiyoriOo](https://github.com/oOHiyoriOo); the sanitized source notes are
included under each model's `source/` directory. The guides themselves are
original English text under the repository's MIT license — see
[LICENSE](../../LICENSE).
