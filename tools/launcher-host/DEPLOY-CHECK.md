# deploy-check — the go/no-go preflight for a lane-3 deploy

The deploy of the native Home was blocked twice, and both times the blocker
was only discovered by hand after a wasted round trip: the TV was not on the
network, the bundle path was the wrong module, the pinned hash had moved.
[the handoff](../../docs/launcher/NATIVE-DEPLOY-HANDOFF.md) carries the
numbered recipe, but nothing answered the one question that matters before
touching a TV:

> Is this deploy safe to run right now, and if not, exactly what is wrong?

This command answers it. It runs the checks from
[the handoff's recipe](../../docs/launcher/NATIVE-DEPLOY-HANDOFF.md) in one
shot — profile, pinned stock, build, pairing, reachability, root, and the
TV's live state — before [native-install.cjs](native-install.cjs) is allowed
near anything.

```
node tools/launcher-host/deploy-check.cjs --model 50a51huv --host <tv-ip> [--variant alvidaa] [--json]
node tools/launcher-host/deploy-check.cjs --model 50a51huv --fixture <dir>
```

Flags: `--port` (default 2222) and `--key` (default
`server/keys/tv_root_ed25519`) are honoured and flow into the suggested next
command.

## The one rule

**The checks are claims about the TV. The tool only observes; it never writes
to the TV.** No writes, no restarts, no `kill`, no "fixing" what it finds — a
preflight that can change the thing it is checking is not a preflight. Every
remedy it prints names a command owned by somebody else:
`native-install.cjs bootstrap/install` for the lane, the switch script for
owner/mode, the operator for the network.

This is also why two tempting checks were dropped rather than softened:

- *"clear space if /var/local is tight"* — a write; the space check only
  reports, and its remedy lists what an operator may clear by hand.
- *"flip `watcher.enabled` off when it is on"* — a write to the bridge
  config; `native-install.cjs` owns that flip during install, so the
  preflight only warns loudly.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | go — no FAIL; WARNs are footguns, not blockers |
| `1` | no-go — at least one FAIL |
| `2` | bad usage — unknown model/variant, missing `--host` without `--fixture`, bad flag |

## Output

One line per check: status, short name, the observed value, and — on
anything but PASS — a one-line remedy. The last line is the exact next
command to run, or the reason there is not one.

```
PASS  reachability   192.168.0.175:2222 answers
FAIL  root           ssh answers but not as root: uid=1000(nobody) ... | remedy: lane 3 needs root; ...
blocked by root: ssh answers but not as root: uid=1000(nobody) ...
```

`--json` prints the same result as one JSON object — and nothing else on
stdout — for a future bridge page:

```json
{
  "tool": "deploy-check", "go": false, "exit": 1,
  "model": "50a51huv", "variant": "alvidaa", "host": "192.0.2.10", "port": 2222,
  "checks": [ { "name": "reachability", "status": "FAIL", "observed": "…", "remedy": "…" } ],
  "next": null,
  "blocked": "blocked by reachability: TV not reachable: …"
}
```

The exit code and the JSON `exit` come from one `verdict()` on the same
results array, so the two modes cannot disagree.

## The checks, in order

Cheap and local first, remote last, so a broken toolchain never costs a
round trip.

| # | Name | Question | Outcomes |
| --- | --- | --- | --- |
| 1 | `profile` | Does the model id resolve? Prints model, engine, bundle path from [models.json](models.json). | always PASS (unknown model is a usage error, exit 2) |
| 2 | `stock-bundle` | Does `local_stock` exist in the repo? | FAIL → bootstrap remedy. Gitignored and private: absence is normal on a fresh clone. |
| 3 | `stock-hashes` | Do its md5 and sha256 match the pinned `stock_md5` / `stock_sha256`? | FAIL on mismatch — a moved bundle must be re-pinned, never built against. |
| 4 | `build` | Does the variant's builder ([variants.json](variants.json)) build against the pinned stock into a temp file? Prints byte size + sha256. Also proves the builder **refuses** a deliberately wrong expected hash — that guard is the only thing stopping a build against the wrong revision. | FAIL if the build throws or the guard is gone. Temp output deleted. |
| 5 | `pairing` | Is the variant listed as verified on this model? | WARN if not — say clearly that it needs `--force`; the suggested next command carries it. |
| 6 | `reachability` | Does TCP connect to the TV's SSH port? (The firmware drops ICMP; TCP is the documented probe.) | **Hard gate.** FAIL names deep standby / other network; no later check is attempted. |
| 7 | `root` | Does `id` over SSH contain `uid=0`? | **Hard gate.** FAIL otherwise — lane 3 needs root; no later check is attempted. |
| 8 | `bundle-path` | Does the profile's `app` path exist, with the profile's owner/mode? | FAIL if missing. WARN on owner/mode drift — the switch script sets them, so a difference means someone has been here. |
| 9 | `current-bundle` | Is the live bundle's md5 the pinned stock, this candidate (variant already installed), or something else? | always reported, never FAIL. Unknown revisions are normal: install will `switch`, not `install`. |
| 10 | `engine` | Is a process for the profile's engine running? (Mirrors the switch script's `live_engine()`: matched on the `/proc/<pid>/exe` link, zombies excluded.) | WARN if not — the switch script restarts it, but a missing engine means the UI is down. |
| 11 | `bridge` | Does `127.0.0.1:8770/api/debug` answer from the TV's loopback, with MQTT connected? | WARN/SKIP, never FAIL — the native Home does not need the bridge, but the watcher and `tools/screenshot.sh` live there. WARN (not SKIP) because on this TV curl is present and the bridge is normally up: silence is most likely a real down bridge. |
| 12 | `watcher` | Is `watcher.enabled` true in `/var/local/alvidaa/config.json`? | WARN if true — `native-install.cjs` owns this; a native Home with the watcher on is bounced back to the canvas page within a second. SKIP if the config is missing/unreadable. |
| 13 | `space` | How much is free where the candidate lands (`/var/local`)? | WARN under 5 MB. |

