# 01 — the EDID surface: a config-driven catalogue, not an eeprom blob

Session 2026-11-14, second block. Unit `55U67LEVS`, `MTK9603`, VIDAA `U09.60`,
firmware `V0000.09.60A.Q0707`, region `EU_A`, panel `3840x2160`.

**Why this file exists.** While reading for another purpose (1440p120 + VRR for
a PS5) we found that this build selects its advertised EDID from files on a
normal filesystem, per HDMI port, through an INI. That is a different and much
better lane than "write the raw eeprom", which is what the repo implied until
now. Nothing here was written to the TV.

Labels: **verified** = read from the device this session; **unverified** = the
mechanism is inferred and not yet exercised.

## 1. The display stack is fbdev, not DRM

| Fact | Value |
| --- | --- |
| Framebuffers | `/proc/fb` → `0 MStar FB0`, `1 MStar FB1` |
| fb0 modes | `1920x1080p-51`, `1280x720p-107`; 32bpp, stride 7680, virtual 1920x3540 |
| `/sys/class/drm` | contains only `version` — **no connector objects** |
| `/sys/module/drm/parameters/edid_fixup` | exists, `EACCES` to uid 314 |

Consequence: the usual Linux EDID override hooks (`/sys/class/drm/*/edid`,
`drm.edid_firmware`, `/lib/firmware/edid`) are **not available** on this build.
`/proc/cmdline` carries no EDID parameter (`root=/dev/mmcblk0p20`,
`CFG_SYS_INI=/config/sys.ini`, `FLASH_TYPE=EMMC`, …).

## 2. Where EDID actually lives

Partition **p24 `tvconfig`**, ext4, mounted read-only at **both** `/config` and
`/vendor/tvconfig` (`ro,seclabel,nosuid,nodev,noexec`). The rw partitions are
`/APPS` (p54) and `/var/local` (p49).

`/config/EDID_BIN/` is the vendor catalogue: files `mode 444 uid 0`,
**readable as uid 314**. Verified contents by family:

| Family | Sizes | Notes |
| --- | --- | --- |
| `Hisense_EDID{1..4}_4k2k_{Enhance,Standard}.bin` | 256 B | the "enhanced vs standard" pair |
| `Mstar_EDID{1..4}_v1.4_*` | 256 B | 1.4, 3D, side-half-top variants |
| `Mstar_EDID{1..4}_v2.0_4K_2K_{,3D_HDR}` | 256 B | HDMI 2.0 |
| `Mstar_EDID{1..4}_v2.1_4K_2K_3D_HDR{,_DSC,_FS_V1,_FS_V2,_freesync}` | 256/384 B | HDMI 2.1 family, incl. **freesync** and DSC |
| `Mstar_EDID{1..4}_v2.1_4K_2K_30_YUV420_ALLM_5867.bin` | 256 B | ALLM variant |
| `MTK_EDID{1..4}_Persist.bin` | 512 B | **all zero** — purpose unverified |
| `HDMI_EDID.bin` | 256 B | default |

> **CORRECTION (measured later, same session): the INI is not the last word.**
> The EDID actually presented on HDMI 1 is
> `Hisense_EDID1_4k2k_Enhance.bin` — the *Enhanced HDMI mode* file — not the
> `Mstar_EDID1_v2.1_*` file either INI names. Proven by reading the live EDID
> over HDMI (`~/private/hisense/tools/read-edid-macos`) and byte-comparing it
> with every candidate: exact match on the Hisense file, no match on either
> Mstar file. Editing the Mstar pair therefore changed nothing, twice.
> So: `Hisense_EDID{1..4}_4k2k_{Enhance,Standard}.bin` (per port, per HDMI
> mode) is the effective selector on this build; `edid_cfg.ini` /
> `model/Customer_1.ini` appear to be consumed somewhere else or overridden.
> Everything below about the catalogue, the decoded advertisement and the
> FreeSync variant still holds — only the *which file wins* answer changes.

## 3. Selection is an INI, and the two INIs disagree

`/config/sys.ini` sets `gModelName = "/config/model/Customer_1.ini"`, and the
model INI contains, per port:

```ini
[HDMI_EDID_1]
HDMI_EDID_File     = ".../Mstar_EDID1_v2.0_4K_2K_3D_HDR.bin"
HDMI_EDID_File_2_1 = ".../Mstar_EDID1_v2.1_4K_2K_3D_HDR.bin"
HDMI_EDID_File_2_0 = ".../Mstar_EDID1_v2.0_4K_2K_3D_HDR.bin"
HDMI_EDID_File_1_4 = ".../Mstar_EDID1_v1.4_3D_Frame_SideHalf_Top.bin"
bEDIDEnabled = 1     # 0/1
eEdidVersion = 3     # 1.4:1, 2.0:2, 2.1:3
```

