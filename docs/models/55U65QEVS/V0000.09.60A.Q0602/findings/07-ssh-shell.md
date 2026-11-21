# 07 — A key-only SSH shell on this build (dropbear), and the traps on the way

The unit has no `sshd`, `dropbear`, `nc` or `socat`, and every writable filesystem
is `nosuid`, so a setuid helper is impossible. Two working arrangements exist:
a Node TCP shell (what the `65A85QEVS` guide uses) and a **static armv7 dropbear**
started by the IPK postinst. This note records the second, because SSH is the more
comfortable channel and it survives a reboot.

## The binary

Static **ARMv7** (userland is 32-bit even though the kernel is aarch64), built
against **musl** rather than glibc:

- glibc-static still `dlopen`s NSS for `getpwuid()`; a binary built against a
  newer glibc than the target's 2.31 can fail user lookup at login.
- musl has passwd/group lookup compiled in, so a musl-static dropbear is genuinely
  self-contained. Built with `--disable-zlib --disable-pam --disable-shadow
  --disable-logintfunc -DDROPBEAR_SVR_PASSWORD_AUTH=0`, ~380 KB.

## Four traps, all of which cost a boot cycle

| Trap | Symptom | Fix |
|---|---|---|
| **`/etc/shells` does not exist** | `User 'root' has invalid shell, rejected` in dropbear's log, `Permission denied (publickey)` to the client | binary-patch the literal `/etc/shells` → `/APPS/shell` (a writable file listing allowed shells) |
| **`-g` is not a valid option** when password auth is compiled out | `Invalid option -g`, dropbear exits immediately | don't pass it; key-only is already the only method |
| **`$HOME` is `/`** (root's home is the read-only rootfs) | dropbear looks for `/.ssh/authorized_keys`, finds nothing | bind-mount a writable copy of `/etc/passwd` over `/etc/passwd` with root's home pointing at `/APPS/home/root` |
| **`sed -i` breaks the bind mount** | the mounted `/etc/passwd` shows the *old* contents after editing | `sed … > /tmp/x; cat /tmp/x > /etc/passwd` — write in place, same inode |

The last one is the subtle one: `busybox sed -i` writes a new file and renames it,
so a bind mount made before the edit keeps pointing at the orphaned inode.

## Shape of the working setup

```
/APPS/.re_ssh/dropbear            static armv7, /etc/shells → /APPS/shell
/APPS/.re_ssh/dropbearkey
/APPS/.re_ssh/hostkey_ed25519     generated once, persists
/APPS/shell                       /APPS/bin/tvsh, /bin/bash, /bin/sh
/APPS/bin/tvsh                    login wrapper: PATH + LD_LIBRARY_PATH, then bash
/var/local/etc/passwd             overlay; root home /APPS/home/root, shell tvsh
/APPS/home/root/.ssh/authorized_keys
```

`tvsh` exists because the rootfs is read-only and `/etc/profile` does interactive
work that breaks non-interactive commands; it sets `PATH` (so `busybox` resolves)
and `LD_LIBRARY_PATH` (so `opkg` resolves `libarchive`).

## Re-applied at every boot

The same postinst that installs the payload does the overlay, the key, the
`iptables` accepts for 2222/8008 and starts dropbear; a `BaseService`
([02](02-base-service-persistence.md)) re-runs that postinst at every boot when
nothing is listening. Verified across a power cycle: SSH accepts a key ~20 s after
boot, no page, no PC.

## Teardown

```sh
kill $(pidof dropbear)
umount /etc/passwd
rm -rf /APPS/.re_ssh /APPS/bin/tvsh /APPS/shell /APPS/home/root
```
