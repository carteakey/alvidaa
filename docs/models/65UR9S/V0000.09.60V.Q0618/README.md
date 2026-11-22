# 65UR9S / V0000.09.60V.Q0618 — root chain (root achieved, persistence verified)

**Status: root verified and boot-persistent (2026-11-22).** The root channel
is a TCP port (`8008`) served by the vendor Node runtime, spawning a root
shell per connection — no SSH daemon exists on this build. A cold boot
re-arms it by itself, with no browser and no operator action. This file is
the live record of the work; every step below is written as it happens, with
its rollback.

> **Applies to `65UR9S` (MediaTek MTK9655, VIDAA `U09.60` — the 09.60
> generation, not read off the device; region `?`, also not read), running
> `V0000.09.60V.Q0618`, build date 2026-06-18.** The claim is narrow: one unit,
> one build, one boot cycle. The same board family ships as the 75UR9S on the
> six-days-newer `09.60W` build, which was **not** re-tested here.

> **Contributed by the unit owner** (own device, owner-authorized). The
> handle is withheld at the owner's request. The material was adapted from the
> 75UR9S guide; every delta listed below was measured on this unit.

## Scope and ground rules

- Own-TV-only, LAN-local. No DRM circumvention.
- Nothing is written to the read-only partitions; the chain stays inside
  `/APPS` (rw) and the vendor package store.
