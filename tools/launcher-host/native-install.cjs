#!/usr/bin/env node
'use strict';
/* Pick a lane-3 native Home variant and put it on a TV.
 *
 *   node native-install.cjs list
 *   node native-install.cjs install <variant> --model <id> --host <ip> [--force] [--no-watcher]
 *       [--no-input-art] [--input-art <file.json>] [--no-device-art]
 *   node native-install.cjs rollback --model <id> --host <ip> [--no-watcher]
 *   node native-install.cjs status   --model <id> --host <ip>
 *   node native-install.cjs doctor   --model <id> --host <ip>   (read-only diagnosis, issue #52)
 *
 * Why a CLI and not a page on the TV: lane 3 replaces the thing a picker would
 * live in. If a variant renders badly, a picker inside the native Home is
 * unreachable. The picker has to sit outside the swapped component, so this is
 * a host-side tool over the root SSH lane. A bridge-served page can drive the
 * same functions later.
 *
 * Safety rules, all enforced here:
 *   - a variant is only offered for a build it has actually run on; --force
 *     overrides that, loudly.
 *   - the stock bundle is pulled from the TV and verified against the model
 *     profile before anything is written.
 *   - the stock backup is taken once, by bootstrap, and is never replaced by a
 *     variant switch. Rollback therefore works whichever variant is installed.
 *   - the installer owns the bridge watcher: install/switch disable it, and
 *     rollback restores the pre-native config, which is backed up once and
 *     never replaced. A native Home and the watcher are exclusive; --no-watcher
 *     skips this, loudly, for an operator who runs the canvas launcher.
 *   - every build states the stock sha256 it targets.
 *   - per-input art is decoration: no config, no inputs section, an unreadable
 *     config or zero usable entries all build without art, and only values the
 *     component's own allowlist accepts are baked (a remote URL is dropped with
 *     a warning naming the input).
 *   - inputs with no configured backdrop get a device-class silhouette from
 *     device-art.cjs keyed by the name the TV reports; --no-device-art skips
 *     that matcher. Owner art always wins; a refused URL is never masked.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { hash, CONFIG } = require('./native-trial.cjs');
const deviceArt = require('./device-art.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const VARIANTS = JSON.parse(fs.readFileSync(path.join(HERE, 'variants.json'), 'utf8'));
const MODELS = JSON.parse(fs.readFileSync(path.join(HERE, 'models.json'), 'utf8'));

function variant(id) {
  const found = VARIANTS.variants.filter(v => v.id === id)[0];
  if (!found) {
    throw new Error('unknown variant: ' + id + ' (try: ' +
      VARIANTS.variants.map(v => v.id).join(', ') + ')');
  }
  return found;
}

function model(id) {
  const found = MODELS.models[id];
  if (!found) {
    throw new Error('unknown model: ' + id + ' (try: ' +
      Object.keys(MODELS.models).join(', ') + ')');
  }
  return found;
}

function verified(v, m) {
  return (v.verified || []).some(entry => entry.model === m.name.split(' / ')[0]);
}

function checkPair(v, m, force) {
  if (verified(v, m)) return;
  const where = (v.verified || []).map(e => e.model + ' / ' + e.firmware).join(', ') || 'nowhere yet';
  const message = v.name + ' has not been verified on ' + m.name + ' (verified on: ' + where + ')';
  if (!force) throw new Error(message + '. Pass --force only if you accept the risk.');
  console.warn('WARNING: ' + message + '. Proceeding because --force was passed.');
}

function sshArgs(opts, command) {
  return ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-p', String(opts.port), '-i', opts.key, 'root@' + opts.host, command];
}

function ssh(opts, command, input) {
  if (opts.dryRun) {
    console.log('[dry-run] ssh ' + opts.host + ' ' + command.split('\n')[0]);
    return '';
  }
  const result = cp.spawnSync('ssh', sshArgs(opts, command), {
    input: input == null ? undefined : input,
    encoding: input == null ? 'utf8' : 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error('ssh failed (' + result.status + '): ' +
      String(result.stderr || '').trim().split('\n').slice(-2).join(' '));
  }
  return input == null ? String(result.stdout) : result.stdout;
}

// opts.ssh and opts.sleep stand in for the SSH lane and the switch poll wait in
// the tests only (the fake emulates the TV's trimmed busybox); every remote
// call in this file goes through them when set.
const sshFn = opts => opts.ssh || ssh;

function upload(opts, local, remote) {
  if (opts.dryRun) {
    console.log('[dry-run] upload ' + local + ' -> ' + remote);
    return;
  }
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/local/bin; cat > ' + remote, fs.readFileSync(local));
}

function bootstrap(opts, m) {
  console.log('bootstrap ' + m.name);
  const localStock = path.join(REPO, m.local_stock);
  fs.mkdirSync(path.dirname(localStock), { recursive: true });
  const stock = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + m.app);
  if (!opts.dryRun) {
    fs.writeFileSync(localStock, stock, { mode: 0o600 });
    const md5 = cp.execFileSync('md5sum', [localStock], { encoding: 'utf8' }).split(/\s/)[0];
    assert.equal(md5, m.stock_md5, 'pulled stock md5 does not match the model profile');
    assert.equal(hash(fs.readFileSync(localStock)), m.stock_sha256,
      'pulled stock sha256 does not match the model profile');
    console.log('  stock verified: ' + md5);
  }
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; mkdir -p ' + m.state + '/backup; chmod 700 ' + m.state);
  upload(opts, path.join(HERE, m.switch), m.state + '/switch-home.sh');
  upload(opts, localStock, m.state + '/backup/app.js.stock');
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; chmod 700 ' + m.state + '/switch-home.sh; ' +
    'chmod 600 ' + m.state + '/backup/app.js.stock');
  console.log('  switch script and stock backup installed');
}

function currentMd5(opts, m) {
  const out = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; md5sum ' + m.app);
  return String(out).split(/\s/)[0];
}

function runSwitch(opts, m, mode) {
  const done = m.state + '/switch.done';
  const log = m.state + '/switch.log';
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; rm -f ' + done + ' ' + log + '; ' +
    '/bin/sh -c \'trap "" HUP; exec /bin/sh ' + m.state + '/switch-home.sh ' + mode + '\' ' +
    '>/dev/null 2>&1 </dev/null & echo started');
  if (opts.dryRun) return;
  const sleep = opts.sleep || (() => cp.execFileSync('sleep', ['2']));
  for (let i = 0; i < 45; i++) {
    sleep();
    let text = '';
    try {
      text = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + done + ' 2>/dev/null');
    } catch (_) { /* not there yet */ }
    if (String(text).trim()) {
      const logText = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + log + ' 2>/dev/null');
      console.log(String(logText).trim());
      if (!/^OK /.test(String(text).trim())) throw new Error('switch failed: ' + String(text).trim());
      return;
    }
  }
  throw new Error('switch did not finish in 90s; SSH is still up, check ' + log);
}

