# alvidaa v2 — launcher replacement on rooted VIDAA

Status: planning (root landed Oct 2026 — see FINDINGS.md §10 for the recon
story; §10.12 for the toolbox inventory). This document is the launcher-side
plan and the design for moving alvidaa from a Pi-hosted web app to a native
boot-time home. Ownership: this document and everything under `launcher/` +
`server/` belongs to the launcher lane; the firmware/telemetry digging
(binaries, Ghidra, endpoint mapping) lives in the other session.

## Where v1 stands (the baseline v2 replaces)

- Server: Python (`server/vidaa_server.py`) on the Pi (`alvidaa.service`,
  port 8770) — MQTT/TLS bridge to RemoteNow (token auth + auto-refresh),
  HTTP static + WebSocket + `/icon/*` proxy, config-driven allowlist/renames/
  glyphs, home watcher (3s `gettvstate` poll → relaunch).
- TV side: `Home` is a browser app (Type: Browser) written into
  `websdk/Appinfo.json` via `HiUtils_createRequest` — self-installed from the
  page. Stateless page, single canvas, ES2018, pointer+keyboard input.
- Known limitations v2 kills: ~1s stock-home flash before the watcher
  relaunches; Pi is a SPOF (page dead-degrades when it sleeps); every page
  load and control action crosses the LAN; watcher is a poll, not a hook.

## v1 operational lessons the v2 port must honor

These cost us real debugging time; the on-TV port inherits them as requirements:

1. **Wildcard MQTT subscriptions are denied** (SUBACK Unspecified error) —
   subscribe to exact topics only.
2. **Client identity is part of the credential** — client_id is baked into
   `his$…` auth and topic paths; two processes sharing a client_id kick each
   other off the broker. One session per TV.
3. **applist/sourcelist are JSON arrays**, state/token are objects — don't
   filter payloads by shape or you drop half the traffic.
4. **Token lifecycle**: access token 2 days, refresh token 30 days, refresh via
   `platform_service/data/gettoken` with `{"refreshtoken": …}`. Refresh must be
   re-entrant (mid-run expiry recovery) — a 2-day-old process will hit it.
5. **PIN dialogs rotate on re-trigger** — never poll `vidaa_app_connect`.
6. **Reboot/`pm`-state churn empties applist transiently** — treat an empty
   applist as "keep the previous one", never overwrite cache with `[]`.
7. **The browser D-pad is a pointer** — tiles are click hit-tested; keyboard
   events are secondary.
8. **Chrome 77 on a weak GPU**: one canvas at 960×540, no offscreen canvases
   (they render empty), no layered DOM/CSS, ES2018 only, `Cache-Control:
   no-store` on everything.
9. **app TTL 60s**: TV-side installs/uninstalls must surface within a minute.

## R-phases

### R0 — hook v4: guardrails before anything else (other session + this doc)

1. **OTA freeze at the kernel layer**: iptables rules (hook-owned) dropping the
   firmware-update endpoints. Exact endpoints TBD from the binaries/firmware
   dump — candidate list goes to FINDINGS §10 when mapped. An update that
   reseals the root hole mid-project is the only unrecoverable setback.
2. **2323 lockdown**: `telnetd -l /bin/sh` is an unauthenticated root shell on
   the LAN. The hook adds `iptables -A INPUT -p tcp --dport 2323 ! -s
   <trusted-ips> -j DROP` before starting the listener; longer term, stage a
   static dropbear and use key auth instead of telnet entirely.
3. **Kill-switch**: if `/var/local/otaTest.off` exists, hook exits 0 untouched.
   Gives us a one-write disable for every future iteration.
4. **Idempotency + lineage**: every hook revision is versioned, keeps the
   previous as `.bak` (pattern set by `otaTest.v1.bak`), and is verified by
   readback before the reboot that activates it.

### R1 — shell persistence (in flight)

Plug pull → hook v3 fires → static busybox lands → `telnet <tv> 2323` as root.
Immediately after: `reboot` binary test (remote reboots from here on), then the
partition dump (`dd if=/dev/mmcblk0pN | tar/nc → Pi`) for the Ghidra lane.

### R2 — map the home plumbing (needs R1)

Questions the map must answer before any patching:

