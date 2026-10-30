# alvidaa

A self-installed, self-hosted home screen for Hisense **VIDAA** TVs — turn the
smart TV's ad-laden launcher into a dumb, fast one. No root, no firmware
changes, fully reversible.

Clock, HDMI inputs (live signal), your real apps — and nothing else. The TV
installs the page itself as a native app through its own hidden APIs.

![what it is](docs/hero-placeholder.png)

## How it works

```
┌─────────────┐   WebSocket    ┌──────────────────┐   MQTT/TLS 36669   ┌─────────┐
│ TV browser  │ ◄────────────► │ server (Pi)      │ ◄────────────────► │ VIDAA   │
│ canvas page │  JSON pushes   │ config + watcher │  RemoteNow control │ TV      │
└─────────────┘                └──────────────────┘                    └─────────┘
```

- The **TV page** is one canvas — drawn and repainted cheaply, which sidesteps
  the TV browser's compositing quirks on every generation we've tested
  (Chrome 77 on older firmware, Chromium 111 on 2024+). Stateless: all config
  and state are pushed by the server.
- The **server** (Python, stdlib + paho-mqtt) bridges OK-presses to the TV over
  the same RemoteNow channel the official remote app uses, filters the app
  list (`config.json`: hide/rename), and runs the **home watcher** that
  relaunches the launcher whenever the stock VIDAA home appears (~1s of stock
  UI is inherent — VIDAA has no default-launcher setting).
- **Pairing** (`pair.py`) walks the modern app handshake: dynamic credentials +
  the 2024 client certificate, and captures long-lived tokens so you pair once.
  The full reverse-engineering story is in [docs/findings/](docs/findings/01-mqtt-bridge.md).

## Setup

```sh
# 1. get the 2024 client cert (see docs/FINDINGS.md §3):
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

# 4. on the TV: open the browser -> http://<server-ip>:8765/
#    navigate to "+ INSTALL AS APP" -> OK -> restart TV -> open "Home"
```

Harden the config in `server/config.json`: hide preset apps, rename tiles,
toggle the home watcher.

## Status & tested models

**Working end-to-end** (2024+ firmware generation, `transport_protocol=3290`):
pairing, token auth + refresh, app launch, source switching, self-install,
home watcher, Pi deployment (systemd). The root/shell research chain is
documented separately in [docs/findings/](docs/findings/) — it is
**model-specific** (armv7/MTK paths and partition layouts differ per SoC),
while the launcher only depends on the firmware generation.

**Tested on:**

| Model | Region | SoC | Firmware | `transport_protocol` | Browser | Launcher | Root chain | Tested by |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 50A51HUV | US/CAN | MTK9602 | V0000.09.01O.P0813 (U09.01) | 3290 | Chromium 111 "odin" | ✅ v1.3 | ✅ full chain | [@carteakey](https://github.com/carteakey) |

**Report your test — by PR, not issue.** Fork, add one row to the table
(edit this README), open a PR. What to include and where to find it:

- **Model / region**: TV Settings → Support → device info, or the SSDP
  device descriptor (`modelDescription` leaks `region=`, `brand=`,
  `vidaa_support=`, `transport_protocol=` — see
  [docs/findings/01-mqtt-bridge.md](docs/findings/01-mqtt-bridge.md) §1).
- **`transport_protocol`**: the single most predictive number — it selects
  the auth generation. From the SSDP descriptor.
- **Firmware**: Settings → About, or `Hisense_GetFirmWareVersion()` from any
  page in the TV browser (or the recon page in `launcher/recon.html`).
- **SoC**: `Hisense_GetChipSetName()` — same bridge (needs a page running on
  the TV; HiSilicon vs MTK changes the root chain, not the launcher).
- **What worked / what didn't**: pairing, install, watcher, canvas
  rendering, anything generation-surprising.

See [docs/findings/](docs/findings/) for everything learned on the way —
the cert gate, the auth cascade, the exact-topic subscription trap, the PIN
rotation race, the install APIs, and (separately) the root chain.

## Credits & safety

Built on the shoulders of [Bananamafia's hisensehax](https://bananamafia.dev/post/hisensehax/),
[d3nd3/Hisense-mqtt-keyfiles](https://github.com/d3nd3/Hisense-mqtt-keyfiles),
[Krazy998/mqtt-hisensetv](https://github.com/Krazy998/mqtt-hisensetv),
[stevene1919/hisense_vidaa](https://github.com/stevene1919/hisense_vidaa) and
[Zfinix/vidaa-launcher](https://github.com/Zfinix/vidaa-launcher) (mechanism
reference only — this is an independent implementation).

Everything here runs on a TV you own, through the TV's own APIs. Nothing is
written to system partitions; deleting the "Home" app entry (or a factory
reset) fully reverts it. The certificates and tokens in `server/keys/` are
device credentials — never commit them.

## Deployment (Pi)

Production home: Raspberry Pi, `alvidaa.service` (systemd, `Restart=always`),
listening on **port 8770** (8765 is taken by the camera-wall service there).

```sh
rsync -a --exclude venv --exclude .git ~/repos/alvidaa/ pi:alvidaa/
ssh pi 'cd ~/alvidaa/server && python3 -m venv venv && ./venv/bin/pip install paho-mqtt'
# unit: /etc/systemd/system/alvidaa.service -> venv/bin/python vidaa_server.py <tv-ip> 8770
```

**Run only ONE server instance against a TV at a time** — the paired MQTT
client identity is shared, and two servers will kick each other off the broker.

After moving hosts, re-point the installed TV app: open
`http://<new-host>:8770/` in the TV browser and use "+ INSTALL AS APP" (same
app Id overwrites the old entry), then restart the TV.

## Security research & disclosure

The research behind this project identified weaknesses in VIDAA 2024+ firmware
(browser-exposed install/file APIs, weakly authenticated telemetry endpoints).
Findings are being disclosed to Hisense; publication runs in parallel per the
reasoning in [SECURITY.md](SECURITY.md) — LAN-local findings, no DRM circumvention, own
hardware. Firmware dumps and vendor binaries are not published.

If you deploy this, change nothing about your expectation of privacy on a
smart TV that this does not fix — but you can expect the ads and the
phone-home to be yours again.
