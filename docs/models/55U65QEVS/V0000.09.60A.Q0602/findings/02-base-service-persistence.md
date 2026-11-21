# 02 — Boot persistence without PFM: the vendor js-service autostart

**This is the finding worth merging.** Root that survives a wall-plug power cycle
with **no boot-chain writes, no `eval` at boot, and a benign failure mode** — the
vendor's own service manager starts our service at uid 314, and our service asks
superwatch for the already-installed IPK again.

Verified end to end on 2026-11-20, twice, including one physical power cycle.

## The mechanism

```
boot
 └ tv.vidaa.jsservice.basic  (systemservice → phoenix.server.js)
     └ lib/serviceManager.js reads CHA/services/serviceList.json
         └ {"id":"hearthd","autoStart":true,"isKeepAlive":true}
             └ pathRouter('basic', id) → require(<ROOT_BASIC_JS>/services/hearthd/index.js)
                 └ new Service(entry) → await start()
                     └ if nothing LISTENs on :1F48 (8008):
                          send "83" then "82" to /var/run/superwatch_socket
                          └ opkg → postinst (uid 0) → start the shell on :8008
```

Observed on this unit, from `/APPS/.hearthd.log` (written by the service itself):

```
18:09:32 module loaded pid=2869
18:09:32 ctor entry=/APPS/pkgs/tv.vidaa.jsservice.basic/current/services/hearthd
18:09:32 ctor done, has start=function
18:09:32 hearthd start pid=2869 uid=314 argv=…/current/phoenix.server.js
18:09:51 attempt 1 uninstall=[921:0] install=[922:0]
18:09:56 ARMED: root shell up on 8008
```

## The trap: the service directory needs `package.json`

`BaseService`'s constructor reads a per-service manifest:

```js
// lib/baseService.js
this.#isBackgroundType = service_package?.selfStart ?? false;
if (Object.prototype.hasOwnProperty.call(service_package, 'permission')) …
```

With only `index.js` in the directory, `super(entry)` **throws**, the manager logs
`Not supported service <id>` and discards the service — silently, with no entry
in any file a contributor can read. Symptom: the module is required (so a
top-of-file breadcrumb proves it loads) but `start()` is never called, and the
port never opens.

Minimum working manifest:

```json
{
  "name": "hearthd", "version": "1.0.0", "main": "index.js",
  "type": "commonjs", "selfStart": true,
  "permission": { "required": {}, "provided": {} },
  "author": ""
}
```

Every stock service has one (`hiutils/package.json`, `tvinfo/package.json`,
`fetcher/package.json` …), and the repo's own `re_sshd` source trees ship one
too (`75U8QTUK/.../source/re_sshd/package.json`,
`50U7DSE/.../source/re_sshd/package.json`) — but no guide says **why**, so a
port that carries only `index.js` + the `serviceList.json` entry looks complete
and fails silently. That is exactly how this unit was first misconfigured: the
service was listed, the module was loaded, and `start()` was never reached.

## Other contract details that cost time

| Detail | Why it matters |
| --- | --- |
| `entry` argument is `…/current/services/<id>` (a symlink path, not `CHA/…`) | do not string-compare against `CHA` |
| `start()` **must** `await super.start()` | the manager awaits the `started` event before starting the next service; skipping it stalls the whole autostart list |
| `ROOT_BASIC_JS` / `BASIC_JS_LIB` are **not** in the process environment | `run_env.js` installs the `@sdk` module alias; a service that needs `@sdk/baseService.js` outside that process must add the alias itself |
| the manager retries nothing | the service must own its retry loop (this one retries 36× / 5 s, because superwatch can come up after the service manager) |
| `isKeepAlive: true` | the manager restarts a service that exits |

## Why this lane over PFM

| | BaseService autostart | PFM (`DebugPowerup` + `pfmParse`) |
| --- | --- | --- |
| Runs as | uid 314, then postinst as uid 0 | uid 0 directly, via `eval` of `PFMCheck` |
| Boot-time code evaluated | none | **every line of a file, as root, before the UI** |
| Failure if malformed | service skipped; TV boots normally | possible **boot loop**; recovery is UART |
| Persistence across power cycle | yes (verified) | yes (verified on `65A85QEVS`) |
| Leaves boot-chain state | none | `DebugPowerup` + `pfmParse` (self-wiping) |

For a unit where the goal is "root after every boot, no drama", the autostart is
strictly better: the worst case is a TV that boots without root.

## Hardening notes

- Gate on `:8008` **listening** via `/proc/net/tcp` (`1F48`, state `0A`) — do not
  trust a pidfile, and do not `pgrep`.
- Give up after a bounded number of attempts; a service that loops forever will
  be restarted by `isKeepAlive` and can spin during boot.
- Keep the service's own log in tmpfs (`/tmp`) **and** an `/APPS` marker: `/APPS`
  is `0777` so a uid-314 append works, and `/tmp` survives only until reboot.
