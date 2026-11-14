# verify-install — the post-install gate for a lane-3 switch

[deploy-check.cjs](deploy-check.cjs) answers the one question that matters
*before* a deploy: is it safe to run? This one answers the question that
matters *after* a switch:

> Is the thing that is running the thing we just installed?

Until now a lane-3 install ended at "the switch reported OK" plus a human
with a screenshot, and on **2026-11-10** that cost two debugging rounds:

- the bridge watcher bounced a **good** install back to the canvas page
  within a second, so the native Home looked broken;
- the compiled-JS cache served a **stale** bundle after a same-filename
  push, so a working deploy looked like a missing feature.

Both failures are silent, and neither is visible in the switch script's exit
code. The switch script says whether its own steps ran; only the TV can say
whether the deploy actually landed.

```
node tools/launcher-host/verify-install.cjs --model 50a51huv --host <tv-ip> \
  --expect-md5 <candidate md5> [--previous-pid <pid>] [--json]
node tools/launcher-host/verify-install.cjs --model 50a51huv --host <tv-ip> \
  --kind stock [--previous-pid <pid>] [--json]          # the rollback case
node tools/launcher-host/verify-install.cjs --model 50a51huv --fixture <dir> ...
```

`--expect-md5` is the md5 of the bundle you expect on the TV — the md5
[native-install.cjs](native-install.cjs) prints for the built candidate. For
`--kind stock` it defaults to the profile's pinned `stock_md5`.
`--previous-pid` is the engine pid from *before* the switch; without it the
restart comparison is skipped and the check says so.
`--port` (default 2222) and `--key` (default `server/keys/tv_root_ed25519`)
are honoured.

## The one rule

**The checks are claims about the TV. The tool only observes.** No writes, no
restarts, no `kill` — the same rule [deploy-check](DEPLOY-CHECK.md) states,
for the same reason: a gate that can change the thing it is checking is not a
gate. Every remedy it prints names a command owned by
[native-install.cjs](native-install.cjs), the switch script, or the operator.

The single exception is the frame check, which needs a picture: it triggers
the vendor HAL capture through the same lane
[tools/screenshot.sh](../../tools/screenshot.sh) uses. The frame lands in
`/tmp/alvidaa-verify.png` — tmpfs, gone at reboot, zero persistent writes —
and the tool removes that temp file after reading it, best effort. That is
the whole footprint. (The name is distinct from screenshot.sh's so a verify
run never collides with a manual capture.)

## The checks, in order

| # | Check | PASS | WARN | FAIL |
|---|---|---|---|---|
| 1 | `bundle` | on-TV md5 of the profile's `app` path equals `expected.md5` | — | anything else, naming both hashes |
| 2 | `engine` | a live (non-zombie) engine process exists; with `--previous-pid`, it is a **new** pid | — | no live engine, or the pre-switch pid is still the live one |
| 3 | `frame` | a HAL capture comes back, is a PNG, and is not uniform | — | no capture after two attempts, unreadable PNG, or uniform even on retry |
| 4 | `watcher` | off (native) / matching the pre-native backup (rollback) | on when it should be off, unparseable or missing config, missing backup | never — see below |

**bundle.** The switch script's OK means its commands ran, not that the
right bytes are at the profile's `app` path. A same-filename push, a half
run, or a second operator all read as OK. The md5 is compared against what
was *expected*, so the failure text says which side moved: for a candidate,
"the old bundle is still in place"; for a rollback, "the stock bundle is not
in place".

**engine.** A bundle that never got loaded reads as installed, which is the
stale-cache half of 2026-11-10: the switch script resets the compiled-JS
caches during its restart, so a switch that reports OK without restarting
the engine left the old compiled bundle in front. The check scans
`/proc/<pid>/exe` for the profile's engine binary — the same scan
[deploy-check](deploy-check.cjs) runs (`engineScan`), zombies excluded, per
the lane-3 handoff's trap 2 (`pidof` catches transient children). When the
pre-switch pid is passed, the pid **must have changed**: same pid, no new
bundle.

