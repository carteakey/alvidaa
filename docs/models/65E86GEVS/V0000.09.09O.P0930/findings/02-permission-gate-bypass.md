# Finding 02 — the phoenix permission gate: why "no identifier" is enough, and why tokens are forgeable

Device: 65E86GEVS / V0000.09.09O.P0930 (MTK9618, U09.09). Discovered 2026-10-24.
No exploit needed — three access-control design flaws chain together.

This unit reached the bus and the file bridge through these. The **mechanism**
is public here; the AES key literal is withheld (key material, per
[DISCLOSURE.md](../../../../DISCLOSURE.md)).

## Flaw 1 — CORS is wide open

`lib/router/Router.js` sends on every response:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Headers: identifier, timeout, sentry-trace
```

The router listens on `http://localhost:9009`. Because the TV browser honors
the wildcard, **remote web content** (a page served from the LAN or the
internet) can POST to the TV's internal service bus.

## Flaw 2 — an empty `identifier` bypasses `checkRequestPermission`

`lib/serviceManager.js`:

```js
if (origintype === 'client') {
    const id = request?.identifier
    if (!id) return true          // no identifier == allowed
    ...
}
```

`callService.js` type-checks `identifier` only as `'string'`. An **empty
string** satisfies the type check *and* is falsy, so the function returns
`true` before any permission logic runs.

Verified from a LAN web page (an HTTP POST to `localhost:9009`):

| Call | Result |
| --- | --- |
| `service/hiutils` `setDebugPort` (`identifier:""`) | `{"ret":true,"msg":"success"}` |
| `service/hiutils` `getDebugPort` | `{"ret":true,"msg":0}` |
| `service/hiutils` `deviceCode` | `{"ret":true,"msg":"…"}` |
| `service/system/pkgmgr` `getInstalledPkgs` | `{"ret":true, 13 packages}` |

## Flaw 3 — permission tokens are mintable (static key + zero IV)

The same function decrypts the client-supplied `identifier` to obtain the
caller's permissions:

```js
const key_byte  = Buffer.from(<static 32-byte literal>)   // AES-256
const iv_byte   = Buffer.from('0000000000000000')          // static zero IV
const decipher  = crypto.createDecipheriv('aes-256-cbc', key_byte, iv_byte)
```

`identifier` decrypts to `<seconds-of-uptime>+<appid>+<permissions>`; the check
requires `now - timenow <= 3` (uptime seconds, readable from the same API). A
client can therefore **mint its own token** claiming any appid and any
permission set. Fixing Flaw 2 alone would not fix this.

Also: `origintype === 'service'` returns `true` unconditionally
("service check is not ready").

## File bridge state on this build

`hiutils` enforces a per-action appconfig allowlist, but the two interesting
APIs are **permitted** here (no 503):

- `fileRead`, `fileWrite`, `getOSVersion`, `getUIVersion` → allowed
- `setDebugPort`, `getDebugPort`, `installApplication`, `resetDevice` → refused
  (the 503 "please check appconfig" seen on other builds)

So a page gets arbitrary uid-314 file read/write in `/APPS`, `/OAD`,
`/var/tvservice`, `/tmp` (traversal + write verified), which is the
entry primitive for [findings 01](01-superwatch-restore-injection.md).

## Impact

Any page the TV browser renders → uid-314 service bus and file access →
(with findings 01) a root shell, without being on the LAN. That is the same
attack surface the [MT9618 security review](../../../55S7NEVS/V0000.09.60X.Q0609/findings/50-security-review.md)
describes; this finding adds *why* the gate is not a gate (empty-identifier
short-circuit) and why even a mandatory identifier would not help while the
token scheme stays static-key/zero-IV.

## What would fix it (vendor side)

1. Make `identifier` mandatory — reject the empty case instead of short-circuiting.
2. Rotate/derive the decryption key per unit and per session; never a static
   key with a zero IV. Use the existing `/proc/uptime` freshness only as a
   secondary check, never as the trust anchor.
3. Authenticate the superwatch channel (their fix list item 3) — the file bridge
   and the permission gate are only the entry; the daemon is the root source on
   this unit.
