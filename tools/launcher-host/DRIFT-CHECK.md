# drift-check — what came back? (issue #50)

An engine restart, a half-applied session or a vendor update can silently
revert what alvidaa set, and nothing notices. [deploy-check](deploy-check.cjs)
is the *before* and [verify-install.cjs](verify-install.cjs) is the *after*
of a deliberate action; every moment in between had no tool. Both Android-TV
audits ranked this class at the top of the list: dumbtv's `verify` loop and
CleanMyTV's "clean up after a firmware update" are the same idea — compare
live state against last-known-good, and name the repair when they differ.

```
node tools/launcher-host/drift-check.cjs --model 50a51huv --host <tv-ip> [--record-dir <dir>] [--json]
node tools/launcher-host/drift-check.cjs --model 50a51huv --fixture <dir> [--record-dir <dir>] [--json]
```

`--port` (default 2222) and `--key` (default `server/keys/tv_root_ed25519`)
are honoured and flow into the transport. `--record-dir` overrides where
[recovery-record.cjs](recovery-record.cjs) keeps its records (default
`firmware/<model>/recovery/`, gitignored and private).

## The one rule

**Read-only against the TV.** No writes, no restarts, no kills — inherited
whole from deploy-check, because a drift check that can change the thing it
checks is not a drift check. Every remedy names a command owned by somebody
else: `native-install.cjs bootstrap/install/rollback` for the install lane,
the hookinstall lane for the boot hook, AdGuard for the sinkhole, the
operator for the rest.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | clean — no FAIL; WARNs are ambiguous states, SKIPs are unreadable ones |
| `1` | drift — at least one FAIL |
| `2` | bad usage — unknown model, missing `--model`/`--host`, bad flag |

## Output

One line per check — status, name, observed, and on anything but PASS a
one-line remedy — then one verdict line. `--json` prints the same result as
exactly one JSON object (and nothing else on stdout):

```json
{
  "tool": "drift-check", "ok": false, "exit": 1,
  "model": "50a51huv", "host": "192.0.2.10", "fixture": null,
  "unit": { "key": "50a51huv:bc5c17bc4688", "serial_source": "mac:wlan0" },
  "record": { "key": "50a51huv:bc5c17bc4688", "created": "…", "updated": "…" },
  "checks": [ { "name": "watcher", "status": "FAIL", "observed": "…", "remedy": "…" } ],
  "verdict": "DRIFT on 50A51HUV / 09.01O.P0813: watcher — …"
}
```

The exit code and the JSON `exit` come from one `verdict()` on the same
results array, so the two modes cannot disagree.

## The checks, in order