**frame.** The engine being up proves it is running; it does not prove
anything is drawn. The capture is polled on the TV for up to 20 s (the HAL
is asynchronous — 6–8 s and occasionally longer, trap 3 in
[the handoff](../../docs/launcher/NATIVE-DEPLOY-HANDOFF.md)), and a **uniform
frame is retried once before failing**: a black frame while the engine
restarts is expected and proves nothing.

**watcher.** WARN, never FAIL, by design: the watcher being wrong is a
footgun, not a broken install. For a native install it must be `false` —
that is the other half of 2026-11-10. For a rollback it must match the
pre-native value, which is what the once-taken backup
(`config.json.bak-native-home`) holds; no backup means the pre-native state
is unknown and is reported as such, exactly as the watcher CLI does.

## The black-frame heuristic and its limits

No image library is needed. The PNG container is walked by hand, the IDAT is
inflated with `node:zlib` **on the host**, and the decompressed scanlines are
compared: a frame is "uniform" when every scanline (filter byte `0`) carries
the same pixel value as every other. Two fast paths sit on top:

- an IDAT over 4 MB is judged as content without inflating (a uniform frame
  at any resolution this TV outputs compresses to a few KB);
- a non-8-bit or exotic colour layout falls back to the strict all-bytes
  check, which is exact when it passes.

What the heuristic can miss — it is a heuristic:

- **A solid colour of any kind reads as "uniform"**, not just black. That is
  deliberate: a solid grey screen is exactly as undrawn as a black one.
- **Filtered rows defeat the proof.** If the encoder chose a non-zero PNG
  filter for a row, uniformity is no longer provable and the frame is judged
  as *content* — a false PASS is possible for a solid-colour frame encoded
  with adaptive filtering. Standard libpng-based encoders (the HAL's) pick
  filter `0` on uniform rows, so in practice this does not bite.
- **A nearly-black frame with one drawn pixel is "content"** — correct by
  definition ("not uniformly black"), but it will not tell you the picture
  is garbage. The check proves something is drawn; it cannot prove the
  right thing is drawn. Eyes or `tools/screenshot.sh` close that gap.
- PNG CRCs are not verified, and interlaced captures are walked but not
  positionally decoded — fine for uniformity, meaningless for anything else.

## Contract

Library:

```js
verifyAfter({ transport, model, expected, sleep }) ->
  { ok, checks: [{ name, status: 'PASS'|'WARN'|'FAIL', observed, remedy }], verdict }
```

- `transport` — deploy-check's shape: `{ exec(cmd) -> string,
  readFile(path) -> Buffer, connect(port) -> bool }`.
- `model` — a `models.json` profile (`app`, `engine`, `state`, `name`).
- `expected` — `{ md5, kind: 'candidate'|'stock', previousPid? }`.
- `ok` is true iff no check FAILED. WARNs do not block: the watcher is a
  footgun, not a broken install. Every check runs even after an earlier FAIL
  — each is independent evidence, and the bundle being wrong does not make
  the frame less worth seeing.
- `verdict` is one printable line, composed in one place so the text and
  `--json` renderings cannot disagree.

CLI exit codes: `0` verified, `1` not verified, `2` bad usage. `--json`
emits exactly one parseable object (`tool`, `ok`, `exit`, `model`, `host`,
`expected`, `checks`, `verdict`) and nothing else on stdout. The tool is
read-only against the TV (see the one rule), so it is safe to re-run.

## The integration point

The supervisor wires this into [native-install.cjs](native-install.cjs) at
merge time; nothing here edits that file. The call site is **after
`runSwitch(opts, m, mode)` and after the watcher step** — the watcher check
must read the config's final state — in both `install()` and `rollback()`.
Three values flow in:

1. **`expected.md5`** — `install()` already computes it:
   `md5` from the `md5sum` of the built candidate (the same value written to
   `<state>/candidate.md5`). For rollback: `m.stock_md5`, `kind: 'stock'`.
2. **`expected.previousPid`** — captured *before* `runSwitch`, from the same
   scan the check replays:
   `ssh(opts, PATH_PREFIX + engineScan(m.engine))` → first pid. The engine
   scan command comes from `deploy-check.cjs`'s exported `engineScan`.
3. **`transport`** — `require('./deploy-check.cjs').sshRemote(opts)`; the
   install command's `opts` already carries `host`, `port` and `key` in the
   shape `sshRemote` expects.

The call, in full:

```js
const { sshRemote, engineScan } = require('./deploy-check.cjs');
const { verifyAfter } = require('./verify-install.cjs');
const PATH_PREFIX = 'export PATH=/bin:/usr/bin:/sbin:/usr/local/bin; ';