Two files carry that block, with **different file selections**:

| File | Points at | Build mtime |
| --- | --- | --- |
| `/config/model/Customer_1.ini` (and `/config/Customer_1.ini`, same content) | **non**-freesync `Mstar_EDID*_v2.1_4K_2K_3D_HDR.bin` | 2026-07-06T16:57:19Z |
| `/config/edid_cfg.ini` | **`*_freesync.bin` for all four ports** | 2026-07-06T16:57:19Z |

`edid_cfg.ini` also has `[HDMI_EDID_VERSION]` (`bHDMI_EDID_DEFAULT=1`,
`bHDMI_EDID_1.4=1`, `bHDMI_EDID_2.0=0`) and a `[VGA_EDID]` block.
`/config/board.ini` adds `[BOARD_EDID_INFO] HDMI_COUNT=4`,
`HOT_PLUG_INVERSE=0xFFF0`.

Identical mtimes mean mtime cannot tell which file wins. **Which one the
middleware reads at boot is unresolved.**

## 4. What the TV advertises today (decoded)

`Mstar_EDID1_v2.1_4K_2K_3D_HDR.bin`, 256 B = base block + one CEA block:

- Base: EDID 1.3, vendor/product `0x3673/0x0001`, monitor name `MStar Demo`,
  range limits **59–70 Hz V**, 31–140 kHz H, 600 MHz max dotclock.
- Base DTD1 `3840x2160 @ 594.0 MHz` (4K60), DTD2 `1920x1080 @ 148.5 MHz`
  (1080p60).
- CEA rev 3, DTD offset `0x62`, flags `0xF2`.
- VICs: `5,132,3,1,18,19,20,7,144,31,32,34,93,95,96,97,98,100,101,102,94,99,
  2,6,33,63,64` — **63 = 1080p120, 64 = 1080p100**, and the 4K set.
- HDMI VSDB `03 0c 00 10 00 78 44 20 00 80 01 02 03 04`.
- HDMI Forum VSDB `d8 5d c4 01 78 80 07 32 28 78 00 00 00` (OUI `d85dc4`,
  ver 1, max TMDS char rate `0x78` = 120 × 5 MHz = **600 MHz**, SCDC present;
  the VRR bits are **not yet decoded**).
- **No 2560x1440 anywhere.** 1440p is not a CEA VIC, so supporting it requires
  a custom DTD (or a 384-byte, three-block EDID like the `FS_V1/FS_V2` files).

## 5. The FreeSync variant is a one-block delta

`Mstar_EDID1_v2.1_4K_2K_3D_HDR_freesync.bin` is byte-identical to the above
except the CEA DTD offset moves `98 → 107` and one vendor block is appended:

```
1a 00 00 01 01 30 78 00
AMD OUI 1A:00:00, version 1, min 0x30 = 48 Hz, max 0x78 = 120 Hz
```

So the platform's own EDID set already contains an **AMD FreeSync 48–120 Hz**
advertisement, and `edid_cfg.ini` already selects it for all four ports.
Whether the HDMI receiver actually supports VRR is a separate question —
advertisement is not capability (unverified).

## 6. Constraints discovered

- **EDID file checksum is validated.** `avmain` carries
  `CEC_SEND_EDID_FILE_CHECKSUM_PORT`, `handleGetEDIDFileCheckPort`,
  `getEDIDFileChecksum` — the CEC/HAL path computes and checks a checksum for
  the EDID file. A hand-built `.bin` must satisfy that (standard EDID per-block
  checksum at minimum; whether a separate file checksum is also exchanged is
  unverified).
- **There is a service-mode EDID reset.** `tvmain` carries
  `servicemode_reset_edid` / `reset HDMI EDID` (`cmdResetHdmiEdid`,
  `processResetHdmiEdid`) — a recovery path of last resort if a bad file is
  selected.
- `/config` is ro at runtime; writing requires root plus a remount (or a
  pre-mount write at boot). `/APPS` and `/var/local` are rw and are **not** the
  EDID path — copying a `.bin` there does nothing by itself.
- Recovery after a bad EDID is **network-side** (dropbear over LAN), not HDMI,
  so a mistake that kills an HDMI port does not lock the operator out — as long
  as boot persistence works.
