# 55U67LEVS / V0000.09.60A.Q0707 — one-shot uid-0 root over the vendor installer, and the EDID surface (MTK9603, EU_A)

**Status:** measured on the unit, 2026-11-14. Pairing, array-path traversal,
the fetcher write primitive, the FaaS exec primitive and **one-shot uid-0
code execution** are verified. Root was reached through the standard
superwatch → vendor `opkg` → `postinst` lane; the earlier `rc -1` was a
malformed IPK, not a closed door. Boot persistence and a shell are **not**
established, and no EDID has been written yet.

> **Applies to `55U67LEVS` (`55U6LE` series) on `MTK9603`, VIDAA `U09.60`,
> firmware `V0000.09.60A.Q0707`.** The same firmware string ships on
> [`43A5LE`](../../43A5LE/V0000.09.60A.Q0707/README.md) (region `EU_A`, ITA,
> build 2026-07-07), which was measured for pairing + launcher only; the two
> rows are separate units and separate measurements. Region on this unit was
> not read (`Hisense_GetRegion()` not called) — do not assume `EU_A`.

> **Measured by the unit's owner in an AI-driven session, 2026-11-14.**
> Research frame unchanged: own TV, LAN-local, verified boot untouched, no
> `/OAD`, no writes to read-only mounts.

## What the chain rests on

1. **The MQTT broker validates the client certificate's CA at the TLS layer.**
   A self-signed client cert fails the handshake (`tlsv1 alert unknown CA`)
   before MQTT is reached — unlike the 50A51HUV build, where any cert
   completes TLS and refusal happens at CONNECT. The official
   `CN=VidaaAppAndroidV01` keystore (`res/raw/client_mobile_android.p12`,
   2565 bytes, from `com.universal.remote.multi` 1.09.06.003.1) completes a
   TLSv1.2 handshake and then authenticates.
2. **The file bridge rejects bare-string traversal but accepts an array path.**
   `path: "../proc/uptime"` → `{ret:false, msg:"invalid path:../proc/uptime"}`;
   `path: ["../proc/uptime"]` → `ret:true` with the file's content. The base
   for absolute resolution is `/APPS/`. This is the same validator shape as
   75U8QTUK / 50U7DSE, not the 43Q60SEVS "strict joiner".
3. **The FaaS fetcher writes.** `vowOS.service.syncExecute("basic/fetcher",
   {api:"fetchFile", args: JSON.stringify({url, directory, permission})})`
   returns `{ret:true, msg:"download finished"}` for arbitrary
   `directory` values as uid 314 — `/APPS/…` and
   `/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/…` both confirmed. The browser
   `fileWrite` surface is a different path and was not re-measured here.
4. **The FaaS fetch directory executes.** `POST
   http://localhost:9009/function/basic/fetch/<name>` runs whatever module
   sits at `…/jsservice.basic/CHA/functions/fetch/<name>.js`. Worker identity
   on this unit: **uid 314, gid 314**, supplementary groups include **616**,
   `execPath` `/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix`.
5. **The root channel is the vendor's own installer.** `/var/run/superwatch_socket`
   is `mode 660 uid 0 gid 616` and connects as uid 314 (group 616 present).
   Framing is a 4-byte LE length followed by
   `<session>:<command>:<session>;<ipkPath>;<package>;<options>`; the reply is
   `<session>:<rc>`. Command `82` runs `/usr/local/scripts/ipk_install.sh` as
   root, which calls the vendor `opkg`. That `opkg` is patched: it requires
   `AppId` and `AppName` in the package control and a **non-empty**
   `data.tar.gz` — a minimal "control + empty data" IPK is rejected with
   `install_app_configs: Invalid input parameters` and `Failed to extract data
   files`. With both fixed, `rc 0` and the postinst runs as uid 0
   (`CapEff 000001ffffffffff`). The script's outcome is readable as uid 314 at
   `/tmp/ipk_install_result` (chown 314:314).

## What was measured

