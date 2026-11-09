# 50A7HAU / V0000.06.12X.N1212 — read-only fingerprint (MTK9602, VIDAA U6, AU)

**Status:** fingerprint only. Reconnaissance was strictly read-only: no write
probes, no boot scripts, no payloads. Root and the launcher lane are **untested**
on this unit.

> **Applies to `50A7HAU` (Australian market, VIDAA `U06.12`, firmware
> `V0000.06.12X.N1212`).** Reported by [@gonzule](https://github.com/gonzule)
> from their own set, gathered with an automated read-only pass.

## System profile

| Field | Value | Source |
| --- | --- | --- |
| Model (retail) | `50A7HAU` | sticker |
| Internal board / `modelName` | `50A6GA` | UPnP `/dd.xml` |
| Firmware | `V0000.06.12X.N1212` | `Hisense_GetFirmWareVersion()` |
| Extended version | `N1213` | TV settings |
| VIDAA OS | `U06.12` (U6) | `Hisense_GetOSVersion()` |
| SoC | MediaTek MTK9602 | `Hisense_GetChipSetName()` |
| Architecture | `armv7l` (32-bit userland) | UA |
| GPU / WebGL renderer | Mali-G51 | browser |
| `transport_protocol` | `3290` | decoded from the UDN ASCII payload on `:3366` |

Browser: Chromium `88.0.4324.182`.

## What the network surface looks like

| Port | State | Note |
| --- | --- | --- |
| 3366 | open | UPnP/DIAL, `dd.xml` answers over direct unicast |
| 36669 | open | RemoteNow MQTT, mutual TLS enforced (`SSLV3_ALERT_HANDSHAKE_FAILURE` without a cert) |
| 36670 | open | companion TLS listener |
| 9009 | filtered | bridge is loopback-bound, as expected |
| 9222–9226 | filtered | DevTools |
| 22, 2222, 2323, 8008, 5555 | closed | no shell, no ADB |

ICMP is dropped, and SSDP multicast went unanswered on this network. Direct
unicast to `:3366/dd.xml` worked, which is the cheaper probe anyway.

## Generation note

This is the interesting part for the matrix. Earlier U6 units (the `65U8HAU`
report) presented `transport_protocol=3160`; this build decodes to **3290**, so
the newer pairing handshake is active. Pairing here should need the colon
formatted MAC and the 2024 client certificate (`res/El.p12`), like the U9 sets,
rather than the older U6 path.

The bridge family is expected to be the `WebSDK_*` origin-gated one
(`WebSDK_createFileRequest`), not the U7/U9 `HiUtils_createRequest` shim. That is
an expectation from the browser engine and the generation, not a measurement.

## What this guide includes and leaves out

| Included | Left out |
| --- | --- |
| the fingerprint and firmware constants | any write probe or payload |
| the network surface as measured | root, launcher install, bridge traversal |
| the generation delta against `65U8HAU` | anything that would change the TV |

Nothing was written to the device, so there is no teardown to document.

## Open items

- Pairing, launcher delivery and the bridge surface are all untested. The
  `3290` reading suggests the modern path works, but nobody has run it.
- Root: untested. MTK9602 has the best-documented chain in this repo
  ([50A51HUV](../../50A51HUV/09.01O.P0813/README.md)), so this is a good
  candidate for a first attempt on U6.

## Cross-reference

- Method catalogue: [EXPLOITS.md](../../../research/EXPLOITS.md)
- Publication policy: [DISCLOSURE.md](../../../DISCLOSURE.md)
