# fake-tv — a scripted TV for the switch protocol (issue #59)

`fake-tv.cjs` is a host-side test double that implements the file protocol
[switch-home-50a51huv.sh](switch-home-50a51huv.sh) and
[native-install.cjs](native-install.cjs) speak over the root SSH lane — with
the failure modes that cost real time on hardware. `native-install.cjs` runs
against it unmodified; that acceptance run is the point, not unit tests of the
fake.

The command-string-map fake in `native-install.test.cjs` asserts the commands
we mean to send and then pretends they succeeded. It cannot see the failures
that are protocol-shaped: a switch that reports OK but left the old bundle, an
engine that never comes back, a JS cache that survived the swap, a dropbear
that resets mid-run. CleanMyTV tests against `fake-adbd` for the same reason.
(`deploy-check.cjs` already has a fixture mode — `fixtureRemote`, see
[DEPLOY-CHECK.md](DEPLOY-CHECK.md) — but it is a read-only preflight fixture:
it answers the checks' questions and never runs the switch.)

## Shape

```js
const { createFakeTv } = require('./fake-tv.cjs');

const tv = createFakeTv({
  engine: 'hisenseUI',          // the binary the scan matches on (/proc/<pid>/exe tail)
  state: '/var/local/alvidaa/native-home',
  app: '/APPS/channelA/operation-ui/apps/launcher/js/app.js',
  stockMd5: '2f1758…',          // what md5sum reports while stock is installed
  candidateMd5: '<md5 of the bytes you will upload>',   // optional, see below
  flags: { homeStuck: true },   // optional initial flags
});
// -> { ssh(opts, command, input), files, dirs, procs, calls, flags, reset(),
//      engine, state, app, cache, config, candidatePath, stockMd5, candidateMd5 }

install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv',
  builder, noRecord: true, noVerify: true });
```

`tv.ssh(opts, command, input)` has the exact signature the installer injects
through `opts.ssh`. `files` maps path → `{ content: Buffer, md5, mode }`;
`procs` is the process table (`pid → { exe, state, ppid }`), which tests seed
to build scan scenarios (zombies, bystanders); `calls` records every command
in order, which is how the reset test finds the call to drop.

### The seeded TV

A fresh fake is a **bootstrapped, mid-life TV**: stock `app.js` in place
(reported as `stockMd5`), `state/switch-home.sh` and
`state/backup/app.js.stock` installed, the engine running (pid 4242, exe
`/opt/<engine>/bin/<engine>`) with a stock-era compiled-JS cache, and a bridge
config with the watcher on. `switch.done`, `switch.log`, `phase` and
`candidate.md5` do not exist yet. `reset()` returns to exactly this state and
clears runtime flags and the call log.

Bootstrap itself is out of scope: the installer verifies the pulled stock
bytes against the pinned md5 **on the host**, and the real pinned bytes are
vendor code that never enters the repo. Seeding the post-bootstrap state is
also the realistic starting point — a re-run install.

### The md5 contract

`md5sum` reports a real md5 of the stored bytes, with two named exceptions —
the only lies the fake tells, both given at construction:

- the **stock stand-in** bytes report `stockMd5` (a content alias, so the
  backup pulled from `app` and restored by rollback reports it too);
- whatever is uploaded to `state/candidate-native-home.js` reports
  `candidateMd5`, because that is the value the installer writes to
  `candidate.md5` and the switch gate compares against — pass the host md5 of
  the bytes your stub builder produces.

md5 travels with the bytes through `cp -p` and `mv`, so after a switch `app.js`
reports the candidate md5, and after a rollback it reports `stockMd5` — which
is how the installer picks `install` vs `switch` mode on a re-run.

### Protocol coverage

Known commands, all busybox-shaped: `md5sum`, `cat` (including `cat >` uploads
and `cat x 2>/dev/null` — still a non-zero exit when x is missing, which the
poll loop counts on), `cp -p`, `mv -f`, `chmod`, `mkdir -p`, `test -f … &&
echo yes || echo no`, `printf "%s\n" … > file`, `grep` (`-q` answers through
the exit code), the composite forms bootstrap and the candidate step issue,
and the engine-scan one-liner from `deploy-check.cjs` (`engineScan`,
consumed by `previousEnginePid`) with `/proc/<pid>/exe` matching and zombie
exclusion.

Everything else **throws `fake TV: unhandled command: …`**. A silent fake
hides exactly the bugs it exists to catch: a new remote command must be taught
here before it can be tested.

The detached-switch command runs a native re-implementation of the switch
script's state machine — same gates per mode (`dry`, `install`, `switch`,
`rollback`, unknown), env capture, engine stop, the candidate swap with owner
mode recorded, the cache rules (install moves `compiled_js`/`uncompiled_js`
into the backup and recreates them empty; switch clears them; rollback
restores them from the backup), `phase`, the `switch.log` lines, and the
`OK mode=… new=…` / `FAIL …` verdict in `switch.done`. The uploaded script's
bytes are stored, never interpreted: the state machine here **is** the
protocol under test, and a drift between it and the real script shows up as a
failed acceptance run.

