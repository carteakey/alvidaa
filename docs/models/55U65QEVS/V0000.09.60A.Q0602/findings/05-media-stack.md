# 05 — Hardware and media stack, as measured

Filled in after a second pass on the unit (2026-11-21). Everything here was read
from the running TV; nothing is inferred from another model.

## CPU is Cortex-A73, not A72

```
$ grep -E '^(processor|CPU part)' /proc/cpuinfo
processor : 0
CPU part  : 0xd09        # A73 (A72 would be 0xd08)
… ×4
```

Four cores, aarch64 kernel, `Features: fp asimd evtstrm aes pmull sha1 sha2 crc32
cpuid`. Earlier notes (copied from another model) said A72; that was wrong. It
does not change the software-decode arithmetic — 4× A73 still cannot decode
HEVC Main10 2160p in software.

## Display: the framebuffer is 1080p, the app surface reports 720p

```
$ cat /sys/class/graphics/fb0/virtual_size   → 1920,2160     (double-buffered 1080p)
$ cat /sys/class/graphics/fb0/modes          → U:1920x1080p-51
                                               U:1280x720p-107
$ Hisense_GetPictureInfo()                   → panel_resolution "3840*2160"
                                               app_resolution   "720p"
```

So there are three different numbers in play and they are all true at their own
layer: a 2160p panel, a 1080p framebuffer, and an app compositing surface the
vendor API describes as 720p. Design and screenshot tooling must use the
**1920×1080** UI layer.

## Graphics are OpenGL ES through DirectFB — no DRM/KMS

- There is **no `/dev/dri`**: no KMS/GBM path, so nothing that expects a DRM
  master (Kodi's GBM backend, mpv's `--vo=gpu`, flutter-pi, any Wayland compositor)
  can start.
- **GLES is available, but through DirectFB.** The vendor middleware exposes it;
  stock upstream toolkits do not have a backend for this arrangement.
- The system UI is drawn by a Cobalt/Chromium-class engine on `file:///hisenseUI/`,
  via `/opt/hisenseUI/bin/SystemUI`, with DirectFB underneath.

Practical consequence: a *native* app could technically draw, but only by
targeting the vendor's GLES/DirectFB stack directly. No mainstream toolkit does,
and nothing documents it.

## Video decode lives inside one vendor process

- `mediamain` (`/usr/local/bin/mediamain -D`) owns the media pipeline; its GStreamer
  is the vendor's build with the SoC decoders.
- The browser does not decode HEVC itself — it hands streams to that pipeline over
  a private channel.
- `/dev/video1` exists (a standard Linux decoder node) and **nothing in userspace
  opens it**; its capabilities are unknown and untested.

This is why every "use `libmpv`/VLC/GStreamer yourself" plan stalls: the working
decoder is reachable through the vendor app surface, not through public interfaces.

## Runtimes present

| | |
|---|---|
| Node.js | **v20.19.4**, `process.arch=arm` — but the binary is **`/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix`** (31.7 MB), not `node` |
| BusyBox | 1.34.1, **no `httpd` applet**, no `nc` |
| bash | 3.2.57 (no assoc arrays, no globstar) |
| `opkg` | 0.7.0, needs `LD_LIBRARY_PATH` (libarchive lives under `/usr/local/lib` → `/mnt/tvroot/usrlocal/lib`) |

Two traps that make these look absent:

```sh
# looks like "no Node on this device":
phoenix -e 'console.log(1)'
#   → error while loading shared libraries: libapp-manager-client.so

# works:
LD_LIBRARY_PATH=/lib:/usr/local/lib:/basic/lib:/3rd/lib:/vendor/lib:/vendor/lib/utopia \
  phoenix -e 'console.log(process.version, process.arch, process.getuid())'
#   → node v20.19.4 arm 0
```

And it can serve HTTP, so a loopback static server needs no new binary:

```sh
phoenix -e 'require("http").createServer((q,r)=>r.end("ok")).listen(8899,"127.0.0.1",…)'
#   → listening
```
