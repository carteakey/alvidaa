# 11 — Boot persistence verified: `re_sshd` service autostart

**2026-11-07, owner-authorized, supervised reboot.** Root SSH on `:8008` now
comes back **automatically after a reboot**, with no browser and no manual
re-arm. The native Home, its merged apps+inputs list and the Dusk wallpaper
all survived the same reboot. Verified boot stays green.

## Preconditions checked before writing anything

- `git log`: branch `u8qtuk-75-upstream`, HEAD `9885dee`, clean tree.
- `/var/local`: only this session's `/var/local/alvidaa` state; **no**
  `otaTest*` backups and no other agent's state (AGENTS.md rule).
- OTA frozen: `/OAD/AppUpgradeSwitch.json` `upgradeFlag: "0"`,
  `nightupdate.ini` standby/DCm updates off, `/OAD/pkgs/download` and
  `backup` empty. No OTA endpoints poked.
- `/` and `/application` still `erofs ro` (dm-verity); no rootfs writes.
- Manual recovery ready: `tools/u7q/web/rearm.html` served from the Mac on
  `http://<host-ip>:9000/` (findings/08 path), verified HTTP 200 before the
  reboot. **It was never needed** — the server logged only two local curl
  checks, no TV-browser hit. Stopped after the test.

## Two separate questions

| | Before | After |
|---|---|---|
| **Root SSH** (dropbear `:8008`) | Died on reboot; `83`+`82` re-arm via browser (findings/08) | **Auto re-arms at every boot** |
| **Native Home** (`app.js` on `/APPS`) | Assumed persistent, never tested; a boot redeploy could overwrite it | **Verified survived**, byte-identical |

## Mechanism

