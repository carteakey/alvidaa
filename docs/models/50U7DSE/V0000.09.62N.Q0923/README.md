# 50U7DSE / V0000.09.62N.Q0923 — root + boot-persistent native Home (MTK9618, EU_A/DEU)

**Status:** full chain verified on 2026-11-11. Pairing works (modern profile,
`transport_protocol=3290`); the browser self-install lane is **closed** by the
`503 appconfig` identity gate; root is **achieved** through the
`fetcher → superwatch → IPK postinst` chain and is **boot-persistent** via the
`re_sshd` serviceList autostart; the launcher runs as a **native lane-3
component swap** (Free My TV) and survives a cold boot byte-identically. The
native Home's action paths (app launch / input switch / TV Settings) are
owner-verified on screen (2026-11-11). On 2026-11-12 the Free My TV
**web-parity port** (the upstream web program, per
[findings 02](findings/02-web-parity-port.md)) replaced the offline V1 as the
installed Home, after a Cobalt capability probe
([findings 01](findings/01-cobalt-capability-probe.md)) verified the asset,
IPC and font lanes this build needs.

> **Applies to `50U7DSE` (internal `50U73SEVS_01`, serial type `50U7SE`; SoC
> MTK9618 = mt16587/mt5879, aarch64 kernel with 32-bit ARM userland; VIDAA
> `U09.62`; region `EU_A`, country `DEU`) running `V0000.09.62N.Q0923`, build
> date 2026-09-23.** The same build may ship on other MTK9618 units; none were
> tested.

