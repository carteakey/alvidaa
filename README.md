# alvidaa 👋

![alvidaa launcher, live on a Hisense VIDAA TV — clock, inputs with live
signal, and real app icons, captured from the TV itself](docs/img/launcher-home.png)

Two projects in one repo. 

1. **A launcher** — a self-installed, self-hosted home screen for Hisense
   **VIDAA** TVs: a clock, your HDMI inputs with live signal, your real
   apps. Nothing sponsored. The TV installs the page itself as a native
   app through its own hidden APIs (or over a bridge without root)
   
2. **Root** — and more importantly: the first publicly documented root
   path for 2024+ VIDAA firmware (as far as public record shows). A
   browser-exposed file bridge, a sandbox escape found by reading an
   errno, a production boot hook, and a key-only SSH shell — no hardware,
   no flashed partitions, verified boot still green.

Everything runs on a TV you own, through the TV's own APIs, and every step is designed to be undone. Built with — and designed for — AI coding sessions: point your agent at [AGENTS.md](AGENTS.md); the prompt ladder  that worked is in [the prompt ladder](docs/project/HACK-YOUR-OWN.md).

What this repo publishes, and what it deliberately does not:[docs/DISCLOSURE.md](docs/DISCLOSURE.md).

**Read it as a site:** <https://carteakey.github.io/alvidaa/> 

## Start here

