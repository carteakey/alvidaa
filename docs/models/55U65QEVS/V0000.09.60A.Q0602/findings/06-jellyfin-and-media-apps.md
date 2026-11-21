# 06 — Jellyfin (and other media apps) on this unit

Two questions: does Jellyfin's **web client** work here, and is a **native** client
worth building? Short answers: the web client works very well; a native client is
not viable.

## The web client already knows this platform

`jellyfin-web` detects VIDAA by user agent and has platform-specific behaviour for
it — MKV is remuxed rather than played directly, HDR is assumed, and Backspace is
treated as Back. No fork or patch is required; serving the stock web UI to this
browser is the supported path.

Naming, for anyone publishing: the Jellyfin maintainers declined an official VIDAA
app (`jellyfin-web#8006`), and third parties may not use the Jellyfin name, logo or
package id for their own wrapper. Personal use is unaffected; a published shell
needs its own name.

## Native client: no

Assessed against the facts in [05](05-media-stack.md):

| Candidate | Why it fails or limps here |
|---|---|
| Jellyfin Desktop (Qt + mpv) | no X11/Wayland/DRM; Qt's `linuxfb`/`directfb` backends are limited and mpv has no working video output for the vendor decoder → software decode only |
| Kodi + Jellyfin add-on | Kodi is GLES-through-KMS/GBM today; the vendor GLES path is DirectFB; upstream dropped vendor decoder ports |
| Flutter / mpv-based shells | need KMS/DRM (`flutter-pi`, `--vo=gpu`) |
| jellyfin-androidtv / Findroid | Android runtime absent |
| Purpose-built native | would have to target vendor GLES + the vendor media pipeline, both undocumented |

Software-decoding 4K HEVC Main10 on four A73s is not achievable, so the browser's
path to the vendor decoder is the only 4K route on this hardware.

## What was actually installed

A TV-shaped Jellyfin client — **Moonfin** (MPL-2.0) — was packaged as an IPK with
`Architecture: mtk9618` and installed alongside the system apps; a matching
`jellyfind` entry now appears in
`/APPS/pkgs/tv.vidaa.jsservice.basic/CHA/services/`. That is the packaged-app route
working end to end: the vendor OPKG accepted a third-party app and the launcher
shows it.

## Playback matrix (owner's library, via Jellyfin, on this unit)

| Content | Result |
|---|---|
| 4K Dolby Vision (profiles 5 and 7), 4 films incl. *Spider-Man*, *Obsession* | **direct play**, DV passthrough |
| Dolby Digital Plus 5.1 / Dolby Digital 5.1 | **direct play** |
| TrueHD 7.1 (*John Wick*) | **direct play**, sound works |
| DTS (*The Wire*) | **direct play** |
| 1080p H.264 | direct play |
| Bitmap (PGS) subtitles | **forces a full HEVC→H.264 software transcode** and loses HDR |

So: keep the default audio track, prefer text subtitles (server-side extraction or
external `.srt`), and 4K HDR direct play is reliable.

## Two findings worth keeping

**A dark-scene "line" is a TV picture setting, not the app.** With the panel in
*Custom* or *IQ*, dynamic contrast/local dimming lifts blacks; *Dolby Vision Dark*
is the accurate mode and the artefact disappears. Nothing to fix in software.

**Non-default choices re-encode.** Selecting a non-default audio track, or a
subtitle that must be burned in, makes the server transcode the whole video and
lose HDR. Plain playback never triggers it.

## Remote keys

Directional pad, OK and Back work; **Back arrives as `Backspace`**. Media transport
keys (play/pause, ff/rw, stop) had not been observed reaching the app at the time
of writing — worth mapping explicitly if a client needs them.