- **Do not write `p6 eeprom_a`.** It holds calibration together with EDID and
  has no documented readback path. The catalogue above makes that lane
  unnecessary.

## 7. Open questions, and the cheap test for each

| Question | How to answer |
| --- | --- |
| Which INI wins — `edid_cfg.ini` or `model/Customer_1.ini`? | Connect a PC to HDMI 1 and read the EDID: presence of the `1a 00 00` AMD block means the freesync selection is live. |
| Does the set actually do VRR? | PS5 → Settings → Screen and Video: is VRR offered? Or the PC's adaptive-sync report. Advertisement ≠ support. |
| Is EDID re-read per boot, per hotplug, or only at provisioning? | Change nothing yet; watch for a runtime marker while toggling the HDMI mode setting. |
| What are `MTK_EDID*_Persist.bin` for? | Zeroed 512-byte slots; check whether they are rewritten after a mode change. |
| Does the middleware generate EDID from the panel instead of these files? | `chassis` exports `Panel::getPanelIDForEDID` — so panel ID participates at least in identification. |

## 8. What the PS5 reports (owner-observed, 2026-11-14)

With a PS5 on the TV, the console's own screen-and-video page says:

- **1440p: not supported**
- **VRR: supported, 48–60 Hz**

Two things follow, and they are the first device-side confirmation of the
decode in §4:

1. **VRR is real and already negotiated.** The set advertises HDMI VRR, the
   PS5 accepts it, and the floor (48 Hz) is the usual HDMI VRR minimum. So no
   EDID work is needed to get VRR at 4K60 — it works today.
2. **The 1440p gap is advertisement-only**, exactly as expected: the mode
   appears nowhere in the catalogue file, so the console hides it even though
   the HDMI receiver accepts the timing when a PC forces it.

The 48–60 top end at 4K60 is **mode-limited, not a panel limit** — measured
next: at 1080p the same console reports **VRR 48–120 Hz**. So the panel and
HDMI receiver do 120 Hz, and the VRR range tracks the active mode with a 48 Hz
floor (PS5 appears to derive the displayed range from the mode rather than
from the EDID's min/max fields, which makes the exact VRR byte encoding in
§9 less critical than the presence of the VRR declaration itself).

**1440p120 is therefore worth building**, and the target artefact is
`hisense-55u6nq-ps5-1440p120-vrr120.bin` (§9).

## 9. Prepared EDID variants (built off-device, not installed)

Six 256-byte candidates exist outside the repo
(`~/private/hisense/edid_extracted/`), all with **valid base and CEA
checksums**:

| File | DTD2 | Range limits | HF-VSDB tail |
| --- | --- | --- | --- |
| `hisense-55u6nq-hdmi.bin` | 1080p60 | V 24–75 Hz | `12 30 3c` |
| `hisense-55u6nq-hdmi-highfreq.bin` | 1080p60 | V 24–75 Hz | `12 30 3c` |
| `hisense-55u6nq-hdmi-1440p120.bin` | 2560x1440 @ 483.2 MHz | V 24–120 Hz | `12 30 3c` |
| `hisense-55u6nq-hdmi-1440p120-cvt-rb.bin` | 2560x1440 @ 497.8 MHz (CVT-RB) | V 24–120 Hz | `12 30 3c` |
| `hisense-55u6nq-ps5-1440p120-vrr60.bin` | 2560x1440 @ 497.8 MHz | V 24–120 Hz | `12 30 3c` |
| `hisense-55u6nq-ps5-1440p120-vrr120.bin` | 2560x1440 @ 497.8 MHz | V 24–120 Hz | `12 30 78` |

All keep 4K60 as DTD1 (preferred), replace DTD2 with 1440p where applicable,
carry monitor name `HISENSE`, 600 MHz max dotclock, and the VIC list
`97,94,95,96,93,106,107,1,2,4,5,16,17,19,20,31,32,33,34,18,3,101,102,98,99,
100,63,64` (63/64 = 1080p120/100 retained).

The tail differs by one byte only: `3c` = 60, `78` = 120 — the VRR maximum, with
`30` = 48 as the minimum. **The byte layout of that VRR field is the one part
not verified against a parser**; the empirical check is whether the PS5 reads
the range the file intends after it is installed.

**None of these is installed** — the console still reports 1440p unsupported,
which is consistent with the vendor file being the one presented. Deployment
needs root (§6).

## 10. Deployed: 1440p120 on HDMI 1 (2026-11-14)

