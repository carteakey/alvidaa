# alvidaa findings — the bridge is a local HTTP API (recon §10.1–10.3, 10.5)

> Split from the original FINDINGS.md lab notebook. Canonical record; the blog and STORY.md draw from these.

## 10. Recon deep-dive (Oct 2026): the bridge is a local HTTP API

Probed live with `launcher/recon.html` (v1→v5), which self-reports to the server's
`/api/recon` endpoint. Per-run snapshots: `server/recon-report-v*.json`. The page
POSTs its report incrementally after every section — needed, because the bridge
backend can die mid-run (§10.3).

### 10.1 Device identity

- SoC **MTK9602** (MediaTek — *not* HiSilicon), 4K panel (3840×2160),
  model `50A51HUV` / serial type `50A5HU`, region US / country CAN.
- Firmware `V0000.09.01O.P0813`, OS `U09.01`, capability code `2025011014`.
- Browser "odin" = **Chromium 111**, 32-bit ARM (`armv7l`) UA. §7's "Chrome 77" is
  stale on this firmware; modern JS works (recon pages still ship ES2018 out of habit).

### 10.2 The JS bridge is three layers

1. Page JS: ~81 `Hisense_*` functions + `HiUtils_createRequest` — enumerable with
   `Object.getOwnPropertyNames(window)`. They are plain JS shims.
2. The shims POST JSON to **`http://localhost:9009/service/hiutils`** (file ops and
   utility APIs) and **`/service/tvinfo`** (`Hisense_Get*` info), with body
   `{"api":"<name>","args":{...}}` and a header `identifier: <base64 16-byte token>`
   that **rotates on every request**. Response shape: `{"ret":bool,"msg":...,"session":-1}`.
   Wrong api names get a clean `{"ret":false,"msg":"Not supported api"}` — a perfect
   fuzzing oracle.
3. The backend is **phoenix** — a Node.js server: `/opt/pkgs/tv.vidaa.app.phoenix/bin/phoenix`
   (Node flags incl. `--report-uncaught-exception --report-on-fatalerror`,
   report to `/var/local/log.phoenix.report`) running
   **`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/phoenix.server.js`** — i.e. the file
   bridge's own source lives on the writable `/APPS` partition.

### 10.3 The file sandbox — and the hole in it

- `fileRead`/`fileWrite` resolve relative paths against **`/APPS`**; absolute paths
  fail with an errno leak that proves it: `open("/APPS//etc/passwd") → ENOENT`.
- **`../` escapes to the real root.** `../etc/passwd`, `../proc/mounts`,
  `../etc/inittab` read fine; `../tmp/...` writes succeed. Net effect: arbitrary
  read+write as uid 314, filesystem-wide.
- Root-owned 0600/0700 files still deny (EACCES): `/etc/shadow`,
  `/usr/local/scripts/rootlogin.sh`, `/etc/cli_login.sh` — plain DAC, because
  **SELinux is permissive**: `/sys/fs/selinux/enforce` = 0, and `rcS.utopia.linux`
  explicitly calls `setenforce 0` when `/openbox/bin/load_policy` exists.
- `mode: 0` resolves against `/tmp` instead (errno leak `/tmp/../etc/`);
  `mode: 6` is the Appinfo-flow convention.
- No directory listing: `fileRead` on a directory → `EISDIR`. Enumeration is
  path-guessing fed by anything that names files (boot scripts, package names).
- **Reading a binary (ELF) crashes the phoenix backend.** Reproduced twice
  (`../bin/sh`); text files are fine. The backend is back by the next page run —
  supervised restart — but everything queued after the crash in one run is lost
  (hence the incremental POSTs).

### 10.5 Raw API probing

- The shim's request is reproducible directly from any page: XHR to
  `localhost:9009` with the captured shape (v4 `report.wire` has it verbatim).
  Fuzzing api names against that shape cleanly separates supported from
  unsupported (`"Not supported api"`).
- `phoenix.server.js` — the backend's own source, on our writable `/APPS` — is
  readable via `../APPS/pkgs/tv.vidaa.jsservice.basic/CHA/phoenix.server.js`;
  see [04-privilege-map.md](04-privilege-map.md) (§10.4, §10.6–10.8) for the privilege map, lane assessment, and the v5/v6 dump results.
