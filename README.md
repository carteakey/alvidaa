# vidaa-home

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

- The **TV page** is one canvas (VIDAA's browser is Chrome 77 — DOM/CSS dies).
  Stateless: all config and state are pushed by the server.
- The **server** (Python, stdlib + paho-mqtt) bridges OK-presses to the TV over
  the same RemoteNow channel the official remote app uses, filters the app
  list (`config.json`: hide/rename), and runs the **home watcher** that
  relaunches the launcher whenever the stock VIDAA home appears (~1s of stock
  UI is inherent — VIDAA has no default-launcher setting).
- **Pairing** (`pair.py`) walks the modern app handshake: dynamic credentials +
  the 2024 client certificate, and captures long-lived tokens so you pair once.
  The full reverse-engineering story is in [docs/FINDINGS.md](docs/FINDINGS.md).

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
./venv/bin/python pair.py <tv-ip>

# 3. serve
./venv/bin/python vidaa_server.py <tv-ip> 8765

# 4. on the TV: open the browser -> http://<server-ip>:8765/
#    navigate to "+ INSTALL AS APP" -> OK -> restart TV -> open "Home"
```

Harden the config in `server/config.json`: hide preset apps, rename tiles,
toggle the home watcher.

## Status

Working end-to-end on a 2024+ VIDAA firmware (`transport_protocol=3290`):
pairing, token auth + refresh, app launch, source switching, self-install,
home watcher. Pi deployment with systemd units is the next milestone.

See [docs/FINDINGS.md](docs/FINDINGS.md) for everything learned on the way —
the cert gate, the auth cascade, the exact-topic subscription trap, the PIN
rotation race, and the install APIs.

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
