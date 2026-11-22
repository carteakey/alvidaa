# 02 — Round 3: the toolchain decision, and the install chain that follows

> Measured 2026-11-22 from the owner unit (65UR9S, `<tv>`) with the
> round-3 probe `tools/ur9s/web/pub/recon-probe3.js` (uid 314, read-only).
> Companion to [01-recon.md](01-recon.md) and the model [README](../README.md).

Raw report (owner PC): `tools/ur9s/web/captures/run-20261122-152422-000017.txt`.

## 1. Runtime facts that decide the root channel

| Item | Measured |
|---|---|
| Node runtime | **v20.19.4**, `process.arch=arm`, `execPath=/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix` |
| `/bin/bash` | **GNU bash 3.2.57(1)-release (arm-none-linux-gnueabihf)**, 596 448 B, mode 755 — a real bash, and `/bin/sh` is the same binary |
| `iptables` | **present**: `/usr/local/bin/iptables` (687 760 B) + `/basic/bin/iptables` (a 452 B wrapper) |
| SELinux | **enforcing** (`/sys/fs/selinux/enforce` = 1) — stricter than the 65A85QEVS unit, where the same Node shell worked under permissive |
| Mounts | `/APPS` rw **nosuid**, `/var/local` rw **nosuid**, `/OAD` rw; `/` is `erofs` (EROFS on write) |
| Writable from uid 314 | `/APPS`, `/var/local`, `/tmp`, `/OAD`; `/` not |
| Free port | **8008 is not listening** (nothing on `:1F48` in `/proc/net/tcp`) |
| `basic` package | has `CHA/services/` with `fetcher`, `hiutils`, `ipchandler`, `tvinfo` **and `serviceList.json`** → the boot-persistence lane exists |

## 2. The decision: Node rshell, not Dropbear

The 65A85QEVS lane (`tools/65a85q/`) already solved the identical problem on
the identical platform: same vendor Node binary, same busybox without an `nc`
applet, no `sshd` anywhere. Its answer is a **TCP server in the vendor Node
runtime that spawns a root shell per connection** — no compile step, no
binary, no SUID (every persistent filesystem is `nosuid`).

That lane is reused here with two adjustments:

1. the spawned shell is `/APPS/.re_sshd/sh`, a wrapper that sources
   `/etc/profile` (the vendor's single source of truth for `PATH` and
   `LD_LIBRARY_PATH`) and execs bash — the 75UR9S design. `/etc/profile`'s
   stdout is a login banner, not environment, so it is sunk to keep the
   output clean;
2. the supervisor is `busybox setsid`-detached, because a plain `&` from an
   opkg `postinst` dies with the installer's process group (measured on the
   65A85QEVS unit).

**Dropbear would need an ARM cross-compiler** that this host does not have,
and the TV ships no SSH daemon to reuse. The bash `/dev/tcp` fallback is not
used as the primary channel because bash cannot *listen* — the operator would
have to connect to a PC-side relay instead of to the TV.

## 3. The install chain on this build

```
browser page  http://<pc>:9000/pub/install65.html
  └─ phoenix FaaS "fetcher" (uid 314)
       ├─ fetchFile  pub/installer.ipk      -> /APPS/installer.ipk
       └─ fetchFile  pub/trigger65.js       -> <basic pkg>/CHA/functions/fetch/trigger65_ur9s.js
  └─ POST /function/basic/fetch/trigger65_ur9s        (uid 314)
       └─ /var/run/superwatch_socket  (root:616, mode 660)
            ├─ "91:82:91;/APPS/nonexistent_probe.ipk;re.probe;"   ← PHASE 1, validation
            └─ "90:83:90;re.installer" + "91:82:91;/APPS/installer.ipk;re.installer;"
                 └─ /usr/local/scripts/ipk_install.sh (root)
                      └─ opkg --force-reinstall install /APPS/installer.ipk
                           └─ postinst (uid 0)
                                ├─ /APPS/.re_sshd/{rshell.js,rshell.sh,sh}
                                ├─ iptables -I INPUT / FIREWALL_IN_EULAON :8008 ACCEPT
                                └─ busybox setsid rshell.sh
                                     └─ phoenix (Node 20) rshell.js -> listen 8008
```

### 3.1 Command 82 is validated before it is used

The numeric command ids are compiled into `superwatch_server` and are not in
its string table. Three sibling 09.60 builds (75UR9S `W.Q0624`,
55U67LEVS `A.Q0707`, 43Q60SEVS `W.Q0612`) all use `82` = install,
`83` = uninstall, `85` = dir usage — and `85` answers `901:0` here, the same
shape as on the 75UR9S.

Before the real install, the page sends **`82` with a bogus IPK path**:

```
91:82:91;/APPS/nonexistent_probe.ipk;re.probe;
```

The vendor script checks the path first and refuses (`handle_error 2`,
"ipk file … not exists"), so **no package can be installed** — but the
refusal proves the command code: it is written to `/tmp/ipk_install_result`,
which is `chown 314:314` and therefore readable from the app context.

Blind probing of unknown ids is deliberately avoided: the same command table
contains `RmDeletableFileCommand` and `GeneralCommand`, which are not
harmless.

### 3.2 The operator gate between the two phases

Phase 1 and phase 2 are separated by a file the **operator** controls:
`tools/ur9s/web/pub/phase.txt`. The page polls it every 2 s and only runs the
real install once the operator has written `2` there. The user never has to
type anything for the second phase.

### 3.3 The IPK

Built by `tools/ur9s/scripts/make_installer.sh` (a bash/tar/ar twin of
`make_installer.py`, because this host has no Python). Layout, verified after
the build:

```
installer.ipk (ar)
├── debian-binary      "2.0"
├── control.tar.gz     ./control (644)  ./postinst (755)
└── data.tar.gz        ./APPS/.re_sshd/rshell.js (644)
                       ./APPS/.re_sshd/rshell.sh (755)
```

`control` carries `AppId: re.installer` and `AppName: re.installer` — the
patched vendor opkg refuses a package without them — and `data.tar.gz` is
non-empty for the same reason. `Architecture: mtk9655` matches the SoC
measured in round 1.

The data set is extracted **relative to `/APPS/pkgs`**, which is why the
paths are `./APPS/.re_sshd/...`: the postinst expects them at
`/APPS/pkgs/APPS/.re_sshd/`.

## 4. Firewall

The vendor chains end in `-j DROP`, so an appended rule is never reached —
the ACCEPT has to go **at the head** of both `INPUT` and
`FIREWALL_IN_EULAON`. The postinst does that, idempotently
(`iptables -C || iptables -I 1`).

## 5. Teardown

| Step | Command (as root) |
|---|---|
| stop the root shell | `opkg remove re.installer` (kills the supervisor) + `rm -rf /APPS/.re_sshd` |
| close the port | `iptables -D INPUT -p tcp --dport 8008 -j ACCEPT` and the same for `FIREWALL_IN_EULAON` |
| remove the trigger module | `rm /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/trigger65_ur9s.js` |
| remove the installer | `rm /APPS/installer.ipk` |

`/` is never written: it is `erofs` and the postinst only touches `/APPS`.
