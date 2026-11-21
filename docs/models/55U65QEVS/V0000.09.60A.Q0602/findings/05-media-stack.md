# 05 — Hardware and media stack, as measured

Values read from the running unit.

## CPU: Cortex-A73

```
$ grep -E '^(processor|CPU part)' /proc/cpuinfo
processor : 0
CPU part  : 0xd09        # A73 (A72 would be 0xd08)
… ×4
```

Four cores, aarch64 kernel, `Features: fp asimd evtstrm aes pmull sha1 sha2 crc32
cpuid`. `0xd09` is A73; `0xd08` is A72. Software decode of HEVC Main10 2160p is not
achievable on four A73s.

## Display layers

```
$ cat /sys/class/graphics/fb0/virtual_size   → 1920,2160     (double-buffered 1080p)
$ cat /sys/class/graphics/fb0/modes          → U:1920x1080p-51
                                               U:1280x720p-107
$ Hisense_GetPictureInfo()                   → panel_resolution "3840*2160"
                                               app_resolution   "720p"
```

Three values, three layers: 2160p panel, 1080p framebuffer, and an app surface the
vendor API reports as 720p. UI work and screenshots use the **1920×1080** layer.

## Graphics are OpenGL ES through DirectFB — no DRM/KMS

- There is **no `/dev/dri`**: no KMS/GBM path, so nothing that expects a DRM
  master (Kodi's GBM backend, mpv's `--vo=gpu`, flutter-pi, any Wayland compositor)
  can start.
- GLES is available through DirectFB; no upstream toolkit has a backend for that
  arrangement.
- The system UI is drawn by a Cobalt/Chromium-class engine on `file:///hisenseUI/`,
  via `/opt/hisenseUI/bin/SystemUI`, with DirectFB underneath.

A native app can draw only by targeting the vendor GLES/DirectFB stack directly;
no mainstream toolkit does, and the interface is undocumented.

## Video decode lives inside one vendor process

- `mediamain` (`/usr/local/bin/mediamain -D`) owns the media pipeline; its GStreamer
  is the vendor's build with the SoC decoders.
- The browser does not decode HEVC itself — it hands streams to that pipeline over
  a private channel.
- `/dev/video1` exists (a standard Linux decoder node) and **nothing in userspace
  opens it**; its capabilities are unknown and untested.

The working decoder is reachable through the vendor app surface, not through public
interfaces; any client that brings its own pipeline gets software decode.

## Runtimes present

| | |
|---|---|
| Node.js | **v20.19.4**, `process.arch=arm` — but the binary is **`/APPS/pkgs/tv.vidaa.app.phoenix/CHA/bin/phoenix`** (31.7 MB), not `node` |
| BusyBox | 1.34.1, **no `httpd` applet**, no `nc` |
| bash | 3.2.57 (no assoc arrays, no globstar) |
| `opkg` | 0.7.0, needs `LD_LIBRARY_PATH` (libarchive lives under `/usr/local/lib` → `/mnt/tvroot/usrlocal/lib`) |

Both runtimes require the vendor library path; without it they appear absent:

```sh
# looks like "no Node on this device":
phoenix -e 'console.log(1)'
#   → error while loading shared libraries: libapp-manager-client.so

# works:
LD_LIBRARY_PATH=/lib:/usr/local/lib:/basic/lib:/3rd/lib:/vendor/lib:/vendor/lib/utopia \
  phoenix -e 'console.log(process.version, process.arch, process.getuid())'
#   → node v20.19.4 arm 0
```

HTTP works, so a loopback static server needs no additional binary:

```sh
phoenix -e 'require("http").createServer((q,r)=>r.end("ok")).listen(8899,"127.0.0.1",…)'
#   → listening
```
