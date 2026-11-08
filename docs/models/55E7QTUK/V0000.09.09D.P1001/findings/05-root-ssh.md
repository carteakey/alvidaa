# 05 — Root SSH achieved (2026-11-08)

Phase 3 on a 55E7QTUK (`09.09D.P1001`, MTK9603, armv7 userland, enforcing
SELinux — [04](04-selinux-and-hook.md)). Executed the 100U7Q/75UR9S/55A7KAU
superwatch chain end-to-end on this unit, with owner authorization
("block OTA, and then arm it"). Read-write on rw partitions only; verified
boot untouched; `/OAD` never written.

## The chain that worked (verified)

```
TV browser page (fetcher FaaS, wss://localhost:9888 start + vowOS syncExecute)
  └─ fetchFile: settings installed as uid 314:
       /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/alvarm2.js  (forwarder)
       /APPS/installer.ipk
  └─ POST http://localhost:9009/function/basic/fetch/alvarm2      (fresh name per arm!)
       body {"list":[ "<sid>:54:<sid>;re.installer",
                      "<sid>:53:<sid>;/APPS/installer.ipk;re.installer;" ]}
        └─ superwatch_server (root, /var/run/superwatch_socket, 0660 0:616)
             └─ wire: 4-byte LE length prefix + payload
             └─ ipk_install.sh → opkg --force-reinstall install re.installer
                  └─ postinst: Uid 0, CapEff 000001ffffffffff
                       ├── OTA freeze FIRST: REJECT 8.8.8.8/8.8.4.4 (DoH/DNS
                       │   hard lane) + REJECT 131.189.69.51 (ota-tv +
                       │   upgrade-plc host; CDN-shared with auth/file-ul —
                       │   collateral accepted by owner)
                       ├── deploys static ARMv7 dropbear 2026.94 (this
                       │   session's own build; 0 DT_NEEDED) at /APPS/.re_sshd
                       ├── keys-only dropbear on 0.0.0.0:8008 with
                       │   -D /APPS/.re_sshd/root_home/.ssh (per-TV ed25519 key)
                       ├── /APPS/shell whitelist (/bin/sh + /bin/bash)
                       └── accepts 8008 in FIREWALL_IN_EULAON
                            └─ ssh -i server/keys/e7qtv-root -p 8008 root@192.168.0.246
                                 Uid 0 0 0 0; CapEff 000001ffffffffff
```

## The gauntlet, item by item (all owner-visible, all recorded)

| Check on the way | This unit's answer |
| --- | --- |
| kernel arch for the static binary | **32-bit ARM (EABI5)** — aarch64 static-PIE rejected early exit "cannot execute binary file" (ENOEXEC) — the armv7 build runs |
| dropbear's `DROPBEAR_SVR_MULTIUSER` | **must be 1**: a second `./configure` regenerates `localoptions.h` and silently reverts the patch — children answered every connection `Non-multiuser Dropbear requires a non-multiuser kernel`; banner then kex never followed |
| vendor firewall debug-port blacklist | `FIREWALL_IN_EULAON` chain present; postinst inserts `ACCEPT dpt:8008` at position 1 (deduped) |
| authorized_keys location | `-D` replaces the whole dir component (default `~/.ssh`) — the file must be at `-D dir/authorized_keys`; our patch: `-D $D/root_home/.ssh` |
| login shell factory gate | patched `get_user_shell()` returns `/bin/sh`; the shell-validity check is skipped (patched `getusershell()`) — the build's `/etc/shells` is absent and `/bin/sh` would fail it |
| permissions walk on authorized_keys | patched `checkpubkeyperms()` returns success (vendor /var world-writable by design) |
| OTA freeze from the hook | the rc.local path is SELinux-dead pre-root ([04](04-selinux-and-hook.md)) — the freeze lives in the postinst instead, which is the first thing root |

## The superwatch protocol on THIS unit (measured, per id)

