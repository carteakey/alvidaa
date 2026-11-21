# 07 — A key-only SSH shell on this build (dropbear), and the traps on the way

No `sshd`, `dropbear`, `nc` or `socat` is present, and every writable filesystem is
`nosuid`, so a setuid helper is impossible. Two arrangements work: a Node TCP shell
(as on `65A85QEVS`), or a **static armv7 dropbear** started by the IPK postinst and
re-armed at every boot. This note covers the second.

## The binary

Static **ARMv7** (userland is 32-bit; the kernel is aarch64), built against **musl**:

- glibc-static still `dlopen`s NSS for `getpwuid()`; linking against a newer glibc
  than the target's 2.31 can fail user lookup at login.
- musl compiles passwd/group lookup in, so a musl-static dropbear is self-contained.

Configure: `--disable-zlib --disable-pam --disable-shadow --disable-lastlog
--disable-loginfunc -DDROPBEAR_SVR_PASSWORD_AUTH=0`. Result: 380 KB, armv7 EABI5,
static-pie.

## Requirements and failure modes

| Requirement | Failure if unmet | Implementation |
|---|---|---|
| `/etc/shells` must exist and list the login shell | `User 'root' has invalid shell, rejected`; client sees `Permission denied (publickey)` | binary-patch the literal `/etc/shells` → `/APPS/shell`, a writable file listing allowed shells |
| `-g` is unavailable when password auth is compiled out | `Invalid option -g`; dropbear exits | omit it; key-only is the only compiled method |
| `$HOME` must be writable | root's home is `/` on the read-only rootfs, so `~/.ssh/authorized_keys` cannot exist | bind-mount a writable `passwd` over `/etc/passwd` with root's home at `/APPS/home/root` |
| the overlay must be written in place | `busybox sed -i` writes a new file and renames it, so an existing bind mount keeps the orphaned inode and shows old contents | `sed … > /tmp/x; cat /tmp/x > /var/local/etc/passwd` |

## Layout

```
/APPS/.re_ssh/dropbear            static armv7, /etc/shells → /APPS/shell
/APPS/.re_ssh/dropbearkey
/APPS/.re_ssh/hostkey_ed25519     generated once, persists
/APPS/shell                       /APPS/bin/tvsh, /bin/bash, /bin/sh
/APPS/bin/tvsh                    login wrapper: PATH + LD_LIBRARY_PATH, then bash
/var/local/etc/passwd             overlay; root home /APPS/home/root, shell tvsh
/APPS/home/root/.ssh/authorized_keys
```

`tvsh` is the login shell. The rootfs is read-only and `/etc/profile` performs
interactive work that breaks non-interactive commands, so `tvsh` sets `PATH` (for
`busybox`) and `LD_LIBRARY_PATH` (for `opkg`, which needs `libarchive` from
`/usr/local/lib`) before exec'ing bash.

## Boot re-apply

The postinst performs the overlay, the key, the `iptables` accepts for 2222 and
8008, and starts dropbear. A `BaseService`
([02](02-base-service-persistence.md)) re-runs that postinst at every boot when
nothing listens. Measured: key auth accepted ~20 s after a power cycle, with no
intermediate step.

## Teardown

```sh
kill $(pidof dropbear)
umount /etc/passwd
rm -rf /APPS/.re_ssh /APPS/bin/tvsh /APPS/shell /APPS/home/root
```
