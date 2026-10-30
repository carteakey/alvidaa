# alvidaa findings — SSH: dropbear, the EULA firewall, and the five locks (recon §10.13–10.16)

> Split from the original FINDINGS.md lab notebook. Canonical record; the blog and STORY.md draw from these.

### 10.13 SSH: static dropbear for armv7 (hook v4)

- The firmware ships **no ssh server** (`/usr/local/bin/openssh/` absent, no
  dropbear/telnetd binaries anywhere — the `sshd` uid-999 account in passwd is
  vestigial). Static cross-build, no container needed:
  `zig cc -target arm-linux-musleabihf` (zig 0.13, macOS host) with
  `CC=zig-wrapper LDFLAGS="-static" ./configure --host=arm-linux-musleabihf
  --disable-zlib --disable-{lastlog,utmp,wtmp,utmpx,wtmpx}` and
  `make PROGRAMS="dropbear dropbearkey"`.
- Gotcha: the bundled libtomcrypt/libtommath sub-makes must run with
  `AR=zig-ar RANLIB=zig-ranlib` — the macOS host `ar` produces a broken archive
  (1 member) that lld rejects; zig's ar rebuilds it properly.
- **No bind-mount needed**: dropbear 2025.88 has `-D <dir>` to set the
  authorized_keys directory — pointed at the rw `/var/local/roothome/.ssh/`
  (root's real home `/` is read-only, so the classic `~/.ssh` path is unusable).
- Hook v4 (installed remotely like v3): fetches `tvtools.tar.gz`
  (busybox + dropbear + dropbearkey, ~2 MB) from the Pi over bash `/dev/tcp`,
  untars to `/var/local/tvtools`, writes the owner's public key to
  `/var/local/roothome/.ssh/authorized_keys` (600, embedded in the hook),
  generates the host key on first boot, and starts **telnetd on 2323**
  (bootstrap) and **dropbear on 2222 with `-s`** (keys only — no passwords ever).
- Private key: `server/keys/tv_root_ed25519` (gitignored). Connect:
  `ssh -p 2222 -i server/keys/tv_root_ed25519 root@<tv-ip>`.
- The Pi's raw TCP file server (`/tmp/rawserve.py`, port 4444) must be running
  at boot; it currently serves `~/tvtools/tvtools.tar.gz`.

### 10.14 The last defense: Hisense's EULA firewall

- Hook v4 fired correctly on the next real boot: 3× `Network is unreachable`
  during the early-boot fetch, the retry loop caught the 4th try once wifi came
  up, `UNTAR-OK`, host key generated, **`TELNETD-OK-2323`, `DROPBEAR-OK-2222`** —
  and then the ports were unreachable from the LAN anyway (SSH timed out, not
  refused: SYN dropped).
- Cause: `rc.local`/middleware installs an iptables policy — INPUT jumps to
  `FIREWALL_IN_EULAON`, whose EULA-off sibling shows the intent: accept only
  loopback, mark 0x64 traffic, ICMP, and **tcp/36669 (RemoteNow)**; everything
  else DROP — with an explicit blacklist of debug/daemon ports: **22, 23**,
  1025, 4444, 4445, 9222 (Chromium devtools), 9536, 9666, 10001, 10485, 12321,
  3366/3367, 4635-4637, 4990, 5000/5001, 6000, 6030, 7000, 7236, 8085/8086,
  9080, 9226, 11600/11601/11669/11679, 12345, 13452, 22321, 26642, 38400,
  39500, 44642, and UDP 67, 319, 320, 1900, 5020, 5353.
- Hook v5 counters: `iptables -I INPUT 1 --dport 2222/2323 -j ACCEPT`, re-applied
  on a 15 s loop for the first 3 minutes so later boot stages can't silently
  reload the policy. One more reboot needed — and after SSH works, reboots
  happen over SSH (`/usr/local/bin/reboot`), so this is the final manual one.

### 10.15 Key-path post-mortem and hook v6

- The firewall hole worked immediately (dropbear answered with a real
  `Permission denied (publickey)` — SYN no longer dropped). The rejection was
  self-inflicted: dropbear's `-D <dir>` **replaces the entire `~/.ssh`
  directory**, so the expected file is `<dir>/authorized_keys` — the hook had
  written `<dir>/.ssh/authorized_keys`. Verified against
  `svr-authpubkey.c:authorized_keys_filepath()`; `checkpubkeyperms()` walks
  every parent (`/var`, `/var/local`, `/var/local/roothome`) requiring
  root-owned, not-group/world-writable — all satisfied, since the hook runs as
  root.
- busybox `telnetd` died between boots (raw `nc` interaction with a telnetd
  master is unreliable); hook v6 adds a 10-minute watchdog that relaunches
  dropbear/telnetd if `pidof` finds them gone, skips the fetch when
  `/var/local/tvtools/dropbear` already exists, and writes the key to both
  `/var/local/roothome/authorized_keys` (the one dropbear reads) and the
  legacy `.ssh/` copy.

### 10.16 The real rejection: dropbear's shell check

- With the key path fixed, dropbear still answered `Permission denied
  (publickey)`. Source-level cause, in `svr-auth.c:checkusername()`: dropbear
  requires the login user's shell to appear in `getusershell()` — and root's
  shell on this TV is `/usr/local/scripts/rootlogin.sh`, which `/etc/shells`
  does not list (musl's fallback list is `/bin/sh`, `/bin/csh`). The rejection
  happens **before the key is ever examined**.
- Fix: the shell-validity loop is patched out of our own build (`goto
  goodshell` unconditionally — we are the owners; the check protects nothing
  here), dropbear relinked and the payload refreshed.
- Hook v7: always refetches `tvtools.tar.gz` (so the patched dropbear lands),
  everything else unchanged (watchdog, firewall holes, harvest).
- Meta-lesson recorded for the next target: when a stock daemon binary
  rejects for unobvious reasons, compile your own — but read the rejection
  path in source first; it was the shell, not the key.
