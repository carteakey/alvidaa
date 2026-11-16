# 02 — File transfer: SFTP lane over the existing root SSH

> The SFTP lane ships a static OpenSSH `sftp-server` (built from portable
> sources) with the patched dropbear in the `re.installer` IPK:
> whole-filesystem access as root over the existing ssh channel — no new
> ports, no new daemons, LAN-only. Same pattern as the HE40 and 43A6K
> models. Verified live including after a cold power cycle. Companion to
> the model [README](../README.md) and [01-os-exploration](01-os-exploration.md).

## 1. What and why

- ssh is already the root lane (findings 01): key-only, uid 0, no pty.
  SFTP is a subsystem of that same channel — file transfer with zero new
  network surface.
- Dropbear has no sftp-server of its own; its `sftp` subsystem execs the
  compile-time `SFTPSERVER_PATH`. The dropbear build byte-patches that
  constant to `/APPS/.re_sshd/sftp-srvr` — a small wrapper that execs the
  static OpenSSH 9.9p1 `sftp-server` with `-d /`.
- **Why the wrapper:** `sftp-server` with no `-d` chroots to the passwd
  home, and on this TV root's home is `/basic` (`/etc/passwd`) — not the
  filesystem root. `-d /` pins the SFTP root to `/` for whole-fs access
  (`/APPS`, `/var/local` rw; erofs parts ro — expected). The wrapper also
  appends one line per session to `/APPS/.re_sshd/sftp-srvr.log`.
- `sftp-server` is built static from the OpenSSH portable sources
  (`--without-openssl --without-zlib --without-pam` — the SSH crypto stays
  in dropbear; sftp-server only speaks the SFTP protocol over stdio), so it
  has no runtime glibc dependency. The build verifies the source SHA-256
  and the result's static/ARM nature.

## 2. Components

| Path | What |
| --- | --- |
| `tools/ur9s/scripts/build_sftp_server.sh` | builds the static ARM `sftp-server` → `tools/ur9s/bin/` |
| `tools/ur9s/sources/` | offline OpenSSH source tarball (not committed; see its README) |
| `tools/ur9s/sftp-srvr.sh` | the wrapper: execs `sftp-server -d /`, one log line per session |
| `tools/ur9s/scripts/build_dropbear_a7k.sh` | dropbear build with 3 byte patches: uid-0 shell override, `/etc/shells` path, `SFTPSERVER_PATH` |
| `tools/ur9s/scripts/make_installer.py` | the IPK: bundles `dropbear-root`, `dropbearkey`, `sftp-server`, the wrapper |

## 3. Build

```sh
tools/ur9s/scripts/build_dropbear_a7k.sh   # -> tools/ur9s/bin/{dropbear-root,dropbearkey}
tools/ur9s/scripts/build_sftp_server.sh    # -> tools/ur9s/bin/sftp-server
```

The dropbear script asserts literal counts after patching (each patched
string: old 0, new 1) and refuses to build otherwise. The sftp script
refuses on a bad source SHA-256 or a non-static/non-ARM result.

## 4. Deploy

```sh
python3 tools/ur9s/scripts/make_installer.py \
    "$(cat server/keys/tv_root_ed25519.pub)" /tmp/installer.ipk

# ship (the TV has no scp applet and no sha256sum):
ssh -p 8008 -i server/keys/tv_root_ed25519 root@<tv> \
    'cat > /APPS/installer.ipk' < /tmp/installer.ipk
ssh -p 8008 -i server/keys/tv_root_ed25519 root@<tv> 'wc -c < /APPS/installer.ipk'

# install, detached (the postinst kills the running dropbear — i.e. your
# own session's server — and restarts it):
ssh -p 8008 -i server/keys/tv_root_ed25519 root@<tv> \
    'busybox setsid sh -c "opkg remove re.installer && opkg install /APPS/installer.ipk > /APPS/.re_sshd/opkg.log 2>&1" < /dev/null'
```

- **Ship via `ssh 'cat >'` + `wc -c` verify.** `scp` fails both ways:
  modern OpenSSH `scp` defaults to the SFTP protocol (chicken and egg),
  and the legacy protocol needs a server-side `scp` applet the TV lacks.
- **Install detached with `busybox setsid`** (no `nohup` applet); a
  foreground opkg dies with the connection the postinst tears down.
- The postinst is idempotent: guarded `mv` of the binaries and wrapper
  into `/APPS/.re_sshd/`, chmod 755, dropbear restart. It runs at every
  boot via the re_sshd service, so the lane self-heals after a power cycle.

## 5. Use

```sh
sftp -P 8008 -i server/keys/tv_root_ed25519 root@192.168.1.20
sftp> put local.bin /path/on/tv
sftp> get /path/on/tv/file ./local
```

Verified: `ls /` shows the filesystem root; put/get round-trips
byte-identical (10 MB in ~2.6 s, ~8 MB/s); `ls -l` reports real
owner/group.

## 6. Operational notes

- **Log**: `/APPS/.re_sshd/sftp-srvr.log` (append, one line per session,
  written by the wrapper).
- **TV busybox gaps**: no `tail`, `sha256sum`, `uptime`, `nohup`, `scp`;
  `busybox setsid` is the detach tool.
- The vendor's USB-key login gate (`/etc/rootlogin.sh`) is **not** in this
  exec chain: dropbear's uid-0 shell override (build patch 1) routes root
  login sessions to `/APPS/.re_sshd/sh` → bash. No USB HDD needed.
- The `sftp-server` binary is bit-reproducible from the pinned source:
  635,680 B, matching the HE40 record.

## 7. Teardown

Rebuild and reinstall the pre-SFTP IPK (this repo's `make_installer.py`
without the sftp entries, dropbear built without patch 3), or
`opkg remove re.installer` and restore the stock binaries. ssh is
unaffected either way; only the `sftp` subsystem fails.