Checks 2–4 SKIP (with the bootstrap remedy) when there is no verified local
stock: nothing is hashed or built against a bundle that is absent or has
moved.

## Fixture mode — testing without a TV

The TV is unreachable from CI, so every remote interaction goes through one
small interface:

```js
// { exec(cmd) -> string, readFile(path) -> Buffer, connect(port) -> bool }
```

- `sshRemote(opts)` — the real TV, over `ssh` with the same flags
  [native-install.cjs](native-install.cjs) uses.
- `fixtureRemote(dir)` — a fake TV: a directory read as if it were the TV's
  root filesystem, plus marker files for the things that are not files.

The model/variant tables and repo root are injectable the same way
(`main(argv, deps)`), because the pinned stock bundle is gitignored and
cannot exist in a fresh clone. [deploy-check.test.cjs](deploy-check.test.cjs)
builds worlds from these parts.

Fixture layout (paths under the fixture dir stand in for TV paths):

| Path | Stands in for |
| --- | --- |
| `APPS/…/app.js` | the live launcher bundle (content drives the md5 checks; permissions drive the mode check) |
| `APPS/…/app.js.owner` | owner override, e.g. `305:305` (tests run unprivileged and cannot chown) |
| `var/local/alvidaa/config.json` | the bridge config the watcher check reads |
| `var/local/.free-kb` | free space on `/var/local` (default 819200) |
| `bridge/api-debug.json` | the body the bridge probe returns (absent = bridge down) |
| `proc/<pid>/exe` → symlink | a live engine process; the symlink target must end in `/<engine>`; a `State:` line containing ` Z` in `proc/<pid>/status` marks a zombie |
| `.unreachable` (marker) | makes `connect()` fail — the TV is "in deep standby" |
| `.nonroot` (marker) | makes `id` report a non-root uid |

`exec()` emulates exactly the handful of busybox invocations the tool issues
(`id`, `md5sum`, `ls -ldn`, `df -k`, the engine scan, the bridge curl) and
**throws on anything else**, so drift between the tool and the fixture
contract fails the tests loudly instead of silently passing.

## Worked examples