// before runSwitch:
const previousPid =
  ssh(opts, PATH_PREFIX + engineScan(m.engine)).trim().split('\n')[0] || null;

// after runSwitch + the watcher step (skip under --dry-run):
const v = await verifyAfter({
  transport: sshRemote(opts),
  model: m,
  expected: { md5, kind: 'candidate' /* or 'stock' */, previousPid }
});
console.log(v.verdict);
if (!v.ok) process.exitCode = 1;   // do NOT auto-rollback here — see below
```

Policy note for the wiring: a FAILED verification should set the exit code
and tell the operator to run `rollback` — it should not roll back by itself.
The gate is read-only on purpose; an automatic rollback would be a second,
unsupervised write racing the first, and the failure may be the capture lane
lying rather than the TV being broken (the frame check's remedy says when).

## Fixture mode

`--fixture <dir>` reads a directory as if it were the TV's root filesystem,
so the whole command runs with no TV on the network (for a no-TV smoke test,
not for the retry tests — those use scripted transports in the test file):

```
<dir>/APPS/channelA/operation-ui/apps/launcher/js/app.js   the bundle (md5sum is computed for real)
<dir>/proc/<pid>/exe                                       symlink to the engine binary path
<dir>/proc/<pid>/status                                    'State:\tS (sleeping)' — Z is excluded, as live_engine does
<dir>/var/local/alvidaa/config.json                        the bridge config
<dir>/var/local/alvidaa/config.json.bak-native-home        the pre-native backup (optional)
<dir>/tmp/alvidaa-verify.png                               the "capture" (must exist for the frame check to see one)
```

The fixture emulates exactly the busybox invocations the tool issues —
`md5sum`, the `/proc` engine scan, the screenshot trigger, `rm -f` of the
capture — and throws on anything else, so drift between the tool and the
fixture contract fails loudly.

## Known limits

- **PID reuse.** The kernel can hand the new engine the old engine's pid, at
  which point the restart check reads a false FAIL. Rare, momentary, and
  safe in the right direction (it asks a human to look), but it is a false
  FAIL, not a proof.
- **`75u8qtuk` exe matching is unverified on hardware.** Its switch script
  still finds the engine with `pidof`; the exe scan follows
  [deploy-check](deploy-check.cjs)'s convention (basename of the `exe` link
  equals the profile's `engine`). Nothing here has run against that box.
- **Nothing here is verified on hardware.** Every claim about the TV is a
  claim until an owner runs it; the tests prove the logic against fakes.
- The frame check costs one capture (~10 s) per run — the poll is on the TV,
  and two uniform frames cost two captures. Verify once per switch, not in
  a loop.

## Tests

```
node --test tools/launcher-host/verify-install.test.cjs
```

Eighteen tests, `node:test`, no new dependencies: the four checks end to end
against a scripted fake TV (healthy, md5 mismatch, unchanged pid, absent
engine, zombie, black-frame retry, missing capture, watcher warn, rollback
expectations, unreadable bundle/config), input validation, `--json` shape,
and fixture mode. The PNG fixtures are built in the test file — real chunks,
zeroed CRCs, since the analyzer does not verify CRCs by design.