| Claim | Evidence | Source |
| --- | --- | --- |
| Model / SoC / firmware | verified | UA `Model/VIDAA-MTK9603 VIDAA/9.0(Hisense;SmartTV;55U67LEVS;MTK9603/V0000.09.60A.Q0707;UHD;55U6LE;)`, Chromium `111.5563.5.1 Odin` |
| Broker rejects a self-signed client cert at TLS | verified | `SSLError: TLSV1_ALERT_UNKNOWN_CA` |
| Genuine 2024 cert completes TLS | verified | `TLSv1.2 ECDHE-RSA-AES256-GCM-SHA384` |
| Pairing, `modern` profile, colon MAC | verified | `vidaa_app_connect` → 4-digit PIN → `authenticationcode {result:1}` → `tokenissuance` (access 2 d, refresh 30 d) |
| Traversal: bare string rejected | verified | `{"ret":false,"msg":"invalid path:../proc/uptime"}` |
| Traversal: one-element array works | verified | `{"ret":true,"msg":"828091.91 3022176.18\n"}` |
| Fetcher write to `/APPS` and the package CHA dir | verified | `ret:true "download finished"` ×4 variants |
| FaaS exec as uid 314 with gid 616 | verified | module response `uid:314,gid:314,groups:[…,616,…]` |
| `/var/local` writable as uid 314 | verified | module write/read/unlink all `true` |
| superwatch socket reachable | verified | `socketStat {mode:"660",uid:0,gid:616}`, command 85 → `rc 0` |
| superwatch install `82` | verified | reply `802:0` once the IPK was compliant |
| superwatch `82` with a malformed IPK | rejected (`rc -1`) | opkg: `install_app_configs: Invalid input parameters`, `Failed to extract data files` |
| superwatch `53` | untested semantics | reply `714:604` |
| **Root (one-shot)** | **verified** | postinst ran `Uid: 0 0 0 0`, `CapEff 000001ffffffffff` |
| Boot persistence / shell | untested | — |
| `/config` remount rw/ro as root | verified | `remount rw: OK`, `remount ro: OK` |
| Launcher page render on this unit | untested | page was opened but never confirmed on screen |

## The command table as measured

| Frame | Reply | Reading |
| --- | --- | --- |
| `711:85:711` | `711:0` | command accepted, baseline ok |
| `712:82:712;/APPS/re-proof.ipk;re.proof;` | `712:-1` | rejected / install failed (ar-format IPK) |
| `713:82:713;/APPS/re-proof-tar.ipk;re.prooft;` | `713:-1` | rejected / install failed (tar-format IPK) |
| `714:53:714;/APPS/re-proof.ipk;re.proof;` | `714:604` | different code path; semantics unknown |
| `715:85:715;/APPS/re-proof.ipk;` | `715:0` | args on 85 are ignored, not an error |

The probe IPK was 788 bytes (`ar`) / 626 bytes (`tar.gz`), package `re.proof`,
postinst writing one `Uid:` line to `/APPS/.re_root/PROOF` and nothing else.

## What this guide includes and leaves out

| Included | Left out |
| --- | --- |
| fingerprint and firmware constants | working payloads |
| the five properties the chain rests on | the exact command sequence |
| the measured command/reply table | key material, tokens, certificates |
| the teardown path | vendor binaries |

The line is the repo's publication policy: the architecture and the evidence
are public, the artefact that executes is not. The probe IPK described above
is a proof-of-identity, not a root payload, and is not shipped.

## Teardown

State left on the unit by this session: `/APPS/re-proof.ipk`,
`/APPS/re-proof-tar.ipk`, `/APPS/.re_root/` (empty), and any
`alvproof_*` / `alvdiag3_*` module files under
`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/`. None of it is
armed: no postinst ran (`rc -1`), so nothing starts on boot.

- The FaaS directory has **no delete primitive**; removal is
  overwrite-with-zero by convention, or `fs.unlink` from inside a module
  (uid 314 can write the directory).
- Nothing was appended to `serviceList.json`, so there is no boot hook to
  remove.
- `server/keys/` holds the cert and tokens (gitignored); they are
  credential material and stay there.

## See also

- [`findings/00-session-2026-11-14.md`](findings/00-session-2026-11-14.md) —
  the full session record, including the managed-host networking trap and
  the exact continuation plan.
- [`findings/01-edid-surface.md`](findings/01-edid-surface.md) — the EDID
  surface: a per-port, config-driven catalogue on `/config/EDID_BIN` rather
  than an eeprom blob, with the decoded current advertisement and the
  vendor's own FreeSync variant. Relevant to anyone who wants 1440p/VRR; it
  also replaces the repo's earlier "eeprom or nothing" answer.
- [43Q60SEVS / 09.60W.Q0612](../../43Q60SEVS/V0000.09.60W.Q0612/README.md) —
  the same family's verified chain (fetcher → superwatch → uid-0 postinst).
- [50U7DSE / 09.62N.Q0923](../../50U7DSE/V0000.09.62N.Q0923/README.md) — the
  array-path traversal precedent.