Proven on [75UR9S](../../../75UR9S/V0000.09.60W.Q0624/README.md#boot-persistence-verified-2026-11-06),
55A7KAU and 43E7DS. This unit has the identical machinery, confirmed by
source inspection before deploying:

- `serviceManager.init()` → `startAutoStartServices("basic",
  ROOT_BASIC_JS/services/serviceList.json)` → every entry with
  `autoStart === true`. No allowlist / `SafeStart` rejection on this build.
- `pathRouter('basic', id)` → `services/<id>` → `new Service(sid_path)`.
- `serviceList.json` existed at
  `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/`, with
  `current -> CHA` (one inode).
- Superwatch ids **83 (uninstall) / 82 (install)** for `re.installer`, same as
  `tools/u7q/web/rearm.html`.
- `/APPS/installer.ipk` (424200 bytes), `/APPS/.re_sshd/dropbear-root` and the
  `sw2.js` FaaS helper were all still present.

Chain at every boot:

```
phoenix (uid 314, group 616)
  └─ serviceManager → startAutoStartServices("basic", …/serviceList.json)
       └─ re_sshd (autoStart: true) → services/re_sshd/index.js
            ├─ await super.start()        ← emits 'started'
            └─ if no :8008 LISTEN in /proc/net/tcp:
                 /var/run/superwatch_socket (4-byte LE length prefix)
                 ├─ "90:83:90;re.installer"                    → 90:0
                 └─ "91:82:91;/APPS/installer.ipk;re.installer;" → 91:0
                      └─ opkg → postinst uid 0 → dropbear on 8008
```

Retries every 5 s for 3 minutes in case superwatch is not up yet. Evidence is
written to `/APPS/.re_sshd/boot_marker.txt` and `/tmp/re_sshd_boot.log`.

## Build-specific corrections (the important discovery)

The sibling sources do **not** port verbatim to `V0000.09.60I.Q0813`:

| | 75UR9S / 55A7KAU | **This build** |
|---|---|---|
| Constructor | `(name, dest)` | `registerService` calls `new Service(sid_path)` — **one argument**; use `(entry)` |
| `start()` | logs, fires `arm()`, never emits `'started'` | **`await super.start()` is mandatory**: this `serviceManager` awaits the `'started'` event for each autostart service before starting the next, so omitting it would **stall the entire autostart list** (including system services) |
| SDK import | `@sdk/baseService.js` (75UR9S) / `globalThis.PHOENIX_LIB` (55A7KAU) | `@sdk/baseService.js`, registered by `run_env.js` → `BASIC_JS_LIB` |
| dropbear check | 75UR9S reads the root-owned pidfile | **`/proc/net/tcp`** (`1F48` / state `0A`); a uid-314 pidfile read can fail and loop the install forever |
| Package ids | 82/83 (75UR9S), 54/53 (55A7KAU) | **83/82** |
| `serviceList.json` hot-reload | none | none — deploy is non-disruptive; entries activate at next boot |

The hook re-runs the **already installed** `re.installer` IPK — the same
documented root-lane mechanism as findings/07/08, not a new payload.

## Files deployed (all byte-verified)

| File | Destination | md5 |
|---|---|---|
| `source/re_sshd/index.js` | `…/services/re_sshd/index.js` | `57876eac454bce2fadd2e7cf136ae12b` |
| `source/re_sshd/package.json` | `…/services/re_sshd/package.json` | `535e620096d8d05201209476a5bf175d` |
| `source/re_sshd/serviceList.json` | `…/services/serviceList.json` | `b1512afe5efa2db3753315b92b17cc2b` |
| `source/re_sshd/boot-persist.sh` | `/var/local/alvidaa/boot-persist/boot-persist.sh` | `3d90b8251db7cfb815d69cc44c38158e` |
| pristine list | `…/services/serviceList.json.pristine` + private Mac copy `firmware/75u8qtuk/boot-persist/` | `8ad68a4ddc0afee959ec651391a165e4` |

Only change to `serviceList.json` is one appended entry
`{"id":"re_sshd","autoStart":true,"isKeepAlive":false}`. Files are owned
`314:314`, mode `0640` (dir `0750`), matching the sibling services. The
marker file is pre-created and owned `314:314` so the uid-314 service can
append despite its root-owned parent directory.

Pre-flight validation: `node --check` and both JSONs locally; `bash -n` on the
helper; **the TV's own Node v20.19.4 parsed `index.js` with `--check` exit 0**;
`./scripts/check.sh` clean. Deploy was non-disruptive (no hot-reload):
SystemUI, SSH and `app.js` were unchanged immediately after.

## Reboot evidence

Sent `/bin/sync` then a detached `/sbin/reboot` over SSH at uptime `84000.41`.

```
SSH silent ~10 s → back at uptime 16.39 (uptime reset = real reboot)
uid 0, CapEff 000001ffffffffff

/APPS/.re_sshd/boot_marker.txt:
2026-11-07T21:39:11.416Z re_sshd start pid=2650 uid=314
2026-11-07T21:39:33.578Z attempt 1 uninstall=[90:0] install=[91:0]
2026-11-07T21:39:38.581Z ARMED: dropbear up
```

- **No browser re-arm was used.** dropbear PID `7550`, fresh pidfile.
- `app.js` md5 still `b6143b2dac510da56591685fb8d6972f`, `350645` bytes,
  `305:909` / `0640` — the launcher survived the reboot untouched.
- SystemUI PID 1561, `PPid 1`, uid 311.
- `/` and `/application` still `erofs ro`; `upgradeFlag: "0"`.
- HAL screenshot, committed as
  [`img/native-home-after-reboot.png`](../img/native-home-after-reboot.png),
  shows the normal Home: `Sat Nov 07 2026`, clock 21:39, merged apps+inputs
  shelf, **Dusk wallpaper persisted**, status `Native · 11 apps · 10 inputs`.
  It contains no device identifiers (PNG has only `IHDR`/`IDAT`/`IEND`
  chunks). The private originals remain in gitignored
  `firmware/75u8qtuk/screenshots/`.
- **Owner confirmed the Home screen is normal.**

## Teardown

One command restores the pre-change state (takes effect at next boot; the
currently running dropbear is unaffected):

```
ssh -p 8008 -i server/keys/vidaa_75u8qtuk_ed25519 root@<tv-ip> \
  '/bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh teardown'
```

That restores `serviceList.json.pristine` (byte-identical), removes
`services/re_sshd/` and the marker. Status check:

```
'/bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh status'
```

The full root-lane teardown (remove `/APPS/.re_sshd`, `/APPS/shell`,
`/APPS/installer.ipk`, `sw2.js`, the `re.installer` package and the firewall
rule) remains as documented in findings/07. Manual re-arm fallback remains
`tools/u7q/web/rearm.html` + `tools/u7q/web/server.py` (restart the server if
needed).

## Trade-off (deliberate)

Previously "root dies on reboot" was a built-in kill switch. Now TCP 8008 is
open **LAN-wide at every cold boot** (key-only, dedicated ed25519 key in
`server/keys/`, gitignored), and a persistent uid-314 service holds group 616
(superwatch socket) access. This is strictly more attack surface, accepted by
the owner. The hook writes only to `/APPS` and `/var/local`; verified boot is
untouched.

## Ground rules

Owner's own TV, LAN-local, no DRM circumvention, no OTA writes, no `/OAD`
staging, no rootfs writes, no device identifiers committed, keys stay in
`server/keys/`, `server/pair.py` not run (Sidee holds the single MQTT session).
Every discovery recorded here the same hour. Commit kept local — pushing would
update upstream PR #28 and is not done without asking.
