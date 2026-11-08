# 04 — Phase-3 lane: the hook is installed, SELinux blocks it (2026-11-08)

The first root-lane attempt on a `09.09D` unit. The 50A51HUV playbook's core
step — write `/var/local/otaTest.sh` through the bridge, reboot, exec as
root — does **not** fire on this firmware: the branch enforces SELinux from
boot with no vendor path to permissive. Everything below is measured on the
TV; nothing at boot is armed (the hook is inert on disk).

## The hook lane (verified twice)

- `/etc/rc.d/rc.local` calls `/var/local/otaTest.sh` if it exists (the
  reference-hook stanza, unchanged from the vendor tree — see
  [03](03-recon-v3-v4.md)).
- Hook v1 written via the file bridge traversal write
  (`../var/local/otaTest.sh`, mode 6): `ret:true "success"`, readback
  4447 b. The traversal write **escapes the `/APPS` base** on this unit
  (the base-relative form joins to `/APPS/var/local/…`).
- Cold boot (mains, 61 s uptime): `proc/boottime` traces `rc.local begin`
  7.038 s → `autorun.sh` → `rc.local done` 8.447 s — the caller ran.
- **The hook never opened `otaTest.log`** — zero bytes, ENOENT afterward —
  exec (or its first redirection) was blocked before the script's first
  line. No bootscript error surfaced; the stanza sequence carries on.

## The blocker (verified from vendor boot scripts)

`/etc/init.d/common/init_selinux.rc` (readable via the bridge):

```sh
load_policy -i
restorecon -r /var/run &   # also /run, /dev — NOT /var/local
echo 0 > /sys/fs/selinux/checkreqprot
if grep -q "androidboot.selinux=permissive" /proc/cmdline
then
    setenforce 1      # ← both branches
else
    setenforce 1      # ← identical
fi
```

- Both branches of the permissive check call `setenforce 1` — the escape
  hinge is dead code on this branch.
- `rcS.utopia.linux` **sources** init_selinux.rc and waits; **no
  `setenforce 0`** anywhere in the boot chain we dumped (rcS, rcS.OTA,
  rcS.utopia.linux, rc.d/rc.local) — unlike the 50A51HUV record, where
  `start-hisense.sh` runs `setenforce 0` before rc.local.
- Post-boot read of `/sys/fs/selinux/enforce` → `1`.
- Files created by phoenix (uid 314) under `/var/local` inherit the
  directory's default type (no restorecon sweep covers `/var/local`);
  the policy denies the init-context rc.local shell our exec. AV-denial
  evidence is not readable pre-root (dmesg/klog are root-only) — the
  mechanism is inferred from the exec-visible outcome, not observed in
  kernel logs. The conclusion to revisit after root exists.

**Consequence: pre-root `rc.local` hook lane = period-closed on this
branch.** Family keeper: the `otaTest` stanza itself still ships (the
source is unchanged), so root work can still finish through the
superwatch/IPK chain and reach for this lane later, labeled, once a root
context exists.

## The superwatch/IPK lane — prerequisites measured, chain not yet armed

Same architecture as the 100U7Q/75UR9S/55A7KAU chain, blocked only at
SELinux: phoenix (uid 314) **carries group 616** ([03](03-recon-v3-v4.md))
and the `jsservice.basic` package exists exactly where the chain needs it:

- `vowOS` is present with `vowOS.service.syncExecute: function` — the
  75U8QTUK page shape ports directly.
- `pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/` exists (`EISDIR`
  probe) and the vendor fetcher function `functions/fetch/fetchfile.js`
  is readable: `fetchFile(args{url, directory, permission, timeout,
  custom_headers, cancelable, isCancel, ratelimit, sync_unit_size})`,
  absolute destination paths, `permission: 420` = 0644.
- `phoenix.server.js` readable (the framework, not the function table).
- **`tv.vidaa.jsservice.system` does not exist on this unit** even though
  `ROOT_SYSTEM_JS=/APPS/pkgs/tv.vidaa.jsservice.system/CHA/` is exported —
  the env is set blindly (same root var name as the 75U8 unit). All
  pkgmgr-style service code must therefore be read from the **basic**
  package on this unit.
- `ROOT_BASIC_JS=/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/`,
  `BASIC_JS_{LIB,UTIL}`, `PHOENIX_BIN_PKG=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/`
  read from `../proc/self/environ`.
- Vendor opkg config not at the reference's
  `../opt/apps/opt-pkgs/opkg.conf` (ENOENT) — feed/arch strings need a
  fresh location here.

## Traps recorded (both now two-data-point generalities)

- **Rapid synchronous fileRead bursts jam the hiutils bridge** (09.09O
  record; reproduced here with bursts >6/s — first-call success
  then all-NetworkError on a page). Pace ≥1 file per ~1.3 s.
- **Binary reads via the bridge kill the transport** (large ELF read →
  every later call NetworkError until the webview/redirect recovers).
  Happened twice today: the iptables-ELF head reads, and the
  `app.phoenix/CHA/bin/phoenix` read. **Never `fileRead` a binary.**
- The fetcher's own error path **deletes the destination on a failed
  fetch** (reference unit evidence; our fetch pages must serve artifacts
  from the page's own origin, absolute URLs).
- `syncExecute` without timeout can wedge the page — one service call per
  page-load section, artifacts split across loads.

## State after this session

- `/var/local/otaTest.sh` (4447 b) — written, **inert** (SELinux blocks
  exec; the file sits there for a labeled post-root revisit). Teardown:
  `rm ../var/local/otaTest.sh` via the same bridge lane, or the
  `hook.off` kill-switch page (absent — hook never ran).
- No binaries on the TV, no dropbear, no IPK; `/tmp`,`/:4444` listener
  never received a fetch (killed by the tool sandbox between calls —
  server artifacts for the chain go through the fetcher lane instead).
  - the launcher server (192.168.0.195:8770) is the only active lane.
- Root remains **blocked-at-selinux-exec (hook lane)**; the superwatch
  chain is the measured-open continuation (prereqs above).