> **Contributed by [@roelven](https://github.com/roelven)** from their own TV.
> The root chain and the lane-3 native Home are the same families already
> documented for `55E75LEVS` (09.61B, MTK9618) and `75U8QTUK` (09.60I); this
> guide records the 09.62N replay and its deltas.

## What the chain rests on

1. **`transport_protocol=3290` + the 2024 client cert.** Pairing needs the
   `CN=VidaaAppAndroidV01` cert (`res/El.p12` from `com.universal.remote.multi`
   v1.09.05.001.0) and a colon-formatted MAC as `client_id`. The `modern`
   profile connects (rc 0); a PIN dialog appears and must be submitted within
   ~10–15 s on this build (shorter than the ~30 s seen elsewhere).
2. **Array-path file-bridge traversal.** `hiutils.fileRead` traverses `../`
   only with a one-element **array** path (`path: ['../proc/uptime']` →
   `ret:true`); bare strings are rejected with `"invalid path"`.
3. **The FaaS fetcher is the write primitive.** The browser `fileWrite`
   (`HiUtils_createRequest`) is gated (`503 "client request permission check
   error, please check appconfig"` — the identity gate), but
   `vowOS.service.syncExecute("basic/fetcher", {api:"fetchFile"})` writes
   arbitrary paths as uid 314 (`ret:true "download finished"` to `/APPS/` and
   the package CHA dir). This is the same split as `55E75LEVS` / `43Q60SEVS`.
4. **Superwatch 83/82 → uid-0 postinst.** `sw2.js` (a FaaS helper) speaks the
   `4-byte LE length + payload` protocol to `/var/run/superwatch_socket`;
   `"90:83:90;re.installer"` (uninstall) then
   `"91:82:91;/APPS/installer.ipk;re.installer;"` (install) makes the vendor
   `opkg` run the IPK's `postinst` as uid 0 (`CapEff 0000003fffffffff`).
   `Architecture:` in the IPK control must be **`mtk9618`**.
5. **`re_sshd` serviceList autostart.** A `BaseService` in
   `tv.vidaa.jsservice.basic/CHA/services/` with a `serviceList.json` entry
   re-runs the already-installed IPK through superwatch whenever nothing is
   listening on `:8008` at boot — the same `@sdk/baseService.js` contract and
   `(entry)` constructor as `75U8QTUK`/09.60I, verified to hold on 09.62N.
6. **The writable UI module is `pkgs/tv.vidaa.app.operationui`** (not
   `/APPS/channelA/operation-ui` as on the MTK9602 reference). The launcher
   bundle is `CHA/apps/launcher/js/app.js`; its tail is
   `(self._V_M_=self._V_M_||{}).launcher=()=>i("740m").Z`, and the SDK contracts
   match the `75U8QTUK` adapter (see below).

## What was measured

| Claim | Evidence | Source |
| --- | --- | --- |
| Pairing works | `modern` profile, rc 0, PIN accepted, `tokenissuance` issued | live, 2026-11-11 |
| `../` traversal (array path) | `../proc/uptime` → `ret:true "4919.50 17783.11"`; bare string → `"invalid path"` | live |
| Browser `fileWrite` gated | `503 appconfig` | live |
| Fetcher write open | `fetchFile` → `"download finished"` to `/APPS/` + CHA dir | live |
| `postinst` runs as uid 0 | installer log `Uid: 0`, `CapEff: 0000003fffffffff` | live |
| Root SSH | `ssh -p 8008 root@…` → `whoami` = root | live |
| Boot persistence | `re_sshd` re-armed dropbear ~30 s after each of **two** cold boots | live |
| Native Home renders | HAL screenshot shows dark theme + shelf + dock | live |
| Native Home survives reboot | `app.js` md5 unchanged after reboot | live |
| Native action paths (app launch / input switch / TV Settings) | owner-verified | owner, 2026-11-11 |
| Cobalt capability probe (XHR, artCache lane, fonts, CDN, CSS) | probe report via the vendor bridge, rolled back after each run | live, 2026-11-11/12 |
| Web-parity port boots + IPC live | `context.json` (uid 314): 47 apps, `zoneSource native-zone-hook`, no error; HAL screenshot `img/free-my-tv-web-first-install.png` | live, 2026-11-12 |

## Chain summary (the commands, not the payloads)

```text
pair (modern/3290, VidaaAppAndroidV01 cert, colon MAC)
  └─ fetchFile writes sw2.js + installer.ipk (uid 314)
       └─ superwatch 83 (uninstall) + 82 (install)
            └─ opkg postinst uid 0 (CapEff 0000003fffffffff)
                 └─ key-only static ARM32 Dropbear on :8008
                      └─ re_sshd serviceList autostart re-arms at every boot
```

The Dropbear is Dropbear 2022.83 built static ARMv7
(`tools/ur9s/scripts/build_dropbear_a7k.sh`, key-only,
`DROPBEAR_SVR_PASSWORD_AUTH 0`, `/etc/shells` → `/APPS/shell`). The installer
is `tools/ur9s/scripts/make_installer.py --arch mtk9618`.

## Native Home (lane 3)

Free My TV port using the `75U8QTUK` data adapter
(`tools/launcher-host/native-platform-75u8qtuk.js`), whose SDK contracts were
confirmed present in this build's `app.js` (`app-service` `getAppList`, `all-inputs`
`changeSourceTo`/`getAllInputsData`, `apc.start` with `LAUNCHER_RECOMMEND`
`"52"` / `typeCode "600002"`). Pinned stock:

| | |
|---|---|
| stock `app.js` | 323596 bytes, md5 `8b1c61935b182beb9f476ee9d00e54f5`, sha256 `fbffe7293c5d4f118ab5c359da3769b891754cb96d83f6d6dc548791a8920f5e`, owner `305:909` |
| engine | `SystemUI` (`/opt/hisenseUI/startgui.sh`, restart via `secure_exec`) |
| candidate | 356487 bytes, md5 `130210f4fc62959c5ace59aba952607d` |

The switch script `tools/launcher-host/switch-home-50u7dse.sh` is the
`75U8QTUK` script with the stock md5 swapped; it runs `dry` / `install` /
`rollback`, captures the SystemUI environment before the kill, resets only
`compiled_js`/`uncompiled_js`, and relaunches through `secure_exec`.

### Web-parity port (installed 2026-11-12)

