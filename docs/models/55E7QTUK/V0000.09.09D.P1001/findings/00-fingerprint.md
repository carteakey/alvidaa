# 00 — Fingerprint (2026-11-08)

First visit to a 55" E7QTUK (UK QLED SKU). Discovery ran end-to-end from one
session: SSDP + descriptor fields, TCP probes, RemoteNow MQTT pairing, then
the browser-env identity readout. Device-identifying fields (Device ID,
Feature Code, UDN, MACs) are kept out of this notebook on purpose.

## SSDP + the descriptor surface

`tools/ssdp-descriptor.sh` (auto-discover) found the TV at `192.168.0.246`
alongside the gateway; two responder descriptors on the TV:

| Endpoint | Contents |
| --- | --- |
| `:3366/dd.xml` | `tvdevice`, friendlyName "Living Room TV", `modelName` **55E7QE**, manufacturer Hisense — a minimal stub, no faceData |
| `:18400/MediaServer/rendererdevicedesc.xml` | the fingerprint blob: `transport_protocol=3290`, `mac=`/`macEthernet=`/`macWifi=` (redacted), `ip=`, `region=0`, `platform=1`, `voice=2`, `brand=his`, `vidaa_support=1` |

**Readings:**

- `transport_protocol=3290` → 2024 app-style generation. This is the field
  that gates `pair.py` path selection (2024+ rejects the old static MQTT
  login — "Not authorized" + on-screen "app outdated" popup per attempt).
- A ten-port sweep across the VIDAA surface (7676, 8888, 8001, 8080/8081,
  9998, 23456, 26001, 46300, 49152–55, 36670/71, 9271) found nothing else
  open. This generation's LAN surface is exactly `:3366 + :18400 + :36669`;
  the legacy unauthenticated `:1195` query API of pre-2024 VIDAA is dead
  here (verified **untested**→ n-a: port closed, timeout).
- `:9009` (phoenix file bridge) is loopback-only, as on every model so far.
- The UDN encodes the WiFi MAC in ASCII hex.

## RemoteNow MQTT (:36669)

- TCP **open**; TLS server cert is the canonical RemoteNow broker pair:
  `CN=127.0.0.1, OU=multiscreen, O=hh`, issued by `CN=RemoteCA,
  OU=multimedia, O=hh` (2018 → 2043).
- **The broker pins the client-cert CA at the TLS layer** (verified): a
  self-signed client stub completes good TLS on 50A51HUV (2023 gen) but on
  this unit the TLS handshake itself fails with
  `tlsv1 alert unknown CA` before MQTT CONNECT. Same stance as the
  55A7KAU (09.09O); a bare `openssl s_client` *without* a client cert
  appears to complete — don't be fooled; the CONNECT-time truth is what
  matters.
- The genuine app cert (`CN=VidaaAppAndroidV01`, issued by `RemoteCA`,
  2024 → 2034, matching `res/El.p12` recipe in the 65U8HAU guide) clears
  the TLS layer. A copy was placed from a public repo that vendors the
  same pair; the locally cached XAPK
  (`com.universal.remote.multi_1.09.06.003.1`) holds the same cert per the
  `res/El.p12` recipe and is the reproducible path.

## Pairing matrix (verified 2026-11-08)

| Client cert | `TV_MAC` | Profile | Result |
| --- | --- | --- | --- |
| self-signed stub | (any) | all | TLS refused: `tlsv1 alert unknown CA` |
| VidaaAppAndroidV01 | 12-hex from descriptor (`mac=`/ethernet) | all four | MQTT `rc=135` Not authorized |
| VidaaAppAndroidV01 | colon-formatted **ethernet** | all four | MQTT `rc=135` Not authorized |
| VidaaAppAndroidV01 | colon-formatted **macWifi** | `modern` | **session established → PIN → tokens (2-day access)** |

**Readings:**

- The rc=135 family on wrong MACs keeps the 2024-generation shape:
  username/password don't depend on MAC at all — the broker keys the
  credential check off the client_id (the MAC hash) first, then the
  profile fit. Whether `standard`/`middle` would also connect with
  colon-formatted `macWifi` is **untested** (we didn't need them).
- `pair.py`'s auto-colonization only triggers on `rc=133`; on this unit
  the wrong-MAC failure surfaced as 135, so the format fix had to be
  manual (pass `TV_MAC` colon-formatted).
- The accepted identity is the WiFi MAC because the TV reports
  `net_type: wireless` (bridge `GetNetworkInfo`). The `mac=` field in the
  SSDP blob is the ethernet identifier and is NOT the active interface.
- `modern` profile + PIN produced `{"result": 1}` and `tokenissuance`
  with a **2-day access token**, same issuance shape as 43A5LE / 65U8HAU.
- The PIN dialog lives ~30 s after `vidaa_app_connect`; timing the
  handshake to a human standing at the TV is the practical constraint
  (the first attempt expired while waiting for the operator; the second
  landed). Trigger → dialog is ~4–6 s, well inside the window when run
  deliberately.
- Cert provenance check: certs fetched from a third-party repo were
  verified for subject/issuer/validity and modulus equality between
  cert and key before use. Keys and tokens live only in `server/keys/`
  (gitignored) per ground rules.

## Browser-env identity readout (verified via `launcher/fingerprint.html` +
`launcher/identity.html` through `/api/open`)

Server = this project's `server/vidaa_server.py` (fresh venv) on
`192.168.0.195:8770`, MQTT session from the just-minted tokens.

- UA: `Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like
  Gecko) Chrome/111.0.5563.146 Odin/111.5563.5.1 Safari/537.36
  Model/VIDAA-MTK9603 VIDAA/9.0(Hisense;SmartTV;55E70QEVS;MTK9603/V0000.09.09D.P1001;UHD;55E7QE;)`
- Firmware: **V0000.09.09D.P1001** — the inventory-canonical string. The
  `09.09` OS branch matches the 55A7KAU (`V0000.09.09O.P1015`, MTK9602);
  the O/D letter difference in the P-code is not established — two
  branches of the same OS generation.
- Chipset: **MTK9603** (UA says the same → consistent).
- Model trio, the usual retail/inner split: retail **55E7QTUK** (owner),
  internal **55E70QEVS_0002** (`GetModelName`), serial type **55E7QE**
  (`GetSerialType`, same as the UPnP modelName).
- OS version: **U09.09**; runtime: **Chromium 111**, api version 3.0.1;
  panel 3840×2160.
- Region: bridge reports **EU_A** / country **GBR**; the SSDP blob's
  `region=0` is a different field-style from the A7KAU's `region=6`
  (AU) — the two are not the same scale.
- Network: wireless (see pairing-matrix reading above), IP as above.
- `GetDeviceCode`/`GetUuid` came back junk/empty; DeviceID and Feature
  Code are present on the unit but redacted here.
- ~95+ `Hisense_*` functions are enumerated on the page (full sweep in
  the recon report, not committed — contains identifiers).

## State after this session

- Server paired and left running in the background on `192.168.0.195:8770`
  (`vidaa_server.py 192.168.0.246 8770`), recon reports landing in
  `server/recon-report.json` (gitignored). Kill before other pairing work:
  one MQTT session per credential set.
- `server/keys/` holds tokens + the Vidaa-app cert pair only (throwaway
  TLS stubs removed).
- Launcher tile **not** installed; TV has no entry pointing at
  `192.168.0.195:8770` yet. The page-load lane works (`/api/open` + any
  LAN URL); next lane step is `launcher/index.html` self-install per
  `docs/launcher/DEPLOY.md`.
