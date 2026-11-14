# Hisense 43A6K / internal 43A53FEVS_0011

Owner report by [@Hlushok](https://github.com/Hlushok), verified on the physical unit on 2026-11-11/12. This report records the working state and its limits; it is not a claim that every 43A6K or every VIDAA 9 build supports the same chain.

## Identity

| Field | Observed value |
| --- | --- |
| Owner-reported model / SSDP friendly name | 43A6K / `Hisense_43A6K` |
| `Hisense_GetModelName()` and DevKit model | `43A53FEVS_0011` |
| `Hisense_GetOSVersion()` | `U09.09` |
| `Hisense_GetFirmWareVersion()` | `V0000.09.09C.P0930` |
| DevKit platform / region | `MTK9602_EU_A` / `EU_A` |
| SSDP `region` / `transport_protocol` | `0` / `3290` (read again 2026-11-12) |
| Running kernel / architecture | Linux `4.19.79+`, `armv7l` |
| Browser | `Hisense_GetCurrentBrowser()`: `odin`; UA reports Chromium `111.0.0.0`, Linux `armv7l` |

The marketed/owner-reported model and internal model are retained separately. The full Chromium patch version was not independently obtained; the UA's `111.0.0.0` is not presented as the precise binary version. The chipset label above comes from DevKit, not an independently recorded `Hisense_GetChipSetName()` result. Exact firmware build date is unconfirmed.

## Root and file access

The native browser file bridge was usable for text reads and writes with mode base 6, including `../var/local/otaTest.sh`. The stock `/etc/rc.d/rc.local` on this unit actually invokes that hook as root. A staged hook started an owner-controlled static ARM Dropbear and then left a small persistent hook pointing to the owner's SSH startup script. No firmware partition was flashed and vendor `/etc/passwd` and `/etc/shadow` were not changed.

Confirmed results:

- SSH on TCP 2222, with both owner password authentication and an owner-generated public key.
- Authenticated non-PTY commands return `uid=0(root) gid=0(root) groups=0(root)`; `id -u` returns `0`.
- An interactive shell works with `ssh -T -p 2222 root@TV /bin/sh -i`.
- Dropbear `2026.94`, statically built for ARM EABI5/musl.
- SFTP works using a separate static OpenSSH `10.6p2` `sftp-server`. Directory listing, reading, a 1 MiB upload/download with matching SHA-256, rename and cleanup were checked. Password SFTP and the owner's graphical file client were also confirmed.
- Persistence was checked across a real kernel restart and subsequent Power-on: the boot ID changed, SSH returned at about 30 seconds uptime, and no browser console was opened to re-arm it. On this unit the forced reboot powered the set off; the owner pressed Power. This is not a claim of unattended reboot-and-return or a separately demonstrated persistence test across removing the mains plug.

The listener is restricted to the owner's LAN. Passwords, private keys, device codes, MACs, IPs, host-key fingerprints and personal settings are intentionally omitted from this public report.

## PTY limitation — not a full terminal success

Ordinary PTY-based SSH is **not working yet** on this firmware. The initial error was `openpty: No such device or address`.

Observed kernel configuration:

```text
CONFIG_TTY=y
# CONFIG_UNIX98_PTYS is not set
CONFIG_LEGACY_PTYS=y
CONFIG_LEGACY_PTY_COUNT=256
```

`devpts` is absent from `/proc/filesystems`; a devpts mount attempt returned ENODEV. A Dropbear build using the legacy BSD PTY path and private major-2/major-3 nodes can allocate a pair, but data still does not reach reads. A standalone probe reproduced accepted writes followed by poll timeouts/read EAGAIN in both directions, independent of SSH. Both ends report the `n_tty` line discipline. An isolated workqueue trace confirms that `flush_to_ldisc` is queued and executed. The remaining cause is unconfirmed; neither a patched kernel nor a working full PTY is claimed.

## Launcher scope

An adapted Alvidaa-based web launcher was exercised on this unit: app launch, the regular and quick TV settings paths, and the Home-watcher redirect worked. This is the browser/web launcher lane, **not** a verified native lane-3 replacement. The owner later preferred the stock Home because relaunching the web UI introduced a visible delay.

PIN pairing/control were used successfully. This report does not establish the euladpp untar, developer-code forging, IPK/superwatch, or native Home replacement paths on this build.

## Additional owner findings

- **`ssh_commands` working** — authenticated command execution and a non-PTY interactive shell run as uid 0. This is separate from the broken PTY path.
- **`sftp` working** — listing, read, write, rename and cleanup were checked with a 1 MiB SHA-256 roundtrip, plus owner confirmation in a graphical client. No full-terminal claim is implied.
- **`boot_persistence` working within the tested scope** — a changed boot ID and SSH availability after restart / owner Power-on were recorded without opening the browser again. Separate mains-removal persistence and unattended reboot-and-return are unconfirmed.
- **`pty` blocked in the current setup** — UNIX98 PTYs are disabled in this kernel. Private legacy PTY nodes allocate, but a standalone probe still reads EAGAIN in both directions. An isolated workqueue trace observed `flush_to_ldisc` executing, ruling out the narrower hypothesis that its worker never runs. The cause and fix remain unknown.
- **`stock_home_posters` unresolved** — changing custom shortcut metadata and serving a candidate content feed did not produce an owner-confirmed poster shelf; the stock VIDAA placeholder remained. The successful web launcher does not establish stock-Home content-service integration.
- **`home_source_readout` working** — root permitted reading the installed operation-ui and system-ui JavaScript/HTML files (773 files) for offline inspection. This is not a claim that these vendor files were modified or that a native replacement was installed.
- **`backup` copied and integrity-checked, restore untested** — a full 3,959,422,976-byte mmcblk0 image, two 2 MiB boot areas and a separate writable-file archive were saved privately. Stream hashes, local hashes, partition boundaries and both kernel-image CRCs were checked. The filesystems were mounted during capture, so this is not an atomic snapshot or a proven recovery procedure; RPMB, OTP and eFuses are excluded.
- **`media_codecs` unconfirmed** — local multimedia libraries and device nodes were observed, but no extra codec or player was installed. Their presence does not establish that unsupported torrent audio can be decoded locally.
- **`torrserver` untested on this TV** — no TorrServer installation or runtime compatibility result is claimed.

Only this unit and the recorded firmware are covered. The public report contains observations, not the owner's private backup or proprietary Home source files.
