# 85U7SE V0000.09.62M.Q0921 — modding notes

Status: root lane achieved and boot persistence staged; the launcher lane
(product lane) has NOT been exercised on this unit yet. Everything below the
root line is available once SSH is up.

## Tooling for this unit

| Path | Contents |
| --- | --- |
| `tools/ur9s/scripts/build_dropbear_a7k.sh` | same recipe, run with `CROSS=aarch64-linux-gnu` (aarch64 static works: COMPAT-enabled kernel). See the `-Wl,-pie` relink trap in the README. |
| `tools/ur9s/scripts/make_installer.py` | reuse as-is with `Architecture: mtk9655`; no ur8s fork ships — v1 here dropped the sftp lane (transfer via base64 over the shell). The prose recipe (fields, sizes, postinst steps) is in findings/01 §root. |
| `tools/ur8s/bin/` | build output only — **not committed** (IPKs/binaries never enter the tree). |

## Launcher lane (untested here)

- Pairing works over RemoteNow MQTT 36669 with the modern profile (PIN flow ~10–15 s window).
- `launchapp` with `urlType:1` / `storeType:100` under appId 16 loads arbitrary URLs in the
  stock browser — this is the delivery vehicle the root chain used.
- The Appinfo.json custom-tile recipe (50A51HUV findings 01) has not been tried on this unit.
- Per AGENTS: freeze OTA endpoints before any UI-lane edits. The unit took an OTA on
  2026-11-19 (09.60B → 09.62M), so OTA checks are live on this network.

## Environment notes for tool builders

- BusyBox v1.34.1 lives at `/usr/local/bin/busybox` (185 applets, `netstat` included) —
  use `busybox <applet>` where the distro tools are missing (`id`, `uname`, `df`, `tr`,
  `wget`, `curl`, `nc` are absent).
- `/bin/sh` and `/bin/bash` both point at `//openbox/bin/bash` (bash 3.2.57 armhf).
- Bash is whitelisted in `/APPS/shell` by the postinst; the uid-0 wrapper is
  `/APPS/.re_sshd/sh` (exports the vendor PATH, then execs bash).
- dropbear sessions: key-only (password auth not compiled in), PTY works after the
  postinst `chmod 666 /dev/ptmx /dev/pts/ptmx`.
