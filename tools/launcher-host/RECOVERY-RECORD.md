# recovery-record — the host-side record of what a TV looked like before alvidaa touched it

Every backup alvidaa takes lives on the TV, in `/var/local/alvidaa/`. That is
the right place for the restore path and the wrong place for the record of it:
a bad TV-side change takes the recovery path with it, and there is no second
copy anywhere. This module is that second copy, kept on the **host**, one JSON
file per physical unit — and it makes the standing
[AGENTS.md](../../AGENTS.md) warning that *"another agent session may be
working the same TV"* auditable instead of prose.

```js
const rr = require('./recovery-record.cjs');

rr.identify({ transport, model })     // -> { model, firmware, serial, key, ... }
rr.record({ transport, model })       // -> record object (written)
rr.read({ model, key })               // -> record | null
rr.compare(record, live)              // -> [{ field, recorded, live, drift }]
```

`transport` is injectable — `{ exec(cmd) -> string, readFile(path) -> Buffer }`
— the same shape [deploy-check.cjs](deploy-check.cjs) uses, so tests run with
no TV. The real one is `rr.sshTransport({ host, port, key })`: the exact ssh
flags [native-install.cjs](native-install.cjs) uses, borrowed from
deploy-check so they cannot drift between the tools.

## The one rule

Read-only against the TV. The transport only execs and reads (`md5sum`, `ls`,
`grep`, `/proc`); every write happens on the host. The TV's busybox has no
`id`, `curl`, `wget`, `nc`, `sha256sum`, `netstat` — nothing here uses them.

## What is recorded, and why

| Fact | Why it is in the record |
| --- | --- |
| bundle md5 + whether it was stock at record time | tells a later session whether the TV was pristine or already carrying a candidate |
| `watcher.enabled` **at first record** | this is the value rollback restores; getting it wrong is the exact trap that nearly shipped on 2026-11-10 — the live config was already watcher-off while the true original sat in `config.json.bak-nativetest` |
| every `config.json.bak-*` file's watcher value | the pristine watcher value often lives in one of these; `enabled: null` entries carry the read error, so a missing reason is never silent |
| engine binary path + pids | a restart needs the binary; a changed binary is a changed TV |
| boot hook (`/var/local/otaTest.sh`) + its rolling backup (`/var/local/otaTest.v1.bak`), present + md5 ([findings 05](../../docs/models/50A51HUV/09.01O.P0813/findings/05-root-primitive.md)) | the hook is the recovery lane itself; its md5 drifting means someone rewrote the boot path |
| firmware string + model name | so a record is never applied to the wrong build |

The live `watcher.enabled` read is allowed to **fail the record loudly**: a
flaky SSH lane must not poison the pristine snapshot with a silent null —
re-run `record` until it completes clean. Only the optional backup files get a
soft `null`, and then with the reason inline.

## Identity: model + a stable per-unit identifier

The key is `<model>:<serial>` (lowercased, `:` and whitespace stripped from
the serial), so a record follows the TV when DHCP moves it and refuses a
different unit. The IP is never part of it.

The serial candidates were **measured** on the reference unit (50A51HUV at
192.168.0.175, 2026-11-10, read-only over the root SSH lane), not guessed:

| Candidate | Measured result |
| --- | --- |
| `/proc/device-tree/serial-number` | absent — the Mstar device tree has no serial or uuid node |
| `/sys/firmware/devicetree/base/serial-number` | absent |
| `/vendor/tvconfig/config/Did` | exists (37 bytes) but `DID0`–`DID5` are all empty on this unit |
| `/serialdata/common/serials.ini`, `/serialdata/characteristic/` | per-series/per-model tables and tarballs, not per-unit |
| `/sys/class/net/wlan0/address` | `bc:5c:17:bc:46:88` — matches the MAC the project already records |

So on this unit there is **no readable per-unit serial**, and the identifier
falls back to the WiFi MAC (`wlan0` first, then `eth0`), with the source
recorded in the file as `serial_source: "mac:wlan0"`.

**The limitation, stated plainly:** a MAC identifies a network card, not a
mainboard. It survives DHCP moves, reboots and OTAs, but a different WiFi
module (or a spoofed MAC) is a different "unit" as far as the key is concerned,
and two TVs swapped into one chassis would be told apart by the wrong thing.
The device-tree and `Did` candidates stay first in the probe order, so a
firmware that starts exposing a real serial upgrades the identity without any
change here. If neither serial nor MAC can be read, `identify` refuses — a
record keyed on nothing that survives a reboot is worse than no record.

## Where the files live