// --- the installer owns the bridge watcher ----------------------------------
//
// A native Home and the bridge watcher are exclusive: with the watcher on, the
// bridge bounces the TV to the canvas page the moment the VIDAA home appears,
// and a perfectly good native install looks like it silently failed. So the
// picker enforces the two coherent setups — install/switch disable the
// watcher, rollback restores whatever the config was before the first native
// install. The decision is pure (applyWatcherConfig); syncWatcher is the only
// part that touches the SSH lane. The JSON work happens on the host (the TV's
// busybox has no jq), and every write lands through a temp file + mv, never a
// truncating redirect on the live file.
const WATCHER_BACKUP = CONFIG + '.bak-native-home';
const WATCHER_TMP = CONFIG + '.tmp-native-home';
// The 2026-11-09 lane-3 session disabled the watcher by hand and left the true
// original here (HANDOFF-2026-11-09-LANE3, "The one thing to know"). On a TV
// that already has it, the LIVE config is already watcher-off — so snapshotting
// the live file would record "off" as the original, and rollback would then
// leave the canvas launcher dead. Seed from the legacy backup when it exists.
const WATCHER_BACKUP_LEGACY = CONFIG + '.bak-nativetest';

// Pure: given config text and a mode, return the text to write, or refuse.
//   disable — text is the live config; the result is the same config with
//             watcher.enabled = false and every other key untouched.
//   restore — text is the backup about to take the live file's place; it is
//             validated and returned byte-for-byte.
// A refusal (invalid JSON, no watcher object) throws and produces no text, so
// the caller cannot write a file it does not understand.
function applyWatcherConfig(text, mode) {
  let config;
  try { config = JSON.parse(text); }
  catch (error) { throw new Error('refusing: config is not valid JSON (' + error.message + '); nothing written'); }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      !config.watcher || typeof config.watcher !== 'object' || Array.isArray(config.watcher)) {
    throw new Error('refusing: config has no usable "watcher" object; nothing written');
  }
  if (mode === 'disable') {
    config.watcher = Object.assign({}, config.watcher, { enabled: false });
    return JSON.stringify(config, null, 2);
  }
  if (mode === 'restore') return String(text);
  throw new Error('unknown watcher mode: ' + mode);
}

// Pure: what status should say about the watcher. Never throws; anything it
// cannot read or understand is "unknown", not a guess.
function watcherState(text) {
  try {
    const config = JSON.parse(text);
    if (config && typeof config === 'object' && !Array.isArray(config) &&
        config.watcher && typeof config.watcher === 'object' && !Array.isArray(config.watcher)) {
      if (config.watcher.enabled === true) return 'on';
      if (config.watcher.enabled === false) return 'off';
    }
  } catch (_) { /* unreadable config */ }
  return 'unknown';
}

