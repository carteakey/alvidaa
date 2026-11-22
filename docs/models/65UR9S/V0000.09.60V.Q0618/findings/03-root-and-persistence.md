# 03 — Root, boot persistence, and the traps on the way

> Measured 2026-11-22 on the owner unit (65UR9S, `<tv>`,
> `V0000.09.60V.Q0618`). Companion to [01-recon.md](01-recon.md),
> [02-install-chain.md](02-install-chain.md) and the model
> [README](../README.md).

## 1. The root channel

```
PC (<pc>)  --TCP 8008-->  TV
                                   node (uid 0) /APPS/.re_sshd/rshell.js
                                     └─ per connection: /APPS/.re_sshd/sh
                                          → . /etc/profile ; exec /bin/bash
```

Measured from the operator host, over the LAN, in the root session:

```
Uid:    0   0   0   0
Gid:    0   0   0   0
CapEff: 000001ffffffffff
PATH=/usr/local/bin/openssh/sbin:/usr/local/bin:/usr/local/scripts:/basic/bin:/bin:/usr/bin:/sbin:/usr/sbin:/3rd/bin/wpa_supplicant/common
```

The shell is the vendor's own environment: `/etc/profile` exports `PATH` and
the `LD_LIBRARY_PATH` chain the dynamic vendor binaries need (this build has
no `/etc/ld.so.cache`, so `jq`/`opkg`/`kprop` only resolve through it).

