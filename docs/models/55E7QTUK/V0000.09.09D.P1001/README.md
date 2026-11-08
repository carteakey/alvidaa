# 55E7QTUK / V0000.09.09D.P1001 — fingerprint, pairing, launcher self-install verified (MTK9603, UK)

**Status:** Fingerprint, RemoteNow pairing, and the full launcher lane
verified 2026-11-08 (own TV): the custom-app registry write through the
hiutils file bridge succeeds on this branch, the TV restart ingested the
tile (owner confirmed the launcher canvas renders), and the page-load lane
from `/api/open` works. File-bridge traversal beyond the registered base
and the root chain are untested.

> **Applies to `55E7QTUK` (internal `55E70QEVS_0002`, serial type `55E7QE`,
> MTK9603, VIDAA `U09.09`, region EU_A / GBR) running `V0000.09.09D.P1001`.**
> Same `09.09` OS branch as the 55A7KAU guide (`V0000.09.09O.P1015`, MTK9602,
> AU) but a different P-code letter and a different SoC. The hiutils
> `websdk/Appinfo.json` write gate compares as opened here vs closed on the
> 43A5LE (same SoC, `U09.60A.Q0707`) — see
> [findings/01](findings/01-launcher-install.md).

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
| hiutils `fileRead` mode 6 works, `msg` is shape-polymorphic (`{errno:-2, code:"ENOENT"}` object for missing paths) | `selfinstall.html` pre/post record | verified |
| `fileWrite` mode 6 to `websdk/Appinfo.json` — **open on this branch** | `ret:true "success"`; the 43A5LE `503` gate does not apply | verified |
| Launcher self-install → restart → tile in MQTT applist (52→53) → launcher canvas renders | `selfinstall.html` + WS snapshot + owner confirmation | verified |
| Bridge surface: 75 `Hisense_*` fns + `HiUtils_createRequest` only, no `WebSDK_*` | `recon-e7qtuk.html` v1 sweep | verified |
| Sandbox base `/APPS/` leaked by failed reads (full path in errno object); absolute paths join (`/APPS//etc/passwd`) | `recon-e7qtuk.html` v2 | verified |
| Single `../` escapes the base to `/`; extra `../` clamps; dirs `EISDIR` | `../etc/passwd` read returning real contents | verified |

## Where to go next

[findings/00-fingerprint.md](findings/00-fingerprint.md) holds the pairing
matrix and the descriptor surface; [findings/01-launcher-install.md](findings/01-launcher-install.md)
holds the install run, the shape-trap that came out of it, and the rollback
path; [findings/02-recon-ladder.md](findings/02-recon-ladder.md) holds the
bridge enumeration and traversal measurements. Untested lanes on this
unit: identity gate, root chain (deliberately not run — separate decision).