// Read and write the watcher config over the SSH lane. mode is "disable" or
// "restore". The backup is copied by the TV itself (cp -p), so it holds the
// original bytes, and only ever if it does not already exist: a second install
// must never replace the original, or rollback restores the wrong thing.
function syncWatcher(opts, m, mode) {
  const P = 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; ';
  const exists = file =>
    String(sshFn(opts)(opts, P + 'test -f ' + file + ' && echo yes || echo no')).trim() === 'yes';
  const read = file => String(sshFn(opts)(opts, P + 'cat ' + file));
  // Replace `file` with `text` atomically: the temp inherits the live file's
  // owner and mode (cp -p), is overwritten, then mv'd into place. A crash
  // leaves the live file intact and a stale temp that the next run replaces.
  const stage = (file, text) => {
    sshFn(opts)(opts, P + 'cp -p ' + file + ' ' + WATCHER_TMP);
    sshFn(opts)(opts, P + 'cat > ' + WATCHER_TMP, Buffer.from(text));
    sshFn(opts)(opts, P + 'mv -f ' + WATCHER_TMP + ' ' + file);
  };
  if (mode === 'disable') {
    if (!exists(CONFIG)) {
      throw new Error('refusing: no bridge config at ' + CONFIG +
        ' — is the bridge deployed on this TV? nothing written');
    }
    const after = applyWatcherConfig(read(CONFIG), 'disable'); // refuses before anything is backed up or written
    if (!exists(WATCHER_BACKUP)) {
      // Prefer the pre-native backup over the live file: the live config may
      // already be watcher-off from a manual session, and restoring that on
      // rollback would be wrong.
      if (exists(WATCHER_BACKUP_LEGACY)) {
        sshFn(opts)(opts, P + 'cp -p ' + WATCHER_BACKUP_LEGACY + ' ' + WATCHER_BACKUP);
        console.log('watcher: original seeded from the pre-native backup ' + WATCHER_BACKUP_LEGACY);
      } else {
        sshFn(opts)(opts, P + 'cp -p ' + CONFIG + ' ' + WATCHER_BACKUP);
      }
    }
    stage(CONFIG, after);
    console.log('watcher: disabled in ' + CONFIG + ' (original preserved at ' + WATCHER_BACKUP + ')');
    return;
  }
  if (mode === 'restore') {
    if (!exists(WATCHER_BACKUP)) {
      console.warn('WARNING: no watcher backup at ' + WATCHER_BACKUP +
        ': the watcher state is unknown, and ' + CONFIG + ' was left untouched.');
      return;
    }
    const original = applyWatcherConfig(read(WATCHER_BACKUP), 'restore'); // refuses to clobber with an unreadable backup
    if (exists(CONFIG)) {
      stage(CONFIG, original);
    } else {
      sshFn(opts)(opts, P + 'cat > ' + WATCHER_TMP, Buffer.from(original));
      sshFn(opts)(opts, P + 'chmod 600 ' + WATCHER_TMP);
      sshFn(opts)(opts, P + 'mv -f ' + WATCHER_TMP + ' ' + CONFIG);
    }
    console.log('watcher: restored ' + CONFIG + ' byte-for-byte from ' + WATCHER_BACKUP +
      ' (backup kept, so a repeat rollback stays harmless)');
    return;
  }
  throw new Error('unknown watcher mode: ' + mode);
}

// The post-switch watcher step, shared by install and rollback. Never runs
// silently: either it acts, or it says exactly why it did not — and when a
// sync fails after the bundle swapped, it says exactly what state the TV is in.
function watcherStep(opts, m, mode, what) {
  if (opts.noWatcher) {
    console.warn('WARNING: --no-watcher: the bridge watcher was left untouched. ' +
      (mode === 'disable'
        ? 'With the watcher on, the bridge will hide this native Home within about a second; ' +
          'pass --no-watcher only if the canvas launcher is what you actually want.'
        : 'The stock Home is back, but the watcher state is whatever it was before the native install.'));
    return;
  }
  if (opts.dryRun) {
    console.log('[dry-run] watcher: would ' + (mode === 'disable' ? 'disable' : 'restore') + ' ' + CONFIG +
      (mode === 'disable' ? ' (first run also preserves it at ' + WATCHER_BACKUP + ')'
        : ' from ' + WATCHER_BACKUP + ', if that backup exists'));
    return;
  }
  // The TV closes SSH connections for a second or two around the engine
  // restart — measured four times on 2026-11-12/13, always right after a
  // switch, always transient. The sync is idempotent (the backup is taken once,
  // the write is atomic), so retrying is safe and turns a scary "the bridge will
  // hide the native Home" into the truth.
  const transient = /Connection closed|Connection reset|closed by remote host|Broken pipe/i;
  let attempt = 0;
  for (;;) {
    try {
      syncWatcher(opts, m, mode);
      return;
    } catch (error) {
      attempt++;
      if (attempt < 3 && transient.test(String(error.message))) {
        console.warn('watcher: connection dropped by the TV during the restart; retrying (' + attempt + '/2)');
        cp.spawnSync('sleep', ['3']);
        continue;
      }
      throw error;
    }
  }
}