There is **no SSH** on this unit — the channel is a raw TCP port carrying a
root shell. The operator client is `tools/ur9s/win-tvsh.ps1` (the Windows
twin of the repo's `tools/tvsh.py`): it connects, sends a command batch
terminated by `exit`, and prints the answer.

## 2. The chain that produced it

| # | Step | Evidence |
|---|---|---|
| 1 | browser page → phoenix `fetcher` writes `/APPS/installer.ipk` | `{"ret":true,"msg":"download finished"}` |
| 2 | superwatch `82` + a **bogus** IPK path (validation only) | socket reply `91:-1`, `/tmp/ipk_install_result` = `{"code": 2, …, "msg": "ipk file /APPS/nonexistent_probe.ipk not exists"}` |
| 3 | superwatch `83` (uninstall) then `82` (install) | socket replies `90:0` and `91:0`; `/tmp/ipk_install_status` = `[re.installer]step:finish` |
| 4 | `postinst` runs as **uid 0**, full caps | log: `Uid: 0 0 0 0` / `CapEff: 000001ffffffffff` |
| 5 | `postinst` inserts the firewall rules | `INPUT: ACCEPT inserted at head`, `FIREWALL_IN_EULAON: ACCEPT inserted at head` |
| 6 | `postinst` starts the supervisor | `busybox setsid /bin/sh /APPS/.re_sshd/rshell.sh`, then `:1F48` LISTEN in `/proc/net/tcp` |

## 3. Boot persistence — verified across a real reboot

The persistence service is a JS service in the basic jsservice package:

```
/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/index.js   (314:314, 640)
/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/package.json
/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json   (+ re_sshd entry)
```

`serviceList.json` is merged with Node (never with text surgery — the
55E7QTUK lane broke the JSON that way) and a pristine copy is kept beside it
as `serviceList.json.pristine`.

The service runs as **uid 314** and asks the root daemon to re-install the
package, which re-runs the `postinst` as uid 0 — that is what re-inserts the
iptables rules (they live in RAM and are gone after every reboot) and
restarts the supervisor.

Cold-boot evidence (2026-11-22, `boot_id <boot-id>` — the value is withheld
with the other unit identifiers; the point of the check is that it is the
*same* boot id as before the reboot, uptime 104 s at the check):

```
/APPS/.re_sshd/boot_marker.txt
2026-11-22T14:51:55.890Z re_sshd start pid=2575 uid=314
2026-11-22T14:52:21.907Z attempt 1 uninstall=[90:0] install=[TIMEOUT]
2026-11-22T14:52:26.912Z ARMED: rshell up
```

One attempt, then armed: ~31 s after the boot the root channel was back with
**no browser and no operator action**. After the reboot the unit had exactly
one supervisor (pid 5754) and one node (pid 5765), `:1F48` LISTEN, the
package installed, and both `ACCEPT tcp … dpt:8008` rules present in
`INPUT` and `FIREWALL_IN_EULAON`.

## 4. Traps measured on this build

### 4.1 A `*/` inside a block comment ends the comment

The canonical service source carried the line

```js
 * /proc entry, so scanning /proc/*/cmdline for "rshell.js" never succeeds and
```

The `*/` in `/proc/*/cmdline` **closes the block comment**. Everything after
it is parsed as code and the host reports the error 90 lines away from the
real cause:

```
SyntaxError: Unexpected token 'for'
```

This one nearly shipped: the file was already deployed when the TV's own
Node rejected it. The local syntax gate (see 4.2) catches it in one second.

### 4.2 Ship a syntax gate, not a syntax hope

`tools/ur9s/web/syntax/jsparse2.html` loads a file as an inline script and
reports `ERROR line <n> col <m>`; `jsbisect.html` recompiles the file with
each line removed in turn and lists the lines whose removal makes it parse.
Both are served by `tools/ur9s/web/server.ps1` on `/syntax/<name>` and can be
run headless:

```powershell
& '…\msedge.exe' --headless --disable-gpu --dump-dom `
    'http://<host>:9000/syntax/jsparse2.html#/pub/recon-probe3.js'
```

The same gate on the TV itself: `new vm.Script(fs.readFileSync(file))` through
the vendor Node runtime.

### 4.3 The service cannot see the root process in `/proc`

The first version of the service looked for the running node by scanning
`/proc/*/cmdline`. The node runs as **uid 0**, the service runs as **uid
314**, and the phoenix domain cannot read another domain's proc entry — so
the check never succeeded and the service re-installed the package every 25 s
forever (24 attempts before it was noticed).

Fix: the supervisor publishes the node pid in `/APPS/.re_sshd/rshell.pid`
(mode 644), and the service uses that, with a TCP probe of
`127.0.0.1:8008` as a fallback.

### 4.4 Killing the supervisor does not kill its child

The `postinst` kills the supervisor by pid, but the node it started survives
and keeps port 8008 bound. The next supervisor then loops on `EADDRINUSE`
every 3 s and the log grows without bound (51 KB in two minutes).

Fix, both ends: the supervisor tracks its child and kills it on exit
(`trap` + `wait`), and the `postinst` stops **every** process whose cmdline
mentions `rshell.js` before starting a new one. The log is also capped at
256 KB by the `postinst`.

### 4.5 Do not kill the rshell from inside the rshell

A cleanup script that killed all `rshell.js` processes also killed the node
serving its own shell — the script died mid-way and the port stayed closed.
From inside the channel, never mass-kill `rshell.js`; use the `postinst`
(the `opkg` path) or the supervisor's own lock.

### 4.6 `busybox reboot` is a no-op here

`busybox reboot` returns 0 and nothing happens. The vendor binary
`/usr/local/bin/reboot` (with `/sbin/reboot -> halt` as an alternative) does
reboot the unit — the connection drops immediately, but the system actually
restarts ~40 s later.

### 4.7 busybox applets are not symlinked

`/usr/local/bin/busybox` is present, but there is no `/usr/local/bin/tail`,
`cat`, `sed`… The applets are invoked as `/usr/local/bin/busybox <applet>`.
`/bin` carries the toybox applets (`awk`, `base64`, `cat`, `chmod`, …) and
`/etc/profile` puts `/bin` on the PATH.

### 4.8 A UTF-8 BOM breaks the operator gate

`Set-Content -Encoding UTF8` on Windows PowerShell 5.1 writes a BOM. The
install page compares the operator flag file byte for byte, so the BOM made
it never match (`phase.txt` = `BOM + "2"`). The file must be written without
a BOM (`[System.IO.File]::WriteAllText(path, "2", (New-Object
System.Text.UTF8Encoding($false)))`).

### 4.9 The install reply times out, and that is normal

The `82` install answer arrives late (opkg + `postinst` run first): the
socket call times out after 15 s while the daemon is still working. The
install is verified through `/tmp/ipk_install_result` and
`/tmp/ipk_install_status` instead — both `chown 314:314`, so the app context
can read them without root. Error codes seen on this build: `91:-1` (the
file does not exist) and `91:606` (already installed / busy).

## 5. What is installed on the TV

| Path | Owner | Purpose |
|---|---|---|
| `/APPS/.re_sshd/rshell.js` | root:root 644 | the Node root-shell server |
| `/APPS/.re_sshd/rshell.sh` | root:root 755 | supervisor (`setsid`, pid file, restart loop) |
| `/APPS/.re_sshd/sh` | root:root 755 | the root shell wrapper (`/etc/profile` → bash) |
| `/APPS/.re_sshd/rshell.pid` | root:root 644 | node pid, published for the boot service |
| `/APPS/.re_sshd/boot_marker.txt` | 314:314 644 | boot service log |
| `/APPS/.re_sshd/installer.ipk` | root:root 640 | the IPK the boot service installs |
| `/APPS/.re_sshd/installer_log.txt` | root:root 644 | last `postinst` log |
| `/APPS/installer.ipk` | 314:314 644 | the IPK as fetched by the page |
| `…/CHA/services/re_sshd/{index.js,package.json}` | 314:314 640 | the boot-persistence service |
| `…/CHA/services/serviceList.json` (+ `.pristine`) | 314:314 640 | service registry, with the `re_sshd` entry |
| `…/CHA/functions/fetch/{trigger65_ur9s.js,reconprobe*}` | 314:314 | the FaaS modules used during the run |
| package `re.installer` | — | vendor package store, status `install user installed` |

Nothing outside `/APPS` was written. `/` is `erofs` + `dm-verity` and was
never touched; the only kernel-visible change is two `iptables` rules in RAM.

## 6. Teardown

```sh
# 1. the boot service first, or it will re-install the package on the next boot
cp /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json.pristine \
   /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json
rm -rf /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd

# 2. the package and the root channel
opkg remove re.installer
rm -rf /APPS/.re_sshd
rm -f /APPS/installer.ipk
rm -f /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/trigger65_ur9s.js
rm -f /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/reconprobe*.js
rm -f /APPS/.recon_probe_result*.json

# 3. close the port
iptables -D INPUT -p tcp --dport 8008 -j ACCEPT
iptables -D FIREWALL_IN_EULAON -p tcp --dport 8008 -j ACCEPT
```

Step 3 matters: the vendor `FIREWALL_IN_EULAON` chain ends in `-j DROP`, and
the `ACCEPT` for 8008 was inserted at its head, so deleting it restores the
vendor policy exactly.
