# 11 — Screen capture: how the vendor tool works, what it can capture, HDR

Measured on a **55U61KEVS** (retail 55U7KQ, MTK9618, V0000.09.62C.Q0924) over
the root-SSH lane, 2026-11-14/15. Other MTK models ship the same tool
(`tools/screenshot.sh` was written on the 50A51HUV); the internals below were
read from this unit's binaries and may differ elsewhere.

**Boundary:** this documents taking a picture of what the TV shows, on a TV you
own, with the manufacturer's built-in capture tool. Nothing about the TV's
content protection is changed or bypassed, and protected (DRM) video is not
captured: see below.

## How it works

`/dev/fb0` has no readback path (`read()`/`dd` return `ENODEV`; it is
mmap-only), so `/usr/local/bin/screenshot` is the lane:

```
/usr/local/bin/screenshot <dir> <name> [capture_type]     (returns in ~0.09 s, async)
  └─ sysctrlservice RPC  cmdCaptureScreen(path, name, CaptureType)
       └─ sysmain  (/mnt/tvroot/usrlocal/bin/sysmain): "screencapture" worker, queue + timeout
            └─ ki::port::ScreenCapture  (libkiport)
                 └─ libHui  HUI_ScreenCapture → MediaTek Mif/MTVSS capture from the display pipeline
            └─ libpng  generatePNG → <dir>/<name>, 8-bit RGBA PNG (whatever the extension says)
```

The capture types, from the vendor debug-shell help text in `libkiport`
(`screencapture <capture_type>`), match libHui's `E_MIF_SCREENCAPTURE_*`:

| type | captures |
|---|---|
| 1 | `VIDEO_MAIN` — main video window only |
| 2 | `VIDEO_SUB` — PIP window |
| 3 | `OSD` — UI layer only |
| 4 | `VIDEO_OSD` — video + UI, as on screen (what the default produced) |

`screenshot /tmp x.jpg 1` was accepted (a different frame) and still came out at
1920×1080. Width, height and colour format are parameters of the HAL call, but
`sysmain` fixes them; the CLI has no size option. The panel is 4K, the capture is
always **1920×1080**.

Not the same thing: the `capture` daemon (`/usr/local/bin/capture`, uid 385,
`libcapture-screen`, `HUI_CaptureMore*`) is continuous capture for the screen
magnifier. Its debug dump writes to `/OAD` — never trigger it.

## What can be captured

| source | result |
|---|---|
| Launcher / TV UI | works |
| HDMI, SDR (Chromecast with Kodi; PC desktop) | works, colours 1:1 (a white window reads 242/250/254) |
| TV's own YouTube app (`main:Youtube`) | works (video + YouTube's controls, owner screenshot 2026-11-15). Two earlier attempts during a slow app start, screen mostly black, produced **no file at all**; cause unknown, not reproduced (possibly protected video starting, as below; unverified) |
| Crunchyroll app (`main:206\|2372`) | menus work. During video playback: **no file at all**, not even the UI layer (2 of 2 attempts, 2026-11-17; nothing in `dmesg`) |
| Netflix / other DRM apps, live TV | not tested |

Video is captured however it is decoded, because the frame comes from the
display pipeline, not from an app's framebuffer, **except protected video**:
while DRM-protected playback is on screen, the whole request is refused and no
file is written, most likely by the secure video path. That is the TV's content
protection doing its job; nothing here works around it.

## HDR comes out raw

With an HDR source the PNG holds the signal on an **HDR (PQ) curve, not
tone-mapped**, squeezed into 8 bits: it looks flat and dim. Evidence: white
subtitles burned into an HDR film measure ~150–160/255 (≈200–350 nits on the
PQ curve); in SDR they would be ~235–255.

- The colours are already **BT.709**: tagging the PNG as BT.2020 + PQ and
  converting gives a green cast; tagging it as BT.709 + PQ looks right.
- It is **not the raw HDMI signal**. A Windows desktop in HDR with the "SDR
  content brightness" slider at 49 (≈276 nits → PQ code ≈154) captured at
  ≈194. The capture point sits inside the TV's picture processing (per-input
  picture settings differ), so any conversion is approximate.
- Best match for films (owner's eye against the TV): PQ → linear (npl=100) →
  Mobius tone map → BT.709/BT.1886. In ffmpeg:

  ```
  setparams=color_primaries=bt709:color_trc=smpte2084:colorspace=gbr:range=pc,
  zscale=t=linear:npl=100,format=gbrpf32le,
  tonemap=tonemap=mobius:param=0.5:desat=0,
  zscale=t=bt709:m=bt709:r=pc,format=rgb24
  ```

  Hable was too dark. A PS5 game in HDR looked closer raw, so keep the raw PNG.
- **No readable HDR flag was found.** `/proc/xc/hdr_type` stays empty even during
  HDR playback. `/proc/utopia_mdb/HDMIRX` (MDB debug node; the vendor `getlog`
  scripts `cat` it and read `dmesg`) printed nothing, also after the vendor's own
  `echo hdmiloglevel REGEN` (a log level, resets at reboot). HDR metadata exists
  only inside vendor processes (`ki::port::HdrMetadata`). A frame-based test
  works on every capture tried: SDR frames reach full white somewhere (brightest
  0.1% of pixels ≥ 247), HDR captures do not (≤ 201); threshold 215. A very dark
  SDR scene would be misread.

## Timing

Measured with a millisecond clock page on a PC, synced to the machine sending
the request:

| step | time |
|---|---|
| SSH connect until the TV command runs | ~0.2 s |
| request → frame grabbed, TV idle (incl. PC render + input lag) | **~0.11 s** |
| frame → PNG complete | 1.7 s (mostly black) to 3.6 s (busy picture) — compression only |

The captured moment is fixed ~0.1 s after the request; the slow part is writing
the PNG and does not move it. The PNG appears in one step: polling every 10–20 ms
never saw a partial file (four runs, end marker `IEND` present at first sight),
so `sysmain` encodes first and writes or renames at the end. `phone-shot.sh`
still waits for `IEND` rather than trusting a fixed delay. From an iPhone Shortcut ("Run Script Over SSH",
first action → frame): 316–355 ms.

**Requests are queued, not parallel.** Three `screenshot` calls 0.2 s apart came
back after 2.9 s, 6.4 s and 8.6 s: `sysmain` keeps a queue (`Capture queue is
full` is one of its strings) and processes one request at a time. The three
frames differed a lot in size during video playback, so each frame was most
likely grabbed when its turn came, not when it was requested (inferred, not
measured with the clock page). Consequences:

- the ~0.11 s above only holds when no other capture is running; a request
  that arrives during one waits until it is done;
- the lane tops out at roughly **0.3–0.45 frames per second**, so it can make a
  slideshow of a UI flow, not a recording.

## Tools

- `tools/screenshot.sh [--hdr] [out.png]` — capture and pull; `--hdr` also writes
  a tone-mapped `-sdr.png` (needs ffmpeg with zscale on the host).
- `tools/shotconv/` — the same HDR → SDR conversion as a small static ARM program
  that runs **on the TV** (stb_image, JPEG output), with automatic HDR detection.
- `tools/phone-capture/` — one-tap capture from a phone: a dedicated SSH key
  restricted to a single capture script (`command=` in `authorized_keys`). Recipe,
  Shortcut steps and teardown in its README.

Binaries cannot run from `/var/local` on this unit (`Permission denied`; scripts
there need `/bin/sh <script>`), so `shotconv` goes to `/APPS/.re_sshd/`.
