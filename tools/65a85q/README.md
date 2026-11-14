# alvidaa kit — Hisense 65A85QEVS / MTK9618 / V0000.09.60A.Q0602

Root + boot persistence without any cross-compiled binary. Everything here is
POSIX sh plus the vendor's own Node runtime.

| File | On-TV path | What |
| --- | --- | --- |
| `alive.sh` | `/var/local/alvidaa/alive.sh` | `alive <pid> <marker>` — pid is alive *and* its cmdline matches |
| `rshell.js` | `/var/local/alvidaa/rshell.js` | Node TCP server on `:8008`; spawns `/bin/sh` per connection as uid 0 |
| `rshell.sh` | `/var/local/alvidaa/rshell.sh` | single-instance loop that restarts the Node server |
| `phonehome.sh` | `/var/local/alvidaa/phonehome.sh` | optional outbound shell to `<lan-host>:4444` (bash `/dev/tcp`); the host is set at deploy time |
| `svc.sh` | `/var/local/alvidaa/svc.sh` | single supervisor: keeps `rshell.sh` + `phonehome.sh` up, re-plants the PFM gate |
| `boot.sh` | `/var/local/alvidaa/boot.sh` | called by the PFM lane at boot; `start` re-opens the firewall, freezes OTA and runs `svc.sh`, `replant` restores the gate, `fw` re-adds the `8008`/`2222` ACCEPTs, `ota` re-adds the `131.189.69.51` REJECT |
| `native_install.py` | host-side (`tools/65a85q`) | lane-3 installer over tvsh: `bootstrap` / `dry` / `install` / `rollback` / `status` — the `native-install.cjs` flow without SSH |

`boot.sh replant` is the only place the PFM payload exists, so the boot hook
and the on-demand repair cannot drift apart. `boot.sh fw` is the same for the
firewall: `iptables` is RAM-only, so the postinst's `ACCEPT` rules are gone
after every reboot and the supervisor re-adds them every 30 s.

## Deploy

```sh
# from the TV, as root (the postinst already did this once)
mkdir -p /var/local/alvidaa
cp alive.sh rshell.js rshell.sh phonehome.sh svc.sh boot.sh /var/local/alvidaa/
chmod 644 /var/local/alvidaa/alive.sh /var/local/alvidaa/rshell.js
chmod 755 /var/local/alvidaa/*.sh
/bin/sh /var/local/alvidaa/boot.sh replant
/usr/local/bin/busybox setsid /bin/sh /var/local/alvidaa/svc.sh \
  >/dev/null 2>&1 </dev/null &
# or simply: /bin/sh /var/local/alvidaa/boot.sh   (fw + svc + gate check)
```

Verify from the LAN host:

```sh
python tools/tvsh.py "id; cat /proc/uptime"
```

## Why Node and not Dropbear

`process.arch` is `arm` on an `aarch64` kernel: userland is 32-bit ARM, so the
`tools/ur9s` static ARMv7 Dropbear would run — but building it needs a
toolchain (zig or GNU binutils) that this host does not have, and the TV ships
no `dropbear`, `sshd`, `nc`, `socat`, `wget` or `curl`. Node is the one
privileged runtime already present, it speaks TCP, and it can spawn a shell.

## Teardown

```sh
/usr/local/bin/busybox pkill -f /var/local/alvidaa/   # or kill the PIDs
rm -rf /var/local/alvidaa /var/local/pfmParse
rm -f /var/local/DebugPowerup
iptables -D INPUT -p tcp --dport 8008 -j ACCEPT 2>/dev/null
iptables -D INPUT -p tcp --dport 2222 -j ACCEPT 2>/dev/null
iptables -D FIREWALL_IN_EULAON -p tcp --dport 8008 -j ACCEPT 2>/dev/null
iptables -D FIREWALL_IN_EULAON -p tcp --dport 2222 -j ACCEPT 2>/dev/null
```