- Frame: **4-byte little-endian length + payload** (`\x04\x00\x00\x00sid:rc` replies; the first `\x05…50:-1` read bare then Chapel-parsed correctly once framing used)
- Payload grammar: `<sid>:<cmd>:<sid>[;<ipk>;<pkg>[;<options>]]`; sids any small ints
- **install = `53`**; **uninstall = `54`** — `85` (09.60's read-only getdirusage) replies `604` here too, matching the a7KAU finding that the 09.09 family renumbered
- Install result: `/tmp/ipk_install_result` written **only on failure** (`{"code":400,…,"msg":"ipk file … not exists"}` verified); success = the file stays EMPTY — poll `/APPS/.re_sshd/installer_log.txt` instead
- Uninstall replies `0` even when the package isn't installed (idempotent)

## Traps recorded (each reproducible on this build)

- **The FaaS `require` cache is the long-lived trap**: replacing
  `functions/fetch/sw2.js` and POSTing the SAME module path runs the
  OLD file from the phoenix process's module cache — the file's new
  content only loads under a NEW function name. Rule: every functional
  iteration gets a fresh function file name (this is why the final two
  functions are `alvarm2.js` / `alvdiag2.js`).
- **`fetchFile` from the wrong origin deletes the target** — artifacts
  served from the page's own origin only.
- **Binary reads through hiutils kill the bridge** (confirmed a second
  and third time with the iptables/phoenix ELF probes) — text files only.
- **Rapid synchronous fileRead bursts jam the bridge** — one call per
  ~1.3 s.
- The vendor opkg config is NOT at `../opt/apps/opt-pkgs/opkg.conf` on
  this unit (layout diverged) — arch string taken from the mtk9603-side
  family record (`Architecture: mtk9603` accepted by opkg).
- `id`/`uname` do NOT exist in the vendor PATH even with the fixed
  PATH export — read identity updates via `/proc/self/status` fonts.
- The FaaS lives in `basic/CHA/functions/fetch/` — the vendor
  `jsservice.system` package this reference assumed absent here doesn't
  exist; all service code reads from `basic`.

## State left on the TV (as-is; not boot-persistent)

- `re.installer` installed (opkg meta at
  `/APPS/pkgs/opkgmeta/info/re.installer.*`); files at `/APPS/.re_sshd/`.
- dropbear-root running keys-only on 0.0.0.0:8008 (`-D` set; `pid=5698`,
  dropped to root after auth; `CapEff 000001ffffffffff` in the session).
- OTA freeze rules active in OUTPUT (session-only — kernel rules do not
  survive a reboot without a persistence mechanism; the DoH lane note
  that the vendor chain re-applies the systems firewall on the fly).
- Function files: `functions/fetch/{sw2,alvdiag,alvdiag2,alvarm,alvarm2,alvproc}.js`
  + results `/APPS/.sw2probe.json` `/APPS/.alvdiag.json` +
  `/APPS/installer.ipk` + `/APPS/.alv_phase3_probe`.
- `/var/local/otaTest.sh` — hook v1 still on disk, **inert** (SELinux
  blocks the exec; it was never chmod'ed into the trusted context). If
  root looks to revisit: `chcon` to the init-trusted type then `chmod 6755`
  would be the next experiment. NOT run today.

## Boot persistence — deliberately not armed

The root session dies at the next reboot (postinst doesn't re-run: the
`md5sum` chain of an opkg install happens once). The two persistence
routes both documented in the repo audits: (a) the 75U8QTUK
`re_sshd serviceList autostart` IPK (postinst reloads the binary at
every boot), and (b) the relocated hook lane (with post-root relabel).
**Persisting root is a separate owner decision** and NOT landed either
way on this TV.

## Teardown (verified commands)

```sh
# kill the session
kill $(cat /APPS/.re_sshd/dropbear.pid)
# uninstall through the server message lane (superwatch 54) or directly:
opkg remove re.installer 2>&1 | tail -2
# files
rm -rf /APPS/.re_sshd /APPS/installer.ipk
rm -f /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/{sw2,alvdiag,alvdiag2,alvarm,alvarm2,alvproc}.js
rm -f /APPS/.sw2probe.json /APPS/.alvdiag.json /APPS/.alv_phase3_probe
rm -f /var/local/otaTest.sh            # inert but resident
# uninstall on OUTPUT (session-only anyway)
iptables -D OUTPUT -d 8.8.8.8 -j REJECT 2>/dev/null
iptables -D OUTPUT -d 8.8.4.4 -j REJECT 2>/dev/null
iptables -D OUTPUT -d 131.189.69.51 -j REJECT 2>/dev/null
```
