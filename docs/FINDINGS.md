# alvidaa — FINDINGS (index)

The lab notebook. Every discovery gets written down the moment it happens;
the blog and [STORY.md](STORY.md) draw from these files. Split into modules:

| Module | Contents |
| --- | --- |
| [01-mqtt-bridge.md](findings/01-mqtt-bridge.md) | SSDP discovery, RemoteNow/MQTT channel, the 2024 auth gate (cert + dynamic credentials), pairing quirks (PIN rotation, wildcard-sub denial), broker quirks, app self-install, the VIDAA browser. |
| [02-operations.md](findings/02-operations.md) | Pi deployment, keys hygiene, one-server-per-TV rule. |
| [03-bridge-internals.md](findings/03-bridge-internals.md) | Device identity (MTK9602, Chromium 111 armv7), the bridge's three layers (shims → localhost:9009 → phoenix/Node), the `/APPS` sandbox and the `../` escape, raw API (no auth, CORS `*`), lane assessment. |
| [04-privilege-map.md](findings/04-privilege-map.md) | Who runs what: mounts (dm-verity vs rw+exec), accounts, the boot chain, `deploy_oem_data.sh` (root file deployer), `set_ipk_path.sh`, phoenix's environment. |
| [05-root-primitive.md](findings/05-root-primitive.md) | The UART console gate (`key_check.sh` fully reversed), the `/var/local/otaTest.sh` root boot hook, remote page loading via `/api/open`, root confirmed + the harvest, the toolbox inventory (`iptables`, `opkg`, bash `/dev/tcp`). |
| [06-ssh-gauntlet.md](findings/06-ssh-gauntlet.md) | Static dropbear via `zig cc`, Hisense's EULA firewall, and the five locks (firewall, key path, `/etc/shells`, perms walk, gate-as-shell) with the hook-version counters. |
| [07-root-summary.md](findings/07-root-summary.md) | The kill chain end-to-end, working state (`server/tv`), eMMC map, teardown path. |
| [08-image-exploration.md](findings/08-image-exploration.md) | Loewe chassis bones, the multi-brand ODM platform (CVTE/Cultraview), CVTE factory remount scripts, DEV build marker. |
| [09-endpoints.md](findings/09-endpoints.md) | The complete vidaahub.com service map, telemetry API surface, `/data` silos. Live tiers in `firmware/ENDPOINTS.md` (gitignored working copy). |

## Status snapshot (Oct 30)

- **Root**: persistent boot-time code exec via `/var/local/otaTest.sh` (v10 +
  rolling `.bak` on the TV; every version installable remotely over MQTT).
- **SSH**: `server/tv` → dropbear 2222, key-only, from the laptop, every boot.
- **Wiretap**: `iptables` LOG rules (`TVOUT`/`TVDNS`, v4+v6) live and
  persisted via `/var/local/tvrc`, sourced by the boot hook.
- **Firmware**: all 12 partition images dumped to the Pi, rootfs unpacked;
  endpoint map drafted (`firmware/ENDPOINTS.md`).
- **Untouched by design**: read-only partitions (verified boot, locked/green).

## Open questions

- ~~Preset app deletion~~ — superseded: root makes the whole `Appinfo.json`
  and channel layout addressable; revisit via the UI code on channelA.
- ~~Boot-time takeover preset slot~~ — superseded: R2 found
  `hisense_stage0.sh` and the stock home's webpack loader; the native-home
  shim is the cleaner answer (LAUNCHER_V2.md R5).
- ~~Does `HiUtils_createRequest` survive firmware updates~~ — the deeper
  question is moot while OTA is frozen; the hook re-arms everything else.
- What domain does `hi_logreport_service` actually upload to? (runtime
  `getDomain` — read it from the `TVOUT` wiretap once a few days of data
  accumulate.)

## Next actions

1. **Wiretap window** — let the `TVOUT`/`TVDNS` log accumulate ~3 days,
   then resolve IPs → confirm the telemetry upload host → finalize the
   block tiers in `firmware/ENDPOINTS.md`.
2. **`tvfw` canary** — push a `/var/local/tvfw` drop-in (sourced by the
   hook like `tvrc`) blocking ONE ad domain (`recommend-ui.vidaahub.com`),
   reboot remotely, verify the TV still works, then roll out the tier-1 set.
3. **Hook v11** — dedup the stacked iptables ACCEPT rules, source `tvfw`,
   and add a kill-switch file check (`/var/local/hook.off`) so a bad
   iteration can never boot-loop the TV.
4. **Tailscale on the TV** — static armv7 `tailscaled` in
   userspace-networking mode (no `/dev/net/tun` dependency), state on
   `/var/local`, started by the hook; TV becomes reachable over the
   tailnet from anywhere, MagicDNS name, no firewall exposure. Login URL
   can even be opened on the TV via `/api/open`.
5. **GitHub publish decision** — the repo would genuinely help 2024+ VIDAA
   owners stuck on the "app no longer compatible" wall; scrub keys/tokens
   first.