# 85U7SE — V0000.09.62M.Q0921

- **Model:** 85U7SE
- **Firmware:** V0000.09.62M.Q0921
- **SoC:** MTK9655 (MT5896 die, mt5877 family)
- **Region:** AU (owner-confirmed; AU presets in applist)
- **VIDAA OS:** U09.62
- **Browser:** Chromium 111 "odin" WebViewer/3.0.0 (aarch64 UA, arm32 userland)
- **Reported by:** owner-direct

## Root chain — verified on-device (2026-11-20)

The 100U7Q/75UR9S chain works on the 09.62M build with three measured deltas:

1. **hiutils path arguments must be arrays** (`{path:["../proc/uptime"],mode:6}`); bare
   strings with `../` are rejected. Same as 50U7DSE (09.62N).
2. **aarch64 static dropbear works** alongside the armv7 recipe — the kernel is aarch64
   (COMPAT for the arm32 userland), so either architecture links and runs. Build trap:
   dropbear's configure hardening injects `-Wl,-pie`, which silently defeats
   `LDFLAGS="-static"` from configure; relink with
   `rm dropbear dropbearkey && make dropbear dropbearkey LDFLAGS="-static -no-pie"`.
3. **`/var` is tmpfs on this unit** — the `/var/local/otaTest.sh` root hook does not
   persist a reboot here. Use the `re_sshd` service lane for persistence instead.

Chain:

```
TV browser page (launchapp urlType 1)
  └─ phoenix wss://localhost:9888 → basic/fetcher (fetchFile, uid 314, group 616)
       ├─ sw2.js        -> /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/sw2.js
       └─ installer.ipk -> /APPS/installer.ipk
  └─ POST /function/basic/fetch/sw2 (length-prefixed commands to /var/run/superwatch_socket)
       └─ vendor installer daemon: opkg install → postinst uid 0, full caps
            └─ key-only Dropbear 2022.83 (static aarch64) on 0.0.0.0:8008
```

Result: `ssh -p 8008 root@<tv>` → uid 0, `CapEff 000001ffffffffff`. Verified Boot stays
green (erofs `/`, dm-verity, nothing outside `/APPS` + one reversible iptables rule).

**Boot persistence** is installed but NOT yet reboot-verified: a pure-JS `re_sshd`
service (`serviceList.json`, `autoStart`) re-sends the superwatch uninstall+install at
every cold boot. Verification is scheduled as the final step of the engagement.

**Model-name note:** the device reports `Name = 85U7SE` in `ModelInfo.ini`; the owner
reached for the retail line name (UR8S). Recorded here as 85U7SE per the device's own
identity, following the 75U8QTUK ↔ 75U85QEVS precedent.

Details, traps, and the full audit: [findings/01-unit-recon.md](findings/01-unit-recon.md).