| If you want to… | Go to |
| --- | --- |
| **replace your home screen** — no root, reversible | [Quickstart — the launcher](#quickstart--the-launcher) |
| **root the TV** | [docs/models/](docs/models/) — match your model *and* firmware string, then read [SECURITY.md](SECURITY.md) |
| **see what works on which TV** | [Tested models](#tested-models) and [EXPLOITS.md](docs/research/EXPLOITS.md) |
| **contribute a report** | [TESTED-MODELS.md](docs/research/TESTED-MODELS.md) — PR, not issue |
| **understand what's published and why** | [DISCLOSURE.md](docs/DISCLOSURE.md) |

## Three ways to run the launcher

Same page, three delivery mechanisms. Lanes 1 and 2 share everything except
where the daemon runs. Lane 3 is a separate implementation, and it now has
three to pick from.

| | Where it runs | Root | State |
| --- | --- | --- | --- |
| **1. Bridge on a Pi or NAS** | a Go daemon on another box, plus a watcher that bounces the TV to it | no | **live.** The one most people should use, because it works without root |
| **2. Bridge on the TV** | the same daemon on the TV's loopback, kept alive by the root hook | yes | **live** on the reference unit. No external hardware, no bounce target to lose |
| **3. Native** | a component inside the vendor home engine | yes | **three implementations to pick from**, all on one scaffold. Start with **Free My TV (generic)**, verified on the 55A7KAU and now the reference unit |

```
LANE 1 — bridge elsewhere (no root)

┌─────────────┐   WebSocket    ┌──────────────────┐   MQTT/TLS 36669   ┌─────────┐
│ TV browser  │ ◄────────────► │ Go bridge on a   │ ◄────────────────► │ VIDAA   │
│ canvas page │  JSON pushes   │ Pi / NAS         │  RemoteNow control │ TV      │
└─────────────┘                └──────────────────┘                    └─────────┘

LANE 2 — bridge on the TV (root)

┌─────────────┐   loopback     ┌──────────────────┐   MQTT/TLS 36669   ┌─────────┐
│ TV browser  │ ◄────────────► │ alvidaa-bridge   │ ◄────────────────► │ VIDAA   │
│ canvas page │  127.0.0.1     │ on the TV        │  RemoteNow control │ TV      │
└─────────────┘                └──────────────────┘                    └─────────┘

LANE 3 — native (root)

vendor home engine ─► route[0].component for /Launcher replaced ─► the chosen component
                      (no browser, no bounce, stock Settings preserved)
```

Lanes 1 and 2 are the same page, the same protocol and the same `config.json`.
Lane 3 is a Vue component using the vendor SDK, and cannot share the canvas page.
[`launcher/README.md`](launcher/README.md) has the detail and
[`tools/launcher-host/IMPLEMENTATIONS.md`](tools/launcher-host/IMPLEMENTATIONS.md)
maps the lane-3 implementations.

## The root chain

Root is what enables lanes 2 and 3, and it is **model-specific**: the SoC and
partition layout bite hard. The chain, stage by stage, is in
[the 50A51HUV guide](docs/models/50A51HUV/09.01O.P0813/README.md), and the
per-model deltas are in the guides under [`docs/models/`](docs/models/).

```
cert-gated MQTT ─► browser file bridge ─► ../ escape ─► unauth local API
    ─► rc.local boot hook ─► root at every boot ─► key-only SSH
```

## Quickstart — the launcher

```sh
# 1. the 2024 client cert (the full story: docs/models/50A51HUV/09.01O.P0813/findings/01-mqtt-bridge.md)
#    unzip res/raw/client_mobile_android.p12 from the VIDAA Smart TV APK, then
openssl pkcs12 -legacy -in client_mobile_android.p12 \
  -passin pass:186e990688070325a1c4b0ce275d2388 \
  -clcerts -nokeys -out server/keys/vidaa_cert.pem
openssl pkcs12 -legacy -in client_mobile_android.p12 \
  -passin pass:186e990688070325a1c4b0ce275d2388 \
  -nocerts -nodes -out server/keys/vidaa_key.pem

# 2. pair (TV shows a 4-digit code; type it when asked)
cd server && python3 -m venv venv && ./venv/bin/pip install paho-mqtt
TV_MAC=<tv-wifi-mac> ./venv/bin/python pair.py <tv-ip>

# 3. serve
./venv/bin/python vidaa_server.py <tv-ip> 8765

# 4. on the TV: browser -> http://<server-ip>:8765/ -> "+ INSTALL AS APP"
#    -> OK -> restart TV -> open "Home"
```

Harden `server/config.json` (hide preset apps, rename tiles, set `"autoSwitch": true` to auto-jump to a single active HDMI input on boot, or toggle the watcher) — it is read live. The launcher renders at 1080p (`?540p` fallback), caches tiles in `localStorage` for instant cold paint, auto-focuses active HDMI signals, and binds remote keys `1`–`9` as tile hotkeys. Production deployment on an always-on box:

[DEPLOY.md](docs/launcher/DEPLOY.md). Roadmap for shimming and modifying the native stock launcher (`/APPS/channelA/hisenseUI/`) directly on rooted TVs: [LAUNCHER_V2.md](docs/launcher/LAUNCHER_V2.md). One server per TV — the paired MQTT identity is exclusive.

## Quickstart — root

Root is **model- and firmware-specific**: the chain that works on a 50A51HUV
does nothing on a 100U7Q. Start at [docs/models/](docs/models/), match the model
*and* the firmware string exactly, and read that guide end to end before
touching anything. [SECURITY.md](SECURITY.md) has the disclosure stance.

The MTK9602 chain in one line: the browser bridge that installs the launcher can
be walked past its sandbox (`../`), the file API behind it is unauthenticated,
and a boot script executes a writable file as root — after that it is a static
dropbear and five hook versions. Full detail:
[the 50A51HUV guide](docs/models/50A51HUV/09.01O.P0813/README.md).

The recon probe ([launcher/recon.html](launcher/recon.html)) includes write
probes and a root hook installation action; inspect it before use. Installing
the hook changes your TV's boot behaviour.

## The docs

| Doc | What it is |
| --- | --- |
| [docs/](docs/README.md) | **The map** — every guide, finding and tool, with where to start |
| [docs/models/](docs/models/) | Model- and firmware-specific root guides — 50A51HUV, HE40, 100U7Q, 75UR9S, 43Q60SEVS |
| [EXPLOITS.md](docs/research/EXPLOITS.md) | Method inventory: tested devices, evidence, outcomes and limits |
| [AGENTS.md](AGENTS.md) | Briefing for AI sessions working in this repo |
| [TODO.md](TODO.md) | Open work, ordered — loose ends and the catalogue refactor plan |

## Repo layout

The repository root is the launcher product; the root research is filed by
model and firmware.

| Path | What |
| --- | --- |
| `launcher/`, `server/` | the launcher (the default, no-root lane) |
| `docs/models/<Model>/<FW>/` | per-model root guides, evidence and modding |
| `docs/research/` | cross-model inventory, method catalogue, tested-models guide, patched-firmware playbook |
| `docs/launcher/` | launcher deployment and v2 roadmap |
| `docs/project/` | story and the AI prompt ladder |
| `tools/` | scripts used by the guides |

## Tested models

The compact scan — model / firmware / launcher / root / who. The full table
with every field lives in [TESTED-MODELS.md](docs/research/TESTED-MODELS.md);
both regenerate from `docs/research/inventory.json`.

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
| 43A6K | V0000.09.09C.P0930 | working | achieved | [@Hlushok](https://github.com/Hlushok) |
| 65C350LE | V0000.09.09H.P0930 | untested | untested | [@VaheSaroyan](https://github.com/VaheSaroyan) |
| 50U7DSE | V0000.09.62N.Q0923 | working | achieved | [@roelven](https://github.com/roelven) |
| 55U67LEVS | V0000.09.60A.Q0707 (55U67LEVS) | untested | achieved | [unit owner](https://github.com/carteakey/alvidaa) |
<!-- INVENTORY:END -->

**Report yours by PR, not issue** — add a firmware entry to [inventory.json](docs/research/inventory.json) (single source of truth; fields and where to find them: [TESTED-MODELS.md](docs/research/TESTED-MODELS.md)) and run `scripts/gen-inventory.py` — every table in the repo regenerates from it.

## Contributors

<p class="contrib">
<a href="https://github.com/carteakey" title="carteakey — the project, 50A51HUV / MTK9602"><img src="https://github.com/carteakey.png?size=96" width="56" height="56" alt="carteakey"></a>
<a href="https://github.com/oOHiyoriOo" title="oOHiyoriOo — HE40 and 100U7Q guides and tooling"><img src="https://github.com/oOHiyoriOo.png?size=96" width="56" height="56" alt="oOHiyoriOo"></a>
<a href="https://github.com/EvzenP" title="EvzenP — 75UR9S / V0000.09.60W.Q0624"><img src="https://github.com/EvzenP.png?size=96" width="56" height="56" alt="EvzenP"></a>
<a href="https://github.com/ryjr2ddznn-lab" title="ryjr2ddznn-lab — 43E7DS / 43Q60SEVS, MTK9603"><img src="https://github.com/ryjr2ddznn-lab.png?size=96" width="56" height="56" alt="ryjr2ddznn-lab"></a>
<a href="https://github.com/MewX" title="MewX — 65U8HAU / V0000.06.29X.P0813, MTK9900 (VIDAA U6)"><img src="https://github.com/MewX.png?size=96" width="56" height="56" alt="MewX"></a>
<a href="https://github.com/damiennnnn" title="damiennnnn — 55E7QTUK / V0000.09.09D.P1001, MTK9603 (boot-persistent root + ad removal)"><img src="https://github.com/damiennnnn.png?size=96" width="56" height="56" alt="damiennnnn"></a>
<a href="https://github.com/JacksonDCollins" title="JacksonDCollins — the lane-3 scaffold (native-entry.js, route swap) and Free My TV native Home on the 55A7KAU"><img src="https://github.com/JacksonDCollins.png?size=96" width="56" height="56" alt="JacksonDCollins"></a>
<a href="https://github.com/Kingpandacc" title="Kingpandacc — 75U8QTUK native DOM Home, and the write-up the lane-3 approach is learned from"><img src="https://github.com/Kingpandacc.png?size=96" width="56" height="56" alt="Kingpandacc"></a>
<a href="https://github.com/EmoFa" title="EmoFa — 32A35HUV / V0000.09.01O.P0814, a second MTK9602 board"><img src="https://github.com/EmoFa.png?size=96" width="56" height="56" alt="EmoFa"></a>
<a href="https://github.com/antmagl" title="antmagl — 43A5LE / V0000.09.60A.Q0707, launcher lane"><img src="https://github.com/antmagl.png?size=96" width="56" height="56" alt="antmagl"></a>
<a href="https://github.com/gonzule" title="gonzule — 50A7HAU / V0000.06.12X.N1212, read-only fingerprint"><img src="https://github.com/gonzule.png?size=96" width="56" height="56" alt="gonzule"></a>
<a href="https://github.com/aadnaane" title="aadnaane — 50A6Q / V0000.09.61B.Q0721, the first Novatek and first aarch64 unit"><img src="https://github.com/aadnaane.png?size=96" width="56" height="56" alt="aadnaane"></a>
</p>

The native launcher work is thanks to **JacksonDCollins** and **Kingpandacc**, who
each built one independently. It gives us a framework for interchangeable native
variants rather than a single blessed implementation: pick one, adapt it to your
build. See [tools/launcher-host/IMPLEMENTATIONS.md](tools/launcher-host/IMPLEMENTATIONS.md).

Community reports: [u/pavanjadhaw](https://reddit.com/user/pavanjadhaw) ·
[u/possibly_matt](https://reddit.com/user/possibly_matt) ·
[u/LulzTigre](https://reddit.com/user/LulzTigre) ·
u/Affectionate-End-601 · u/Wing-Tsit-Chong · u/____dls · u/uzueta

Also [@gitgost-sa2](https://github.com/gitgost-sa2), who submitted the 43A5FE
guide through an anonymous fork and asked to stay unattributed beyond that. The
credit is here because the work is theirs, not because we know who they are.

A report without a model and firmware string stays in
[TESTED-MODELS.md](docs/research/TESTED-MODELS.md) until someone fills in the
gaps; that is the entry bar, not a judgement on the report.

### Finding your way around

The repo is growing faster than its layout, so start from the index rather
than the tree:

- [docs/models/](docs/models/) — one page per **model and** firmware string. If your model is not listed there, it is not documented yet.
- [EXPLOITS.md](docs/research/EXPLOITS.md) — every method, its evidence grade, and what already failed.
- [inventory.json](docs/research/inventory.json) — the single source for every table in the repo. Edit the JSON; never the tables.
- [AGENTS.md](AGENTS.md) — the briefing, including for an AI session doing the work.

Prior art and the safety stance are in [Credits & safety](#credits--safety) below.

## Credits & safety

### Prior art

The two projects closest to this one work the same problem on Android
televisions: [dumbtv](https://github.com/humblemuzzu/dumbtv) cleans up Fire TV /
Fire OS over ADB and replaces the home screen with its own 107 KB launcher, and
[CleanMyTV](https://github.com/wingedpanther/cleanmytv) does the same for
Android TV and Google TV from a Mac/Windows app. They are the reference points
for what a cleaned-up, ad-free TV looks like, and neither supports VIDAA —
both are Android work, and Fire OS, Android TV and Google TV all speak ADB and
have a package manager. A VIDAA TV has neither: its home screen is not an app
but a Cobalt/JS bundle inside the vendor's own `operation-ui` module, so
replacing it means editing that bundle on the TV, which is what
[lane 3](#three-ways-to-run-the-launcher) does. A feature-by-feature comparison
and what a native port borrows from them:
[EXISTING-LAUNCHERS.md](docs/launcher/EXISTING-LAUNCHERS.md).

Built on the shoulders of [Bananamafia's hisensehax](https://bananamafia.dev/post/hisensehax/),
[d3nd3/Hisense-mqtt-keyfiles](https://github.com/d3nd3/Hisense-mqtt-keyfiles),
[Krazy998/mqtt-hisensetv](https://github.com/Krazy998/mqtt-hisensetv),
[stevene1919/hisense_vidaa](https://github.com/stevene1919/hisense_vidaa) and
[Zfinix/vidaa-launcher](https://github.com/Zfinix/vidaa-launcher) (mechanism
reference only — this is an independent implementation).

### How this was produced

This project was built in AI coding sessions, and it seems dishonest not to
say so plainly. The main models were **DeepSeek 4.1 Flash** and **GLM 5.3 Flash**, with
others used for smaller pieces along the way.

No system partitions were written during this research; verified boot stayed
locked and green. Changes were designed to be reversible, but a complete
teardown has not been verified: it also requires restoring any edited UI files
and removing the root hook and its associated tools and configuration. The
certificates and tokens in `server/keys/` are device credentials — never
commit them.

### Disclosure

The findings here were reported to Hisense/VIDAA Product Security on
2026-10-29 and logged as **`VIDAA-PSIRT-2026-005`**; their response is
recorded in [docs/DISCLOSURE.md](docs/DISCLOSURE.md), which also states what
this repo publishes and what it withholds. The reasoning behind publishing in
parallel rather than waiting: [SECURITY.md](SECURITY.md).
