# 55E7QTUK / V0000.09.09D.P1001 — fingerprint + launcher-lane pairing only (MTK9603, UK)

**Status:** Fingerprint and RemoteNow pairing verified 2026-11-08 (own TV).
The page-load lane (`/api/open` → browser-env recon) runs; the launcher tile
is not installed, the file bridge is probed not at all, and there is no root
path attempted on this unit.

> **Applies to `55E7QTUK` (internal `55E70QEVS_0002`, serial type `55E7QE`,
> MTK9603, VIDAA `U09.09`, region EU_A / GBR) running `V0000.09.09D.P1001`.**
> Same `09.09` OS branch as the 55A7KAU guide (`V0000.09.09O.P1015`, MTK9602,
> AU) but a different P-code letter and a different SoC.

## What was measured

| Claim | Evidence | Label |
| --- | --- | --- |
| `transport_protocol=3290` | SSDP `:18400` renderer faceData | verified |
| Firmware `V0000.09.09D.P1001`, chip `MTK9603` | `Hisense_GetFirmWareVersion()` / `Hisense_GetChipSetName()` + UA (`Model/VIDAA-MTK9603 ... MTK9603/V0000.09.09D.P1001`) | verified |
| Broker pins the client-cert CA at TLS | self-signed stub → `tlsv1 alert unknown CA`; genuine `VidaaAppAndroidV01` completes | verified |
| Modern profile + colon-formatted `macWifi` pairs | PIN → `{"result":1}` → 2-day token | verified |
| Wrong MAC (12-hex or colon-formatted ethernet) is `rc=135` on all four profiles | pair.py logs, 2026-11-08 | verified |
| LAN surface = `:3366` stub + `:18400` blob + `:36669` MQTT; legacy `:1195` dead | curated port sweep | verified |
| Page-load lane (`/api/open`) works for recon pages | `fingerprint.html` + `identity.html` POSTed `/api/recon` | verified |

## Where to go next

`findings/00-fingerprint.md` holds the pairing matrix, the descriptor
surface, and the state left on the TV (paired server running, tile not
installed). Lane order per AGENTS.md: launcher self-install next, file
bridge probes after, root never assumed.