A failing run — a fresh clone (no pinned stock) and an unreachable TV. Real
output; `192.0.2.10` is a documentation address standing in for the TV:

```
$ node tools/launcher-host/deploy-check.cjs --model 50a51huv --host 192.0.2.10; echo "exit=$?"
PASS  profile        50A51HUV / 09.01O.P0813, engine hisenseUI, bundle /APPS/channelA/operation-ui/apps/launcher/js/app.js
FAIL  stock-bundle   no pinned stock bundle at firmware/50a51huv/operationui/apps/launcher/js/app.js | remedy: run: node tools/launcher-host/native-install.cjs bootstrap --model 50a51huv --host 192.0.2.10
SKIP  stock-hashes   no local stock bundle to hash | remedy: node tools/launcher-host/native-install.cjs bootstrap --model 50a51huv --host 192.0.2.10
SKIP  build          no local stock bundle to hash | remedy: node tools/launcher-host/native-install.cjs bootstrap --model 50a51huv --host 192.0.2.10
PASS  pairing        alvidaa is verified on 50A51HUV / 09.01O.P0813
FAIL  reachability   TV not reachable: no TCP answer on 192.0.2.10:2222 — it may be in deep standby (all ports close, the MAC stays in ARP) or on another network | remedy: check Settings → Network → Network Information for its address
blocked by stock-bundle: no pinned stock bundle at firmware/50a51huv/operationui/apps/launcher/js/app.js (+1 more FAIL)
exit=1
```

A passing run — real output from a fixture shaped like the 50A51HUV deploy
(the pinned stock is gitignored, so the example pins a scratch stand-in):

```
PASS  profile        50A51HUV / 09.01O.P0813, engine hisenseUI, bundle /APPS/channelA/operation-ui/apps/launcher/js/app.js
PASS  stock-bundle   firmware/scratch/stock.js
PASS  stock-hashes   md5 e89e63a8d24e58b5a1d43db8bb4f6b9a, sha256 a0a499b459f5289c0906576e3e6ec367fcc2771dc20bdc47bfd4512cf81078d4
PASS  build          224576 bytes, sha256 fca52261d2d3fb6f25278d38b3f1dc0f4b8c5a3b10354553c80873d64eeed463
PASS  pairing        alvidaa is verified on 50A51HUV / 09.01O.P0813
PASS  reachability   192.168.0.175:2222 answers
PASS  root           uid=0(root) gid=0(root) groups=0(root)
PASS  bundle-path    /APPS/channelA/operation-ui/apps/launcher/js/app.js is 305:305 755
PASS  current-bundle e89e63a8d24e58b5a1d43db8bb4f6b9a — stock
PASS  engine         hisenseUI running (pid 431)
PASS  bridge         answers, MQTT connected
PASS  watcher        watcher disabled
PASS  space          600.0 MB free on /var/local
next: node tools/launcher-host/native-install.cjs install alvidaa --model 50a51huv --host 192.168.0.175
```

Go. The next command is the real one — same variant, model, host, and any
`--port`/`--key`/`--force` the run asked for.

## Notes

- The TV's busybox is trimmed: no `wc`, `tail`, `tr`, `strings`, `readlink`,
  `sha256sum`. `md5sum` runs on the TV (check 9); everything sha256 is
  computed on the host (checks 3–4).
- `scp` does not work on this TV; everything goes over `ssh` — one short
  `exec` per remote check, no sessions left open.
- `ls -ldn` gives numeric owners (the profile's `305:305` has no passwd
  entry); if the TV's busybox drops `-n`, the check falls back to `ls -ld`,
  whose columns line up the same way.
- The watcher check reads the bridge's config at
  `/var/local/alvidaa/config.json`, which is where the launcher lane keeps
  it on both supported models.

## Tests

```
node --test tools/launcher-host/deploy-check.test.cjs
```

Fifteen cases: the healthy TV (every check PASS), the unreachable TV, the
non-root shell, the unknown current bundle, watcher on/off, the missing and
the tampered pinned stock, the `--json` contract, the usage errors, and the
WARN paths (owner drift, missing engine, tight space, unverified pairing).