`firmware/<model>/recovery/<key>.json` — e.g.
`firmware/50a51huv/recovery/50a51huv-bc5c17bc4688.json`. Under `firmware/`
because that directory is gitignored and private and already holds the
per-model stock bundles; never in the public tree, never in `/tmp` — a record
that does not survive a reboot is not a record. Files are written atomically
and `0600`: they carry the unit's MAC and bundle hashes. Records deliberately
do not travel through git; each host that deploys keeps its own.

A record looks like this (the real first record of the reference unit,
2026-11-10 — note `pristine: false`: the alvidaa candidate was already
installed, and all three config backups show the original watcher value was
**on**):

```json
{
  "model": "50a51huv",
  "firmware": "09.01O.P0813",
  "serial": "bc:5c:17:bc:46:88",
  "serial_source": "mac:wlan0",
  "key": "50a51huv:bc5c17bc4688",
  "pristine": false,
  "facts": {
    "bundle": { "md5": "7c1172e3e8ec2157a7205cecde7a7fe9", "is_stock": false },
    "watcher": {
      "backups": [
        { "file": "config.json.bak-20261105", "enabled": true },
        { "file": "config.json.bak-native-home", "enabled": true },
        { "file": "config.json.bak-nativetest", "enabled": true }
      ],
      "enabled": false
    },
    "engine": { "binary": "/opt/hisenseUI/bin/hisenseUI", "pids": ["6224"] },
    "boot": { "hook": { "present": true, "md5": "35f3df188442e0610b3fe9a5e6b6cc7d" },
              "backup": { "present": true, "md5": "32dfe473a2c91a95cf93ed9de06f5d95" } }
  },
  "latest": { "…same shape as facts, from the most recent record()…" },
  "history": [ { "at": "…", "bundle_md5": "…", "watcher_enabled": false,
                 "engine_binary": "…", "hook_present": true } ]
}
```

## The overwrite policy: merge, originals preserved

A second `record` on the same unit **merges**: the pristine snapshot in
`facts` is immutable forever, `latest` is replaced with the fresh probe, and a
compact line lands in `history`. Merge was chosen over refuse-and-`--replace`
because refusing pushes an operator towards deleting the old record by hand —
the exact accident this file exists to prevent — while the merge keeps the
values rollback restores authoritative and turns "another agent session may be
working the same TV" into a list of timestamps.

A record is **refused**, never overwritten or half-applied, when: the file is
malformed JSON or fails validation; it belongs to a different model or a
different key; or a read error hits the live watcher value. A malformed file
stays untouched on disk for a human to look at.

## compare()

`compare(record, live)` diffs the **pristine** snapshot against a fresh
`probe()` and returns one entry per field — `firmware`, `bundle_md5`,
`watcher_enabled`, `engine_binary`, `hook_present` — each with
`{ field, recorded, live, drift }`, drifted or not, so the output is a stable
table. Before any recovery action, this is the "what moved since we first
touched it" answer.

## Integration point (wired by the supervisor)

[native-install.cjs](native-install.cjs) gets two call sites; both take the
same arguments the installer already has in `opts`:

1. **Before any TV write** — in `install()`, right after the model and
   variant checks, before `bootstrap()` or anything is uploaded:

   ```js
   const rr = require('./recovery-record.cjs');
   rr.record({ transport: rr.sshTransport(opts), model: opts.model });
   ```

   This is the capture that matters: the pristine watcher value and the
   stock md5, taken before the first file lands. The record's own probe is
   the installer's first TV contact and it is read-only.

2. **After a successful switch or rollback** — after `runSwitch()`
   returns, re-record and surface drift:

   ```js
   const rec = rr.record({ transport: rr.sshTransport(opts), model: opts.model });
   for (const d of rr.compare(rec, rec.latest)) {
     if (d.drift) console.log('drift: ' + d.field + ' ' +
       JSON.stringify(d.recorded) + ' -> ' + JSON.stringify(d.live));
   }
   ```

   The merge appends the audit line; the loop prints what the operation
   changed against the pristine snapshot. `rollback()` gets the same pair, so
   a rollback's history line shows the restored state.

## Tests

```
node --test tools/launcher-host/recovery-record.test.cjs
```

Fourteen cases against a scripted fake transport: identity and the MAC
fallback (including the measured empty `Did` file), key stability across a
DHCP change, one file per unit, the merge policy keeping the original watcher
value, null on unknown units, all five drift fields, the unchanged-TV case,
cross-model refusal naming both models, malformed-record refusal without
overwrite, and the no-identity refusal.
