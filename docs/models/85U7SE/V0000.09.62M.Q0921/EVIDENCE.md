# 85U7SE V0000.09.62M.Q0921 — evidence ledger

| Claim | Evidence | Source |
| --- | --- | --- |
| Device identity: `Name = 85U7SE`, `SocModel = MTK9655`, `SwVersion = V01.09.62M.Q0921` | `ModelInfo.ini` contents | `/APPS/ModelInfo.ini` (root SSH) |
| OTA history 09.60B → 09.62M applied 2026-11-19 | `UPG_TIME=2026-11-19-04:58:20,SRC_VER=V0000.09.60B.Q0628,TGT_VER=V0000.09.62M.Q0921` | `/APPS/ota_history.ini` |
| SoC die: `mediatek,mt5896` | device-tree strings | `/proc/device-tree/{model,compatible}` |
| Kernel cmdline: optee, erofs ro, `veritymode=enforcing`, `mt5877 rev E2` | cmdline text read via hiutils fileRead | `/proc/cmdline` |
| 32-bit ARM userland on aarch64 kernel | `/lib/ld-2.31.so` mapped at f7… addresses in the phoenix worker | `/proc/self/maps` via fileRead |
| hiutils fileRead requires array paths; `../` traversal reads arbitrary files as uid 314 | uptime/cmdline/mounts/serviceList.json/opkg status all read back ret:true | probe pages `u7p3`–`u7w9` |
| fetchFile write primitive, no path allowlist | marker written to `/APPS/.recon_marker` + full `fetchfile.js` source (6133 B, plain `fs.createWriteStream`) | probe `u7w1` + readback |
| superwatch socket live and reachable from uid 314 (group 616) | `/proc/net/unix` entry; `90:83:90;re.probe` → reply `90:0` via sw2.js FaaS trigger | probe `u7s1` |
| IPK install → postinst as uid 0, full caps | `installer_log.txt`: `Uid: 0 0 0 0`, `CapEff 000001ffffffffff`, dropbear pid, 1F48 LISTEN | `/APPS/.re_sshd/installer_log.txt` |
| Root SSH key-only on :8008 | interactive SSH: `whoami`=root, `$UID`=0, `CapEff 000001ffffffffff` | PC `ssh -i keys/ur8s_root -p 8008` |
| opkg `Architecture: mtk9655` for this unit's packages | status DB: 10× mtk9655, 5× all, 20 packages total | `/APPS/pkgs/opkgmeta/status` |
| Boot persistence staged (reboot test pending) | `services/re_sshd/{index.js,package.json}` (314:314) + `serviceList.json` entry + pre-edit backup | SSH file listing |
| DNS was pointing at the PC (experiment leftover); reverted to router | `/etc/resolv.conf` → `/var/local/etc/resolv.conf` contents + busybox nslookup via 192.168.0.1 | SSH |
| ALV_BLOCK telemetry/ad-block chain installed by postinst (owner kept) | `iptables -L ALV_BLOCK` — 15 REJECT rules in OUTPUT | SSH |
| Remote power press reaches evdev at press instant; leads `last_poweron_state` commit by the full 6–8 s standby delay | 16-byte input_event decode: OFF press @t0, ON press @t0+8.7 s while `last_poweron_state` stayed stale | findings/01-unit-recon.md §08, `/tmp` capture via `busybox dd bs=16` |