- What does boot actually launch into the home? (§10.7 boot map +
  `/APPS/channelA` UI tree; `preset.txt` vs `Appinfo.json` vs the kilby
  service that assembles the home.)
- Where is the HOME key handled (which process consumes the remote's HOME and
  what does it start)?
- What is rw vs ro under `/APPS/`, `/usr/local/varlocal/`, `/var/local/`?
- `phoenix` runtime: node version, bundled modules (mqtt? ws? fs write paths),
  how its apps/services are registered and restarted.
- Where the stock home's ad/sponsored components render from
  (`/APPS/channelA` rw — candidate for R6 strip).

Deliverable: a map section in FINDINGS (other session's file — coordinate)
plus a written "writable, read-only, do-not-touch" inventory.

### R3 — telemetry + ads at the kernel/service layer

- iptables rules (hook-owned, persistent) for every endpoint the mapping
  surfaces. Log-first for a few days (`iptables -j LOG`) to see what actually
  phones home, then block everything that isn't the opkg/app_upgrade channel.
- Service-level suppression of `hi_logreport_service`, `mdharvester`,
  `write_stat`, `bizm` — stop + disable autostart in whatever service config
  is rw (kilby configs / init scripts). Network blocks without process
  suppression are half a win.
- AdGuard Home per-client rules (LAN layer) stay as defense-in-depth; with the
  kernel layer in place they become redundancy, not the only line.

### R4 — alvidaa on the TV (the port)

Run the bridge + page server on the TV itself under the `phoenix` Node
runtime; the Pi retires to a fallback.

Port inventory (what `server/vidaa_server.py` does today → Node equivalents):

| Python piece | Node port |
|---|---|
| paho-mqtt TLS client, client cert, dynamic/token auth, exact-topic subs | `mqtt.js` (verify availability on phoenix; else raw MQTT 3.1.1 over net is feasible — we already speak the protocol) |
| token refresh (`gettoken`) | same flow, timer + on-reject recovery |
| ThreadingHTTPServer static + `no-store` | plain http server, `Cache-Control` headers kept |
| hand-rolled WebSocket (`/ws`), push listeners | `ws` lib if present; hand-rolled again if not (the protocol code is ours already) |
| `/icon/<appId>` proxy with disk cache (`iconcache/`) | same, cache to a rw dir; the TV fetching `img.vidaahub.com` directly is fine too but the proxy keeps one origin |
| home watcher (gettvstate poll → launchapp by content) | unchanged; on-TV it can also react faster (loopback MQTT) |
| config.json (only/hidden/rename/inputs/watcher) | same file, rw location on TV |

Open items for the port: where phoenix apps live and how they're registered
(R2), whether outbound TLS with our client cert works from node on-TV, storage
path for `keys/` (tokens.json, certs) and `iconcache/`, and how the service
survives the boot order (MQTT broker on 36669 comes up later than the boot
listeners — the server must retry, our reconnect logic already does).

### R5 — stock home suppressed at the source

Once R2 answers where boot/home selection lives: point the boot/home slot at
alvidaa (Appinfo/preset patch in rw space), remap HOME at the OS level. The
watcher stays deployed as a fallback but should never fire. Success metric:
power-on and HOME land on alvidaa with zero stock-home flash.

### R6 — strip the ad components from the home UI code

`/APPS/channelA` is rw and loads into the home screen — remove the
sponsored/ad components at the source instead of hiding tiles. Do this only
after R2's map and with a file-level backup on the Pi; this is the most
invasive rw-space edit in the plan.

## Coordination

- Launcher lane (this repo, this session): `launcher/`, `server/`, config,
  this document, the v1 wiki pages.
- Root/firmware lane (other session): FINDINGS.md recon sections, hook
  versions, binaries/Ghidra, endpoint mapping, telemetry inventory.
- Shared: `docs/FINDINGS.md` — recon sections are the other lane's; launcher
  sections (this file, v1 sections) are ours. Don't reformat across lanes.
- Never commit: `server/keys/` (certs, tokens), `server/iconcache/`.

## Immediate next actions

1. (User) Plug pull → hook v3 activates → `telnet 192.168.0.12 2323`.
2. (Root lane) 2323 firewall rule + dropbear swap; OTA endpoint freeze.
3. (Launcher lane, now) this document committed; R4 port skeleton prepared
   behind a flag so it can start the moment R2 reports phoenix's runtime shape.
