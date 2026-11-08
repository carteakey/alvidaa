# 01 — Launcher self-install (2026-11-08)

End-to-end launcher lane on this unit, same day as the fingerprint. The
registry write that is **gated on the 43A5LE (MTK9603, U09.60A.Q0707) is
allowed here** (MTK9603, U09.09D.P1001) — the 503 appconfig permission gate
is not a fixed property of the SoC; it is branch-dependent.

## What ran (verified, via `launcher/selfinstall.html` through `/api/open`)

A hands-free variant of `launcher/index.html` `installAsApp()` — same entry
(`vidaa-home` / "Home"), same bridge calls, shape-aware around this build's
return shape. It loaded once per `/api/open`, did read → merge → write →
readback, and POSTed the full pre/post record to `/api/probe` (append-only;
registry content stays in the gitignored `server/probe-report.json` — nothing
identifying is committed).

| Step | Result |
| --- | --- |
| `fileRead websdk/Appinfo.json mode 6` | `ret:false`, errno −2 `ENOENT` on `/APPS/websdk/Appinfo.json` — factory-state unit, no web-app registry existed |
| `fileWrite` (registry with `vidaa-home` entry) | `ret:true`, `"success"` |
| readback | `ids: ["vidaa-home"]`, `url http://192.168.0.195:8770/` |
| TV restart (mains cycle by owner) | applist 52 → 53; `Home` entry with `icon /icon/vidaa-home` present via MQTT applist |
| tile behavior | owner-confirmed: Home shows the Home tile; opening it renders the launcher canvas (inputs row, app icons, shortcuts) |

**Readings:**

- The hiutils result shape on this build is **not** the launcher's assumed
  `{ret, msg:string}`: on a real missing file phase returns
  `{ret:false, msg:{errno:-2, code:"ENOENT", syscall:"open", path:...}}` —
  `msg` is an *object* carrying the POSIX errno, not a string payload. Any
  page that does `JSON.parse(cur.msg)` blindly will throw
  `TypeError: (...).slice is not a function` (first version of the
  selfinstall page did exactly that). Treat `msg` as shape-polymorphic.
- That ENOENT is itself a capability read: the path resolves and the
  syscall detail comes back — the file bridge is *reachable* from a
  page on this build, with mode 6, without any root lane.
- `fileWrite` mode 6 success: first unit in the matrix where this exact
  gate is **verified open** on a 2024 generation (contrast: 43A5LE 09.60A
  `503 client request permission check error`; 75U8QTUK 09.60I needed
  root-lane writes instead). SoC MTK9603 in both — the deciding variable
  is the firmware branch, not hardware.
- `ret:false` + ENOENT on read followed by the create-on-write path is the
  LAUNCHER's designed first-run lane (`(cur.ret ? JSON.parse : {AppInfo:[]})`
  in `installAsApp`) — it was never exercised before because no prior
  unit came with an empty web registry.
- Relaunch of the same page is deduped by URL **path**, not query —
  findings 12 for the mechanism; here it meant loading with a fresh
  `?v=` each time for re-runs of the same URL.
- The TV's MQTT applist only ingested the registry entry after a full
  power cycle (the DEPLOY.md contract), consistent with the other units.

## State after this lane

- `launcher/selfinstall.html` is the committed one-shot installer tool
  (idempotent style: it rewrites its own entry only; a re-run after app
  state churn picks up where the file left off).
- `installed: True` in the server snapshot; 53 apps in the TV applist.
- The rollback path mirrors the install: a page rewriting
  `websdk/Appinfo.json` without the `vidaa-home` entry (or restoring the
  pre-install empty registry — it didn't exist). No other lane (root,
  boot hooks) was used; the TV is user-space only.
- Watcher stays off (server `config.json`, existing default): making the
  launcher the auto-bouncing home is a server-config choice, not part of
  the install.

## Where next

File-bridge traversal probes (findings 04 pattern) are untested on this
unit; the write lane already proven open could carry the recon ladder
further. That is root-lane territory — separate decision from the
launcher lane, which is complete.
