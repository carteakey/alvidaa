# HANDOFF — 55U67LEVS EDID work (continue in a terminal session)

Session: 2026-11-14, DeepSeek Harness **web** session
`7c02b5d4-fecc-448a-a6a0-b0cf4f8668cf`, workspace `/Users/dominik/private/vidaa/alvidaa`.
Written because the work moved to a TUI session. Delete this file when the
thread is finished.

## The one thing that matters

**The EDID this TV actually presents is
`/config/EDID_BIN/Hisense_EDID1_4k2k_Enhance.bin` — not the `Mstar_EDID1_v2.1_*`
file the INI points at.**

Verified by byte-comparing the live EDID (read over HDMI with
`~/private/hisense/tools/read-edid-macos`) against every candidate in
`/config/EDID_BIN`: exact match on the Hisense "Enhance" file for HDMI 1.

Consequence: patching `Mstar_EDID1_v2.1_4K_2K_3D_HDR*.bin` does nothing, which
is why the PS5 kept saying "1440p not supported" after two deploys and a
reboot.

## State of the TV — RESOLVED (recon 2026-11-14 ~12:10, read-only)

Measured over the FaaS lane (`fs.readFileSync` as uid 314, no writes):

| Check | Value | Meaning |
| --- | --- | --- |
| `/config/EDID_BIN/Hisense_EDID1_4k2k_Enhance.bin` DTD2 | `023a801871382d40582c4500501d7400001e` (1080p60), range `24–75 Hz` | **factory, untouched** |
| `/config/EDID_BIN/Mstar_EDID1_v2.1_4K_2K_3D_HDR.bin` DTD2 | `6fc2…` (1440p), range `24–120 Hz` | still the edited version — but **unused** |
| `/APPS/.re_root/edid_backup/` | only the two `Mstar_*` files | no Hisense backup was ever taken |
| `/APPS/.re_root/edid_deploy2.log` | absent | the `re-hisense.ipk` postinst **never ran** |
| uptime | 2385 s at read (boot ≈ 11:28) | the reboot payload did fire |

So it is **state B**: the live file was never touched, nothing needs restoring,
and the 1440p work is simply not applied yet. The patched `Mstar_*` pair is
harmless dead weight (the TV does not present it).

## State at the time the session was interrupted (historical)

Two deploys were issued; the last one (`re-hisense.ipk`) was launched and the
TV rebooted, but its result was never read — the Mac was disconnected mid-run.

So the unit is in one of these two states:

| # | Mstar port-1 pair | Hisense_EDID1_4k2k_Enhance.bin |
| --- | --- | --- |
| A (likely) | restored from backup by the last postinst | **replaced** with the 1440p surgical version |
| B | still the edited (harmless, unused) version | untouched (factory) |

Check as root, next session:

```
cmp -s /APPS/.re_root/edid_new/Hisense_EDID1_4k2k_Enhance.bin \
       /config/EDID_BIN/Hisense_EDID1_4k2k_Enhance.bin && echo STATE_A
ls -l /APPS/.re_root/edid_backup/
```

Backups live in `/APPS/.re_root/edid_backup/`. Note: the earlier
`/APPS/.re_root/restore_edid.sh` only restores the **Mstar pair**, not the
Hisense file — if state A, copy
`/APPS/.re_root/edid_backup/Hisense_EDID1_4k2k_Enhance.bin` back by hand.

## What the surgical file changes (validated, ready)

`~/private/hisense/edid_surgical/Hisense_EDID1_4k2k_Enhance.bin` — 18 bytes
different from the unit's own file:

- base DTD2 (was 1080p60) → **2560x1440 @ 119.997 Hz**, 497.75 MHz,
  `6fc200a0a0a0555030203500ba04a802001e`
- range limits → **24–120 Hz**, 15–200 kHz, max dotclock unchanged (600 MHz)
- recomputed base + CEA checksums

Everything else byte-identical: preferred DTD stays 4K60, the HF-VSDB (VRR)
block is untouched, the VIC list is untouched (it already carries VIC 16, so
1080p60 survives losing DTD2), audio descriptor untouched.

Why this and not the pre-built `55u6nq` EDIDs in `~/private/hisense/edid_extracted/`:
those rebuild the base identity (mfr `0x20a3` vs `0x3674`), the audio block
(9→21 bytes) and the HF-VSDB (13→10 bytes). They change three things that
currently work, so a failure would be unattributable.

