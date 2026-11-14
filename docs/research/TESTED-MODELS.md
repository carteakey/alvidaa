# Tested models & how to report yours

The README carries a compact matrix (model, firmware, launcher, root, who). The
full table with every field lives below; this file also explains where each
field comes from. A full step-by-step guide, when one exists for the exact model and
firmware, lives under [models/](../models). To report by PR, add an entry to
`inventory.json` and run `scripts/gen-inventory.py` to update the README
and playbook tables.
For a method-specific result, also add an observation to `exploits.json`
and run `scripts/gen-exploits.py`; the generated [method inventory](EXPLOITS.md)
separates reported results, verified results, and failed tests.

## The full matrix

Every field, for every reported unit. The README carries a compact version
because its column is narrow; this is the one to read when you are comparing
builds.

<!-- INVENTORY:START -->
| Model | Region | SoC | VIDAA OS | Firmware | `transport_protocol` | Browser | Launcher | Root chain | Tested by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50A51HUV | US/CAN | MTK9602 | U09.01 | 09.01O.P0813 | 3290 | Chromium 111 "odin" | working | achieved | [@carteakey](https://github.com/carteakey) |
| 55S7NEVS (MT9618 unit; S7N board family — same build covers 55U75LEVS / 65S7NAVS / 75S7NAVS) | EU | MTK9618 | U09.60 | 09.60X.Q0609 (2026-06) | ? | Chromium 111 | untested | achieved | [u/possibly_matt](https://reddit.com/user/possibly_matt) |
| 55A60LEVS | EU_A | MTK9603 | 9.0 | 09.60V.Q0612 (2026-07 EU_A) | 3290 | Chromium 111.5563.5.1 | untested | blocked | [u/Affectionate-End-601](https://reddit.com/user/Affectionate-End-601) |
| 43A60LEVS | EU | MTK9603 | 9.0 | 09.60V.Q0612 (2026-07) | 3290 | Chromium 111 "Odin" (111.5563.x) | untested | untested | [u/Wing-Tsit-Chong](https://reddit.com/user/Wing-Tsit-Chong) |
| ? | ? | MTK9603 | 9.0 | 09.60V.Q0612 (build date unconfirmed) | ? | ? | untested | untested | [u/____dls](https://reddit.com/user/____dls) |
| 65U8HAU (65E83GAVT, serial type 65U8H / intl 65U8HQ) | AU (EM_C / AUS, SSDP region 0) | MTK9900 (aarch64) | U06.29 | V0000.06.29X.P0813 (AU) | 3160 | Chrome 88.0.4324.182 (Linux aarch64, Odin) | working | blocked | [@MewX](https://github.com/MewX) |
| 65U7H (board 65A65GAVT) | India (EM_C, countryID IND) | MTK9900 (aarch64) | U06.29 | V0000.06.29X.P0813 (IN) | 3160 | Chrome 88.0.4324.182 (Linux aarch64, Odin) | untested | blocked | [u/pavanjadhaw](https://reddit.com/user/pavanjadhaw) |
| HE40E5600FFWTS | ? (EU, German-language docs) | MT53xx / MT5863 class (armv7 Cortex-A53) | pre-9 (Linux 3.18.25, glibc 2.18, BusyBox 1.18.5, sysvinit) | V0100.01.00A.N0410 | untested (vector did not use MQTT) | hisenseUI (Chromium 59.0.3071.115, opera4x) + hisense_browser (separate process, DevTools 9224, --disable-web-security) | untested | achieved | [@oOHiyoriOo](https://github.com/oOHiyoriOo) |
| 100U7Q (100U70QEVS) | EU_A | MT9655 (32-bit ARM userland) | U09.60 | V0000.09.60I.Q0813 | untested | untested | untested | achieved | [@oOHiyoriOo](https://github.com/oOHiyoriOo) |
| 75UR9S | EU (Czech Republic) | MT9655 (32-bit ARM userland) | U09.0 | V0000.09.60W.Q0624 | untested | untested | untested | achieved | [@EvzenP](https://github.com/EvzenP) |
| 43E7DS (43Q60SEVS_02, serial type 43E7SE) | EU_A (DEU) | MTK9603 | U09.60 | 09.60W.Q0612 (EU_A) | ? | Chromium 111 "odin" (multi-shell UAs: WebExplorer/1.2.8, SurfMaster/7.0.0, Weblayer, NetSurfer) | working | achieved | [@ryjr2ddznn-lab](https://github.com/ryjr2ddznn-lab) |
| 50A6Q (50A60QXVT) | UAE / intl (SSDP region 4) | NT72690 (Novatek; aarch64 kernel, armhf ELF32 userland) | U09.61 | V0000.09.61B.Q0721 | 3290 | Odin Chromium 111.5563.5.1 (aarch64) | untested | achieved | [@aadnaane](https://github.com/aadnaane) |
| 55A7KAU (internal 55U66GAVT) | AU (AUS; GetCountryCode AUS, SSDP region 6) | MTK9602 | U09.09 | V0000.09.09O.P1015 | 3290 | Chromium 111 "odin" | working | achieved | [@JacksonDCollins](https://github.com/JacksonDCollins) |
| 75U8QTUK | UK (GBR; internal region EU_A) | MTK9655 (aarch64 kernel; 32-bit ARM userland confirmed on-device: phoenix worker process.arch=arm, 2026-11-06) | U09.60 | V0000.09.60I.Q0813 (UK) | not-exposed-over-SSDP (dd.xml stub on :3366; SSDP modelName reports 75U8QE; pairing handled by Sidee, profile 'modern') | Chromium 111 "WebViewer/1.2.1" (odin, aarch64 UA) | working | achieved | [@kingpandacc](https://github.com/kingpandacc) |
| 43A5LE (internal 43A60LEVS_0002) | EU_A (ITA) | MTK9603 | U09.60 | V0000.09.60A.Q0707 | ? | Chromium 111 (armv7l; UA SurfMaster/3.0.1) | working | untested | [@antmagl](https://github.com/antmagl) |
| 43A5FE | EU | MTK9602 | U07.51 | V0010.09.09A.P0930 | 3290 | Chromium 111 "odin" | working | achieved | [@gitgost-sa2](https://github.com/gitgost-sa2) |
| 55E7QTUK (internal 55E70QEVS_0002, serial type 55E7QE) | UK (GBR; bridge region EU_A; SSDP blob region=0) | MTK9603 | U09.09 | V0000.09.09D.P1001 (UK) | 3290 | Chromium 111 "odin" (armv7l UA, Odin/111.5563.5.1, api 3.0.1) | working | achieved | [@damiennnnn](https://github.com/damiennnnn) |
| 32A35HUV | CAN | MTK9602 | U09.01 | V0000.09.01O.P0814 | 3290 | Chromium 111 | working | achieved | [@EmoFa](https://github.com/EmoFa) |
| 50A7HAU (internal 50A6GA) | AU (Australia) | MTK9602 | U06.12 | V0000.06.12X.N1212 | 3290 | Chromium 88.0.4324.182 (armv7l) | untested | untested | [@gonzule](https://github.com/gonzule) |
| 55E75LEVS | EU_A (BIH) | MTK9618 (mt5879; aarch64 kernel, armhf userland) | U09.61 | V0000.09.61B.Q0704 | 3290 | Chromium 111 "odin" (ViewPort/5.2.20, aarch64 UA) | working | achieved | [@mustafaGlobal](https://github.com/mustafaGlobal) |
| 43A6K (internal 43A53FEVS_0011) | EU_A (SSDP region 0) | MTK9602 (DevKit platform MTK9602_EU_A; armv7l) | U09.09 | V0000.09.09C.P0930 | 3290 | Chromium 111.0.0.0 UA / odin (armv7l; exact patch unconfirmed) | working | achieved | [@Hlushok](https://github.com/Hlushok) |
| 65C350LE (Toshiba-branded) | ? | ? | U09.09 | V0000.09.09H.P0930 | not-exposed-over-SSDP (dd.xml stub on :3366 carrying only friendlyName/manufacturer/modelName; pairing handled by Sidee, profile 'modern', brand 'tos') | ? | untested | untested | [@VaheSaroyan](https://github.com/VaheSaroyan) |
| 50U7DSE (internal 50U73SEVS_01, serial type 50U7SE) | EU_A (DEU) | MTK9618 (mt16587/mt5879; aarch64 kernel, armhf userland) | U09.62 | V0000.09.62N.Q0923 | 3290 | Chromium 111 "odin" (multi-shell UA: Weblayer/1.2.1, WebNavigator/6.1.10; aarch64) | working | achieved | [@roelven](https://github.com/roelven) |
| 65A85QEVS | EU_A (Czech Republic) | MTK9618 (aarch64 kernel, 32-bit ARM userland) | U09.60 | V0000.09.60A.Q0602 | untested (SSDP silent; 36669/7000 only) | odin resources present; UA not recorded | untested | achieved | [@LastThylacine](https://github.com/LastThylacine) |
<!-- INVENTORY:END -->

## What each token means on each unit

Every capability cell above is a single vocabulary token —
`working | gated | closed | open | armed | achieved | blocked | untested | n-a` —
so the matrix stays sortable and diffable. The measurement behind the token
lives in the optional `capability_detail` object of the same row in
`inventory.json` and renders below. Generated by `scripts/gen-inventory.py`;
never hand-edit between the markers.

<!-- INVENTORY_DETAIL:START -->
**50A51HUV — 09.01O.P0813**
- `launcher` **working** — Canvas lanes 1 and 2 plus the native lane 3 are live on this unit; lane 3 owner-confirmed 2026-11-09 with the Free My TV generic build.
- `native_home` **working** — Free My TV generic build, owner-confirmed 2026-11-09; the Inputs/Settings/app-launch paths are not yet exercised (findings 13).

**55A60LEVS — 09.60V.Q0612 (2026-07 EU_A)**
- `root` **blocked** — Blocked at the fileWrite gate: this build offers no write primitive for the fetcher/postinst chain. Community report, no model guide; validator and identity-gate shape in notes.

**65U8HAU (65E83GAVT, serial type 65U8H / intl 65U8HQ) — V0000.06.29X.P0813 (AU)**
- `launcher` **working** — Web UI + WebSocket + server-side install and Home-watcher bounce verified; the Appinfo.json self-install lane stays gated (see file_bridge_write).
- `file_bridge_traversal` **gated** — /file/fileRead of ../etc/shells and ../proc/version returns an empty body from a LAN HTTP origin (4 mode bases 0..3). The earlier 65U7H community claim of an open bridge did not reproduce here and has no public source.
- `file_bridge_write` **gated** — /file/fileWrite returns an empty body from a LAN HTTP origin.
- `identity_gate` **working** — The origin gate on /file/* and /hiSecurity/* is the identity gate in effect; /tvapi/initialData and /tvapi/deviceCode stay ungated and deviceCode is unmasked.
- `euladpp_untar` **gated** — /file/fileRead of ../APPS/euladpp/* returns an empty body from a LAN HTTP origin — the arming condition cannot even be read, let alone armed.
- `devtools_forge` **gated** — /tvapi/deviceCode is unmasked and TCP 9226 unfiltered (ECONNREFUSED), but /hiSecurity/* returns an empty body from a LAN HTTP origin, so the checkAccessCode forge is unreachable from this origin.
- `root` **blocked** — Blocked at the origin gate: /file/* and /hiSecurity/* return an empty body from LAN HTTP origins, and TCP 2222/2323/8008 are firewall-dropped. See the model guide's MODDING.md (LAN TCP port filter / DevTools surface).

**65U7H (board 65A65GAVT) — V0000.06.29X.P0813 (IN)**
- `pairing` **working** — Credentials are issued, but the ui_service actions stay silent: pairing completes, control does not.
- `file_bridge_traversal` **working** — WebSDK file bridge (POST localhost:9009/file/<api>) with ../ traversal, origin-gated to vidaahub.com and working over plain HTTP too. Mode bases 0=/tmp, 2=channelA, 6=/APPS, 7=/OAD.
- `file_bridge_write` **working** — Same WebSDK route as traversal; binary reads NUL-truncate and POSTs to /hiSecurity/* kill the handler with nothing supervising it back.
- `root` **blocked** — No exec door found on this build — bridge reads and writes, rc.local ships the /var/local/otaTest.sh call commented out, and /hiSecurity/* POSTs kill the handler. WIP (contributed by pavanjadhaw; issue #2).

**HE40E5600FFWTS — V0100.01.00A.N0410**
- `launcher` **untested** — Custom-UI templates ship (start-UI.sh + /3rd_rw/UI/index.html, PIXI) but the lane was never run end to end.
- `file_bridge_traversal` **open** — The browser runs as uid 0 with full CapEff, single-process, no seccomp — there is no sandbox to escape.
- `file_bridge_write` **open** — File.write is text-only (EINVAL for binary payloads); binaries land via File.download/curl.
- `euladpp_untar` **n-a** — The generation lacks the package.
- `devtools_forge` **n-a** — DevTools is already exposed (hisenseUI on 9223, hisense_browser on 9224) — there is nothing to forge.
- `root` **achieved** — Root + key-only Dropbear SSH on 22 with PTY; boot persistence owner-verified across multiple reboots (2026-11-04) via the HamService wrapper.

**100U7Q (100U70QEVS) — V0000.09.60I.Q0813**
- `root` **achieved** — Key-only root SSH on 8008 with PTY verified. No boot persistence: a real reboot closes 8008, and the chain re-arms with superwatch 83 (uninstall) + 82 (install).

**75UR9S — V0000.09.60W.Q0624**
- `root` **achieved** — Root + key-only SSH on 8008 verified 2026-11-04; boot persistence verified 2026-11-06 — the re_sshd serviceList autostart re-arms dropbear at every cold boot.

**43E7DS (43Q60SEVS_02, serial type 43E7SE) — 09.60W.Q0612 (EU_A)**
- `identity_gate` **working** — The gate blocks the websdk self-install (fileWrite on websdk/Appinfo.json -> 503); the FaaS fetcher write route is not gated.
- `root` **achieved** — The IPK postinst runs as uid 0 (13 installs observed). No Dropbear ships on this build, so persistence comes from the vendor service manager: a two-file service in an already-rw vendor package plus one serviceList.json entry, run at every boot as uid 314 and proven across a power-cycle.

**50A6Q (50A60QXVT) — V0000.09.61B.Q0721**
- `file_bridge_traversal` **closed** — The validator rejects with a literal string, not an errno.
- `file_bridge_write` **gated** — Direct fileWrite returns 503; the ungated fetcher (empty permission block) is the working writer.
- `identity_gate` **working** — Bypassed in-process: an ISC request with origintype=service skips the check.
- `euladpp_untar` **blocked** — /APPS/euladpp/eulaDpp.tar.gz is root-owned.
- `devtools_forge` **achieved** — The checkAccessCode forge is accepted — security level 9, DevTools reachable on 9226.
- `root` **achieved** — Boot-persistent PFM/eval chain running as uid 0 plus key-only SSH on 2222, verified 2026-11-06. The vendor PFM debug framework evals PFMCheck lines as root at boot; a 10 s re-plant loop and a 15 s firewall-strip loop counter the runtime watchdog that deletes the gate flag.

**55A7KAU (internal 55U66GAVT) — V0000.09.09O.P1015**
- `root` **achieved** — Boot-persistent 2026-11-06: the re_sshd serviceList autostart re-arms dropbear at every cold boot with an offline re-arm path. Chain and evidence in docs/models/55A7KAU/V0000.09.09O.P1015/findings/02-root-ssh.md.

**75U8QTUK — V0000.09.60I.Q0813 (UK)**
- `pairing` **working** — Sidee, profile 'modern', applist round-trip 2026-11-06 (findings/02).
- `launcher` **working** — Native DOM Home replaces the /Launcher route component in the writable operation-ui app.js, preserving the vendor lifecycle and routes; app list, inputs, TV Settings and app launch confirmed on screen. v2 merges apps and inputs into one list and adds CSS-gradient wallpapers (findings/09, findings/10); the swap survived a reboot (findings/11). Rollback is one command.
- `file_bridge_traversal` **open** — hiutils.fileRead traverses only with an array path: path:['../proc/uptime'] returns ret:true, while bare-string paths are rejected 'invalid path' (findings/05).
- `file_bridge_write` **open** — The write primitive is the FaaS fetcher: basic/fetcher fetchFile returns ret:true 'download finished', with markers written to /APPS and /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/ (findings/05).
- `root` **achieved** — The 100U7Q chain armed 2026-11-06 (owner-authorized): the IPK postinst ran as uid 0 with CapEff 000001ffffffffff and ssh -p 8008 (dedicated ed25519 key in server/keys/, gitignored) gives uid 0 + PTY, with /etc/shadow and /data readable. Boot persistence achieved 2026-11-07: the re_sshd service re-arms SSH automatically at every boot — a supervised reboot at uptime 84000 s returned SSH at uptime 16.39 s with no browser re-arm (findings/11). The earlier state of this row (no autostart; re-arm with superwatch 83+82) was the pre-findings/11 measurement from findings/08. Teardown: findings/09 (native Home) and findings/11 (persistence hook).

**55E75LEVS — V0000.09.61B.Q0704**
- `launcher` **working** — Native lane 3: the Free My TV component swap in the writable operation-ui app.js, with the owner allowlist (YouTube / Stremio Lite / TV Browser) and the merged inputs shelf; rendered on screen and survived a cold boot. Bridge lanes 1/2 (pairing + home watcher) were not exercised.
- `file_bridge_traversal` **open** — hiutils.fileRead traverses with a one-element array path (../proc/uptime read); bare strings are rejected 'invalid path'.
- `file_bridge_write` **open** — basic/fetcher fetchFile wrote markers as uid 314 to /APPS and to tv.vidaa.jsservice.basic/CHA/; direct hiutils.fileWrite was not tested.
- `devtools_forge` **untested** — not needed for this chain; the superwatch/IPK path was used instead.
- `root` **achieved** — fetcher.fetchFile → superwatch 83/82 → vendor opkg postinst as uid 0 (CapEff 0000003fffffffff); patched static ARM32 Dropbear with key + owner password on :22; boot-persistent via the re_sshd serviceList autostart (ARMED ~30 s after each of four cold boots).

**43A6K (internal 43A53FEVS_0011) — V0000.09.09C.P0930**
- `pairing` **working** — RemoteNow PIN pairing and subsequent control worked; SSDP transport_protocol 3290 was independently read again on 2026-11-12.
- `launcher` **working** — Adapted Alvidaa-based web launcher: app launch, regular/quick TV settings and Home-watcher redirect worked. Native lane 3 was not tested; web relaunch delay remained.
- `native_home` **untested** — Not exercised. A web Home-watcher redirect is not a native Home replacement. Custom poster rows under the stock Home shortcut remain unresolved: the owner still saw the VIDAA placeholder.
- `file_bridge_traversal` **open** — Native HiUtils file bridge mode 6 reads ../ paths, including the stock rc.local and the hook location.
- `file_bridge_write` **open** — Native text fileWrite staged ../var/local/otaTest.sh and was read back exactly; this does not mean every protected path is writable.
- `identity_gate` **untested** — Per-app identity/origin gate behaviour and the ISC/service-origin bypass were not independently tested on this unit; do not infer their result from successful native file-bridge access.
- `euladpp_untar` **untested** — Not tested; the successful root chain used the existing rc.local / otaTest.sh hook instead.
- `devtools_forge` **untested** — Not demonstrated. The DevKit Device Code was obtained, but an unrelated installation key failed Secure Code verification; this is not a test of checkAccessCode forging.
- `root` **achieved** — Owner-confirmed on 2026-11-11/12: stock rc.local invokes otaTest.sh as uid 0; static Dropbear 2026.94 on :2222 accepts password/key commands and static SFTP works. Boot-ID change and automatic SSH return after restart/Power-on verified without browser re-arm. Normal PTY remains nonfunctional (UNIX98_PTYS disabled; legacy pairs allocate but transfer no data).

**65C350LE (Toshiba-branded) — V0000.09.09H.P0930**
- `pairing` **working** — RemoteNow MQTT pairing over :36669 succeeded first try via Sidee (c5d7598), PIN flow, profile 'modern'. The session has held across helper restarts. Reported 2026-11-12.
- `launcher` **untested** — Not alvidaa's launcher. For the record, a third-party canvas launcher (gilbertmsipha/cleanyourtv-vidaa, helper lane) does run end-to-end on this unit: tile install over MQTT, 1080p render in the TV browser, and Inputs/HDMI switching through the helper. That says the browser, tile-install and remote-control paths are open on this build, but says nothing about alvidaa's own lanes.

**50U7DSE (internal 50U73SEVS_01, serial type 50U7SE) — V0000.09.62N.Q0923**
- `launcher` **working** — Lane 3 native Home (Free My TV 75U8QTUK adapter) component swap into operationui app.js; rendered on screen and survived a cold boot. Self-install lane is closed (503 gate).
- `native_home` **working** — Free My TV (75U8QTUK port) component swap; action paths (app launch / input switch / settings) owner-verified on screen (2026-11-11).
- `file_bridge_traversal` **open** — hiutils.fileRead traverses with a one-element array path (../proc/uptime -> ret:true); bare strings are rejected 'invalid path'.
- `file_bridge_write` **gated** — Browser fileWrite (HiUtils_createRequest) returns 503 'client request permission check error, please check appconfig' — the identity gate. The working write primitive is the FaaS fetcher (basic/fetcher fetchFile, uid 314), a different surface.
- `identity_gate` **working** — Per-app {appid,md5,permissions} gate: the 503 appconfig rejection on browser fileWrite. The fetcher write route is not gated.
- `root` **achieved** — fetcher.fetchFile wrote sw2.js + installer.ipk; superwatch 83/82 installed re.installer; postinst ran uid 0 (CapEff 0000003fffffffff) and started key-only Dropbear on :8008. Boot persistence via re_sshd serviceList autostart re-arms dropbear at every cold boot (~30 s).

**65A85QEVS — V0000.09.60A.Q0602**
- `pairing` **untested** — Not exercised: no client cert on the host. The chain needs no pairing.
- `file_bridge_traversal` **open** — hiutils.fileRead traverses with a one-element array path (../proc/uptime -> ret:true); bare strings are rejected. Read-only probe.
- `file_bridge_write` **closed** — Browser fileWrite (HiUtils_createRequest) returns 503 'client request permission check error, please check appconfig'; WebSDK_createFileRequest does not exist on this build. The working write primitive is the FaaS fetcher (basic/fetcher fetchFile, uid 314).
- `identity_gate` **gated** — The 503 appconfig rejection on browser fileWrite; the fetcher route is not gated the same way.
- `root` **achieved** — fetchFile wrote sw2.js + installer.ipk; superwatch 83/82 installed re.installer (Architecture: mtk9618); postinst ran uid 0 and started the Node root shell on :8008. fetchFile cannot create directories, so the PFM payload is planted by the postinst, not by the fetcher.
<!-- INVENTORY_DETAIL:END -->

## Community reports awaiting details

- [uzueta reported](https://reddit.com/r/Hisense/comments/1xj3pc2/comment/19rwnxey9q5j5/)
  that the launcher-only setup worked, but did not provide a model or firmware
  and did not try root. This is a useful launcher report, not a verified matrix
  entry until those details are available; the full watcher flow was not
  separately described.

## Fields

| Field | Where to get it | Why it matters |
| --- | --- | --- |
| Model | TV Settings → Support → device info | panel/board family |
| Region | SSDP device descriptor (`region=`) | ad/OTA server behavior differs |
| SoC | `Hisense_GetChipSetName()` from any page in the TV browser | **decides the root chain** (MTK vs HiSilicon paths differ) |
| VIDAA OS | `Hisense_GetOSVersion()` or Settings → About | feature generation |
| Firmware | `Hisense_GetFirmWareVersion()` or Settings → About | exact build |
| `transport_protocol` | SSDP descriptor (`modelDescription` leaks it) | **the single most predictive number** — selects the MQTT auth generation (3290 = the 2024+ wall) |
| Browser | UA string from any page the TV browser opens | rendering constraints (Chrome 77 vs Chromium 111) |
| Launcher ✅/❌ | pairing → install → watcher | generation-dependent only |
| Root chain ✅/❌ | recon → hook → SSH | SoC-specific |

`Launcher` and `Root chain` (and every other capability) hold exactly one
vocabulary token in `inventory.json`; the prose goes in that row's
`capability_detail`, which the section above renders.
| Tested by / Source | Platform handle in `tested_by` | provenance and attribution without ghost-mentions |

## Getting the numbers

- **SSDP**: M-SEARCH `ssdp:all` finds the TV as a DLNA MediaRenderer; the
  device descriptor's `modelDescription` leaks `mac=`, `region=`,
  `brand=`, `vidaa_support=`, `transport_protocol=`.
  See [01-mqtt-bridge.md](../models/50A51HUV/09.01O.P0813/findings/01-mqtt-bridge.md) §1.
- **From the TV browser**: open any page (e.g. the launcher URL) and call
  the bridge functions via the console, or run
  [launcher/recon.html](../../launcher/recon.html) — its report includes
  chip, firmware, browser, and the whole bridge surface.
- **Root chain fields**: only after reading
  [the 50A51HUV / MTK9602 guide](../models/50A51HUV/09.01O.P0813/README.md) and [SECURITY.md](../../SECURITY.md). The recon page
  alone is read-only and safe.
- **Attribution format** in `inventory.json` (`tested_by` array):
  - GitHub: `"gh:username"` (renders `[@username](https://github.com/username)`)
  - Reddit: `"reddit:username"` or `"u/username"` (renders `[u/username](https://reddit.com/user/username)`)
  - Custom link: `{"name": "...", "url": "https://..."}`

## Template row

```markdown
| 55U8N | EU | MT9602 | U09.01 | V0000.09.01N.N0704 | 3290 | Chromium 111 | ✅ | ✅ | [@you](https://github.com/you) |
```

The launcher column depends only on the firmware generation; the root
column is where SoC and board revisions bite. A ❌ with a note is as
valuable as a ✅.