- Every step below lists its teardown. The full teardown is in
  [Teardown](#teardown).
- The boot chain stays untouched: no `erofs`/`dm-verity` partition is
  modified, no boot hook is installed, no firmware image is patched.

## What the chain rests on

The 65UR9S is the same UR9S board family as the 75UR9S, whose guide is
[../../75UR9S/V0000.09.60W.Q0624/README.md](../../75UR9S/V0000.09.60W.Q0624/README.md).
That chain is: browser page → phoenix `fetcher` FaaS write (uid 314) →
`/var/run/superwatch_socket` → root package manager → `postinst` as uid 0.

The properties of *this* build that make the result possible, in dependency
order:

1. **The phoenix host is a real CommonJS runtime, and it runs as uid 314.**
   `require('fs')`, `require('net')` and `require('child_process')` all work
   inside a FaaS module, so a module dropped into the package's
   `functions/fetch/` directory is the write-and-execute primitive.
2. **The `basic` package is the FaaS host on this build**, and it exposes a
   fetch route: `POST /function/basic/fetch/<name>` runs the module.
3. **`/var/run/superwatch_socket` is `root:616`, mode 660, and uid 314 is in
   group 616.** The daemon that owns the package path is therefore reachable
   from an unprivileged page context.
4. **The vendor package path runs a `postinst` as uid 0.**
   `ipk_install.sh <session_id> <ipk_path> <pkg_name> <options>` writes its
   result to `/tmp/ipk_install_result`, chowned to 314:314 so an unprivileged
   caller can read the outcome.
5. **The `basic` package's `serviceList.json` is a boot lane.** A service
   registered there with `autoStart` is started by the service manager at
   every boot, as uid 314 — enough to re-arm properties 3 and 4 on its own.

Deltas on this unit that were **not** assumed and have now been measured:

| Area | Why it can differ | State |
|---|---|---|
| Build letter `V` vs `W` | `09.60V.Q0612` is an MTK9603 build on other models, `09.60W.Q0624` is MTK9655 — the letter does not map to SoC | **Measured: MT9655** (`M9655V_9655EEAOM_EUKIOXIA/MT9655VD` in the vendor build path) |
| FaaS `fetch` location | moved between `tv.vidaa.jsservice.system` and `tv.vidaa.jsservice.basic` across generations | **Measured: basic package**, route `/function/basic/fetch/<name>` |
| superwatch command codes | `82`/`83` on 09.60W, `53`/`54` on the 09.09 generation | `85` answers `901:0` like the 75UR9S; `82` is validated with a bogus IPK path before use |
| Root shell binary | the repo ships no ARM binary and this host has no ARM toolchain | **Zero-compile lane**: the vendor Node runtime (20.19.4) serves a root shell on `:8008` |
| `iptables` presence | absent in `/sbin` on the 75UR9S build | **Measured present** (`/usr/local/bin/iptables`) |
| SELinux | permissive on the 65A85QEVS reference | **Measured enforcing** on this unit |

## What was measured

Every row is labelled with the vocabulary of
[the publication policy](../../../DISCLOSURE.md#verification-labels).

| Claim | Evidence | Source |
| --- | --- | --- |
| Root shell with uid 0 and full capabilities | verified | `Uid: 0 0 0 0` and `CapEff: 000001ffffffffff` read from the operator host over the LAN |
| The channel comes back by itself after a real reboot | verified | `boot_id` unchanged across the reboot; the service armed it ~31 s after boot, with no browser and no operator action |
| The `basic` package is the FaaS host on this build | verified | `POST /function/basic/fetch/<name>` ran the module as uid 314 |
| `82` is the install command on this build | verified | validated *before* any real install, against a bogus IPK path: the daemon answered `91:-1` and wrote `ipk file … not exists` to `/tmp/ipk_install_result` |
| No vendor SSH daemon and no network client on this build | verified | every usual path probed directly; `sshd`, `dropbear`, `nc`, `socat`, `wget`, `curl` absent, busybox has no `nc` applet |
| `iptables` is present on this build | verified | `/usr/local/bin/iptables`, 687 760 B |
| SELinux is enforcing on this build | verified | read on the device |
| The unit's region | untested | never read off the device — `inventory.json` keeps `?` rather than a guess |
| The launcher lane (pairing, page/WS, home-watcher) | untested | not attempted on this build |

## What this guide includes and leaves out

| Included | Left out |
| --- | --- |
| the fingerprint and the firmware constants | the built IPK and the raw recon captures |
| the chain at the architecture level | the unit's identifiers (boot id included), the operator's network addresses, and the unit owner's handle |
| the measured deltas against the 75UR9S guide | key material, tokens, certificates — this lane has none |
| the evidence for each claim | vendor binaries — none were redistributed |
| the teardown path | — |

The line falls where it does because the superwatch install chain and the
`re_sshd` service source are already published in this repository for the
75UR9S, 75U8QTUK and 50U7DSE guides: what is withheld here is what belongs to
this unit, not the chain itself.

## Run log

### 2026-11-22 — step 0: reachability

| Probe | Result |
|---|---|
| TCP `<tv>:36669` (RemoteNow MQTT) | **open** |
| TCP 22 / 80 / 443 / 8008 / 8080 / 8993 / 9009 / 9888 / 1883 | closed |
| Operator host | `<pc>/24`, gateway `<gateway>` |
| HTTP server | `tools/ur9s/web/server.ps1` on `0.0.0.0:9000` (Windows twin of `server.py`) |

The TV is on the same L2 segment as the operator host and answers on the
RemoteNow port. No HTTP service is exposed by the TV itself, so the browser
page must be served by the operator host — the arrangement the 75UR9S guide
uses.

**Teardown of this step:** stop the server process; nothing was written to
the TV.

### 2026-11-22 — step 1: read-only recon (rounds 1–3)

Probe: `tools/ur9s/web/pub/recon-probe.js` (uid 314, read-only except one
`/var/local` write test that it unlinks immediately), page
`tools/ur9s/web/pub/recon.html`.

Round 1 headline results (full detail in
[findings/01-recon.md](findings/01-recon.md)):

| Item | Measured |
|---|---|
| SoC | **MT9655** — same family as the 75UR9S |
| Execution context | uid 314 / gid 314, **group 616 present**, `process.arch=arm`, phoenix host is Node 20.19.4 |
| `superwatch_socket` | `root:616`, mode 660 → **reachable** from uid 314 |
| superwatch command `85` | replies `901:0` (same shape as the 75UR9S build) |
| Root package script | `ipk_install.sh <session_id> <ipk_path> <pkg_name> <options>`, runs as root, result in `/tmp/ipk_install_result` **chown 314:314** → readable without root |
| Available shells | `/bin/bash` = **GNU bash 3.2.57** (real bash) + `/bin/sh`; busybox 869 KB but **without** `nc`/`wget`/`telnet` |
| Missing | `sshd`, `dropbear`, `nc`, `socat`, `wget`, `curl`, standalone `node` |

Round 3 added (see [findings/02-install-chain.md](findings/02-install-chain.md)):

| Item | Measured |
|---|---|
| `iptables` | present (`/usr/local/bin/iptables`, 687 760 B) |
| SELinux | **enforcing** |
| Mounts | `/APPS` rw `nosuid`, `/var/local` rw `nosuid`, `/` `erofs` (EROFS on write) |
| Port 8008 | free (nothing on `:1F48`) |
| `basic` package | has `CHA/services/` with **`serviceList.json`** → the boot-persistence lane exists |

**Consequence:** the Dropbear lane is out (no ARM toolchain on this host,
and no vendor SSH daemon on the TV). The zero-compile lane is the **vendor
Node runtime**: the postinst starts a TCP server on `:8008` that spawns a
root shell per connection — the design the 65A85QEVS lane already proved on
this platform.

**Teardown of this step:** the probe modules and their result files live in
`/APPS` as uid 314 and are removable without root; no package was installed,
nothing was rebooted.

### 2026-11-22 — step 2: the install chain is armed (not yet executed)

Artifacts built and validated on the operator host:

| File | Role |
|---|---|
| `tools/ur9s/rshell.js` | Node TCP server on 8008, spawns the root shell per connection |
| `tools/ur9s/rshell.sh` | supervisor (busybox `setsid`, mkdir lock, restart loop) |
| `tools/ur9s/scripts/postinst-65ur9s.sh` | the root part of the IPK: deploy, firewall, start, prove |
| `tools/ur9s/scripts/make_installer.sh` | builds the IPK with `tar`/`ar` (no Python on this host) |
| `tools/ur9s/win-tvsh.ps1` | operator client: runs a command batch on the TV and prints the answer |
| `tools/ur9s/web/pub/trigger65.js` | FaaS module: talks to `/var/run/superwatch_socket` |
| `tools/ur9s/web/pub/install65.html` | the installer page (two phases, operator-gated) |

The built IPK (3 730 B) has the layout the patched vendor opkg requires:
`control` carries `AppId`/`AppName`, `data.tar.gz` is non-empty, `postinst`
is mode 755.

Every JS that goes to the TV is parse-checked locally first (findings 01
§5.1) — `trigger65.js`, `install65.html` and `rshell.js` all pass.

**Operator gate:** the page runs phase 1 (validate command `82` with a bogus
IPK path — nothing can be installed that way) and then waits for the operator
to write `2` into `tools/ur9s/web/pub/phase.txt` before the real install runs.

### 2026-11-22 — step 3: root achieved

Phase 1 validated command `82` with a bogus IPK path — the daemon's own
error proved the code and nothing could be installed:

```
socket reply : 91:-1
/tmp/ipk_install_result = {"code": 2, "sessionId": 91,
                           "msg": "ipk file /APPS/nonexistent_probe.ipk not exists"}
```

Phase 2 (uninstall `83` → `90:0`, install `82` → `91:0`,
`/tmp/ipk_install_status` = `[re.installer]step:finish`) ran the `postinst`
as **uid 0** with `CapEff 000001ffffffffff`. The root channel came up:

```
Uid: 0 0 0 0   CapEff: 000001ffffffffff
PATH=/usr/local/bin/openssh/sbin:/usr/local/bin:/usr/local/scripts:/basic/bin:/bin:/usr/bin:/sbin:/usr/sbin:/3rd/bin/wpa_supplicant/common
```

Details and traps: [findings/03-root-and-persistence.md](findings/03-root-and-persistence.md).

### 2026-11-22 — step 4: boot persistence

A `re_sshd` JS service was added to the basic jsservice package
(`services/re_sshd/`, registered in `serviceList.json` with
`autoStart: true`). It runs as uid 314 and asks the root daemon to
re-install the package, which re-inserts the RAM-only iptables rules and
restarts the supervisor.

### 2026-11-22 — step 5: cold-boot verification

A real reboot (`/usr/local/bin/reboot` — `busybox reboot` is a no-op on this
build) was followed by the service arming the channel on its own:

```
boot_id <boot-id>, uptime 104 s
/APPS/.re_sshd/boot_marker.txt
  14:51:55 re_sshd start pid=2575 uid=314
  14:52:21 attempt 1 uninstall=[90:0] install=[TIMEOUT]
  14:52:26 ARMED: rshell up
```

After the reboot: one supervisor, one node, `:1F48` LISTEN, the package
installed, both `ACCEPT … dpt:8008` rules back in `INPUT` and
`FIREWALL_IN_EULAON`, and the root shell answering again from the PC.

## Teardown

Full teardown, in order:

1. `opkg remove re.installer` — removes the installer package and stops the
   root-shell supervisor.
2. `rm -rf /APPS/.re_sshd` — the root channel's home, log and scripts.
3. `rm -f /APPS/shell` — the shell whitelist the root shell needs.
4. `rm -f /APPS/installer.ipk` and the probe/trigger modules under
   `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/`.
5. `iptables -D INPUT -p tcp --dport 8008 -j ACCEPT` and the same for
   `FIREWALL_IN_EULAON` — closes the port again.
6. Remove the boot-persistence service if it was deployed
   (`CHA/services/re_sshd/` + its `serviceList.json` entry).
7. Stop `tools/ur9s/web/server.ps1` on the operator host.

`/APPS` and `/var/local` are the only writable areas this chain touches.
The root filesystem is `erofs` + `dm-verity` and is never written to.

## Open items

- The **region** was never read off the unit; `inventory.json` keeps `?`.
- The **launcher lane** (pairing, page/WS, home-watcher) was not attempted on
  this build.
- A **real SSH daemon** still needs an ARM binary: the root channel is the
  vendor Node runtime serving a shell on `:8008`, because this build has no
  sshd, no dropbear, no `nc`/`wget`/`curl` and a busybox without an `nc`
  applet, while the operator host has no ARM cross-compiler.
- This guide has no `EVIDENCE.md` / `MODDING.md` pages yet, unlike the HE40
  and 100U7Q ones.

## Cross-reference

- Related guides: 75UR9S guide (same board family, 6 days newer build):
  [../../75UR9S/V0000.09.60W.Q0624/README.md](../../75UR9S/V0000.09.60W.Q0624/README.md)
  · 43Q60SEVS guide (MTK9603 on a `09.60W` build — same primitives, different
  SoC): [../../43Q60SEVS/V0000.09.60W.Q0612/README.md](../../43Q60SEVS/V0000.09.60W.Q0612/README.md)
  · 65A85QEVS guide (the Node root shell this chain reuses):
  [../../65A85QEVS/V0000.09.60A.Q0602/README.md](../../65A85QEVS/V0000.09.60A.Q0602/README.md)
- Method catalogue: [../../../research/EXPLOITS.md](../../../research/EXPLOITS.md)
- Publication policy: [../../../DISCLOSURE.md](../../../DISCLOSURE.md)