## Attempted 2026-11-14 evening — two failed applies, one open bug

Baseline read over HDMI with the Mac on port 1: **factory** (`HISENSE`,
4K60 + 1080p60, range 24–75 Hz, no 1440p). Good.

| Run | superwatch reply | Outcome |
| --- | --- | --- |
| 1 | `882:-1` | the page never staged the IPK → `ipk file … not exists`. Fixed: `edid.html` now `fetchFile`s `edid-apply.ipk` / `edid-restore.ipk` before invoking `82`. |
| 2 | `835:0` | **install succeeded, but the live EDID did not change and no reboot was observed.** Cause not yet read. |

**Owner confirmed no reboot happened** during run 2, which selects the first
candidate and rules out the second: the postinst takes this branch

```sh
if [ ! -f "$NEW/$F" ]; then
  echo "MISSING payload ..." >> "$LOG"
  exit 0            # exits before the reboot line
fi
```

so `rc 0` + no reboot + unchanged EDID = **the payload was not staged where
the postinst looks**. The page fetched it (`ret:true "download finished"`) but
the install ran before it was visible, or it landed elsewhere — hence the
silence.

**Fixed in the page (2026-11-14):** `edid.html` now stages a `check_staged.js`
module after the fetch and, before invoking `82`, requires
`/APPS/.re_root/edid_new/Hisense_EDID1_4k2k_Enhance.bin` to exist at exactly
256 bytes; otherwise it logs `ABORT: payload not staged — not installing` and
returns without installing. A silent no-op can no longer be mistaken for a
successful write.

Next session: run `./edid-deploy.sh apply a` again with the fixed page. If it
reports `ABORT`, read `/APPS/.re_root/edid_apply.log` and the `staged check`
line — that is now the only ambiguity left.

The read attempt that would have answered this was blocked by the tunnel being
killed mid-session (the `bore` child dies with the script), so the page never
loaded. Note for the driver: **check the tunnel is alive before `open_page`**,
and read the report with an absolute path (running the script from
`launcher/recon-captures` breaks the relative `server/recon-report.json`).

## Ready-made tooling (built 2026-11-14, not applied)

Everything for the live file is staged outside the repo:

- `~/private/hisense/edid-deploy.sh` — `status` / `verify` / `apply a|b|c` / `restore`
  (starts the server and tunnel, drives a payload page, waits for the reboot,
  then re-reads the file). `verify` is read-only and was exercised end-to-end.
- `~/private/hisense/edid_surgical/` — three variants of
  `Hisense_EDID1_4k2k_Enhance.bin`: **a** 1440p in DTD2 with the shipped VRR
  block, **b** a + VRR max 120, **c** 1440p as preferred timing + VRR 120.
- `~/private/hisense/NEXT-STEPS.md` — the decision tree for the PS5 result.
- repo (gitignored) `launcher/recon-captures/`: `edid.html`, `edid-apply.ipk`,
  `edid-restore.ipk`, the three variants, `variant.txt.a|b|c`.

## Next steps, in order

1. Bring the tooling back (see Environment below).
2. Read the state table above; restore the Mstar pair if state B left them edited.
3. If the Hisense file is not yet the surgical one, deploy it (the IPK recipe
   is `re-hisense.ipk` + the fetcher staging pattern — see findings/01 §10).
4. Reboot, then verify **from the source side**: plug the Mac into HDMI 1 and
   run `~/private/hisense/tools/read-edid-macos /tmp/live.bin`; expect
   `2560x1440` in DTD2 and range `24–120`.
5. Only then put the PS5 back and check Screen and Video.

If the live EDID shows 1440p and the PS5 still refuses, the remaining variable
is the PS5's own 1440p gate (it may require a specific timing shape or the
mode as preferred), not the TV's advertisement.

## Wake-from-standby, measured (owner absent)

The TV sat in `fake_sleep_0` (panel off, MQTT broker up). Lanes tried, one MQTT
session at a time:

| Attempt | Result |
| --- | --- |
| `launchapp` (appId 16, TV Browser) via `ui_service` | no effect — state stayed `fake_sleep_0` |
| `sendkey` `{"key":"KEY_POWER"}` / `{"key":"POWER"}` / `{"keycode":116}` on `remote_service` and `ui_service` | no pushes, no error, no state change observed at the time |
| Wake-on-LAN magic packet to `255.255.255.255` and the /24 broadcast | **the state subsequently read `remote_launcher`** — the TV came on |

