# 01 — Recon round 1: identity, filesystem, and the superwatch surface

> Measured 2026-11-22 from the owner unit (65UR9S, `<tv>`), through
> the browser page `tools/ur9s/web/pub/recon.html` and the in-process probe
> `tools/ur9s/web/pub/recon-probe.js` (round 1). The probe runs as **uid 314**
> in the phoenix host and is read-only except one `/var/local` write test that
> it unlinks immediately. Companion to the model [README](../README.md).

Raw report (owner PC): `tools/ur9s/web/captures/run-20261122-151151-000004.txt`.

## 1. Identity of the execution context

| Item | Measured value |
|---|---|
| uid / gid | `314` / `314` |
| supplementary groups | `516,546,607,616,701,702,711,712,713,762,816,902,903,904,908,911,912,924,943,314` |
| `process.arch` | `arm` (32-bit userland) |
| `process.execPath` | `/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix` |
| CPU | 4× ARMv8-A53 (`CPU part 0xd09`), `BogoMIPS 24.00` |
| kernel cmdline | `rootfstype=erofs ro … init=/sbin/init … console=ttyS0,115200` |

**Group 616 is in the group list** — that is the group that owns the
superwatch socket. This is the same privilege position the 75UR9S chain
relied on.

The phoenix host is a **Node runtime** and the FaaS function executes as a
real CommonJS module (`require('fs')`, `require('net')`, `require('http')`,
`require('child_process')` all work). That is the write/exec primitive:
`fetchFile` places a module into the package's `functions/fetch/` directory
and `POST /function/basic/fetch/<name>` runs it.

## 2. Platform

| Area | Measured |
|---|---|
| SoC family | **MT9655** — the build path embedded in `superwatch_server` is `/home/gfkfcmo/workspace/M9655V_9655EEAOM_EUKIOXIA/MT9655VD/cbb/minos/framework/common/security/security_component/superwatch/superwatch_server/src/CommandFactory` (`M9655V`, EUK region) |
| rootfs | `erofs`, read-only (`rootfstype=erofs ro`) |
| `uname` | not on the PATH of the probe's `execSync` (`/bin/sh: uname: command not found`) — the busybox applet exists but is not in that PATH |

**This is the same SoC as the 75UR9S / 100U7Q chain**, which is why the
`fetcher → superwatch → postinst` lane is the expected route here.

## 3. Tool inventory (uid 314 view)

Present:

| Path | Note |
|---|---|
| `/usr/local/bin/busybox` | 869 628 B — **reduced build**: the applet list has no `nc`, no `wget`, no `telnet`, no `ftpget`, no `httpd`. It has `sh`, `ash`, `awk`, `sed`, `tar`, `dd`, `setsid`, `netstat`, `ip`, `mount`, `pidof`, `ps` |
| `/bin/bash` | 596 448 B — **real bash candidate** (round 2 verifies the `/dev/tcp` support) |
| `/bin/sh` | 596 448 B — same size as `/bin/bash`, i.e. the same binary in `sh` mode |
| `/usr/local/bin/opkg` | vendor package manager |
| `/usr/local/bin/jq`, `kprop`, `inputkeyevent` | JSON, property system, UI key injection |

**Absent** (probed directly): `sshd` (all of `/usr/local/bin/openssh/sbin/sshd`,
`/usr/sbin/sshd`, `/usr/bin/sshd`, `/bin/sshd`), `dropbear`, `node` as a
standalone binary, `nc`, `socat`, `wget`, `curl`, `telnetd`.

**Consequence for the root shell:** the repo's Dropbear lane would need an
ARM cross-compiler (not available on this host), and the vendor ships no
SSH daemon. The **zero-compile** lane is therefore **bash + `/dev/tcp`** —
a root reverse shell to the operator host — with the vendor Node runtime as
the fallback (the 65A85QEVS approach).

## 4. The superwatch surface

| Item | Measured |
|---|---|
| socket | `/var/run/superwatch_socket`, mode `660`, uid `0`, **gid `616`** |
| reachability from uid 314 | **yes** (uid 314 is in group 616) |
| command `85` | reply `901:0` — same reply shape as the 75UR9S build (`85` = dir usage) |

### 4.1 Command table (read from the device's own binary)

`superwatch_server` is a C++ binary with a `CommandFactory::createCommand(int)`
dispatch table. The class names recoverable from its symbol/string table:

```
RunIpkInstallCommand      RunIpkUninstallCommand    RunIpkBackupCommand
RunIpkRestoreCommand      RunIpkClearBackupCommand  RunIpkRestoreInfoFilesCommand
GetDirUsageCommand        DropCacheCommand          TopEmmcCommand
RunCoreDumpCommand        GetCoreTemCommand         IrGetLogCommand
GetLogRemoteCommand       MkDirForPVRCommand        RtlGnetMacCommand
EnterWifiTestmodeCommand  RmDeletableFileCommand    RunCheckPkgsUsdCommand
RunRecreateSoftlinkCommand  GeneralCommand           BaseCommand
```