// --- per-input art (issue #34) ----------------------------------------------
//
// The candidate's art is baked at build time so the launcher stays offline and
// stays one file. The TV reports the *name* of the device on a port but never
// per-source art, so the only sources are the bridge config's inputs
// (bridge/config.go: bg = backdrop wallpaper, logo = tile image) or a map
// handed in with --input-art. The native component's single art slot is the
// backdrop, so a config entry's bg fills it; logo is tile art and gets no slot
// here — stretching tile art over the whole screen would be guessing, and the
// canvas page already renders logos properly. A logo-only entry therefore
// bakes nothing and is counted, not silently swallowed.
const INPUT_ART_ALLOWED =
  /^(var\/local\/storeAppIcon\/|file:\/\/\/|\/(?!\/)|data:image\/(png|jpeg|webp|svg\+xml);base64,)/i;

// Pure: one art candidate -> the value to bake, or '' when it must be refused.
// The same rule the component's allowedInputArt() enforces: local files
// (storeAppIcon, file://, absolute paths) and inline data URIs only. A remote
// URL would break the offline guarantee.
function cleanInputArt(value) {
  return typeof value === 'string' && INPUT_ART_ALLOWED.test(value.trim()) ?
    value.trim() : '';
}

// Pure: a config `inputs` object -> { map, warnings, filled, baked, skipped }.
// Keys are lowercased here, matching what the bridge (state.go) and the
// component both match against.
// Owner art always wins. Where an input has NO backdrop configured (logo is
// tile art and does not fill this slot), the device-class matcher supplies a
// silhouette keyed by the name the TV reports, so an owner who only names
// their ports still gets art. A configured-but-refused bg is the owner's
// mistake to see: the warning names it and no silhouette masks it.
function inputArtFromInputs(inputs, opts) {
  const fill = !(opts && opts.noDeviceArt);
  const map = {};
  const warnings = [];
  const filled = [];
  let baked = 0, skipped = 0;
  for (const [key, entry] of Object.entries(inputs)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const name = String(key).trim().toLowerCase();
    if (!name) continue;
    const bg = typeof entry.bg === 'string' ? entry.bg.trim() : '';
    const logo = typeof entry.logo === 'string' ? entry.logo.trim() : '';
    if (bg) {
      if (!cleanInputArt(bg)) {
        warnings.push(name);
        skipped++;
        continue;
      }
      map[name] = bg;
      baked++;
      continue;
    }
    // No backdrop configured — logo is tile art and does not fill this slot.
    // The gap the silhouettes exist for (issue #60): an entry that only
    // names its port still gets art.
    if (fill) {
      const art = deviceArt.artForName(entry.name || key);
      if (art) {
        map[name] = deviceArt.dataUriFor(entry.name || key);
        filled.push({ name, icon: art.icon });
        continue;
      }
    }
    skipped++;
  }
  return { map, warnings, filled, baked, skipped };
}

// Pure: bridge config text -> { map, note, warnings }. Never throws: art is
// decoration, and no config / no inputs / unreadable / zero entries all mean
// "build without art" — the note says which of those happened, in one line.
function inputArtFromConfigText(text, opts) {
  if (typeof text !== 'string' || !text.trim()) {
    return { map: null, note: 'no bridge config on the TV; building without input art' };
  }
  let config;
  try { config = JSON.parse(text); }
  catch (error) {
    return { map: null, note: 'config is not valid JSON (' + error.message + '); building without input art' };
  }
  const inputs = config && typeof config === 'object' && !Array.isArray(config) ?
    config.inputs : null;
  if (!inputs || typeof inputs !== 'object' || Array.isArray(inputs)) {
    return { map: null, note: 'config has no inputs section; building without input art' };
  }
  const art = inputArtFromInputs(inputs, opts);
  const total = art.baked + art.filled.length;
  if (total === 0) {
    return {
      map: null,
      note: 'config inputs carry no usable backdrop art (' +
        [art.baked + ' from config',
          art.filled.length + ' silhouettes' +
            ((opts && opts.noDeviceArt) ? ' (--no-device-art)' : ''),
          art.skipped + ' left empty'].join(', ') +
        '); building without input art',
      warnings: art.warnings
    };
  }
  const parts = [];
  if (art.baked) parts.push(art.baked + ' from config');
  if (art.filled.length) {
    parts.push(art.filled.length + (art.filled.length === 1 ? ' silhouette: ' : ' silhouettes: ') +
      art.filled.map(f => f.name + '=' + f.icon).join(', '));
  }
  if (art.skipped) parts.push(art.skipped + ' left empty' +
    ((opts && opts.noDeviceArt) ? ' (--no-device-art)' : ''));
  return {
    map: art.map,
    note: 'input art: ' + parts.join(', '),
    warnings: art.warnings
  };
}