Attribution is **not established**: sendkey and WOL were minutes apart and the
state was only sampled after both. What is safe to say:

- the broker answers in `fake_sleep_0`, so a session is available while the
  panel is off;
- `launchapp` does not turn the panel on;
- the network wake that worked is one of {sendkey, WOL} — do not rely on
  either until a controlled A/B is run (toggle with one lane, then the other).

A controlled test needs the TV to be switched off twice, so it is a
user-present task, not a recon one.

## Environment

| Thing | Value |
| --- | --- |
| TV | DHCP lease; scan TCP **36669** on the `/24` (ICMP is disabled, do not ping) |
| Server | `cd server && ./venv/bin/python -u vidaa_server.py <tv-ip> 8765` |
| Tokens | `server/keys/tokens.json` (access 2 days from 2026-11-14, refresh 30) |
| Serving the TV | the host Mac is MDM-managed and Defender's netext drops inbound → `bore local 8765 --to bore.pub` and load `http://bore.pub:<port>/…` |
| Root | one-shot: IPK whose control has `AppId`/`AppName` and a non-empty `data.tar.gz`, installed via superwatch `82` → postinst as uid 0 |
| Payload staging | the fetcher writes files as uid 314 but will not create directories — `mkdirSync` from a FaaS module first; `opkg` extracts `data.tar` relative to `/APPS/pkgs` |
| Readback | `/tmp/ipk_install_result` (chown 314:314) and anything written to `/APPS/.re_root/` (0644) |

## Harness

`dsh tui --resume 7c02b5d4-fecc-448a-a6a0-b0cf4f8668cf` is the intended way to
continue in a terminal, but **this install ships only the `web` profile** —
`dsh tui` fails with `profile "tui" does not exist`. Either create one
(`dsh plugin --profile tui add <bundle>`) or continue in a fresh session in the
same workspace and point it at this file; nothing below depends on chat history.

Files that carry the thread:

- `docs/models/55U67LEVS/V0000.09.60A.Q0707/README.md` — the model guide
- `…/findings/00-session-2026-11-14.md` — chain, opkg contract, state
- `…/findings/01-edid-surface.md` — EDID surface, decoded advertisements, deployment
- `~/private/hisense/` — vendor bins, surgical candidates, read-edid tool

## RESOLVED 2026-11-14 ~22:50 — variant A applied and verified on the TV

Two root causes cleared:

1. **opkg had refused the package as a downgrade.** The installed package was
   `1.2.0` (the poweroff build); the apply package was `1.1.0`. `opkg
   --force-reinstall` did nothing and the wrapper still reported success.
   Rebuilt as `2.0.0` → the postinst ran.
2. **The TV's HDMI input hid the browser.** Whenever the Mac was on HDMI 1,
   pages loaded and executed but the panel showed the Mac — so "the page never
   appeared" was a display-input issue, not a load failure. Confirmed by
   `/proc/uptime` changing and pages fetching in the server log while the owner
   saw no black screen.

Also learned: `busybox cmp` on this build returns non-zero even for identical
files, so the postinst's `verify: MISMATCH` is meaningless — trust a byte read
instead.

Verified on the device after reboot:

```
Hisense_EDID1_4k2k_Enhance.bin  (HDMI 1)
  DTD2  = 6fc200a0a0a0555030203500ba04a802001e   2560x1440 @ 119.997 Hz
  range = 18 78 0f c8 3c                         24-120 Hz, 15-200 kHz, 600 MHz
```

Backup taken by the postinst: `/APPS/.re_root/edid_backup/Hisense_EDID1_4k2k_Enhance.bin`
(plus the two Mstar files). `restore` reverts all three.

Verified again from the source side, with the Mac on HDMI 1 and the
display reader (`~/private/hisense/tools/read-edid-macos`):

```
name   HISENSE
DTD1   3840x2160 (4K60, still preferred)
DTD2   2560x1440 @ 497.75 MHz (119.997 Hz)
range  24-120 Hz, 15-200 kHz
1440p timing present: true
```

So the TV now advertises 1440p120 on HDMI 1 — proven without the PS5.

Next: PS5 on HDMI 1 → Screen and Video. If 1440p appears but VRR caps at 48-60,
apply variant **b** (only the VRR max byte changes).