The numeric ids are compiled in, not in the string table. Sibling 09.60
builds (75UR9S `W.Q0624`, 55U67LEVS `A.Q0707`, 43Q60SEVS `W.Q0612`) all use
**82 = install, 83 = uninstall, 85 = dir usage**; the 09.09 generation uses
53/54. Since `85` answers identically here, the numbering is very likely the
same — but it will be **validated with a bogus IPK path** (no package can be
installed, the vendor script errors out on a missing file) before any real
install.

### 4.2 The root package script (`/usr/local/scripts/ipk_install.sh`)

Run as **root** by the daemon. Its contract, read from the device:

```
ipk_install.sh <session_id> <ipk_path> <pkg_name> <options>
```

- `session_id` = the first field of the socket message
- `ipk_path` = absolute path of the `.ipk` on the TV
- `pkg_name` = package name
- `options` = comma-separated option list
- it refuses to continue if `ipk_path` does not exist (`handle_error 2`)
- results: `/tmp/ipk_install_result` (mode 640, **chown 314:314** → readable
  by the app context) and `/tmp/ipk_install_status`
- `ipk_uninstall.sh <session_id> <pkg_name>` uses `ipk-update`

The `314:314` ownership of the result file is what makes the install
**observable from the app context** without root — no guessing needed.

### 4.3 The vendor's own package interface

`/usr/local/scripts/login.sh` is the serial-console "hidden page" menu. It
exposes an **import package** (menu 18) and an **export package** (menu 19)
entry, implemented through the file interface `/var/run/superwatch` (the
75UR9S findings recorded `echo 13 > /var/run/superwatch` for import and
`echo 12 >` for export). That is a **second entry point to the same root
package lane**, independent of the socket.

## 5. Traps hit on the way

### 5.1 `Unexpected token ';'` — a missing ternary branch, not a corrupted download

Round 2 of the probe failed with
`Calling /fetch/reconprobe_ur9s got error:SyntaxError: Unexpected token ';'`.

The first hypothesis was a corrupted or concatenated file. **It is not**:
the fetcher truncates the target (the file on the TV was 7 395 bytes = the
round-2 source alone, not round 1 + round 2), and the served bytes were
byte-identical to the operator's copy.

The actual cause was in the probe source itself — a ternary written with the
`?` branch but no `:` branch:

```js
return t.length > cap ? t.slice(0, cap) + "\n...[truncated " + t.length + " bytes]";
```

The parser reads the consequent, then meets `;` where it expects `:`, and
reports `Unexpected token ';'` — pointing at the semicolon, ~100 characters
away from the real mistake. The FaaS host surfaces the message without a
line number, which makes it look like a transport problem.

**Lesson for this repo:** validate any JS that goes to the TV *before*
shipping it. A local browser is enough — `new Function(src)` parses exactly
the way the TV's Node does. The gate used here is
`tools/ur9s/web/pub/jsparse2.html` (loads each file as an inline script and
reports `ERROR line <n> col <m>`), driven headless:

```powershell
& 'C:\Program Files (x86)\Microsoft\EdgeCore\157.0.4341.60\msedge.exe' `
    --headless --disable-gpu --dump-dom 'http://<host>:9000/pub/jsparse2.html#/pub/recon-probe3.js'
```

`pub/jsbisect.html` goes further: it recompiles the file with each line
removed in turn and lists the lines whose removal makes it compile.

### 5.2 The `fetcher` write is a plain overwrite

`fetchFile` with `{url, directory, permission}` **replaces** the target file
(the round-2 module was exactly the round-2 source, 7 395 bytes). It does
not append, and it does not create parent directories — the target directory
must already exist (the `functions/fetch/` directory of the basic jsservice
package does).

## 6. What this changes in the plan

1. The FaaS `fetch` function lives in the **basic** package on this build:
   `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/` — the same
   place as the 75UR9S. The route is `/function/basic/fetch/<name>`.
2. The root shell will be **bash + `/dev/tcp`** (no compilation), pending the
   round-2 confirmation that `/bin/bash` has `/dev/tcp` support.
3. The install result is read from `/tmp/ipk_install_result` (readable at
   uid 314), so the arm step is verifiable without root.
4. `82`/`83` are validated with a bogus path before use — no blind probing
   of unknown command ids (several other ids are destructive:
   `RmDeletableFileCommand`, `GeneralCommand`).

## Teardown of round 1

| Written | Where | Removal |
|---|---|---|
| `reconprobe_ur9s.js` | `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/` | `rm` as uid 314 (the probe can delete itself, or the package reinstall overwrites it) |
| `.recon_probe_result.json` | `/APPS/` | `rm` as uid 314 |
| `.recon_write_test` | `/var/local/` | already unlinked by the probe |
| `capture` files | operator PC, `tools/ur9s/web/captures/` | optional, local only |

No package was installed, nothing was rebooted, no privileged state was
touched.
