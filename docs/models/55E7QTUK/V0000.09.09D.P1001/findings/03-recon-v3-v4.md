# 03 — Recon v3+v4: dumps, boot scripts, wire, self-proc (2026-11-08)

Read-only extension of the v1+v2 ladder
([02](02-recon-ladder.md)) — dumps through the `../` traversal, boot-script
structure, XHR wire capture, and the page host's `/proc/self`. Nothing was
written to the TV. Pages: `launcher/recon-e7qtuk.html` (extended;
full-ladder) and `launcher/recon-e7qtuk-wire.html` (focused front-loaded
pass — see "Runner trap" at the end), `launcher/recon-e7qtuk-rc.html`
(micro-probe). Bodies live in the gitignored recon report; this note keeps
structure. `/etc/shadow` deliberately not dumped.

## v3 — the dumps (verified)

**`/proc/mounts`** — same `/APPS/`-relative world as the ladder, SELinux
labels present on mounts and selinuxfs mounted:

- RW: `/proc` `/sys` `/dev/shm` `/certificate` (p5) `/Customer` (p27)…
  **`/var/local` (p49, rw!, noexec)** **`/APPS` (p54, rw)** **`/OAD`
  (p55, rw!)** `/data` (p12) `/vendor/persist` (p33) `/vendor/uuenv` (p4)
  `/var/tvservice` (p44) `/cache` (p11).
- RO dm: `/vendor/lib` (dm-1) `/application` (dm-2) `/vendor/lib/utopia`
  (dm-3) **`/usr/local` (dm-4, ro — same as the A7KAU)** `/opt` (dm-5)
  `/3rd` (dm-6).
- Partition *numbers* differ from the 55A7KAU layout (p54 vs p41 for
  `/APPS` etc.) — layout is mainboard-specific; the writable/ro split
  matches.

**`/etc/inittab`** — busybox init: `si::sysinit:/etc/init.d/rcS` +
`respawn:/sbin/getty -L ttyS0 115200 vt100` (UART console live, as the
A7KAU).

**`/etc/passwd`** — the factory-gate login-shell pattern again, plus one
A7KAU-not-listed detail:

- `root` uid 0 shell `rootlogin.sh`; `television` uid 300 `login.sh`;
  `cli` **uid 0** shell `cli_login.sh`; and **`wifitest` also uid 0**
  (shell `wifi_login.sh`) — three uid-0 rows, all on gate scripts under
  `/usr/local/scripts`. Also note: **uid 314 (phoenix) has no passwd row**
  — a numeric-only account.

**`/etc/init.d/rcS`** (70 lines) — OTA-flag gate → `mount -avt
nonfs,nosmbfs` → `rcS.OTA` if `ota_upgrade_flag=Y` → `rcS.utopia.linux` →
and the line that matters for the root lane: **`[ -x /etc/rc.d/rc.local ]
&& /etc/rc.d/rc.local`** — this unit's rc.local hook is at
**`/etc/rc.d/rc.local`**, not the `/etc/rc.local` path other ladders and
notebooks check.

