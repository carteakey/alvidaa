# 55U61KEVS V0000.09.62C.Q0924 — evidence ledger

Labels: **verified** (observed on-device), **documented** (quoted source/config),
**hypothesis**, **unverified**.

| Claim | Evidence | Source |
| --- | --- | --- |
| 32-bit ARM userland on aarch64 kernel | `process.arch "arm"` from an in-process FaaS probe; kernel `Linux 5.4.302 aarch64` | [findings/01](findings/01-root-chain.md) |
| fetcher `fetchFile` write primitive open | two marker writes returned `ret:true, "download finished"` as uid 314 | [findings/01](findings/01-root-chain.md) |
| `hiutils.fileRead` array-path traversal | `../proc/uptime` read `ret:true`; bare string rejected `invalid path:../proc/uptime` | [findings/01](findings/01-root-chain.md) |
| superwatch socket reachable from uid 314 | `/var/run/superwatch_socket` 0660 root:616; command `85` answered `0`; `82`/`83` wired (bogus-path `-1`/`0`) | [findings/01](findings/01-root-chain.md) |
| IPK postinst runs as root | `POSTINST_RAN`, `Uid: 0 0 0 0`, `CapEff: 0000003fffffffff` in `installer_log.txt` | [findings/01](findings/01-root-chain.md) |
| Root SSH | `ssh -p 8008` uid 0, key-only, PTY | [findings/01](findings/01-root-chain.md) |
| Boot persistence | `re_sshd` autostart re-armed dropbear ~30s after a real cold boot; launcher survived byte-identically | [findings/01](findings/01-root-chain.md) |
| Native launcher works | Home/Input/HDMI/TV Settings/AirPlay verified; `app.js` md5 `130210f4…` after swap | [findings/02](findings/02-native-home.md) |
| SDK surface == 75U8QTUK | `getAppList`/`getAppInfo`/`changeSourceTo`, `setting.open`, `apc`/`CMDMETHOD`, same `launcher=()=>i("740m")` | [findings/02](findings/02-native-home.md) |
| Arc Home runtime quirks | UTC clock, key 409 `MENU_SRC`, `getCurrentAppSource()`, `box-sizing` ignored | [findings/03](findings/03-arc-home.md) |

## Stock launcher pin

`/APPS/pkgs/tv.vidaa.app.operationui/CHA/apps/launcher/js/app.js`

- size `323596`, owner `305:909`, mode `0640`
- md5 `8b1c61935b182beb9f476ee9d00e54f5`
- sha256 `fbffe7293c5d4f118ab5c359da3769b891754cb96d83f6d6dc548791a8920f5e`
