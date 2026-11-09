# 75U8QTUK V0000.09.60I.Q0813 — modding notes

> **Status (2026-11-07): measured.** This page began as a speculative
> fingerprint-only scaffold. The guesses it contained have since been
> **resolved on hardware** in findings 03–11; the unverified expectations
> were removed rather than left standing next to the measured results. The
> lab notebook is [`README.md`](README.md), the claim ledger is
> [`EVIDENCE.md`](EVIDENCE.md). Historical findings files keep their original
> text with a resolution banner at the top.

## Where this fits

This unit shares the firmware build with the 100U7Q. The canonical surface
map lives on the parent guide:

- Partition / mode map, writable-by-uid-314 list, nosuid/noexec flags →
  [100U7Q MODDING.md](../../100U7Q/V0000.09.60I.Q0813/MODDING.md)
- Package tree (`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/…`) and the
  installer handoff → [100U7Q README](../../100U7Q/V0000.09.60I.Q0813/README.md)
- Boot-persistence service → [`source/re_sshd/`](source/re_sshd/), verified
  in [findings/11](findings/11-boot-persistence.md)

## Measured state (replaces the old "expected deltas")

| Item | Measured result | Source |
|---|---|---|
| Pairing | Sidee, profile `modern`; `server/pair.py` **was not run** — one MQTT server per TV | [findings/02](findings/02-pairing.md), [findings/03](findings/03-launcher.md) |
| `transport_protocol` | Not exposed over SSDP (`dd.xml` on :3366 is a 417-byte stub) | [findings/01](findings/01-ssdp.md) |
| FaaS write primitive | `basic/fetcher` `fetchFile` writes succeed; `hiutils.fileRead` traverses with an **array** path | [findings/05](findings/05-fetcher-recheck.md) |
| Superwatch socket | `/var/run/superwatch_socket` `0660 root:616`, reachable from uid 314; command `85` → `901:0` | [findings/06](findings/06-superwatch-gate.md) |
| Root SSH | Static ARM32 Dropbear 2022.83 on `0.0.0.0:8008`, key-only, uid 0 / `CapEff 000001ffffffffff`, PTY OK, `/etc/shadow` and `/data` readable | [findings/07](findings/07-root-armed.md) |
| Boot persistence | **Achieved 2026-11-07.** `re_sshd` service autostarts at every boot and re-arms 8008 via superwatch 83/82 — no browser. Verified by supervised reboot: uptime reset, marker `ARMED: dropbear up` | [findings/11](findings/11-boot-persistence.md) |
| Native Home | Component-only `/Launcher` route swap in operation-ui `app.js`; apps, inputs, TV Settings, app launch verified; merged apps+inputs list and CSS wallpapers added | [findings/09](findings/09-native-home.md), [findings/10](findings/10-native-home-customization.md) |
| Reboot survival | Native Home, merged list and wallpaper survived a reboot byte-identical; owner confirmed normal Home | [findings/11](findings/11-boot-persistence.md), [screenshot](img/native-home-after-reboot.png) |
| Verified boot | `/` and `/application` remain `erofs ro` with dm-verity; only `/APPS` and `/var/local` written | [findings/07](findings/07-root-armed.md), [findings/11](findings/11-boot-persistence.md) |

Operational facts: package ids **83 (uninstall) / 82 (install)** for
`re.installer`; OTA frozen (`upgradeFlag: "0"`, standby updates off, no
staged `/OAD/pkgs`); no vendor binaries or keys shipped in this repo.

### Still unverified (deliberately, no guesses recorded)

- The **browser/canvas launcher lane**: `launcher/hookinstall.html` +
  `hookcheck.html` tile self-install via the `WebSDK_*` file bridge. GET
  delivery of a served page into the TV browser works
  ([findings/03](findings/03-launcher.md)); the self-installing tile has
  never been exercised. The native lane above is what is actually installed.
- Cosmetic region details (PIN dialog text in `en-GB`, UK catalogue presets
  under `/var/local/kilby/categoryList/`).

Do **not** start `server/pair.py` against this TV: Sidee holds the single
paired MQTT identity, and a second server kicks it off the broker.

## Rollback

- Native Home: `switch-home.sh rollback` (see
  [findings/09](findings/09-native-home.md)).
- Boot persistence: `/bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh
  teardown` (see [findings/11](findings/11-boot-persistence.md)).
- Full root lane: [findings/07](findings/07-root-armed.md).
- Manual re-arm fallback (only needed if the hook is torn down):
  `tools/u7q/web/rearm.html` served by `tools/u7q/web/server.py`.

## What this guide does **not** do

Same posture as the parent:

- No flashing, no `.pkg` modification, no UART, no case opening, no
  bootloader change. `/` remains erofs with dm-verity enforcing.
- No vendor binaries and no keys are shipped in this repo.
- No OTA endpoints are poked. The TV browser must never see the open web
  — keep DNS blocking for `vidaa.com` / `vidaahub.com` from the pi, as in
  the main launcher setup.
- No DRM circumvention. Device ID, Netflix ESN and serial are not committed.
