# alvidaa 👋

![alvidaa native launcher, live on a Hisense VIDAA TV — minimal dark-glass redesign with Nordic Fjord backdrop, studio device art, and clock, captured from the TV itself](docs/img/launcher-home.png)

**[Docs site](https://carteakey.github.io/alvidaa/)** · **[Latest release (`v3.1`)](https://github.com/carteakey/alvidaa/releases/tag/v3.1)** · **[Tested models (36 builds / 31 guides)](#tested-models)** · **[Security & disclosure](SECURITY.md)** · **[Publication policy](docs/DISCLOSURE.md)**

Two projects in one repo — both LAN-local, own-TV-only, and designed to be undone:

1. **A clean home screen (no root required)** — a clock, your HDMI inputs with live signal badges, and your real apps. Nothing sponsored. Runs over a bridge without root, on-TV loopback, or natively inside the vendor home engine (`native-alvidaa` / `Free My TV`).
2. **Root research for 2024+ VIDAA** — the first publicly documented root paths for modern VIDAA firmware across MediaTek and Novatek boards. No hardware mods, no flashed system partitions, verified boot stays locked and green.

Built with — and designed for — AI coding sessions: point your agent at [AGENTS.md](AGENTS.md); the prompt ladder that worked is in [HACK-YOUR-OWN.md](docs/project/HACK-YOUR-OWN.md).

---

## Start here

| If you want to… | Go to |
| --- | --- |
| **check your TV safely (100% read-only)** | Serve `launcher/` (`python3 -m http.server 8765`) and open `http://<pc-ip>:8765/fingerprint-full.html` in the TV browser — zero writes, zero pairing |
| **replace your home screen** — no root, reversible | [Quickstart — the launcher](#quickstart--the-launcher) |
| **root the TV** | [docs/models/](docs/models/) — match your model *and* firmware string, then read [SECURITY.md](SECURITY.md) |
| **see what works on which TV** | [Tested models](#tested-models) and [EXPLOITS.md](docs/research/EXPLOITS.md) |
| **contribute a report** | [TESTED-MODELS.md](docs/research/TESTED-MODELS.md) — PR (docs + JSON only), not issue |
| **understand what's published and why** | [SECURITY.md](SECURITY.md) and [DISCLOSURE.md](docs/DISCLOSURE.md) |

---

## Three ways to run the launcher

Lanes 1 and 2 share the same canvas page, protocol, and `config.json`. Lane 3 replaces the `/Launcher` route directly inside the vendor home engine.

| Lane | Where it runs | Root | Notes |
| --- | --- | --- | --- |
| **1. External bridge** | Python/Go bridge on a Pi, NAS, or PC + watcher bounce | No | **Default for most owners** — safe, reversible, no root needed |
| **2. On-TV bridge** | `alvidaa-bridge` on TV loopback (`127.0.0.1`), kept alive at boot | Yes | Self-contained on the TV — no external box to keep awake |
| **3. Native Home** | Vue/DOM component inside the vendor `operation-ui` engine | Yes | **Zero browser bounce, zero stock flash** — `native-alvidaa` (shown above) and `Free My TV` variants on one scaffold |

```text
LANE 1 — bridge elsewhere (no root)
┌─────────────┐   WebSocket    ┌──────────────────┐   MQTT/TLS 36669   ┌─────────┐
│ TV browser  │ ◄────────────► │ Bridge on a      │ ◄────────────────► │ VIDAA   │
│ canvas page │  JSON pushes   │ Pi / NAS / PC    │  RemoteNow control │ TV      │
└─────────────┘                └──────────────────┘                    └─────────┘

LANE 2 — bridge on the TV (root)
┌─────────────┐   loopback     ┌──────────────────┐   MQTT/TLS 36669   ┌─────────┐
│ TV browser  │ ◄────────────► │ alvidaa-bridge   │ ◄────────────────► │ VIDAA   │
│ canvas page │  127.0.0.1     │ on the TV        │  RemoteNow control │ TV      │
└─────────────┘                └──────────────────┘                    └─────────┘

LANE 3 — native (root)
vendor home engine ─► route[0].component for /Launcher replaced ─► native-alvidaa / Free My TV
                      (no browser, no bounce, stock Settings preserved)
```

Details: [docs/launcher/LANES.md](docs/launcher/LANES.md), [launcher/README.md](launcher/README.md), and [tools/launcher-host/IMPLEMENTATIONS.md](tools/launcher-host/IMPLEMENTATIONS.md).

---

## Quickstart — the launcher

```sh
# 1. Extract the 2024 client cert (details: docs/models/50A51HUV/09.01O.P0813/findings/01-mqtt-bridge.md)
#    Unzip res/raw/client_mobile_android.p12 from the official VIDAA Smart TV APK, then:
openssl pkcs12 -legacy -in client_mobile_android.p12 \
  -passin pass:186e990688070325a1c4b0ce275d2388 \
  -clcerts -nokeys -out server/keys/vidaa_cert.pem
openssl pkcs12 -legacy -in client_mobile_android.p12 \
  -passin pass:186e990688070325a1c4b0ce275d2388 \
  -nocerts -nodes -out server/keys/vidaa_key.pem

# 2. Pair (TV displays a 4-digit PIN; type it when prompted)
cd server && python3 -m venv venv && ./venv/bin/pip install paho-mqtt
TV_MAC=<tv-wifi-mac> ./venv/bin/python pair.py <tv-ip>

# 3. Serve
./venv/bin/python vidaa_server.py <tv-ip> 8765

# 4. On the TV browser: open http://<server-ip>:8765/ -> "+ INSTALL AS APP"
#    -> OK -> restart TV -> open "Home"
```

- **Live config:** Edit `server/config.json` to hide preset apps, rename tiles, toggle the watcher, or set `"autoSwitch": true` to jump straight to a single active HDMI input on boot. One server per TV (the paired MQTT identity is exclusive).
- **`09.60`+ self-install gated?** If direct browser `fileWrite` returns `503 appconfig`, see [docs/launcher/ALVIDAA-HOME-INSTALL.md](docs/launcher/ALVIDAA-HOME-INSTALL.md) for the reversible external-server workflow.
- **Always-on & native guides:** [DEPLOY.md](docs/launcher/DEPLOY.md) (Pi/systemd), [BRIDGE_DEPLOY.md](docs/launcher/BRIDGE_DEPLOY.md) (Lane 2), and [tools/launcher-host/IMPLEMENTATIONS.md](tools/launcher-host/IMPLEMENTATIONS.md) (Lane 3 native Home).

---

## Root

Root is **model- and firmware-specific**: the chain that works on a `50A51HUV` (`MTK9602`) does nothing on a `100U7Q` (`MT9655`) or a `50A6Q` (`Novatek`). Start at [docs/models/](docs/models/), match your model *and* firmware string character by character, and read [SECURITY.md](SECURITY.md) before touching anything.

```text
Reference MTK9602 chain (50A51HUV / 09.01O.P0813):
cert-gated MQTT ─► browser file bridge ─► ../ escape ─► unauth local API
    ─► rc.local boot hook ─► root at every boot ─► key-only SSH
```

Newer `09.09` / `09.60` / `09.62` builds use different paths (such as `basic/fetcher` → `superwatch` → `opkg postinst` + `re_sshd` service autostart, or Novatek `PFMCheck`) — see [EXPLOITS.md](docs/research/EXPLOITS.md) for every documented class, evidence grade, and known dead end.

> [!NOTE]
> Use `launcher/fingerprint-full.html` for 100% read-only checks. `launcher/recon.html` includes write probes and a legacy hook action — inspect it before use.

---

## Repo map

| Path | What lives there |
| --- | --- |
| `launcher/`, `server/`, `bridge/` | No-root web launcher, Python MQTT server, and Go loopback bridge |
| `tools/launcher-host/` | Lane 3 native Home scaffold (`native-alvidaa`, `Free My TV`, rollback & verification) |
| `docs/models/<Model>/<FW>/` | **31 model- and firmware-specific guides**, evidence, and modding notes |
| `docs/research/` | `inventory.json`, `exploits.json`, [TESTED-MODELS.md](docs/research/TESTED-MODELS.md), [EXPLOITS.md](docs/research/EXPLOITS.md), and the patched-firmware playbook |
| `docs/launcher/` | Deployment guides, lane architecture ([LANES.md](docs/launcher/LANES.md)), and Android launcher comparisons |
| `docs/project/` | [STORY.md](docs/project/STORY.md) and the AI prompt ladder ([HACK-YOUR-OWN.md](docs/project/HACK-YOUR-OWN.md)) |
| [docs/README.md](docs/README.md) · [AGENTS.md](AGENTS.md) · [TODO.md](TODO.md) | Full docs index, AI session briefing, and open roadmap |

---

## Tested models

Compact scan — model / firmware / launcher / root / reporter. The full table with SoC, region, browser, and capability notes lives in [TESTED-MODELS.md](docs/research/TESTED-MODELS.md); both regenerate from `docs/research/inventory.json`.

<!-- INVENTORY:START -->
| Model | Firmware | Launcher | Root | Tested by |
| --- | --- | --- | --- | --- |
| 50A51HUV | 09.01O.P0813 | working | achieved | [@carteakey](https://github.com/carteakey) |
| 55S7NEVS | 09.60X.Q0609 (2026-06) | untested | achieved | [u/possibly_matt](https://reddit.com/user/possibly_matt) |
| 55A60LEVS | 09.60V.Q0612 (2026-07 EU_A) | untested | blocked | [u/Affectionate-End-601](https://reddit.com/user/Affectionate-End-601) |
| 43A60LEVS | 09.60V.Q0612 (2026-07) | untested | untested | [u/Wing-Tsit-Chong](https://reddit.com/user/Wing-Tsit-Chong) |
| ? | 09.60V.Q0612 (build date unconfirmed) | untested | untested | [u/____dls](https://reddit.com/user/____dls) |
| 65U8HAU | V0000.06.29X.P0813 (AU) | working | blocked | [@MewX](https://github.com/MewX) |
| 65U7H | V0000.06.29X.P0813 (IN) | untested | blocked | [u/pavanjadhaw](https://reddit.com/user/pavanjadhaw) |
| HE40E5600FFWTS | V0100.01.00A.N0410 | untested | achieved | [@oOHiyoriOo](https://github.com/oOHiyoriOo) |
| 100U7Q | V0000.09.60I.Q0813 | untested | achieved | [@oOHiyoriOo](https://github.com/oOHiyoriOo) |
| 75UR9S | V0000.09.60W.Q0624 | untested | achieved | [@EvzenP](https://github.com/EvzenP) |
| 43E7DS | 09.60W.Q0612 (EU_A) | working | achieved | [@ryjr2ddznn-lab](https://github.com/ryjr2ddznn-lab) |
| 50A6Q | V0000.09.61B.Q0721 | untested | achieved | [@aadnaane](https://github.com/aadnaane) |
| 55A7KAU | V0000.09.09O.P1015 | working | achieved | [@JacksonDCollins](https://github.com/JacksonDCollins) |
| 75U8QTUK | V0000.09.60I.Q0813 (UK) | working | achieved | [@kingpandacc](https://github.com/kingpandacc) |
| 43A5LE | V0000.09.60A.Q0707 | working | untested | [@antmagl](https://github.com/antmagl) |
| 43A5FE | V0010.09.09A.P0930 | working | achieved | [@gitgost-sa2](https://github.com/gitgost-sa2) |
| 55E7QTUK | V0000.09.09D.P1001 (UK) | working | achieved | [@damiennnnn](https://github.com/damiennnnn) |
| 32A35HUV | V0000.09.01O.P0814 | working | achieved | [@EmoFa](https://github.com/EmoFa) |
| 50A7HAU | V0000.06.12X.N1212 | untested | untested | [@gonzule](https://github.com/gonzule) |
| 55E75LEVS | V0000.09.61B.Q0704 | working | achieved | [@mustafaGlobal](https://github.com/mustafaGlobal) |
| 55U61KEVS; 75E86GAVS | V0000.09.62C.Q0924 | working | achieved | [@miramaki](https://github.com/miramaki), [@jaypaulb](https://github.com/jaypaulb), [@JustSchwendi](https://github.com/JustSchwendi) |
| 43A6K | V0000.09.09C.P0930 | working | achieved | [@Hlushok](https://github.com/Hlushok) |
| 65C350LE | V0000.09.09H.P0930 | untested | untested | [@VaheSaroyan](https://github.com/VaheSaroyan) |
| 50U7DSE | V0000.09.62N.Q0923 | working | achieved | [@roelven](https://github.com/roelven) |
| VS1165UD1_0400 | V0000.06.10S.N1222 | untested | untested | [@PureBreadBagel](https://github.com/PureBreadBagel) |
| 65A85QEVS | V0000.09.60A.Q0602 | working | achieved | [@LastThylacine](https://github.com/LastThylacine) |
| 55U67LEVS | V0000.09.60A.Q0707 (55U67LEVS) | untested | achieved | [unit owner](https://github.com/carteakey/alvidaa) |
| 75U7KQ; 65E86GEVS | V0000.09.09O.P0930 | working | achieved | [@noctonca](https://github.com/noctonca), [@aleskxyz](https://github.com/aleskxyz) |
| 65A70LAVT | V0000.09.60A.Q0707 (65A70LAVT) | untested | achieved | [u/sl3yr84](https://reddit.com/user/sl3yr84) |
| 55U65QEVS | V0000.09.60A.Q0602 (55U65QEVS) | working | achieved | [@gwerneckp](https://github.com/gwerneckp) |
| 65U7NQTUK | 09.61B.Q0704 | blocked | untested | [@ponciusz](https://github.com/ponciusz) |
| 65U70QEVS | V0000.09.60I.Q0804 | working | achieved | [@jasimancas](https://github.com/jasimancas) |
| 100U7SAU | V02.09.50U.Q0311 | working | achieved | [@rtype-cpu](https://github.com/rtype-cpu) |
| 55A6NV | V0000.09.60L.Q0623 | working | untested | [@TioLen](https://github.com/TioLen) |
| 85U7SE | V0000.09.62M.Q0921 | untested | achieved | [@vsinh14](https://github.com/vsinh14) |
| 65UR9S | V0000.09.60V.Q0618 | untested | achieved | unit owner |
| 43E7HQ | V0000.09.09G.P0930 | untested | achieved | [@AlexBsrd](https://github.com/AlexBsrd) |
<!-- INVENTORY:END -->

**Report yours by PR, not issue** — run `python3 scripts/report.py` (or add a row to [inventory.json](docs/research/inventory.json) and run `scripts/gen-inventory.py`). Model report PRs are **docs + JSON only** (`./scripts/check.sh` enforces this).

---

## Contributors

<p class="contrib">
<a href="https://github.com/carteakey" title="carteakey — the project, 50A51HUV / MTK9602"><img src="https://github.com/carteakey.png?size=96" width="48" height="48" alt="carteakey"></a>
<a href="https://github.com/oOHiyoriOo" title="oOHiyoriOo — HE40 and 100U7Q guides and tooling"><img src="https://github.com/oOHiyoriOo.png?size=96" width="48" height="48" alt="oOHiyoriOo"></a>
<a href="https://github.com/EvzenP" title="EvzenP — 75UR9S / V0000.09.60W.Q0624"><img src="https://github.com/EvzenP.png?size=96" width="48" height="48" alt="EvzenP"></a>
<a href="https://github.com/ryjr2ddznn-lab" title="ryjr2ddznn-lab — 43E7DS / 43Q60SEVS, MTK9603"><img src="https://github.com/ryjr2ddznn-lab.png?size=96" width="48" height="48" alt="ryjr2ddznn-lab"></a>
<a href="https://github.com/MewX" title="MewX — 65U8HAU / V0000.06.29X.P0813, MTK9900 (VIDAA U6)"><img src="https://github.com/MewX.png?size=96" width="48" height="48" alt="MewX"></a>
<a href="https://github.com/damiennnnn" title="damiennnnn — 55E7QTUK / V0000.09.09D.P1001, MTK9603"><img src="https://github.com/damiennnnn.png?size=96" width="48" height="48" alt="damiennnnn"></a>
<a href="https://github.com/JacksonDCollins" title="JacksonDCollins — lane-3 scaffold and Free My TV native Home (55A7KAU)"><img src="https://github.com/JacksonDCollins.png?size=96" width="48" height="48" alt="JacksonDCollins"></a>
<a href="https://github.com/Kingpandacc" title="Kingpandacc — 75U8QTUK native DOM Home"><img src="https://github.com/Kingpandacc.png?size=96" width="48" height="48" alt="Kingpandacc"></a>
<a href="https://github.com/EmoFa" title="EmoFa — 32A35HUV / V0000.09.01O.P0814"><img src="https://github.com/EmoFa.png?size=96" width="48" height="48" alt="EmoFa"></a>
<a href="https://github.com/antmagl" title="antmagl — 43A5LE / V0000.09.60A.Q0707"><img src="https://github.com/antmagl.png?size=96" width="48" height="48" alt="antmagl"></a>
<a href="https://github.com/gonzule" title="gonzule — 50A7HAU / V0000.06.12X.N1212"><img src="https://github.com/gonzule.png?size=96" width="48" height="48" alt="gonzule"></a>
<a href="https://github.com/aadnaane" title="aadnaane — 50A6Q / V0000.09.61B.Q0721 (Novatek aarch64)"><img src="https://github.com/aadnaane.png?size=96" width="48" height="48" alt="aadnaane"></a>
<a href="https://github.com/roelven" title="roelven — 50U7DSE / V0000.09.62N.Q0923"><img src="https://github.com/roelven.png?size=96" width="48" height="48" alt="roelven"></a>
<a href="https://github.com/miramaki" title="miramaki — 55U61KEVS / V0000.09.62C.Q0924"><img src="https://github.com/miramaki.png?size=96" width="48" height="48" alt="miramaki"></a>
<a href="https://github.com/jaypaulb" title="jaypaulb — 75E86GAVS / V0000.09.62C.Q0924"><img src="https://github.com/jaypaulb.png?size=96" width="48" height="48" alt="jaypaulb"></a>
<a href="https://github.com/LastThylacine" title="LastThylacine — 65A85QEVS / V0000.09.60A.Q0602"><img src="https://github.com/LastThylacine.png?size=96" width="48" height="48" alt="LastThylacine"></a>
<a href="https://github.com/aleskxyz" title="aleskxyz — 75U7KQ / free-my-tv-09o"><img src="https://github.com/aleskxyz.png?size=96" width="48" height="48" alt="aleskxyz"></a>
<a href="https://github.com/rtype-cpu" title="rtype-cpu — 100U7SAU OperationUI 9.05.00 native Home & bridge"><img src="https://github.com/rtype-cpu.png?size=96" width="48" height="48" alt="rtype-cpu"></a>
<a href="https://github.com/TioLen" title="TioLen — reversible external-server Alvidaa Home workflow (55A6NV)"><img src="https://github.com/TioLen.png?size=96" width="48" height="48" alt="TioLen"></a>
<a href="https://github.com/jasimancas" title="jasimancas — 65U70QEVS aarch64 MT9655"><img src="https://github.com/jasimancas.png?size=96" width="48" height="48" alt="jasimancas"></a>
<a href="https://github.com/vsinh14" title="vsinh14 — 85U7SE / V0000.09.62M.Q0921"><img src="https://github.com/vsinh14.png?size=96" width="48" height="48" alt="vsinh14"></a>
<a href="https://github.com/vrunk11" title="vrunk11 — 65UR9S / V0000.09.60V.Q0618"><img src="https://github.com/vrunk11.png?size=96" width="48" height="48" alt="vrunk11"></a>
</p>

See the full live list on [GitHub Contributors](https://github.com/carteakey/alvidaa/graphs/contributors). Native Home architecture is thanks to **JacksonDCollins** and **Kingpandacc**; community reports from [u/pavanjadhaw](https://reddit.com/user/pavanjadhaw), [u/possibly_matt](https://reddit.com/user/possibly_matt), [u/LulzTigre](https://reddit.com/user/LulzTigre), [u/sl3yr84](https://reddit.com/user/sl3yr84), u/Affectionate-End-601, u/Wing-Tsit-Chong, u/____dls, u/uzueta, and anonymous contributor [@gitgost-sa2](https://github.com/gitgost-sa2).

---

## Credits & safety

- **Prior art:** Inspired by [dumbtv](https://github.com/humblemuzzu/dumbtv) and [CleanMyTV](https://github.com/wingedpanther/cleanmytv) on Android/Fire TV ([comparison](docs/launcher/EXISTING-LAUNCHERS.md)). Built on the shoulders of [Bananamafia's hisensehax](https://bananamafia.dev/post/hisensehax/), [d3nd3/Hisense-mqtt-keyfiles](https://github.com/d3nd3/Hisense-mqtt-keyfiles), [Krazy998/mqtt-hisensetv](https://github.com/Krazy998/mqtt-hisensetv), [stevene1919/hisense_vidaa](https://github.com/stevene1919/hisense_vidaa), and [Zfinix/vidaa-launcher](https://github.com/Zfinix/vidaa-launcher) (mechanism reference only — independent implementation).
- **How this was produced:** Built in AI coding sessions (primarily **DeepSeek 4.1 Flash** and **GLM 5.3 Flash**, plus other models along the way).
- **Safety:** No read-only system partitions are written; verified boot stays locked and green. Changes are designed to be reversible, and `server/keys/` is gitignored — never commit device credentials or tokens.
- **Disclosure:** Findings were reported to Hisense/VIDAA Product Security on 2026-10-29 and logged as **`VIDAA-PSIRT-2026-005`**. See [SECURITY.md](SECURITY.md) for their response, the OTA tradeoff, and why we both reported the browser-reachable vulnerability and kept this repo public for enthusiasts; see [docs/DISCLOSURE.md](docs/DISCLOSURE.md) for contributor publication boundaries.
