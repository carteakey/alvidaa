# Choosing a lane-3 variant

Lane 3 now has three implementations. This is how a user picks one, and why the
picker looks the way it does.

## Why not a picker on the TV

The picker cannot live inside the thing being replaced. Lane 3 swaps the
`/Launcher` component; if a variant renders badly or throws, a picker that lives
in that component is unreachable, and the user is stuck with a broken Home and
no way to choose another.

So the picker sits outside the swapped component:

- **now:** a host-side CLI over the root SSH lane (`native-install.cjs`).
- **later:** the same functions behind a page served by the bridge. That only
  works in lane 2, where the bridge runs on the TV as root. In lane 1 the bridge
  is on another box and has no root on the TV, so the CLI stays the lane there.

Either way the primitive is the same: build a candidate against the pinned stock
bundle, swap it in, restart, verify. A page is a front end, not a second
mechanism.

## Three layers, three files

| Layer | File | What it owns |
| --- | --- | --- |
| **Variant** | `variants.json` | the design: name, author, summary, build script, parts, and the builds it has actually run on |
| **Model** | `models.json` | the build facts: bundle path, state dir, switch script, pinned stock hashes, owner/mode, engine name, supervisor quirk |
| **Primitive** | `switch-home-<model>.sh` | on-TV: hash checks, kill, atomic swap, cache reset, restart, rollback |

A variant is not a fork. It is a list of parts appended after the stock bundle.
The last part before `native-entry.js` is the component that takes effect; the
entry picks it up through `AlvidaaNativeComponent` (ours) or falls back to
`AlvidaaFreeMyTV` (both Free My TV builds). One component per build.

## Using it

```sh
# what is available, and where each one has actually run
node tools/launcher-host/native-install.cjs list

# first time on a TV: pull the stock bundle, verify it against the model
# profile, install the switch script and the stock backup
node tools/launcher-host/native-install.cjs bootstrap --model 50a51huv --host <tv-ip>

# install or switch, in one command. It detects which: stock -> install,
# another variant -> switch. The stock backup is never replaced.
node tools/launcher-host/native-install.cjs install free-my-tv --model 50a51huv --host <tv-ip>
node tools/launcher-host/native-install.cjs install alvidaa     --model 50a51huv --host <tv-ip>

# back to stock, whichever variant is installed. The watcher is handed back
# too, so the canvas launcher works again without a manual cp.
node tools/launcher-host/native-install.cjs rollback --model 50a51huv --host <tv-ip>

# what is on the TV right now
node tools/launcher-host/native-install.cjs status --model 50a51huv --host <tv-ip>
```

## What the installer guarantees

1. **The stock bundle is pinned, not assumed.** Bootstrap pulls `app.js` from
   the TV and checks both md5 and sha256 against the model profile before
   anything is written. Every build states the sha256 it targets.
2. **The stock backup is taken once.** `install` backs up the stock file and the
   original JS caches; `switch` never touches either. Rollback therefore works
   whichever variant is in place, and you can switch variants all day without
   losing the way back.
3. **Compatibility is a gate, not a claim.** A variant is only offered for a
   build it has run on. `--force` overrides that and says why, loudly. This
   matters because the SDK contracts differ per build: Free My TV generic works
   on `09.01O` and would not work on `09.60I`, which needs its own adapter.
4. **Nothing vendor-derived is committed.** Candidates are written under
   `firmware/` (gitignored) and the build scripts refuse any other output path.
5. **One component per build.** The manifest's parts must match the builder's
   `PARTS`, and the entry is always appended last. A test enforces both.
6. **The installer owns the bridge watcher.** A native Home and the watcher
   are exclusive: with the watcher on, the bridge bounces the TV to the canvas
   page within about a second of the VIDAA home appearing, and a working
   install looks like it silently failed. So `install` and `switch` set
   `watcher.enabled = false` in the bridge config
   (`/var/local/alvidaa/config.json`), and `rollback` puts the pre-native
   original back — the canvas launcher works after a rollback without a
   manual `cp`. That original is backed up once, as
   `config.json.bak-native-home`, and no later install ever replaces it;
   rollback restores it byte-for-byte and keeps it, so a second rollback is a
   no-op. The installer refuses to touch a config it cannot parse rather than
   clobbering it, and if a watcher sync fails after the bundle swapped it
   prints exactly what state the TV is in. `status` reports the watcher as
   `on`, `off` or `unknown`. `--no-watcher` skips all of it, loudly, for an
   operator who is deliberately running the canvas launcher; the cost is that
   the bridge will hide the native Home while the watcher is on.

## Adding a variant

1. Write the component, set `root.AlvidaaNativeComponent` (or reuse the
   `AlvidaaFreeMyTV` fallback), and keep it to inline styles: no canvas, no
   iframe, no general web access. Icons may come from local files or the
   vendor's own host; see [NATIVE-ALVIDAA.md](NATIVE-ALVIDAA.md).
2. Add a build script with the uniform signature
   `build(stockFile, output, expect)` and export `PARTS`.
3. Add the entry to `variants.json` with an empty `verified` list.
4. Run it on a real unit, then add that model and firmware to `verified`.
   Until then the installer refuses the pairing.

## Adding a model

1. Pin the stock bundle: path, size, owner, mode, md5, sha256.
2. Copy `switch-home-50a51huv.sh` and change the app path, state dir, owner,
   mode, cache dir and engine name.
3. Run `MODE=dry` first. It restarts stock-only and changes nothing.
4. Add the profile to `models.json` with `local_stock` under `firmware/`.
5. Record the model's SDK contract in the model guide. The contract decides
   which variants are even candidates.

## What this deliberately does not do

- It does not pick a variant for you based on the model. The verified list is a
  gate, not a recommendation; the user chooses.
- It does not update a variant in place. Switching is a full swap, which is
  cheap and keeps the rollback story simple.
- It does not run from the native Home. See the first section.