// Pure: the text of an --input-art file -> { map, note, warnings }. Accepts a
// plain { key: art } map, or a saved bridge config whose `inputs` section
// carries the bg/logo roles. Remote URLs are dropped with a named warning,
// exactly like the TV path.
function inputArtFromFileText(text, opts) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) {
    return { map: null, note: 'the input-art file is not valid JSON (' + error.message + '); building without input art' };
  }
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) &&
      parsed.inputs && typeof parsed.inputs === 'object' && !Array.isArray(parsed.inputs)) {
    return inputArtFromConfigText(text, opts);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { map: null, note: 'the input-art file is not a JSON object; building without input art' };
  }
  // A plain map's values ARE the backdrop art; only the allowlist applies.
  const map = {};
  const warnings = [];
  for (const [key, value] of Object.entries(parsed)) {
    const name = String(key).trim().toLowerCase();
    if (!name || typeof value !== 'string' || !value.trim()) continue;
    const art = cleanInputArt(value);
    if (!art) { warnings.push(name); continue; }
    map[name] = art;
  }
  if (Object.keys(map).length === 0) {
    return {
      map: null,
      note: 'the input-art file carries no usable art' +
        (warnings.length ? ' (' + warnings.length + ' remote URL(s) dropped)' : '') +
        '; building without input art',
      warnings
    };
  }
  return {
    map,
    note: 'input art: baked backdrop art for ' + Object.keys(map).length + ' input(s): ' +
      Object.keys(map).join(', '),
    warnings
  };
}

