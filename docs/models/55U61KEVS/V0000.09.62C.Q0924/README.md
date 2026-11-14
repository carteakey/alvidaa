# 55U61KEVS — V0000.09.62C.Q0924

- **Model:** 55U61KEVS (retail **55U7KQ**)
- **Firmware:** V0000.09.62C.Q0924 (VIDAA U09.62)
- **SoC:** MTK9618 (aarch64 kernel, **32-bit ARM userland** — `process.arch "arm"`)
- **Region:** EU_A (DEU)
- **Browser:** Chromium 111 "odin" (aarch64 UA)
- **Reported by:** gh:miramaki

This report documents verified root access, boot persistence, and native launcher 
replacement on the 55U61KEVS (retail 55U7KQ), running VIDAA U09.62. The root chain
uses the same three primitives as the 100U7Q / 75UR9S / 55E75LEVS records.

## Root chain (verified)

`fetcher.fetchFile` → `superwatch` `83`/`82` → vendor opkg `postinst` as **uid 0**
(`CapEff 0000003fffffffff`) → patched static ARMv7 Dropbear key-only on **:8008**,
boot-persistent via the `re_sshd` serviceList autostart. See
[findings/01-root-chain.md](findings/01-root-chain.md).

## Launcher (Lane 3)

The Free My TV component swap in the writable `operation-ui` `app.js`
(`route[0].component` for `/Launcher` only). The tested SDK interfaces match
those of the 75U8QTUK, so the `free-my-tv-75u8qtuk` adapter was reused unchanged. A
follow-on "Arc Home" variant adds MENU→settings, a UTC-safe clock, and a Recent
row. See [findings/02-native-home.md](findings/02-native-home.md) and
[findings/03-arc-home.md](findings/03-arc-home.md).

## Capability summary

| Capability | Result |
|---|---|
| `launcher` | working |
| `file_bridge_traversal` | open (array path) |
| `file_bridge_write` | open (fetcher `fetchFile`) |
| `root` | achieved + boot-persistent |
| `pairing` | untested (browser recon lane used) |
| `identity_gate` / `euladpp_untar` / `devtools_forge` | untested |

## Teardown

Full, failure-safe teardown in [MODDING.md](MODDING.md#teardown). All changes are
on the rw `/APPS` + `/var/local`; the read-only rootfs and `/OAD` are never
written, verified boot stays green.
