# 02 — Recon ladder v1+v2 (2026-11-08)

Read-only bridge recon on this unit, pages `launcher/recon-e7qtuk.html`
(v1+v2 only; the upstream v1–v4 ladder for the branch family is
`launcher/recon-55.html` on the 55A7KAU). Nothing was written to the TV;
the only files touched are this notebook and the gitignored recon report.

## v1 — bridge enumeration, UA, sandbox (verified)

- The page env exposes **75 `Hisense_*` functions** and exactly one
  `Hi[Uppercase]*` function: **`HiUtils_createRequest`**. **No `WebSDK_*`
  functions are exposed to pages on this build** (HiUtils is the only bridge
  family beyond identity/settings getters).
- UA: `Mozilla/5.0 (X11; Linux armv7l) AppleWebKit/537.36 (KHTML, like
  Gecko) Chrome/111.0.5563.146 Odin/111.5563.5.1 Safari/537.36
  Model/VIDAA-MTK9603 VIDAA/9.0(Hisense;SmartTV;55E70QEVS;MTK9603/V0000.09.09D.P1001;UHD;55E7QE;)`
  — same Chromium 111 "odin" web-app browser family as the 55A7KAU, armv7l.
- Sandbox probes (all `fileRead`, mode 6):
  - `websdk/Appinfo.json` → `ret:true`, body IS our installed launcher
    registry (round-trip sanity for [01](01-launcher-install.md)).
  - `./` → `errno:-21 EISDIR, syscall:read` (no directory listing, read
    syscall on a dir).
  - `zzz-nonexistent-probe.txt` → `errno:-2 ENOENT` **with the full
    resolved path: `/APPS/zzz-nonexistent-probe.txt`**.
  - `/etc/passwd` (absolute) → `ENOENT` as **`/APPS//etc/passwd`** —
    absolute paths are joined onto the base (naive double-slash), they do
    NOT escape.

## v2 — the errno leak and traversal (verified)

- **A failed read leaks the sandbox base in the errno object's `path`
  field.** Base is **`/APPS/`**. Same leak shape as the 55A7KAU and 75UR9S:
  `{"errno":-2,"code":"ENOENT","syscall":"open","path":"/APPS/…"}`.
- **A single `../` escapes the base**: `../etc/passwd` → `ret:true` with
  real `/etc/passwd` contents (root shell = `/usr/local/scripts/rootlogin.sh`,
  `television:x:300`, same factory-gate login-shell pattern as the
  A7KAU; full body in the session report, not committed).
- Every deeper rung also reads (`../../` … ×8, and
  `websdk/../../../../etc/passwd`); extra `../` clamps at `/` — a base
  mismatch does not break reads. Prefix choice is therefore immaterial, as
  on the A7KAU.
- Directory reads stay listing-free (`EISDIR`) even through the working
  prefix (`../etc` → read-syscall EISDIR shape).

## Where this sits in the family

| Behavior | 55A7KAU `09.09O.P1015` | 55E7QTUK `09.09D.P1001` |
| --- | --- | --- |
| `ret` shape | boolean | boolean |
| failed-read leak | full resolved path in errno object | same |
| base | `/APPS/` (joined absolute paths: `/APPS//…`) | same |
| `../` escape | single `../` reaches `/` | same |
| dir reads | `EISDIR` | same |
| `Hisense_*` count | 75 + `HiUtils_createRequest` | same |
| `websdk/Appinfo.json` write | gated at `fileWrite` 503 on 09.60A only | **open, in base** ([01](01-launcher-install.md)) |

The bridge family on this unit is measured-identical to the 55A7KAU's at
the v1/v2 level; the only recorded divergence in the base-mapping tier is
the appconfig write gate, which is branch-dependent rather than
generation-wide.

## Untested next (root-lane territory, deliberately not run here)

v3 dumps (`/proc/mounts`, inittab) and the v4 wire capture
(`POST localhost:9009/service/hiutils`) + phoenix `proc/self` reads are
compiled into the A7KAU page and the ladder is designed to extend; run
them as a separate decision — this session stayed inside the launcher lane.