The upstream Free My TV web program inside the stock launcher, reusing the
55A7KAU trial's parts and the `75U8QTUK` platform adapter, with a per-build
part (`native-web-50u7dse.js`: `Europe/Berlin` zone constant, vidaahub icon
policy) and builder (`build-native-web-50u7dse.cjs`). Assets (47 MB,
content-addressed `79ff3ba121059de3ca85`) stage under the vendor artCache
symlink `/APPS/hisenseUI_applications/UI/art/cache/free-my-tv/`; the runtime
writes IPC only to `/APPS/free-my-tv/`. No feed worker yet: weather/picks
need the worker suite plus a TMDB key; offline mode renders the full look.
Shelf logos get the upstream lifted treatment anyway — the worker's own
`native-image` lift algorithm runs offline against the pulled icons and the
result ships as a static `snapshot.json` (`build-icon-snapshot-50u7dse.cjs`;
41/47 lifted, the rest are transparent wordmarks upstream keeps raw).
After on-screen review the shelf moved to the repo's own curated look
(phase three): `CONFIG.shelfApps`/`hideApps` keep exactly the owner's five
— Netflix, Apple TV, Disney+, HBO Max, YouTube, in that order — on
upstream's SHELF gradients, with the repo's `web/icons` wordmarks
(rasterized) staged under the artCache lane; nothing was uninstalled.
Details and deploy evidence in
[findings 02](findings/02-web-parity-port.md); the probe that verified the
lanes in [findings 01](findings/01-cobalt-capability-probe.md).

## What this guide includes and leaves out

| Included | Left out |
| --- | --- |
| fingerprint + firmware constants | the working payload bytes |
| the chain at the architecture level | the exact command sequence |
| per-capability evidence and hashes | key material, tokens, certificates |
| the teardown path | vendor binaries |

The line falls where the sibling MTK9618/MTK9655 guides do: everything needed to
reproduce the *method* is public, while the key, cert and vendor bundle stay
private (gitignored `server/keys/`, `firmware/`).

## Teardown

Order matters; every step is reversible and the rootfs is never written
(squashfs ro, dm-verity green).

```sh
# 1. native Home -> stock (restores app.js + JS cache, restarts SystemUI)
/bin/sh -c 'trap "" HUP; exec /bin/sh /var/local/alvidaa/switch-home.sh rollback' \
  >/dev/null 2>&1 </dev/null &

# 1b. staged web-port assets + IPC namespace (only after the rollback above)
rm -rf /APPS/hisenseUI_applications/UI/art/cache/free-my-tv \
       /APPS/free-my-tv

# 2. boot persistence -> pristine serviceList (takes effect at next boot)
/bin/sh /var/local/alvidaa/boot-persist/boot-persist.sh teardown

# 3. root lane -> remove the SSH payload and package
kill "$(cat /APPS/.re_sshd/dropbear.pid)" 2>/dev/null
rm -rf /APPS/.re_sshd /APPS/installer.ipk /APPS/shell
rm -f /APPS/pkgs/tv.vidaa.jsservice.basic/CHA/functions/fetch/sw2.js
# remove the re.installer package + the dpt:8008 firewall rule
iptables -D FIREWALL_IN_EULAON -p tcp --dport 8008 -j ACCEPT 2>/dev/null
```

## Open items

- `euladpp_untar` and `devtools_forge` were not probed on this build.
- A second MTK9618 unit on the same `09.62N` build was not tested; do not
  infer the result beyond this model/firmware pair.

## Cross-reference

- Sibling chains: 55E75LEVS / 09.61B (MTK9618, same fetcher→superwatch root),
  [75U8QTUK / 09.60I](../../75U8QTUK/V0000.09.60I.Q0813/README.md) (native Home + `re_sshd` source).
- Root kit: [tools/ur9s](../../../../tools/ur9s/README.md) (Dropbear build + installer).
- Native toolchain: [tools/launcher-host](../../../../tools/launcher-host/VARIANTS.md).
- Method catalogue: [EXPLOITS.md](../../../research/EXPLOITS.md).
- Publication policy: [DISCLOSURE.md](../../../DISCLOSURE.md).
