# 65A51HEVS / V0000.09.09C.P0930 — root with a credentialed shell and a Node home bridge (MTK9602, EU_A)

**Status:** root, boot-persistent services and a custom home screen are verified on
one owned 65A51HEVS unit (2026-11-21/22). Paths that were only read, not written,
are labelled below. Nothing on the vendor partitions was modified.

> **Applies to `65A51HEVS` (serial type `65A5HE`, retail family 65A6K), board
> `MT168B-20AT`, MTK9602, VIDAA 9.0, region `EU_A`, running `V0000.09.09C.P0930`.**
> The firmware string is the same one reported for the 43A6K; the chain below was
> not tested on a 43A6K and the 43A6K report does not cover a Node bridge or a
> home takeover. The A51H siblings listed in `models.ini` (50A51HEVS_0002,
> 55A51HEVS_0002) were not tested.

> **Contributed by [@RaYVen1337](https://github.com/RaYVen1337).** Own device,
> read-only reconnaissance first, then the write steps described here. All
> secrets (password, certificates, tokens, MAC, LAN addresses) are omitted.

## What the chain rests on

1. **The stock OTA self-test hook is live.** `/etc/rc.d/rc.local` contains the
   stock block that `chmod +x` and executes `/var/local/otaTest.sh` in the
   background as uid 0. `/var/local` is a plain ext4 partition (p39) with no
   dm-verity, so the hook file can be replaced without touching a verified
   partition.
2. **The browser file bridge can write there.** The same bridge documented for
   this firmware family writes text files with mode base 6, including
   `../var/local/otaTest.sh`. This unit used exactly that route.
3. **The build ships a full Node 20 runtime.** `/opt/pkgs/tv.vidaa.app.phoenix/bin/phoenix`
   reports Node `20.9.0` on `armv7l`, so the persistent services are JavaScript
   and need no cross-compiled binary.
4. **Verified boot stays green because nothing verified is written.** The root and
   the seven dm-verity devices are read-only; the only writes are in `/var/local`
   and (for the home page) `/APPS`.

## What was measured

| Claim | Evidence | Source |
| --- | --- | --- |
| Hook runs as root at boot | `uid=0(root) gid=0(root)`, SELinux context `unconfined_process` in the hook's log | verified |
| Persistence across a real cold boot | `reboot -f` → set powered off → owner pressed Power; uptime reset, all three services listening again, no browser console opened | verified (2026-11-22) |
| Node runtime | `phoenix` binary prints `Node.js v20.9.0`; `--check` used for every deployed script | verified |
| Credentialed root shell on the LAN only | TLS listener with password from a root-owned file; iptables allows only the owner's PC address and drops the rest | verified |
| Home screen can be replaced without root-side hacks | MQTT `launchapp` opens the local page; the stock home returns on HOME and the watcher re-opens it | verified |
| Native app start needs `appId` | without it the state reports `appId:"-1"` and Netflix shows error 105; with `appId:"1"` it runs | verified (see [research/12](../../../research/12-native-app-launch.md)) |
| Partition map and verity state | `/proc/partitions`, `/proc/mounts`, `dm-*/slaves`, `/proc/cmdline` | verified (read-only) |
| Unused second root image | p19 mounts read-only as a 29 MB squashfs root; the running root is p20 | verified (read-only) |

## Partition and verity map (this build)

| Device | Size | Mount / role | Protection |
| --- | --- | --- | --- |
| p20 | 36 MB | `dm-0` → `/` (squashfs) | dm-verity, `restart_on_corruption` |
| p24 | 130 MB | `dm-1` → `/3rd` | dm-verity |
| p22 | 120 MB | `dm-2` → `/vendor/lib` | dm-verity |
| p23 | 95 MB | `dm-3` → `/application` | dm-verity |
| p38 | 650 MB | `dm-4` → `/opt` | dm-verity |
| p21 | 40 MB | `dm-5` → `/vendor/lib/utopia` | dm-verity |
| p37 | 240 MB | `dm-6` → `/usr/local` | dm-verity |
| p19 | 36 MB | unused second squashfs root | none (not mounted by stock) |
| p17, p26–p28, p33–p36, p39–p42 | — | `/certificate`, `/config`, `/data`, `/cache`, `/hidata/*`, `/var/tvservice`, `/var/local`, `/serialdata`, `/APPS`, `/OAD` | plain ext4 |

`/proc/cmdline` on this unit carries `androidboot.veritymode=enforcing`,
`androidboot.verifiedbootstate=green` and a `verity … restart_on_corruption` dm
table. **Anything inside the seven verity devices must be treated as
read-only.** The only safe write targets for modding are `/var/local`, `/APPS`,
`/data`, `/cache`, `/OAD` and `/certificate`.

`/etc` is part of the read-only rootfs here; the sibling report that `/etc` is a
writable second data mount does not reproduce on this unit.

## What the boot hook starts

`/var/local/otaTest.sh` (uid 0, started by `rc.local`) does three things, each
under a small supervisor loop so a crash is recovered within seconds:

1. a LAN-restricted `nc` shell as a fallback,
2. a TLS shell that asks for a password stored in a root-owned file,
3. a Node bridge on `127.0.0.1:8770` that serves the home page and speaks MQTT
   to the TV's own broker (see the research note on `appId`).

Both listeners are restricted with iptables to the owner's PC; all other
addresses are dropped. The bridge binds loopback only.

The hook also re-arms the firewall rules on a 20 s loop, because iptables state
does not survive a reboot.

## Teardown

1. Empty or remove `/var/local/otaTest.sh` (the stock `rc.local` then finds
   nothing to run) and delete the service directory under `/var/local`.
2. Remove the iptables chains/rules the hook installed.
3. Restore the previous home page from the backup directory the deploy script
   keeps next to `/var/local/.../launcher` (the stock launcher tree was copied
   before it was replaced).
4. No vendor partition and no verified image was written, so nothing else needs
   to be undone for the TV to boot stock again.

## Open items

- Is the home really the web module `launcher`, or does `dockui`
  (`/3rd/bin/launcher.bin`, present in `/basic/am_config`, not running) take over
  on some paths? Not tested.
- The `app_man` FIFO (`/tmp/fifo_am_read|write`) exposes commands such as
  `GETINFO`, `CHANGESET`, `REQUESTTO`, `ON_KEY`. The wire format is not decoded.
- Cobalt is started with `--remote_debugging_port=9666 --webdriver_port=4445`, but
  neither port listens on this build. Whether the inspector can be enabled by a
  config/env switch is open.

## Cross-reference

- Related guides: [43A6K / V0000.09.09C.P0930](../../43A6K/V0000.09.09C.P0930/README.md)
  (same firmware string, SSH lane)
- Native app launch and state semantics: [research/12](../../../research/12-native-app-launch.md)
- Home module contract: [launcher/MODULE-HOOK.md](../../../launcher/MODULE-HOOK.md)
- Method catalogue: [EXPLOITS.md](../../../research/EXPLOITS.md)
- Publication policy: [DISCLOSURE.md](../../../DISCLOSURE.md)
