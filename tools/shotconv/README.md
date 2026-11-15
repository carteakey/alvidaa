# shotconv — HDR → SDR for TV screenshots, on the TV

`/usr/local/bin/screenshot` hands back HDR sources on the raw PQ curve (see
[docs/research/11-screen-capture.md](../../docs/research/11-screen-capture.md)),
so they look flat. `shotconv` converts them the same way as the ffmpeg chain in
that document, small enough to run on the TV itself, and writes a JPEG
(~250–300 KB instead of a 1.4–8 MB PNG).

```
shotconv <in.png> <out.jpg|out.png> [auto|hdr|raw] [jpeg-quality]
```

- `auto` (default): convert only if the frame looks like HDR — SDR frames reach
  full white somewhere, HDR captures do not (brightest 0.1% < 215). A very dark
  SDR scene would be misread; use `raw` then.
- `hdr` always converts, `raw` never does. The decision is printed to stderr.

Matches ffmpeg within 2 levels (two details that matter: zimg's `bt709` output
from display-linear light is the BT.1886 1/2.4 power, not the camera OETF; and
ffmpeg's `tonemap` assumes peak 12 without HDR metadata). ~0.66 s per frame on a
MTK9618.

## Build and install

```sh
./build.sh                       # -> shotconv-armhf (static, ~390 KB)
ssh … root@<tv-ip> 'cat > /APPS/.re_sshd/shotconv && chmod 700 /APPS/.re_sshd/shotconv' < shotconv-armhf
```

Put it somewhere on rw `/APPS` (on the 55U61KEVS, ELF binaries cannot run from
`/var/local`). **Teardown:** `rm /APPS/.re_sshd/shotconv`. Build artefacts and
the fetched stb headers stay out of git.

Image I/O: [stb_image / stb_image_write](https://github.com/nothings/stb)
(public domain), fetched by `build.sh` at a pinned commit with sha256 checks.
