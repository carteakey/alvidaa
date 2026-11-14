# 65E86GEVS / V0000.09.09O.P0930 — root over the superwatch *restore* path (MTK9618, EM_B)

**Status:** root achieved on 2026-10-24 on the owner's unit — no hardware, no
flashed partitions, verified boot untouched. The chain is a **superwatch
family** root, but a distinct one from the install-id chains documented
elsewhere (83/82, 53/54, 85): this unit lands on **command 55
`RunIpkRestoreCommand`**, whose pkg-name argument is composed into a root shell
command **without quoting**, so the name itself is executed by `/bin/sh` in the
root context. Root cause = *unquoted shell composition*, not the
postinst-as-root policy. Boot persistence is via a writable-service boot hook
(architecture level here; the hook itself is withheld. See "What this guide
includes and leaves out"). The launcher Home module (`tv.vidaa.app.operationui`)
was identified statically; the pairing/launcher lanes and a native Home were
**not** exercised on this unit.

> **Applies to `65E86GEVS` (mDNS serial type `65E8GE`; SoC MTK9618 = mt5879,
> aarch64 kernel with 32-bit ARM userland (CONFIG_COMPAT); VIDAA `U09.09`);
> region `EM_B`, firmware `V0000.09.09O.P0930`, branch
> `all-MTK9618_VIDAA_U909_EUAU_Hotfix_MP_20250915`.** This is the first
> MTK9618 row on the U09.09 branch (sibling U09.09 rows are MTK9602/9603).
> Whether the same build ships on other models is unknown; none were tested.

> **Contributed by [@noctonca](https://github.com/noctonca).** Own-device
> material: root chain live-verified on 2026-10-24; module mapping read from
> the pulled OS. Payloads, unit identifiers and a key literal are withheld
> (see below).

## What the chain rests on

Four properties of this build, in dependency order (the same shape other
superwatch guides document):

1. **Page-to-bus access.** Any page rendered by the TV browser can talk to the
   vendor's Phoenix JS bridge on `localhost:9009` (CORS `*`), and the bus's
   permission gate is bypassable two ways — an **empty `identifier`** satisfies
   the type check and is falsy, and (in the same function) identifiers are
   AES-decrypted with a **static key + zero IV**, so tokens can be minted.
   Mechanism and evidence in [findings 02](findings/02-permission-gate-bypass.md);
   the key literal is withheld.
2. **Group-616 socket reachable by the service user.** `superwatch_server`
   (uid 0) chowns its UDS `/var/run/superwatch_socket` to gid **616** on
   startup (`root:superwatch` 0660), and `phoenix` (uid 314) carries group
   616 via `/etc/group` (`superwatch:x:616:television`). The per-command
   peer-credential check accepts uid 314 by design — it *is* the package
   manager, a legitimate client of the socket.
3. **Command 55 composes a shell command unquoted.** The frame is
   `uint32le length` + `"<sessionId>:<commandId>:<args>"`. Command **55
   `RunIpkRestoreCommand`** builds a `system()`/`popen()` line from the
   caller-supplied package name with **no quoting or validation**, so a name
   containing `$( ... )` is evaluated by `/bin/sh` in the root context before
   the script ever sees it. [findings 01](findings/01-superwatch-restore-injection.md).
4. **A write primitive to get the crafted arg on the wire.** On this build the
   file bridge is **open** — `hiutils` appconfig permits `fileRead`/`fileWrite`
   (no 503), so a page can drop a payload script anywhere uid 314 can write
   (`/APPS`, `/OAD`, `/var/tvservice`, `/tmp`) and then send the two frames.
   [findings 02](findings/02-permission-gate-bypass.md).

Same superwatch *family* as [55E7QTUK](../../55E7QTUK/V0000.09.09D.P1001/README.md),
[55E75LEVS / 09.61B](../../../research/10-patched-firmware-playbook.md) and
[50U7DSE](../../50U7DSE/V0000.09.62N.Q0923/README.md), but the restore command
id and an *injection* (not policy) root cause — a datapoint their "what would
fix it" list (unauthenticated superwatch channel) directly covers.

## What was measured

| Claim | Evidence | Source |
| --- | --- | --- |
| Root shell via superwatch command 55 | **verified** | two command-55 frames with a crafted pkg name → `Uid: 314 0 0 0`; `/etc/shadow` readable; `/data` lists; files writable to `/data` | [findings 01](findings/01-superwatch-restore-injection.md) |
| Superwatch UDS reachable by uid 314 | **verified** | `/var/run/superwatch_socket` `root:superwatch` 0660 chowned to gid 616; `phoenix` uid 314 in group 616 | [findings 01](findings/01-superwatch-restore-injection.md) |
| Frame format | **verified** | `uint32le length` + `"<sid>:<cmd>:<args>"`, session 42 | [findings 01](findings/01-superwatch-restore-injection.md) |
| File bridge open (write + traversal), no 503 | **verified** | `HiUtils_createRequest` `fileRead`/`fileWrite` → `ret:true` to `/APPS`, `/OAD`, `/var/tvservice`, `/tmp`; `../` traversal read of world-readable files | [findings 02](findings/02-permission-gate-bypass.md) |
| Permission gate bypassable (empty id; forgeable token) | **verified** (mechanism) | `identifier:""` → `setDebugPort`/`getDebugPort`/`deviceCode`/`getInstalledPkgs` `ret:true`; static-key + zero-IV minting mechanics; literal withheld | [findings 02](findings/02-permission-gate-bypass.md) |
| Launcher Home = `tv.vidaa.app.operationui` | **verified** (static) | package control `AppId: launcher`; `startgui.sh` `HI_UI_OPERATIONUI`; webpack `MODULE_LAUNCHER` bundle | [findings 03](findings/03-operationui-launcher.md) |
| SoC / userland profile | **verified** | MTK9618 (mt5879); aarch64 kernel, armhf userland (CONFIG_COMPAT) | guide |
| Pairing / launcher lane / native Home | **untested** | not exercised on this unit | — |

## What this guide includes and leaves out

| Included | Left out |
| --- | --- |
| fingerprint + firmware constants | working payloads (the two-frame command strings, the boot-hook file) |
| the chain at architecture level | the exact command sequence and `tvroot.js` |
| measured evidence + teardown | key material (the hardcoded AES literal), unit identifiers (MAC, LAN IP, serial), WiFi passphrase |
| the restore-path finding as a distinct superwatch subclass | vendor binaries |

This unit is in daily owner use; the line falls where alvidaa's always does —
what a build *does* is public, what executes it on one unit is not
([DISCLOSURE.md](../../../DISCLOSURE.md)).

## Teardown

Restored to stock on 2026-10-24, all writes in writable space, nothing
AVB-verified touched:

- restore the writable-service module to stock md5 `f1dd2229e3983c76c4e06e4be79b1b8b`
  (backup copy `/OAD/pkghosting.orig.js`) and force phoenix to reload it;
- remove the `/dev/shm` setuid copy and probe files, and every `/OAD`
  experiment file;
- stop the reverse-shell loops and verify no reconnect.

**Residual:** the *vendor* defect is unchanged on the device — `superwatch_server`
still composes shell commands unquoted and the socket is still group 616.
Closing the door removed only our access. An OTA that redeploys `/opt` +
`/APPS` would remove the writable-service persistence hook (as for every hook in
this repo's guides).

## Open items

- Superwatch command ids **other than 55** (does 82/83 install or 85 exist on
  this build?) unprobed — the install-path chains were not needed here.
- The live runtime tree of `tv.vidaa.app.operationui` (location + md5 on
  `/APPS` vs `/opt`) not recorded at contribution time.
- The kilby store (settings register) internals were mapped off-device but are
  not part of this contribution.
- Pairing / launcher lanes and a native Home not exercised on this unit.

## Cross-reference

- Sibling MTK9618 chains: [50U7DSE / 09.62N](../../50U7DSE/V0000.09.62N.Q0923/README.md),
  [55E75LEVS / 09.61B (playbook row)](../../../research/10-patched-firmware-playbook.md),
  [55S7NEVS / 09.60X offline analysis](../../55S7NEVS/V0000.09.60X.Q0609/README.md).
- Same U09.09 branch: [55E7QTUK / 09.09D](../../55E7QTUK/V0000.09.09D.P1001/README.md),
  [43A6K / 09.09C.P0930](../../43A6K/V0000.09.09C.P0930/README.md).
- Method catalogue: [EXPLOITS.md](../../../research/EXPLOITS.md).
- Publication policy: [DISCLOSURE.md](../../../DISCLOSURE.md).