**`/etc/profile`** — `SYS_MODEL_NAME=hisense_mt9603_linux`, chip export
`DTO_CHIP=mt5873` (the MTK userspace id behind the bridge's "MTK9603"),
**`SYS_VERSION=Debug`**, `umask 026`, PATH carries
`/usr/local/bin/openssh/sbin` (openssh staged under the ro partition).

## The rc.d/rc.local lane — present, and free (verified)

Micro-probe at the exact paths the boot chain references:

| Path | State |
| --- | --- |
| `/etc/rc.d/rc.local` | **EXISTS (3219 b)** — sh script; per-dir shm setup, restorecon, `/basic/autorun.sh` gate, and at its end: |
| | ```if [ -e /var/local/otaTest.sh ]; then chmod +x /var/local/otaTest.sh; /var/local/otaTest.sh &; fi``` — the reference unit's (50A51HUV) exact OTA-test hook stanza, run as root at every boot |
| `/etc/rc.local` | absent (`ENOENT`) — the path the 55A7KAU ladder checked; their "no rc.local lane" conclusion was **path-shaped**, the lane lives at `rc.d/` |
| `/etc/init.d/rcS.OTA` | exists (2627 b) |
| `/etc/init.d/rcS.utopia.linux` | exists (4770 b) |
| `/var/local/otaTest.sh` | **absent** — hook lane free (no session owns it) |
| `/var/local/versionInfo.json` | absent — same missing-file state the euladpp_untar condition keys on (untested) |

**Consequence for the family:** the otaTest hook primitive is
architecturally present and unoccupied on this unit. Whether it exists on
the 55A7KAU (which concluded the lane absent from the `/etc/rc.local`
test) is now an open question worth one micro-probe. **Nothing has been
armed on this TV** — the hook is unresearched territory beyond its
existence; root stays untested pending a separate decision.

## v4 — wire format and the page host (verified)

- **Wire**: every bridge call is **`POST http://localhost:9009/service/hiutils`**
  with body `{"api":"fileRead","args":{"path":"…","mode":6}}` — identical
  to the 55A7KAU v4 capture. Localhost-only listener observed.
- **`../proc/self/cmdline`**: `/APPS/pkgs/tv.vidaa.app.phoenix/CHA//bin/phoenix
  --jitless --max-semi-space-size=3 --no-experimental-fetch
  --no-network-family-autoselection --max-old-space-size=9
  --optimize_for_size --report-uncaught-exception --report-on-fatalerror
  --expose-gc --use-openssl-ca --report-filename=/var/local/log.phoenix.report
  /APPS/pkgs/tv.vidaa.jsservice.basic/CHA//phoenix.server.js`
  — same `jsservice.basic` server script as the A7KAU, but on this unit
  **the phoenix binary itself lives under `/APPS`** (the writable file-bridge
  base), not `/opt`. Also: a `/var/local/log.phoenix.report` filename inside
  the jitted args.
- **`../proc/self/status`**: `Name: phoenix`, `PPid: 695`,
  **`Uid/Gid: 314`** (no passwd row), **Groups: 516 546 554 607 616 701 702
  711 712 713 762 902 903 904 908 911 912 924** — carries **616** (the
  superwatch-socket group from the 100U7Q/75UR9S chain) and **713**
  (`UhisPhoenix`, Appinfo ownership). `CapEff/CapPrm: 0` with
  `CapBnd: 000001ffffffffff`.

## Runner trap (recorded)

The full-ladder page posted v1–v3, but its +6.5 s `setTimeout` chain
**never fired** on this webview (two runs). The focused page
(`recon-e7qtuk-wire.html`) runs dumps synchronously at load and uses a
single 1.2 s timer for the capture — that structure completed every stage.
Mechanism unproven (background-timer throttling vs webview lifecycle);
practical rule for this TV: **no long timer chains in ladder pages — one
short timer maximum.**

## What differs from the 55A7KAU at v3/v4

| Area | 55A7KAU `09.09O.P1015` | 55E7QTUK `09.09D.P1001` — measured |
| --- | --- | --- |
| rc.local lane | concluded absent at `/etc/rc.local` | present at **`/etc/rc.d/rc.local`** with the otaTest stanza; `/etc/rc.local` absent here too |
| `/proc/mounts` partition numbers | p17/p27/p41/p42/p39-family | p5/p27/p54/p55/p49-family (mainboard layout) |
| SELinux | not noted | seclabel on mounts + selinuxfs mounted |
| passwd | root/television/cli | same shape **plus `wifitest` uid 0**; phoenix uid 314 has no row |
| phoenix binary location | `/opt/...app.phoenix` | **`/APPS/...app.phoenix`** (script is `jsservice.basic` in both) |
| phoenix groups | `211 233 312 616 702 711 713 902 1018` | `516 546 554 607 616 701 702 711 712 713 762 902…` — both carry 616 and 713 |

## Untested (deliberately)

No root primitives armed: no hook write, no serviceList change, no
`fetcher`/FaaS attempts. The write lane proven in [01](01-launcher-install.md)
plus the free hook lane above are the obvious candidates if/when root work
is decided for this TV, with `/OAD` frozen first per ground rules.
