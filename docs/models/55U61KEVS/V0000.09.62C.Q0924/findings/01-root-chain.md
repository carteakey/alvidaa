# 01 — Root chain + boot persistence (2026-11-12)

The 100U7Q / 75UR9S / 55E75LEVS chain replayed unchanged on `09.62C`. The three
primitives are the same; nothing new was needed.

## Primitives (all verified on-device)

1. **fetcher `fetchFile` write** — `basic/fetcher` started over `wss://localhost:9888`,
   then `vowOS.service.syncExecute("basic/fetcher", {api:"fetchFile", args:JSON.stringify({url, directory, permission:420})})`.
   Two marker writes returned `{ret:true, "download finished"}` as uid 314:
   - `/APPS/.recon_fetcher_marker`
   - `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/.recon_fetcher_marker`

2. **superwatch socket** — `/var/run/superwatch_socket` 0660 root:616. An in-process
   FaaS probe confirmed `groups` includes 616, `connect()` succeeds, and command
   `85` (GetDirUsage) replies code `0`. Command ids on this branch: **82=install,
   83=uninstall** (same as 55E75LEVS; a bogus-path install `82` replied `-1`, uninstall
   `83` replied `0`).

3. **opkg `postinst` as root** — install `82` of the installer IPK ran the `postinst`
   with `Uid: 0 0 0 0`, `CapEff: 0000003fffffffff`.

## Installer

Minimal root-SSH-only IPK (`re.installer`, `Architecture: mtk9618`): the `postinst`
moves a patched static ARMv7 (EABI5) Dropbear into `/APPS/.re_sshd`, writes the owner
key, generates an ed25519 host key, opens `/dev/ptmx`, accepts 8008 in
`FIREWALL_IN_EULAON`, and starts key-only dropbear on `0.0.0.0:8008`. Built from
Dropbear 2022.83 via the `tools/u7q` recipe (fill_passwd + `/etc/shells→/APPS/shell`
patch) with an Arm GNU toolchain.

Result: `ssh -p 8008` → uid 0, `CapEff 0000003fffffffff`, PTY.

## Boot persistence

`re_sshd` autostart service (the verified 75U8QTUK source, byte-compatible with this
build's `@sdk/baseService.js` contract) + one `serviceList.json` entry. On a real cold
boot the service re-ran the `83`/`82` install and re-armed dropbear ~30s in:

```
17:57:37  re_sshd start pid=2911 uid=314
17:58:01  attempt 1 uninstall=[90:0] install=[91:0]
17:58:06  ARMED: dropbear up
```

The launcher `app.js` survived the same reboot byte-identically.

## Command-id discovery (for future 09.6x units)

Ids are per-branch and must be probed, not assumed. On this unit `85` (GetDirUsage)
returned `0`, confirming the "80/82/85" numbering family (not the 55E7QTUK "53/54").
A bogus-path install `82` is the safe way to confirm the install id without mutating:
it reaches opkg and fails "not exists" (`-1`), leaving the package manager untouched.
