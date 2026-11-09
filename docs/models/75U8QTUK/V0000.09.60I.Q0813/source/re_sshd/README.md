# `re_sshd` — boot-persistence service for the 75U8QTUK

Byte-for-byte sources deployed on 2026-11-07. Adapted from the verified
[75UR9S](../models/75UR9S/V0000.09.60W.Q0624/source/re_sshd/) and
[55A7KAU](../models/55A7KAU/V0000.09.09O.P1015/source/re_sshd/) services,
with **build-specific corrections** for `V0000.09.60I.Q0813` (see below).

| File | Deployed to |
|---|---|
| `index.js` | `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/index.js` |
| `package.json` | `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/re_sshd/package.json` |
| `serviceList.json` | `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/serviceList.json` |
| `boot-persist.sh` | `/var/local/alvidaa/boot-persist/boot-persist.sh` (on-TV helper) |

`current -> CHA` is a symlink, so `current/...` and `CHA/...` are the same
inodes. The staged copies live at `/var/local/alvidaa/boot-persist/`.

## Chain

```
boot
  └─ phoenix (uid 314, groups incl. 616)
       └─ serviceManager.init()
            └─ startAutoStartServices("basic", ROOT_BASIC_JS/services/serviceList.json)
                 └─ re_sshd (autoStart: true) → services/re_sshd/index.js
                      ├─ await super.start()      ← emits 'started', unblocks the queue
                      └─ if no :8008 listener in /proc/net/tcp:
                           /var/run/superwatch_socket (4-byte LE length prefix)
                           ├─ "90:83:90;re.installer"                  (uninstall)
                           └─ "91:82:91;/APPS/installer.ipk;re.installer;" (install)
                                └─ opkg → postinst uid 0 → dropbear on 8008
```

Retries every 5 s for 3 minutes in case superwatch is not up yet. Proof is
written to `/tmp/re_sshd_boot.log` (tmpfs) and
`/APPS/.re_sshd/boot_marker.txt` (pre-created, owned `314:314`).

## Build differences vs the sibling sources

| | 75UR9S / 55A7KAU | **75U8QTUK (09.60I)** |
|---|---|---|
| SDK import | `@sdk/baseService.js` (75UR9S) / `globalThis.PHOENIX_LIB` (55A7KAU) | `@sdk/baseService.js` (alias set by `run_env.js` → `BASIC_JS_LIB`) |
| Constructor | `(name, dest)` | **`new Service(sid_path)`** — one argument; use `(entry)` |
| `start()` | logs and fires `arm()`; never emits `'started'` | **`await super.start()` required**: this `serviceManager` awaits the `'started'` event for every autostart service, so omitting it would stall the whole autostart list |
| dropbear check | 75UR9S reads the pidfile | **`/proc/net/tcp`** (`1F48` / state `0A`); the pidfile is root-owned and a uid-314 read can fail, causing an endless install loop |
| Package ids | 82/83 (75UR9S), 54/53 (55A7KAU) | **83 = uninstall, 82 = install**, identical to `tools/u7q/web/rearm.html` |
| `serviceList.json` hot-reload | none | none — entries take effect at next boot |

## Deploy / verify / teardown

```sh
# stage the four files into /var/local/alvidaa/boot-persist/ over SSH, then:
ssh -p 8008 -i server/keys/vidaa_75u8qtuk_ed25519 root@<tv-ip> \
  '/bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh deploy'
ssh ... '/bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh status'
# supervised reboot, then verify 8008 + launcher
```

**Teardown** (restore pristine list, remove service dir and marker):

```sh
ssh ... '/bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh teardown'
```

`serviceList.json.pristine` is the byte-identical pre-change copy, also
mirrored privately on the host in `firmware/75u8qtuk/boot-persist/`
(gitignored). Restoring it stops the hook at the next boot; the currently
running dropbear is unaffected.

## Safety

- Writes only to `/APPS` and `/var/local` (both ext4 rw). `/` stays
  `erofs ro` with dm-verity; verified boot stays green.
- No `/OAD` staging writes, no SUID (all persistent mounts are `nosuid`),
  no new keys, no OTA endpoints poked (OTA already frozen:
  `upgradeFlag: "0"`).
- The hook re-runs the *already installed* `re.installer` IPK — the same
  documented root-lane mechanism as findings/07/08, not a new payload.
- Manual recovery if the hook ever fails: `tools/u7q/web/rearm.html` served
  by `tools/u7q/web/server.py` (findings/08).
