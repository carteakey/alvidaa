# 02 — Boot persistence via the vendor js-service autostart

Root is restored at every boot without touching the boot chain: the vendor service
manager starts a `BaseService` at uid 314, and that service re-runs the IPK install
through superwatch, whose `postinst` runs as uid 0.

## Mechanism

```
boot
 └ tv.vidaa.jsservice.basic (phoenix.server.js, uid 314)
     └ lib/serviceManager.js reads CHA/services/serviceList.json
         └ {"id":"hearthd","autoStart":true,"isKeepAlive":true}
             └ pathRouter('basic', id) → require(<ROOT_BASIC_JS>/services/hearthd/index.js)
                 └ new Service(entry) → await start()
                     └ if no listener on :1F48 (8008):
                          send "83" then "82" to /var/run/superwatch_socket
                          └ opkg → postinst (uid 0) → start the shell
```

Timing on this unit, from the service's own log:

```
20:06:14  hearthd start pid=2903 uid=314
20:06:35  attempt 1 uninstall=[921:0] install=[922:0]
20:06:40  ARMED: root shell up on 8008
```

19 s from service start to a listening root shell; verified across a power cycle.

## Interface requirements

**The service directory must contain `package.json`.** `BaseService`'s constructor
reads a per-service manifest:

```js
this.#isBackgroundType = service_package?.selfStart ?? false;
if (Object.prototype.hasOwnProperty.call(service_package, 'permission')) …
```

With only `index.js`, `super(entry)` throws, `registerService` logs
`Not supported service <id>` and drops it. The module is still `require`d, so a
top-of-file marker proves it loaded while `start()` is never reached. Minimum
working manifest:

```json
{
  "name": "hearthd", "version": "1.0.0", "main": "index.js",
  "type": "commonjs", "selfStart": true,
  "permission": { "required": {}, "provided": {} },
  "author": ""
}
```

Every stock service ships one (`hiutils`, `tvinfo`, `fetcher`).

| Requirement | Detail |
|---|---|
| `entry` argument | `…/current/services/<id>` — a symlink path, not `CHA/…` |
| `start()` | must call `await super.start()`; the manager awaits the `started` event before starting later services |
| retries | none provided by the manager; the service must implement its own loop (36 × 5 s here) |
| `isKeepAlive: true` | restarts the service if it exits |
| `@sdk` alias | installed by `run_env.js` from `BASIC_JS_LIB`; a service requiring `@sdk/baseService.js` outside that process must add the alias itself |

## Comparison with the PFM lane

`start-kilby.sh` also honours `/var/local/DebugPowerup` → `pfm-manager.sh`, which
`eval`s `PFMCheck` and `Data/platform.txt` as uid 0 at boot and then wipes them.
That path is present on this build and remains unused.

| | js-service autostart | PFM |
|---|---|---|
| Runs as | uid 314, escalation via superwatch postinst | uid 0 directly |
| Boot-time evaluation | none | every line of two files, as root |
| Failure if malformed | service skipped; TV boots normally | possible boot loop; recovery is UART |
| Boot-chain state | none | `DebugPowerup` + `pfmParse` (self-wiping) |