// Where the art comes from: --no-input-art skips it, --input-art <file.json>
// reads a local map (for when the TV is unreachable), else the TV's bridge
// config over SSH. In dry-run nothing is read from the TV; a local file is
// read so the line can say exactly what would be baked. Never fails.
function readInputArt(opts) {
  if (opts.noInputArt) {
    return { map: null, note: '--no-input-art: building without input art' };
  }
  if (opts.inputArtFile) {
    let text;
    try { text = fs.readFileSync(opts.inputArtFile, 'utf8'); }
    catch (error) {
      return { map: null, note: '--input-art file unreadable (' + error.message + '); building without input art' };
    }
    const art = inputArtFromFileText(text, opts);
    if (opts.dryRun && art.map) {
      art.note = '[dry-run] would bake ' + art.note.replace(/^input art: /, '');
    } else if (opts.dryRun) {
      art.note = '[dry-run] ' + art.note;
    }
    return art;
  }
  if (opts.dryRun) {
    return {
      map: null,
      note: '[dry-run] input art: would read ' + CONFIG + ' from the TV, bake the inputs\' backdrop art' +
        ' and fill unconfigured inputs with class silhouettes' +
        (opts.noDeviceArt ? ' (--no-device-art: silhouettes skipped)' : '') +
        ' (--input-art <file.json> previews a local map instead)'
    };
  }
  try {
    return inputArtFromConfigText(String(sshFn(opts)(opts,
      'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + CONFIG)), opts);
  } catch (error) {
    return { map: null, note: 'could not read the TV config (' +
      String(error.message).split('\n')[0] + '); building without input art' };
  }
}

// --- per-app tint (issue #56) ------------------------------------------------
//
// The extractor (app-colours.cjs) turns allowlisted PNG icons into a
// luminance-capped dominant-colour map on the host; its JSON output rides
// --app-colours into the build, baked as self.AlvidaaNativeAppColours. Like
// input art this is decoration: a missing file, bad JSON or unusable entries
// warn and build without colours, never fail the build. Keys are icon
// basenames (what the component resolves from the icon value the TV
// reports); only #rrggbb values are accepted.

const APP_COLOURS_MAX = 64;

// Pure: the text of an --app-colours file -> { map, warnings }. Warnings name
// the keys that were dropped, so a typo is visible instead of a mystery.
function cleanAppColours(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (error) {
    return { map: null, warnings: [], error: 'not valid JSON (' + error.message + ')' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { map: null, warnings: [], error: 'not a JSON object' };
  }
  const map = {};
  const warnings = [];
  for (const [key, value] of Object.entries(parsed)) {
    const name = String(key);
    if (Object.keys(map).length >= APP_COLOURS_MAX) {
      warnings.push(name + ' (over the ' + APP_COLOURS_MAX + '-entry cap)');
      continue;
    }
    if (!name || name.length > 128 || name.includes('/') || name.includes('\\')) {
      warnings.push(name + ' (key must be an icon basename)');
      continue;
    }
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      warnings.push(name + ' (value must be #rrggbb)');
      continue;
    }
    map[name] = value.toLowerCase();
  }
  return { map, warnings, error: null };
}

function readAppColours(opts) {
  if (!opts.appColoursFile) return { map: null, warnings: [], note: null };
  let text;
  try { text = fs.readFileSync(opts.appColoursFile, 'utf8'); }
  catch (error) {
    return { map: null, warnings: [], note: '--app-colours file unreadable (' +
      error.message + '); building without app colours' };
  }
  const cleaned = cleanAppColours(text);
  if (cleaned.error) {
    return { map: null, warnings: cleaned.warnings, note: '--app-colours: ' +
      cleaned.error + '; building without app colours' };
  }
  const count = Object.keys(cleaned.map).length;
  return {
    map: count ? cleaned.map : null,
    warnings: cleaned.warnings,
    note: count ? 'app colours: baked ' + count + ' icon tint(s)' : null
  };
}

// --- the safety net the two new modules provide -----------------------------
//
// recovery-record captures what the TV looked like before we touched it, and
// verify-install proves afterwards that the thing now running is the thing we
// installed. Both are side concerns: a failure to record is loud but never
// blocks an install, and a failed verification reports the TV's real state
// rather than pretending the switch did not happen.

// Every path this installer is about to write is checked against the checked-in
// refusal list first. A match is a refusal, not a warning (issue #53).
function assertTouchesAllowed(m) {
  const { assertSafe } = require('./never-touch.cjs');
  for (const target of [m.app, m.state, m.state + '/backup', m.state + '/candidate-native-home.js']) {
    assertSafe(target);
  }
}

function recordBefore(opts, m, what) {
  if (opts.dryRun || opts.noRecord) return null;
  try {
    const rr = require('./recovery-record.cjs');
    const rec = rr.record({ transport: rr.sshTransport(opts), model: opts.model });
    console.log('recovery record: ' + (rec && rec.key ? rec.key : 'written') +
      ' (pre-' + what + ' state captured)');
    return rec;
  } catch (error) {
    console.warn('WARNING: could not write the host-side recovery record: ' + error.message +
      '\n  The TV-side backup is unaffected; this only costs the second copy.');
    return null;
  }
}

function previousEnginePid(opts, m) {
  if (opts.dryRun) return undefined;
  try {
    const { engineScan } = require('./deploy-check.cjs');
    const out = String(sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; ' + engineScan(m.engine))).trim();
    return out ? Number(out.split(/\s+/)[0]) : undefined;
  } catch (_) { return undefined; }
}

async function verifyStep(opts, m, expected, what) {
  if (opts.dryRun || opts.noVerify) return;
  try {
    const { verifyAfter } = require('./verify-install.cjs');
    const { sshRemote } = require('./deploy-check.cjs');
    const result = await verifyAfter({ transport: sshRemote(opts), model: m, expected });
    for (const check of result.checks || []) {
      console.log('  ' + String(check.status).padEnd(4) + '  ' + check.name +
        (check.observed ? '  ' + check.observed : ''));
    }
    console.log('verify: ' + (result.verdict || (result.ok ? 'ok' : 'failed')));
    if (!result.ok) {
      throw new Error('the ' + what + ' bundle IS in place (the switch reported OK), but verification failed:\n' +
        '  ' + (result.verdict || 'see the checks above') + '\n' +
        'TV state: the switch completed; the checks above say what is actually running.\n' +
        'Run rollback if the native Home is not what you want on screen.');
    }
  } catch (error) {
    if (/IS in place/.test(error.message)) throw error;
    console.warn('WARNING: could not verify the install: ' + error.message);
  }
}

function install(id, opts) {
  const v = variant(id);
  const m = model(opts.model);
  checkPair(v, m, opts.force);

  // Art is decoration: read it first, say what happened in one line, and
  // never let it fail the build.
  const art = readInputArt(opts);
  if (art.note) console.log(art.note);
  for (const name of art.warnings || []) {
    console.warn('WARNING: input art for "' + name + '" is a remote URL — dropped; ' +
      'the launcher must stay offline (use a local file or an inline data URI)');
  }
  // App colours are decoration on the same terms (issue #56).
  const appColours = readAppColours(opts);
  if (appColours.note) console.log(appColours.note);
  for (const warning of appColours.warnings || []) {
    console.warn('WARNING: app colour entry "' + warning + '" dropped; ' +
      'keys must be icon basenames and values #rrggbb');
  }

  // opts.builder stands in for the variant's real build module in the tests
  // only; a real run requires it, and a real build verifies the pinned stock
  // sha256 before anything is uploaded.
  const builder = opts.builder || require(path.join(HERE, v.build));
  const localStock = path.join(REPO, m.local_stock);
  assert.ok(fs.existsSync(localStock),
    'no pinned stock bundle at ' + m.local_stock + '; run bootstrap first');
  const out = path.join(REPO, 'firmware', opts.model, 'candidate-' + v.id + '.js');
  // The silhouettes ship as rules + icons so the dock has art even when the
  // config names no inputs — which is the normal case, and the reason the first
  // deploy of #60 baked none (2026-11-10).
  const deviceArt = opts.noDeviceArt ? null : require('./device-art.cjs').bundle();
  const buildOptions = {};
  if (art.map && Object.keys(art.map).length) buildOptions.inputArt = art.map;
  if (deviceArt) buildOptions.deviceArt = deviceArt;
  if (appColours.map && Object.keys(appColours.map).length) buildOptions.appColours = appColours.map;
  const candidate = builder.build(localStock, out, m.stock_sha256,
    Object.keys(buildOptions).length ? buildOptions : undefined);
  if (deviceArt) {
    console.log('device art: ' + Object.keys(deviceArt.icons).length + ' silhouettes, ' +
      deviceArt.rules.length + ' name rules');
  }
  console.log('built ' + v.name + ': ' + Buffer.byteLength(candidate) + ' bytes, sha256 ' + hash(candidate));

  // Before the first byte lands on the TV: refuse a forbidden path, then capture
  // the pristine state.
  assertTouchesAllowed(m);
  recordBefore(opts, m, 'install');

  if (!opts.dryRun) {
    const probe = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; test -f ' + m.state + '/switch-home.sh && echo yes || echo no');
    if (String(probe).trim() !== 'yes') bootstrap(opts, m);
  }

  upload(opts, out, m.state + '/candidate-native-home.js');
  const md5 = opts.dryRun ? '<dry-run>' :
    cp.execFileSync('md5sum', [out], { encoding: 'utf8' }).split(/\s/)[0];
  sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; printf "%s\\n" "' + md5 + '" > ' +
    m.state + '/candidate.md5; chmod 600 ' + m.state + '/candidate-native-home.js');

  // install when the bundle is stock, switch when another variant is in place.
  const mode = opts.dryRun ? 'install' : (currentMd5(opts, m) === m.stock_md5 ? 'install' : 'switch');
  console.log('mode: ' + mode);
  const previousPid = previousEnginePid(opts, m);
  runSwitch(opts, m, mode);
  if (!opts.dryRun) console.log(v.name + ' is installed on ' + m.name);
  watcherStep(opts, m, 'disable', v.name);
  return verifyStep(opts, m, { md5, kind: 'candidate', previousPid }, v.name);
}

function rollback(opts) {
  const m = model(opts.model);
  assertTouchesAllowed(m);
  const previousPid = previousEnginePid(opts, m);
  runSwitch(opts, m, 'rollback');
  console.log('stock restored on ' + m.name);
  watcherStep(opts, m, 'restore', 'stock');
  return verifyStep(opts, m, { md5: m.stock_md5, kind: 'stock', previousPid }, 'stock');
}

// Read-only: what the live config says about the watcher. Anything missing or
// unreadable is "unknown".
function watcherStatus(opts, m) {
  const P = 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; ';
  if (String(sshFn(opts)(opts, P + 'test -f ' + CONFIG + ' && echo yes || echo no')).trim() !== 'yes') {
    return 'unknown';
  }
  return watcherState(String(sshFn(opts)(opts, P + 'cat ' + CONFIG)));
}

function status(opts) {
  const m = model(opts.model);
  const out = sshFn(opts)(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; /bin/sh ' + m.state + '/switch-home.sh status');
  console.log(String(out).trim());
  if (opts.noWatcher) {
    console.log('watcher: skipped (--no-watcher)');
    return;
  }
  console.log('watcher: ' + watcherStatus(opts, m));
  if (opts.noDrift) return;
  // "What came back": compare live state against the recovery record. Read-only,
  // and it never changes the exit code of status — it reports, the operator
  // decides.
  try {
    const { runDriftCheck } = require('./drift-check.cjs');
    // runDriftCheck prints its own lines (drift-check.cjs:223); only the verdict
    // needs adding here.
    const result = runDriftCheck({ model: opts.model, host: opts.host, port: opts.port, key: opts.key });
    console.log('drift: ' + (result.verdict || (result.ok ? 'none' : 'see above')));
  } catch (error) {
    console.warn('drift check unavailable: ' + error.message);
  }
}

// doctor — the five failures every owner hits, diagnosed read-only (issue
// #52). The analysis lives in doctor.cjs; this is the subcommand shell: flags
// through, exit code back. doctor's exit contract (0 when it has an answer,
// even "the TV is asleep"; 2 on usage) cannot ride this module's require.main
// catch, which exits 1 for every throw — so the code is returned and the
// caller decides.
function doctorCommand(opts, deps = {}) {
  const doctor = require('./doctor.cjs');
  // doctor.parse slices past node and the script name — no 'doctor' token
  // here, or it would arrive as an unknown flag.
  const argv = ['node', 'doctor.cjs'];
  if (opts.help) argv.push('--help');
  if (opts.model) argv.push('--model', opts.model);
  if (opts.host) argv.push('--host', opts.host);
  if (opts.port) argv.push('--port', String(opts.port));
  if (opts.key) argv.push('--key', opts.key);
  try {
    return doctor.main(argv, deps);
  } catch (error) {
    if (!error.usage) throw error;
    console.error('usage: ' + error.message);
    console.error('       (see: node tools/launcher-host/native-install.cjs doctor --help)');
    return doctor.EXIT.USAGE;
  }
}

function list() {
  console.log('variants');
  for (const v of VARIANTS.variants) {
    console.log('  ' + v.id.padEnd(24) + v.name + '  (' + v.author + ')');
    console.log('    ' + v.summary);
    console.log('    verified: ' + ((v.verified || []).map(e => e.model + ' / ' + e.firmware).join(', ') || 'nowhere yet'));
  }
  console.log('\nmodels');
  for (const [id, m] of Object.entries(MODELS.models)) {
    console.log('  ' + id.padEnd(12) + m.name + '  engine ' + m.engine);
  }
  console.log('\ninstall: node tools/launcher-host/native-install.cjs install <variant> --model <id> --host <tv-ip>');
}

function parse(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  const positional = [];
  const opts = { port: 2222, key: path.join(REPO, 'server/keys/tv_root_ed25519'), dryRun: false, force: false,
    noWatcher: false, noInputArt: false, inputArtFile: null, noDeviceArt: false,
    appColoursFile: null,
    noRecord: false, noVerify: false, noDrift: false, help: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model') opts.model = args[++i];
    else if (arg === '--host') opts.host = args[++i];
    else if (arg === '--key') opts.key = args[++i];
    else if (arg === '--port') opts.port = Number(args[++i]);
    else if (arg === '--force') opts.force = true;
    else if (arg === '--no-watcher') opts.noWatcher = true;
    else if (arg === '--no-input-art') opts.noInputArt = true;
    else if (arg === '--no-device-art') opts.noDeviceArt = true;
    else if (arg === '--no-record') opts.noRecord = true;
    else if (arg === '--no-verify') opts.noVerify = true;
    else if (arg === '--no-drift') opts.noDrift = true;
    else if (arg === '--input-art') opts.inputArtFile = args[++i];
    else if (arg === '--app-colours') opts.appColoursFile = args[++i];
    else if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--help') opts.help = true;
    else positional.push(arg);
  }
  return { command, positional, opts };
}

function main(argv, deps = {}) {
  const { command, positional, opts } = parse(argv);
  if (command === 'list' || !command) return list();
  if (command === 'install') {
    assert.ok(positional[0], 'usage: install <variant> --model <id> --host <ip>');
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return install(positional[0], opts);
  }
  if (command === 'rollback') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return rollback(opts);
  }
  if (command === 'status') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return status(opts);
  }
  if (command === 'bootstrap') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return bootstrap(opts, model(opts.model));
  }
  // doctor carries its own exit contract (0 with an answer, 2 on usage), so
  // it validates its own flags and returns the code instead of asserting.
  if (command === 'doctor') return doctorCommand(opts, deps);
  throw new Error('unknown command: ' + command);
}

if (require.main === module) {
  // install() and rollback() now end in an async verification step, so the
  // entry point has to await the result rather than only catching throws.
  // doctor returns an exit code (0/2); the other commands return nothing.
  Promise.resolve()
    .then(() => main(process.argv))
    .then(code => { if (Number.isInteger(code)) process.exit(code); })
    .catch(error => { console.error('error: ' + error.message); process.exit(1); });
}

module.exports = { VARIANTS, MODELS, variant, model, verified, checkPair, parse, main, install, rollback, status, bootstrap, doctorCommand,
  applyWatcherConfig, watcherState, watcherStatus, syncWatcher, WATCHER_BACKUP, WATCHER_BACKUP_LEGACY,
  cleanInputArt, inputArtFromInputs, inputArtFromConfigText, inputArtFromFileText, readInputArt, INPUT_ART_ALLOWED,
  cleanAppColours, readAppColours, APP_COLOURS_MAX };