## Failure flags

Set on `tv.flags` (or at construction). Each reproduces a failure that
actually happened or is one plausible SSH/session away; the third column is
what catches it on a real TV.

| Flag | What the fake does | Real failure it reproduces; what catches it |
| --- | --- | --- |
| `homeStuck` | every gate passes, the switch writes `OK`, the engine restarts — and the bundle and cache are never touched | the switch that says OK but leaves the old bundle on screen (2026-11-10 cost a round trip). Silent by design: `status` still reports stock, and `verify-install`/`deploy-check` are what unmask it on hardware |
| `crashing` | the engine never returns; secure_exec fails too; verdict `FAIL engine did not start; SSH stays up, retry launch manually` | the engine that never came back. `runSwitch` throws and the install aborts — with the candidate already on disk, the engine down and the watcher untouched, which is the real TV's state at that moment |
| `staleCache` | the bundle swaps, but the cache dirs are neither backed up nor cleared | the stale-JS-cache trap (the 55A7KAU lesson): new bundle, old UI. The switch reports OK; only a cache-aware check or eyes on the screen see it |
| `resetAfter` (number) | the Nth ssh call of the session throws the transient lane failure dropbear produces (`Connection closed …`) | the dropbear resets under a burst of sequential calls (three on 2026-11-12 alone). Inside `runSwitch`'s poll loop the installer retries by design and completes; anywhere else the install dies, like on the real TV |

## Scope boundaries

- **No TV, no network, no subprocesses.** The fake is pure host-side state.
- **No bootstrap path**: the host-side md5 gate in `bootstrap()` needs the
  real pinned bytes; the fake seeds the already-bootstrapped state instead.
- **No recovery-record / verify-install**: both run on host-side transports of
  their own (`recovery-record.sshTransport`, `deploy-check.sshRemote` spawn
  real ssh), so the acceptance runs pass the installer's own `--no-record` /
  `--no-verify`. Their logic has its own tests and fixtures.
- **No owner model beyond the mode bits** the protocol touches (`305:305`
  etc. are a deploy-check concern, covered by its fixture).

## Usage

```sh
node --test tools/launcher-host/fake-tv.test.cjs
```

Covers: the loud-refusal contract (unknown command, missing file), the engine
scan (binary match, zombie exclusion), the clean install acceptance run end to
end (bundle bytes and md5, cache move, phase, done/log contract, watcher
disable with a one-time backup, `status` view), the re-run switch and the
rollback (stock bundle, cache restore, watcher restore byte-for-byte), each
failure flag producing the TV state its real failure leaves, the lane retry
(plus its boundary: a reset outside the poll is fatal), the candidate-md5
gate refusing a wrong hash, and `reset()` restoring a coherent, installable
TV.