The lane gate first; every other check runs even after an earlier FAIL —
each is independent evidence (verify-install's rule).

| # | Name | Question | Outcomes |
| --- | --- | --- | --- |
| 1 | `dropbear` | Does the root ssh lane answer a probe echo? | **Hard gate.** The transport *is* the dropbear session, so this is one exec; FAIL stops the run — the remaining checks would only produce noise. |
| 2 | `record` | Is there a recovery record for this unit? | SKIP when there is no stable identity, no record, or an unreadable one — absence is not drift; the checks that wanted a comparison say so in their own observed lines. |
| 3 | `bundle` | Is the live bundle stock, the installed candidate, or unknown — and does it still match what the record last saw? | The two revisions a deliberate action puts in place are the pinned stock and the candidate (`<state>/candidate.md5`, which install writes and rollback deliberately leaves). A third md5 is FAIL — something else wrote the bundle, a firmware update above all. Unknown but unchanged since the record is WARN (the state is stable; only the profile is stale). |
| 4 | `watcher` | Is `watcher.enabled` what this setup expects — native Home ⇒ off, stock ⇒ the pre-native value? | FAIL on a flip in either direction: this tool exists because flips are silent (the 2026-11-10 bounce). Expected value comes from the once-taken `config.json.bak-native-home`, falling back to the record's pre-install capture. SKIP when the config is missing or unreadable. |
| 5 | `stock-backup` | Is `<state>/backup/app.js.stock` present and intact? | FAIL when missing (remedy: bootstrap) or when its md5 no longer matches the pinned stock — corrupt, or a firmware update moved what the profile pins; check before re-running bootstrap, which would replace the backup. |
| 6 | `boot-hook` | Is `/var/local/otaTest.sh` still there? | FAIL when missing — root SSH will not survive the next reboot. The rolling backup (`otaTest.v1.bak`) is checked by hand if this fires. |
| 7 | `sinkhole` | Are the kill-list hosts still unreachable **on TCP :443**? | FAIL if any host accepts a connect — both the resolver pin and the kernel kill-list have let go at once (findings 09's layered design holding is the only PASS). |
| 8 | `prefs` | Are the launcher's `alvidaa_*` keys still in sdk.storage? | PASS with a key count; WARN when storage is reachable but empty (never customized *or* the findings-12 recreation data-loss trap) or root-owned (the engine can neither read nor write its own storage). SKIP whenever the storage is unreachable — say SKIP, never PASS. |

## Last-known-good, and where it lives

No second store is invented. The unit identity and the pre-install state
come from [recovery-record.cjs](recovery-record.cjs) (`identify()` → key,
`read()` → record; the record's `latest` is what the unit looked like the
last time the install lane looked). The installed-candidate md5 comes from
the TV itself (`<state>/candidate.md5`, written by install). The pre-native
watcher value comes from the backup native-install takes once and never
replaces. When none of those exist for a fact, the check says what it could
not compare instead of guessing — that is why WARN and SKIP exist alongside
FAIL.

## The sinkhole probe: TCP, never ICMP, and how without `nc`

The firmware drops ICMP echo (findings 05), so ping proves nothing. The
probe is a TCP connect to port 443 on each kill-list host — the question is
"can telemetry leave", not "is the name pinned": a `0.0.0.0` resolver pin,
an NXDOMAIN and a kernel REJECT all close the path, and only an OPEN connect
is positive evidence of drift. A killed connect (watchdog) counts as closed;
the check fails on positive evidence only.

The build has no `nc` applet (`nc: applet not found`, findings 05) and no
`timeout` binary (findings 11). The primitive is bash `/dev/tcp` —
`/bin/sh` is real bash on this unit, findings 05's measured "network
primitive with zero binaries". Each connect runs under a `sleep`-based
watchdog because a SYN-blackholed host would otherwise hang the ssh lane on
the kernel's connect timeout:

```sh
for h in <hosts>; do
  ( (exec 3<>"/dev/tcp/$h/443") 2>/dev/null && echo "$h OPEN" || echo "$h BLOCKED" ) &
  p=$!; ( sleep 5; kill $p 2>/dev/null ) & w=$!
  wait $p 2>/dev/null; kill $w 2>/dev/null; wait $w 2>/dev/null
done; true
```

The host list mirrors `tools/alvidaa.py`'s `PRIVACY_TIER1` plus `dns.google`
— the DoH bootstrap that [ADGUARD_APPLY.md](../../firmware/ADGUARD_APPLY.md)
calls load-bearing. Limitation, stated rather than hidden: the probe cannot
distinguish *which* layer closed a host (pin vs NXDOMAIN vs REJECT), only
that the path is closed. Reading the layers separately is
`alvidaa.py privacy status`.

## Fixture mode — testing without a TV

Same transport shape as deploy-check; `sshRemote()` is borrowed from there,
not copied, so a lane fix lands here too. The fixture composes
deploy-check's `fixtureRemote` (md5sum, `ls -ldn`, engine scan) with the
commands this tool adds, and still throws on anything unknown, so tool/fixture
drift fails the tests loudly. Fixture layout, over deploy-check's:

| Path | Stands in for |
| --- | --- |
| `APPS/…/app.js`, `var/local/alvidaa/native-home/**` | live bundle, `candidate.md5`, `backup/app.js.stock` |
| `var/local/alvidaa/config.json{,.bak-native-home}` | watcher state and the pre-native value |
| `var/local/otaTest.sh` | the boot hook |
| `sys/class/net/wlan0/address` | the unit identity (serial candidates absent → MAC fallback, as measured on the reference unit) |
| `var/local/hisenseUI/cobalt_home/.starboard.<b64 origin>.storage` | sdk.storage; an `X.owner` sidecar overrides the owner; make it a directory to emulate an unreadable state |
| `dev/tcp/<host>-443` (marker) | that host **accepts** a TCP connect — the sinkhole is not sinking; a `.hang` sibling emulates a watchdog kill |
| `--record-dir <dir>` | where `recovery-record` keeps the unit's record |

## Worked example

Real output from a fixture shaped like the reference unit, with the watcher
flipped back on under the native Home (exit 1):

```
PASS  dropbear       answering on port 2222
PASS  record         50a51huv:bc5c17bc4688 — captured 2026-11-10, last seen 2026-11-10
PASS  bundle         f76b4d13564cec926bf9bdf7b8ea5bab — the installed candidate (per /var/local/alvidaa/native-home/candidate.md5) (matches the record)
FAIL  watcher        watcher is on with the native Home installed — the bridge will bounce it back to the canvas page within a second | remedy: re-run native-install.cjs install — it owns this flip
PASS  stock-backup   present, md5 matches the pinned stock
PASS  boot-hook      present, md5 3e2b31c72181b87149ff995e7202c0e3
PASS  sinkhole       8/8 kill-list hosts closed on TCP :443 — resolver pin or kernel REJECT holds
PASS  prefs          1 alvidaa_* key(s) present in .starboard.ZmlsZTovLy9oaXNlbnNlVUkvaW5kZXguaHRtbA==.storage
DRIFT on 50A51HUV / 09.01O.P0813: watcher — watcher is on with the native Home installed — the bridge will bounce it back to the canvas page within a second
```

## Integration point

`native-install.cjs status` (its `status()` function) prints the switch
script's status and one watcher line. The natural extension is a third call:
`require('./drift-check.cjs').runDriftCheck({ model: opts.model, host: opts.host,
port: opts.port, key: opts.key })` — `status` already holds every flag the
transport needs — then `deployCheck.renderLine` each check and the verdict.
Until that lands, chain the CLI by hand:

```
node tools/launcher-host/native-install.cjs status --model 50a51huv --host <tv-ip>
node tools/launcher-host/drift-check.cjs   --model 50a51huv --host <tv-ip>
```

## Tests

```
node --test tools/launcher-host/drift-check.test.cjs
```

Twenty-two cases: the healthy TV (every check PASS, exact name order), the
four revert classes the task names (bundle moved, watcher flipped, backup
missing/tampered, hook missing, sinkhole open), the SKIP contract (unreadable
prefs, missing storage, missing/absent/malformed record, missing watcher
config), the WARN-only states (unknown-but-stable bundle, zero keys, the
root-owned findings-12 fossil), the sinkhole watchdog kill, the lane gate
stopping the run, the `--json` contract, and the usage errors.
