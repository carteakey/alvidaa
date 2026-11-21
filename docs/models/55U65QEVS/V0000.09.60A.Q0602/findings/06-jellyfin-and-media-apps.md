# 06 — Jellyfin (and other media apps) on this unit

Jellyfin web client: supported. Native client: not viable on this hardware.

## Web client

`jellyfin-web` detects VIDAA by user agent and applies platform behaviour: MKV is
remuxed rather than played directly, HDR is assumed, Backspace is treated as Back.
No fork or patch is required.

A published wrapper needs its own name: the maintainers declined an official VIDAA
app (`jellyfin-web#8006`), and the Jellyfin name, logo and package id are not
available to third parties.

## Native client: no

Assessed against [05](05-media-stack.md):

| Candidate | Why it fails or limps here |
|---|---|
| Jellyfin Desktop (Qt + mpv) | no X11/Wayland/KMS; Qt `linuxfb`/`directfb` backends are limited; mpv has no video output for the vendor decoder → software decode |
| Kodi + Jellyfin add-on | Kodi targets GLES via KMS/GBM; vendor GLES here is via DirectFB; vendor decoder ports were removed upstream |
| Flutter / mpv-based shells | need KMS/DRM (`flutter-pi`, `--vo=gpu`) |
| jellyfin-androidtv / Findroid | Android runtime absent |
| Purpose-built native | must target vendor GLES and the vendor media pipeline; both undocumented |

Software decode of 4K HEVC Main10 is not achievable on four A73s; the browser's path
to the vendor decoder is the only 4K route.

## Installed app

**Moonfin** (MPL-2.0) packaged as an IPK with `Architecture: mtk9618`, installed by
the vendor opkg, with a `jellyfind` entry in
`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/`. Artifact:
`/APPS/jellyfin-moonfin.ipk` (11.4 MB). Third-party apps are accepted by this
package manager and appear in the launcher.

## Playback matrix (measured library)

| Content | Result |
|---|---|
| 4K Dolby Vision, profile 5 and profile 7 titles | **direct play**, DV passthrough |
| Dolby Digital Plus 5.1 / Dolby Digital 5.1 | **direct play** |
| TrueHD 7.1 (Blu-ray remux) | **direct play**, audio decoded |
| DTS 5.1 (TV-rip series episode) | **direct play** |
| 1080p H.264 | direct play |
| Bitmap (PGS) subtitles | **forces a full HEVC→H.264 software transcode** and loses HDR |

Keep the default audio track; prefer text subtitles (server extraction or external
`.srt`). Under those conditions 4K HDR direct play is reliable.

## Two non-app results

**A dark-scene line is a TV picture setting.** In *Custom* or *IQ* mode, dynamic
contrast / local dimming lifts blacks; *Dolby Vision Dark* is the accurate mode and
the artefact disappears. No software change is involved.

**Non-default tracks re-encode.** Selecting a non-default audio track, or a subtitle
that must be burned in, causes a full video transcode and HDR loss; default playback
does not.

## Remote keys

Directional pad, OK and Back reach the page; **Back arrives as `Backspace`**. Media
transport keys (play/pause, ff/rw, stop) were not observed reaching page
JavaScript; map them explicitly if a client needs them.