Written to the unit and verified live, via the one-shot root IPK:

- both channel-1 files were backed up to `/APPS/.re_root/edid_backup/`, and a
  restore script was left at `/APPS/.re_root/restore_edid.sh`;
- `/config` was remounted rw, both `Mstar_EDID1_v2.1_4K_2K_3D_HDR*.bin` files
  were replaced, then remounted ro;
- readback proves the change: bytes at the CEA DTD slot are
  `6fc200a0a0a0555030203500ba04a802001e` (2560x1440 @ 119.997 Hz) in both
  files, and the range-limits descriptor is `18 78 0f c8 3c`
  (24–120 Hz, 15–200 kHz, 600 MHz);
- **only HDMI 1 was touched.** Ports 2–4 keep their factory files, which is
  the deliberate fallback.

The EDID used is a surgical edit of the unit's own vendor binary: the CEA DTD
slot (previously 720x480) and the range descriptor, nothing else — the
HF-VSDB, VIC list and audio descriptor are byte-identical, so the VRR
behaviour that already works at 4K60 is untouched. A wholesale reuse of the
pre-built `55u6nq` EDIDs was rejected for that reason: those rebuild the base
identity, the audio block and the HF-VSDB.

Whether the middleware re-reads the file at boot is the open question; the
change is inert until a reboot.

### Deployment mechanics worth keeping

- `opkg` on this build extracts `data.tar.gz` with cwd `/APPS/pkgs`, so an
  entry `./APPS/.re_root/x` lands at `/APPS/pkgs/APPS/.re_root/x`. Because of
  that, payload files were staged with the **fetcher** into
  `/APPS/.re_root/edid_new/` and the postinst copied them from there;
  the package data tree only has to be non-empty.
- The fetcher will not create directories — a small FaaS module has to
  `mkdirSync` first.
- There is **no root boot hook** on this build: no `/etc/rc.local`, no
  `/var/local/otaTest.sh`, `rcS.utopia.linux` sources nothing writable, no
  `serviceList.json` under `/APPS/pkgs`, and `/etc/scripts/mount_overlayfs.sh`
  does not exist. A self-healing boot guard is therefore not available without
  more research; staged rollout (one port) is the risk control instead.

## 11. State

**Nothing was written.** Every read above went through the FaaS worker as
uid 314 (`fileRead`/`readdir`), no root involved, no mount changed.

Two practical notes for the next session:

- uid 314 **cannot read** `/APPS/pkgs/tv.vidaa.app.youtube` (`EACCES`) — the
  package is root-only, so `start_youtube.sh` needs uid 0.
- The `faas` worker has a memory ceiling: scanning a 32 MB binary in one
  `readFileSync` **killed the worker** ("faas process error closed"). A chunked
  `openSync/readSync` scan of the same file works, but takes about a minute on
  this ARM CPU.

## 12. Result: 1440p120 + VRR 48-120 working on HDMI 1 (2026-11-14)

Applied variant **A** (1440p120 replacing the 1080p60 base DTD; range 24-120 Hz;
VRR block left exactly as the vendor shipped it) to
`Hisense_EDID1_4k2k_Enhance.bin`, rebooted, and verified twice:

- **device-side byte read**: DTD2 `6fc200a0…` (2560x1440 @ 119.997 Hz), range
  `18 78 0f c8 3c` (24-120 Hz, 15-200 kHz, 600 MHz);
- **source-side read** with the Mac on HDMI 1 (`read-edid-macos`): same DTD2,
  same range, 4K60 still the preferred timing.

Owner-observed on the PS5 with that port: **1440p offered**, and **VRR
48-120 Hz**. That is the goal met without touching the VRR block, the audio
descriptor or the per-port CEC address — the whole change is 18 bytes of DTD +
2 bytes of range descriptor + checksums.

Two traps on the way there, both silent, both now documented:

1. **opkg refuses a downgrade.** `--force-reinstall` on a lower `Version:` than
   the installed one does nothing and the wrapper still returns success. The
   apply package had to be rebuilt above the installed version.
2. **An HDMI source hides the browser.** While a source (Mac/PS5) was plugged
   into HDMI 1, pages loaded and executed but the panel showed the source, so
   "the page never appeared" was a display-input issue, not a load failure.
   Pages also render nothing if headless by design — `readapply.html` and
   `recon_state.html` now print their JSON on screen.

Rollback: `/APPS/.re_root/edid_backup/` holds the vendor files; the
`edid-restore.ipk` path restores the Hisense file and both `Mstar_*` files.
