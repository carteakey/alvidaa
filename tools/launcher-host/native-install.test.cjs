'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hash, CONFIG } = require('./native-trial.cjs');
const { VARIANTS, MODELS, variant, model, verified, checkPair, parse, main,
  install, rollback, status, syncWatcher,
  applyWatcherConfig, watcherState, WATCHER_BACKUP, WATCHER_BACKUP_LEGACY,
  cleanInputArt, inputArtFromConfigText, inputArtFromFileText,
  cleanAppColours, APP_COLOURS_MAX } = require('./native-install.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');

test('every variant names real parts, a real builder, and one effective component', () => {
  for (const v of VARIANTS.variants) {
    assert.ok(fs.existsSync(path.join(HERE, v.build)), v.id + ': missing build script');
    const builder = require(path.join(HERE, v.build));
    assert.equal(typeof builder.build, 'function', v.id + ': build is not exported');
    assert.deepEqual(builder.PARTS, v.parts, v.id + ': manifest parts drifted from the builder');
    for (const part of v.parts) {
      assert.ok(fs.existsSync(path.join(HERE, part)), v.id + ': missing part ' + part);
    }
    assert.equal(v.parts[v.parts.length - 1], 'native-entry.js',
      v.id + ': the entry must be appended last');
    const components = v.parts.filter(p => !/^native-platform/.test(p) && p !== 'native-entry.js');
    assert.ok(components.length >= 1, v.id + ': no component part');
    const effective = components[components.length - 1];
    const source = fs.readFileSync(path.join(HERE, effective), 'utf8');
    assert.match(source, /root\.Alvidaa[A-Za-z]+\s*=/, v.id + ': ' + effective + ' exports no global');
    assert.ok(v.summary && v.author && v.name, v.id + ': incomplete metadata');
  }
});

test('every model profile points at a real switch script and a private stock path', () => {
  for (const [id, m] of Object.entries(MODELS.models)) {
    assert.ok(fs.existsSync(path.join(HERE, m.switch)), id + ': missing switch script');
    assert.match(m.stock_md5, /^[0-9a-f]{32}$/, id + ': bad md5');
    assert.match(m.stock_sha256, /^[0-9a-f]{64}$/, id + ': bad sha256');
    assert.ok(m.local_stock.startsWith('firmware/'), id + ': stock copy must stay private');
    assert.ok(m.app.startsWith('/APPS/'), id + ': app path must be the writable module');
    assert.ok(m.state.startsWith('/var/local/'), id + ': state must live on /var/local');
    assert.equal(typeof m.engine, 'string');
  }
});

test('verification is per model, not per variant', () => {
  const fmtv = variant('free-my-tv');
  assert.equal(verified(fmtv, model('50a51huv')), true);
  assert.equal(verified(fmtv, model('75u8qtuk')), false);
  const ours = variant('alvidaa');
  assert.equal(verified(ours, model('50a51huv')), true);
  assert.equal(verified(ours, model('75u8qtuk')), false);
  const port = variant('free-my-tv-75u8qtuk');
  assert.equal(verified(port, model('75u8qtuk')), true);
  assert.equal(verified(port, model('50a51huv')), false);
});

test('an unverified pairing is refused unless forced, and says why', () => {
  const port = variant('free-my-tv-75u8qtuk');
  const reference = model('50a51huv');
  assert.throws(() => checkPair(port, reference, false), /has not been verified on 50A51HUV/);
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(message);
  try { checkPair(port, reference, true); } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /--force/);
  assert.doesNotThrow(() => checkPair(variant('alvidaa'), reference, false));
});

test('each builder assembles its variant against a pinned stock and parses', () => {
  const dir = fs.mkdtempSync('/tmp/alvidaa-variants-');
  const stockFile = path.join(dir, 'stock.js');
  const stock = '/* private vendor bundle */\nself._V_M_={launcher:function(){return {route:[{path:"/Launcher",component:{}}]}}};\n';
  fs.writeFileSync(stockFile, stock);
  const digest = hash(Buffer.from(stock));
  function fixtureAssets(dir){
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'f.txt'),'install asset\n');
    fs.writeFileSync(path.join(dir,'fonts.css'),'@font-face{font-family:FMTVWeb16;src:url(f16.ttf)}\n');
    fs.writeFileSync(path.join(dir,'assets.json'),JSON.stringify({
      files:{'f.txt':hash(fs.readFileSync(path.join(dir,'f.txt')))},colors:['ffffff'],symbols:[]
    }));
    return dir;
  }
  for (const v of VARIANTS.variants) {
    const builder = require(path.join(HERE, v.build));
    const out = path.join(dir, v.id + '.js');
    // Native builders take (stockFile, output, expect) and return the candidate
    // string; web builders stage an asset directory first and return an object:
    // (stockFile, assetsDirectory, output, {expectedSha256}). Arity is not a
    // reliable signal (some native builders take an options tail), so the web
    // builders are told apart by their exported ASSET_BASE.
    const web = typeof builder.ASSET_BASE === 'string';
    const assets = web ? fixtureAssets(path.join(dir, 'assets-' + v.id)) : null;
    const result = web
      ? builder.build(stockFile, assets, out, { expectedSha256: digest })
      : builder.build(stockFile, out, digest);
    const candidate = typeof result === 'string' ? result : result.candidate;
    assert.ok(candidate.includes(stock), v.id + ': stock bundle missing');
    for (const part of v.parts) {
      assert.ok(candidate.includes(fs.readFileSync(path.join(HERE, part), 'utf8')),
        v.id + ': ' + part + ' missing from the candidate');
    }
    assert.doesNotThrow(() => new vm.Script(candidate), v.id + ': candidate does not parse');
    assert.ok(fs.existsSync(out), v.id + ': output not written');
    assert.throws(() => web
      ? builder.build(stockFile, assets, path.join(HERE, 'x.js'), { expectedSha256: digest })
      : builder.build(stockFile, path.join(HERE, 'x.js'), digest),
      /must stay private/, v.id + ': private-output guard missing');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the command line parses flags and rejects unknown variants and models', () => {
  const parsed = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv',
    '--host', '192.0.2.10', '--port', '2222', '--force', '--dry-run']);
  assert.equal(parsed.command, 'install');
  assert.deepEqual(parsed.positional, ['alvidaa']);
  assert.equal(parsed.opts.model, '50a51huv');
  assert.equal(parsed.opts.host, '192.0.2.10');
  assert.equal(parsed.opts.force, true);
  assert.equal(parsed.opts.dryRun, true);
  assert.throws(() => variant('nope'), /unknown variant/);
  assert.throws(() => model('nope'), /unknown model/);
});

// --- the installer owns the bridge watcher ----------------------------------
//
// The decision (applyWatcherConfig) is tested directly. The wiring is tested
// through a fake TV: a Map of absolute paths plus a tiny busybox that
// understands only the commands native-install.cjs actually issues. Anything
// else throws, so a new remote command has to be taught to the fake before it
// can be tested — the fake cannot silently pass a command the real TV would
// choke on.

const WATCHER_TMP = CONFIG + '.tmp-native-home';
const M = MODELS.models['50a51huv'];
const APP = M.app;
const STATE = M.state;
const ORIGINAL = JSON.stringify({
  logLevel: 'info',
  watcher: { enabled: true, app: 'Home', intervalSec: 5 },
  untouched: { deep: [1, 2, 3] }
});

function fakeTV(t, initial) {
  const files = new Map();
  const md5 = new Map(); // path -> md5 the TV should report (what is installed)
  for (const [p, text] of Object.entries(initial)) files.set(p, Buffer.from(text));
  const fail = body => { throw new Error('ssh failed (1): ' + body); };
  const ssh = (opts, command, input) => {
    const body = command.replace(/^export PATH=[^;]+; /, '');
    let m;
    if ((m = body.match(/^test -f (\S+) && echo yes \|\| echo no$/))) return files.has(m[1]) ? 'yes\n' : 'no\n';
    if ((m = body.match(/^test -f (\S+) \|\| cp -p (\S+) (\S+)$/))) {
      if (!files.has(m[1]) && files.has(m[2])) files.set(m[1], Buffer.from(files.get(m[2])));
      return '';
    }
    if ((m = body.match(/^cat (\S+) 2>\/dev\/null$/))) {
      if (!files.has(m[1])) fail(body);
      return files.get(m[1]).toString();
    }
    if ((m = body.match(/^cat > (\S+)$/))) { files.set(m[1], Buffer.from(input)); return ''; }
    if ((m = body.match(/^cat (\S+)$/))) {
      if (!files.has(m[1])) fail(body);
      return files.get(m[1]).toString();
    }
    if ((m = body.match(/^cp -p (\S+) (\S+)$/))) {
      if (!files.has(m[1])) fail(body);
      files.set(m[2], Buffer.from(files.get(m[1])));
      return '';
    }
    if ((m = body.match(/^mv -f (\S+) (\S+)$/))) {
      if (!files.has(m[1])) fail(body);
      files.set(m[2], files.get(m[1]));
      files.delete(m[1]);
      return '';
    }
    if ((m = body.match(/^chmod [0-7]+ (\S+)$/))) return '';
    if ((m = body.match(/^md5sum (\S+)$/))) {
      if (!md5.has(m[1])) fail(body);
      return md5.get(m[1]) + '  ' + m[1] + '\n';
    }
    if ((m = body.match(/^rm -f (\S+) (\S+); \/bin\/sh -c '.+' >\/dev\/null 2>&1 <\/dev\/null & echo started$/))) {
      const mode = (body.match(/switch-home\.sh (\w+)/) || [])[1] || 'unknown';
      // The detached script "finishes": done carries the OK/FAIL verdict.
      files.set(m[1], Buffer.from('OK ' + mode + ' finished\n'));
      files.set(m[2], Buffer.from('switch ' + mode + ': OK\n'));
      return 'started\n';
    }
    if ((m = body.match(/^printf "%s\\n" "([0-9a-f]{32})" > (\S+); chmod 600 (\S+)$/))) {
      files.set(m[2], Buffer.from(m[1] + '\n'));
      return '';
    }
    if ((m = body.match(/^\/bin\/sh (\S+) status$/))) {
      return 'bundle: candidate md5 matches\nengine: ' + M.engine + ' pid 4242\n';
    }
    fail('fake TV: unhandled command: ' + body);
  };
  return { files, md5, ssh };
}

function watcherFixture(t, configText) {
  const tv = fakeTV(t, {
    [CONFIG]: configText === undefined ? ORIGINAL : configText,
    [STATE + '/switch-home.sh']: '#!/bin/sh\n',
    [APP]: 'stock bundle bytes'
  });
  tv.md5.set(APP, M.stock_md5); // the TV currently runs stock
  return tv;
}

test('disable turns the watcher off and leaves every other key untouched', () => {
  const after = JSON.parse(applyWatcherConfig(ORIGINAL, 'disable'));
  assert.equal(after.watcher.enabled, false);
  assert.equal(after.watcher.app, 'Home');
  assert.equal(after.watcher.intervalSec, 5);
  assert.equal(after.logLevel, 'info');
  assert.deepEqual(after.untouched, { deep: [1, 2, 3] });
});

test('disable is idempotent', () => {
  const once = applyWatcherConfig(ORIGINAL, 'disable');
  assert.equal(applyWatcherConfig(once, 'disable'), once);
});

test('restore validates the backup and returns it byte-for-byte', () => {
  const bytes = '{\n  "watcher": { "enabled": true },\n  "odd": " spacing "\n}';
  assert.equal(applyWatcherConfig(bytes, 'restore'), bytes);
  assert.throws(() => applyWatcherConfig('{', 'restore'), /not valid JSON/);
  assert.throws(() => applyWatcherConfig('{"no watcher": true}', 'restore'), /watcher/);
});

test('refusals: unreadable configs and unknown modes never produce output text', () => {
  assert.throws(() => applyWatcherConfig('{', 'disable'), /not valid JSON/);
  assert.throws(() => applyWatcherConfig('[]', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig('null', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig('{"watcher": 7}', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig('{"watcher": null}', 'disable'), /watcher/);
  assert.throws(() => applyWatcherConfig(ORIGINAL, 'enable'), /unknown watcher mode/);
});

test('watcherState reads on, off and unknown, and never throws', () => {
  assert.equal(watcherState(ORIGINAL), 'on');
  assert.equal(watcherState(applyWatcherConfig(ORIGINAL, 'disable')), 'off');
  for (const text of ['{}', '{"watcher": 7}', '{"watcher":{"enabled":"yes"}}', '{', '', '[]']) {
    assert.equal(watcherState(text), 'unknown', text);
  }
});

test('disable writes over ssh atomically and preserves the original exactly once', t => {
  const tv = watcherFixture(t);
  const opts = { ssh: tv.ssh, model: '50a51huv' };
  syncWatcher(opts, M, 'disable');
  const after = JSON.parse(tv.files.get(CONFIG).toString());
  assert.equal(after.watcher.enabled, false);
  assert.deepEqual(after.untouched, { deep: [1, 2, 3] });
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(ORIGINAL)); // the original bytes
  assert.equal(tv.files.has(WATCHER_TMP), false); // mv left no temp behind
  const once = tv.files.get(CONFIG).toString();
  syncWatcher(opts, M, 'disable'); // a second install is idempotent...
  assert.equal(tv.files.get(CONFIG).toString(), once);
  // ...and even if the config changed again by hand in between, the backup
  // still holds the first original.
  tv.files.set(CONFIG, Buffer.from(JSON.stringify({ watcher: { enabled: true }, touched: 'by hand' })));
  syncWatcher(opts, M, 'disable');
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(ORIGINAL));
  const back = JSON.parse(tv.files.get(CONFIG).toString());
  assert.equal(back.watcher.enabled, false);
  assert.equal(back.touched, 'by hand');
});

test('restore reproduces the original bytes and keeps the backup', t => {
  const tv = watcherFixture(t);
  const opts = { ssh: tv.ssh, model: '50a51huv' };
  syncWatcher(opts, M, 'disable');
  const original = tv.files.get(WATCHER_BACKUP);
  syncWatcher(opts, M, 'restore');
  assert.deepEqual(tv.files.get(CONFIG), original); // byte-for-byte, not a re-serialization
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), original); // kept for the next rollback
  syncWatcher(opts, M, 'restore'); // a second rollback is a harmless no-op
  assert.deepEqual(tv.files.get(CONFIG), original);
});

// The 2026-11-09 session disabled the watcher by hand and left the true original
// at .bak-nativetest. On that TV the live config is ALREADY watcher-off, so a
// naive "snapshot the live config" would record off as the original and rollback
// would then leave the canvas launcher dead. Seed from the legacy backup.
test('a pre-native legacy backup is preferred over an already-disabled live config', t => {
  const legacy = JSON.stringify({ watcher: { enabled: true, app: 'Home' }, untouched: 123 }, null, 2);
  const alreadyOff = JSON.stringify({ watcher: { enabled: false, app: 'Home' }, untouched: 123 }, null, 2);
  const tv = watcherFixture(t, alreadyOff);
  tv.files.set(WATCHER_BACKUP_LEGACY, Buffer.from(legacy));
  syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable');
  // The backup holds the pre-native original (watcher ON), not the live file.
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(legacy));
  assert.equal(JSON.parse(tv.files.get(WATCHER_BACKUP).toString()).watcher.enabled, true);
  // So rollback hands the watcher back on, which is what the canvas launcher needs.
  syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'restore');
  assert.deepEqual(tv.files.get(CONFIG), Buffer.from(legacy));
  assert.equal(JSON.parse(tv.files.get(CONFIG).toString()).watcher.enabled, true);
});

test('with no legacy backup the live config is still snapshotted, as before', t => {
  const tv = watcherFixture(t);
  syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable');
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(ORIGINAL));
});

test('restore recreates the config if it vanished, still byte-for-byte', t => {
  const tv = watcherFixture(t);
  tv.files.set(WATCHER_BACKUP, Buffer.from(ORIGINAL));
  tv.files.delete(CONFIG);
  syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'restore');
  assert.deepEqual(tv.files.get(CONFIG), Buffer.from(ORIGINAL));
  assert.equal(tv.files.has(WATCHER_TMP), false);
});

test('restore with no backup warns that the watcher state is unknown and changes nothing', t => {
  const tv = watcherFixture(t); // no install has ever run: no backup
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(String(message));
  try { syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'restore'); } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /state is unknown/);
  assert.equal(tv.files.get(CONFIG).toString(), ORIGINAL);
});

test('an unreadable config is refused, and nothing on the TV changes', t => {
  const broken = '{ "watcher": { "enabled": true }, oops';
  const tv = watcherFixture(t, broken);
  assert.throws(() => syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable'), /not valid JSON/);
  assert.equal(tv.files.get(CONFIG).toString(), broken);
  assert.equal(tv.files.has(WATCHER_BACKUP), false); // not even a backup of garbage
  assert.equal(tv.files.has(WATCHER_TMP), false);
});

test('a config without a watcher object is refused, and nothing changes', t => {
  for (const text of ['{}', '{"bridge":{"port":8770}}', '[]', '{"watcher": null}']) {
    const tv = watcherFixture(t, text);
    assert.throws(() => syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable'), /watcher/);
    assert.equal(tv.files.get(CONFIG).toString(), text);
    assert.equal(tv.files.has(WATCHER_BACKUP), false);
  }
});

test('a missing config is refused, not created', t => {
  const tv = watcherFixture(t);
  tv.files.delete(CONFIG);
  assert.throws(() => syncWatcher({ ssh: tv.ssh, model: '50a51huv' }, M, 'disable'), /no bridge config/);
  assert.equal(tv.files.has(CONFIG), false);
  assert.equal(tv.files.has(WATCHER_BACKUP), false);
});

test('status reports the watcher: on, off and unknown', t => {
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    const tv = watcherFixture(t);
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: on'), logs.join('\n'));
    tv.files.set(CONFIG, Buffer.from(applyWatcherConfig(ORIGINAL, 'disable')));
    logs.length = 0;
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: off'), logs.join('\n'));
    logs.length = 0;
    status({ ssh: tv.ssh, model: '50a51huv', noWatcher: true });
    assert.ok(logs.includes('watcher: skipped (--no-watcher)'), logs.join('\n'));
    logs.length = 0;
    tv.files.set(CONFIG, Buffer.from('not json at all'));
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: unknown'), logs.join('\n'));
    tv.files.delete(CONFIG);
    logs.length = 0;
    status({ ssh: tv.ssh, model: '50a51huv' });
    assert.ok(logs.includes('watcher: unknown'), logs.join('\n'));
  } finally { console.log = original; }
});

test('rollback restores stock and hands the watcher back; a repeat is a no-op', t => {
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    const tv = watcherFixture(t);
    // State after a native install: watcher off, backup holding the pre-native original.
    tv.files.set(WATCHER_BACKUP, Buffer.from(ORIGINAL));
    tv.files.set(CONFIG, Buffer.from(JSON.stringify({ watcher: { enabled: false }, native: 'home was here' })));
    rollback({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv' });
    assert.deepEqual(tv.files.get(CONFIG), Buffer.from(ORIGINAL)); // pre-native bytes back
    assert.ok(tv.files.has(WATCHER_BACKUP)); // still there for the next rollback
    assert.ok(logs.some(l => /watcher: restored/.test(l)), logs.join('\n'));
    rollback({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv' });
    assert.deepEqual(tv.files.get(CONFIG), Buffer.from(ORIGINAL));
  } finally { console.log = original; }
});

test('rollback with --no-watcher leaves the config alone and says so', t => {
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    const tv = watcherFixture(t);
    tv.files.set(WATCHER_BACKUP, Buffer.from(ORIGINAL));
    tv.files.set(CONFIG, Buffer.from(JSON.stringify({ watcher: { enabled: false } })));
    rollback({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv', noWatcher: true });
    assert.deepEqual(JSON.parse(tv.files.get(CONFIG).toString()), { watcher: { enabled: false } });
    assert.ok(warnings.some(w => w.includes('--no-watcher') && /watcher state is whatever/.test(w)), warnings.join('\n'));
  } finally { console.warn = original; }
});

// The stock bundle is vendor code and never enters the repo, so the wiring
// test stubs the build and cleans up after itself; the real builders verify
// the pinned sha256 and are covered by their own tests.
function stubBuildForWiring(t, onBuild) {
  const stock = path.join(REPO, M.local_stock);
  const candidateOut = path.join(REPO, 'firmware', '50a51huv', 'candidate-alvidaa.js');
  const hadStock = fs.existsSync(stock);
  const hadCandidate = fs.existsSync(candidateOut);
  fs.mkdirSync(path.dirname(stock), { recursive: true });
  if (!hadStock) fs.writeFileSync(stock, '/* test stand-in for the pinned stock bundle */\n');
  t.after(() => {
    if (!hadStock) {
      fs.rmSync(stock, { force: true });
      for (let dir = path.dirname(stock); dir !== path.join(REPO, 'firmware'); dir = path.dirname(dir)) {
        try { fs.rmdirSync(dir); } catch (_) { break; }
      }
    }
    if (!hadCandidate) {
      fs.rmSync(candidateOut, { force: true });
      try { fs.rmdirSync(path.dirname(candidateOut)); } catch (_) { /* not empty or gone */ }
    }
  });
  return { build: (stockFile, out, expect, options) => {
    if (onBuild) onBuild(stockFile, out, expect, options);
    fs.writeFileSync(out, '/* wiring-test candidate */\n'); return '/* wiring-test candidate */\n';
  } };
}

test('install ends with the watcher disabled and the pre-native config preserved', t => {
  const tv = watcherFixture(t);
  const builder = stubBuildForWiring(t);
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder });
  } finally { console.log = original; }
  assert.ok(logs.includes('mode: install'), logs.join('\n'));
  assert.ok(logs.some(l => /watcher: disabled/.test(l)), logs.join('\n'));
  const config = JSON.parse(tv.files.get(CONFIG).toString());
  assert.equal(config.watcher.enabled, false);
  assert.deepEqual(config.untouched, { deep: [1, 2, 3] });
  assert.deepEqual(tv.files.get(WATCHER_BACKUP), Buffer.from(ORIGINAL)); // taken once, on the first install
  assert.ok(tv.files.has(STATE + '/candidate-native-home.js')); // the bundle work happened
});

test('install with --no-watcher swaps the bundle but leaves the config alone, loudly', t => {
  const tv = watcherFixture(t);
  const builder = stubBuildForWiring(t);
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder, noWatcher: true });
  } finally { console.warn = original; }
  assert.equal(tv.files.get(CONFIG).toString(), ORIGINAL); // untouched
  assert.equal(tv.files.has(WATCHER_BACKUP), false);
  assert.ok(tv.files.has(STATE + '/candidate-native-home.js'));
  assert.ok(warnings.some(w => w.includes('--no-watcher') && /hide this native Home/.test(w)), warnings.join('\n'));
});

test('--no-watcher parses as an opt-in skip, off by default', () => {
  const parsed = parse(['node', 'x', 'rollback', '--model', '50a51huv', '--host', '192.0.2.10', '--no-watcher']);
  assert.equal(parsed.opts.noWatcher, true);
  assert.equal(parse(['node', 'x', 'status']).opts.noWatcher, false);
});

// --- per-input art (issue #34, gaps filled by #60) ---------------------------
//
// The bridge config's inputs carry bg (backdrop) and logo (tile image); the
// native component's single art slot is the backdrop, so bg fills it. Where
// an input has no backdrop configured, the device-class matcher (issue #60)
// supplies a silhouette keyed by the name the TV reports. Owner art always
// wins; a configured-but-remote URL is refused with a warning and never
// masked by a silhouette.

const ART_CFG = JSON.stringify({
  watcher: { enabled: true },
  inputs: {
    'HDMI2': { name: 'HDMI2', bg: '/var/local/alvidaa/launcher/ps5-bg.png',
               logo: '/var/local/alvidaa/launcher/ps5-logo.png' },
    'TV': { name: 'TV', logo: '/var/local/alvidaa/launcher/tv-logo.png' },
    'HDMI3': { name: 'HDMI3', bg: 'https://cdn.example/hdmi3-bg.png' }
  }
});

test('input art: the allowlist matches the component exactly, remote is refused', () => {
  assert.equal(cleanInputArt('var/local/storeAppIcon/x.png'), 'var/local/storeAppIcon/x.png');
  assert.equal(cleanInputArt('file:///x.png'), 'file:///x.png');
  assert.equal(cleanInputArt('/next/assets/x.png'), '/next/assets/x.png');
  assert.equal(cleanInputArt('data:image/png;base64,AAA'), 'data:image/png;base64,AAA');
  assert.equal(cleanInputArt('data:image/svg+xml;base64,AAA'), 'data:image/svg+xml;base64,AAA',
    'the silhouettes ride the same allowlist the component widened for them');
  assert.equal(cleanInputArt('data:image/gif;base64,AAA'), '', 'gif is not in the component allowlist');
  assert.equal(cleanInputArt('http://x/y.png'), '');
  assert.equal(cleanInputArt('https://x/y.png'), '');
});

test('input art: builds the map from config inputs, silhouettes fill the gaps, remote dropped', () => {
  const art = inputArtFromConfigText(ART_CFG);
  assert.equal(art.map.hdmi2, '/var/local/alvidaa/launcher/ps5-bg.png',
    'owner bg fills the backdrop slot, lowercased key');
  assert.match(art.map.tv, /^data:image\/svg\+xml;base64,/,
    'the logo-only gap is filled by the class matcher (TV -> tv silhouette)');
  assert.deepEqual(art.warnings, ['hdmi3'], 'the refused input is named for the warning');
  assert.match(art.note, /1 from config/);
  assert.match(art.note, /silhouette: tv=tv/);
  assert.match(art.note, /1 left empty/);
});

test('input art: no config, no inputs, bad JSON and zero entries all build without art', () => {
  for (const [text, pattern] of [
    ['', /no bridge config/],
    ['{ oops', /not valid JSON/],
    ['{"watcher":{"enabled":true}}', /no inputs section/],
    ['{"inputs":{}}', /no usable backdrop art/],
  ]) {
    const art = inputArtFromConfigText(text);
    assert.equal(art.map, null, JSON.stringify(text));
    assert.match(art.note, pattern, JSON.stringify(text));
    assert.ok(art.note.split('\n').length === 1, 'the note is one line');
  }
});

test('input art: install passes the map to the builder', t => {
  const tv = watcherFixture(t, ART_CFG);
  let seen = 'not called';
  const builder = stubBuildForWiring(t, (a, b, c, options) => { seen = options; });
  install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder });
  assert.equal(seen.inputArt.hdmi2, '/var/local/alvidaa/launcher/ps5-bg.png');
  assert.match(seen.inputArt.tv, /^data:image\/svg\+xml;base64,/,
    'the TV gap is filled with the class silhouette');
});

test('input art: missing or unusable config never fails the install', t => {
  const cases = [
    // The two corrupt-config cases also pass --no-watcher: on a TV whose
    // config is missing or not JSON, the watcher step rightly refuses on its
    // own terms, and this test isolates the art path's behaviour.
    ['no config file', tv => tv.files.delete(CONFIG), /could not read the TV config/, { noWatcher: true }],
    ['bad JSON', tv => tv.files.set(CONFIG, Buffer.from('{ oops')), /not valid JSON/, { noWatcher: true }],
    // The two well-formed cases carry a watcher object so the watcher step
    // succeeds normally and only the art outcome varies.
    ['no inputs section', tv => tv.files.set(CONFIG, Buffer.from('{"watcher":{"enabled":true}}')),
      /no inputs section/, {}],
    ['zero entries', tv => tv.files.set(CONFIG, Buffer.from('{"watcher":{"enabled":true},"inputs":{}}')),
      /no usable backdrop art/, {}]
  ];
  for (const [what, mutate, pattern, extra] of cases) {
    const tv = watcherFixture(t);
    mutate(tv);
    let seen = 'not called';
    const builder = stubBuildForWiring(t, (a, b, c, options) => { seen = options; });
    const logs = [];
    const original = console.log;
    console.log = message => logs.push(String(message));
    try {
      install('alvidaa', Object.assign({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder }, extra));
    } finally { console.log = original; }
    // No config art is baked in any of these cases. The silhouette bundle is
    // separate and always present unless --no-device-art, so assert on the
    // config-art slot specifically.
    assert.equal(seen && seen.inputArt, undefined, what + ': the builder got no config art');
    assert.ok(logs.some(l => pattern.test(l)), what + ': ' + logs.join(' | '));
    assert.ok(logs.some(l => l.includes('building without input art')), what);
    assert.ok(tv.files.has(STATE + '/candidate-native-home.js'), what + ': install still ran');
  }
});

test('input art: a remote URL in the TV config is dropped with a warning naming the input', t => {
  const tv = watcherFixture(t, ART_CFG);
  const builder = stubBuildForWiring(t);
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder });
  } finally { console.warn = original; }
  assert.ok(warnings.some(w => w.includes('hdmi3') && /remote URL/.test(w)), warnings.join('\n'));
});

test('input art: --no-input-art skips the TV read, --input-art takes a local map', t => {
  // --no-input-art: even with art on the TV, nothing is read and nothing baked
  const tvOff = watcherFixture(t, ART_CFG);
  let seenOff = 'not called';
  const builderOff = stubBuildForWiring(t, (a, b, c, options) => { seenOff = options; });
  install('alvidaa', { ssh: tvOff.ssh, sleep: () => {}, model: '50a51huv',
    builder: builderOff, noInputArt: true });
  assert.equal(seenOff && seenOff.inputArt, undefined,
    '--no-input-art drops the config art; the silhouette bundle is --no-device-art');

  // --input-art <file>: a plain { key: art } map, remote entries dropped
  const dir = fs.mkdtempSync('/tmp/alvidaa-input-art-');
  const mapFile = path.join(dir, 'art.json');
  fs.writeFileSync(mapFile, JSON.stringify({
    'HDMI2 ': '/var/local/alvidaa/launcher/ps5-bg.png',
    'bad': 'https://cdn.example/bg.png'
  }));
  const tvMap = watcherFixture(t); // the TV config is irrelevant here
  let seenMap = 'not called';
  const builderMap = stubBuildForWiring(t, (a, b, c, options) => { seenMap = options; });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => warnings.push(String(message));
  try {
    install('alvidaa', { ssh: tvMap.ssh, sleep: () => {}, model: '50a51huv',
      builder: builderMap, inputArtFile: mapFile });
  } finally { console.warn = originalWarn; }
  assert.equal(seenMap.inputArt.hdmi2, '/var/local/alvidaa/launcher/ps5-bg.png');
  assert.ok(warnings.some(w => w.includes('bad') && /remote URL/.test(w)), warnings.join('\n'));

  // --input-art with a saved bridge config takes the bg/logo path too
  const cfgFile = path.join(dir, 'config.json');
  fs.writeFileSync(cfgFile, ART_CFG);
  let seenCfg = 'not called';
  const builderCfg = stubBuildForWiring(t, (a, b, c, options) => { seenCfg = options; });
  install('alvidaa', { ssh: tvMap.ssh, sleep: () => {}, model: '50a51huv',
    builder: builderCfg, inputArtFile: cfgFile });
  assert.equal(seenCfg.inputArt.hdmi2, '/var/local/alvidaa/launcher/ps5-bg.png');
  assert.match(seenCfg.inputArt.tv, /^data:image\/svg\+xml;base64,/);

  // an unreadable file still builds, without art
  let seenMissing = 'not called';
  const builderMissing = stubBuildForWiring(t, (a, b, c, options) => { seenMissing = options; });
  install('alvidaa', { ssh: tvMap.ssh, sleep: () => {}, model: '50a51huv',
    builder: builderMissing, inputArtFile: path.join(dir, 'nope.json') });
  assert.equal(seenMissing && seenMissing.inputArt, undefined,
    'an unreadable --input-art file still leaves the silhouettes in place');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('input art: --dry-run says what would be baked', t => {
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    // Without a file: the dry-run line names the config it would read. No ssh
    // is involved: dry-run touches nothing, so no fake TV is needed here.
    install('alvidaa', { sleep: () => {}, model: '50a51huv',
      builder: stubBuildForWiring(t), dryRun: true });
    assert.ok(logs.some(l => /\[dry-run\] input art: would read .*config\.json/.test(l)), logs.join('\n'));

    // With --input-art: the dry-run line lists exactly what would be baked.
    logs.length = 0;
    const dir = fs.mkdtempSync('/tmp/alvidaa-input-art-dry-');
    const mapFile = path.join(dir, 'art.json');
    fs.writeFileSync(mapFile, JSON.stringify({ hdmi2: '/x/ps5-bg.png', tv: '/x/tv-bg.png' }));
    install('alvidaa', { sleep: () => {}, model: '50a51huv',
      builder: stubBuildForWiring(t), dryRun: true, inputArtFile: mapFile });
    assert.ok(logs.some(l => /\[dry-run\] would bake .*hdmi2.*tv/.test(l)), logs.join('\n'));
    fs.rmSync(dir, { recursive: true, force: true });
  } finally { console.log = original; }
});

test('--input-art and --no-input-art parse, and --input-art takes a value', () => {
  const parsed = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv',
    '--host', '192.0.2.10', '--no-input-art', '--input-art', '/tmp/art.json']);
  assert.equal(parsed.opts.noInputArt, true);
  assert.equal(parsed.opts.inputArtFile, '/tmp/art.json');
  assert.equal(parse(['node', 'x', 'status']).opts.noInputArt, false);
  assert.equal(parse(['node', 'x', 'status']).opts.inputArtFile, null);
});

// --- device-class silhouettes (issue #60) ------------------------------------

test('device art: silhouettes fill the gaps but never override config art', () => {
  // An unnamed port key matches on the key itself ("hdmi1" -> box); a named
  // entry matches on the name the owner gave it; config bg always wins.
  const cfg = JSON.stringify({
    watcher: { enabled: true },
    inputs: {
      'HDMI1': { name: 'HDMI1' },
      'HDMI2': { name: 'PlayStation 5', bg: '/var/local/alvidaa/launcher/ps5-bg.png' },
      'HDMI3': { name: 'Nintendo Switch' }
    }
  });
  const art = inputArtFromConfigText(cfg);
  assert.equal(art.map.hdmi2, '/var/local/alvidaa/launcher/ps5-bg.png',
    'configured art is passed through untouched');
  assert.match(art.map.hdmi3, /^data:image\/svg\+xml;base64,/);
  const hdmi3Svg = Buffer.from(art.map.hdmi3.split(',')[1], 'base64').toString();
  assert.match(hdmi3Svg, /gamepad-2|lucide-gamepad/, 'Nintendo Switch -> controller silhouette');
  const hdmi1Svg = Buffer.from(art.map.hdmi1.split(',')[1], 'base64').toString();
  assert.match(hdmi1Svg, /lucide-box|lucide-gamepad|lucide-tv|lucide-cast|lucide-cpu|lucide-disc|lucide-usb|lucide-monitor/,
    'an unnamed port still gets its class silhouette, keyed by the reported name');
  assert.match(art.note, /2 silhouettes: hdmi1=box, hdmi3=gamepad-2/);
});

test('device art: --no-device-art builds without silhouettes, config art unaffected', t => {
  const art = inputArtFromConfigText(ART_CFG, { noDeviceArt: true });
  assert.equal(art.map.hdmi2, '/var/local/alvidaa/launcher/ps5-bg.png',
    'owner art survives');
  assert.equal(art.map.tv, undefined, 'no silhouette fills the gap');
  assert.match(art.note, /2 left empty \(--no-device-art\)/);
  // Through the whole install path, too: the flag reaches the matcher.
  const tv = watcherFixture(t, ART_CFG);
  let seen = 'not called';
  const builder = stubBuildForWiring(t, (a, b, c, options) => { seen = options; });
  install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv',
    builder, noDeviceArt: true });
  assert.deepEqual(seen, { inputArt: { hdmi2: '/var/local/alvidaa/launcher/ps5-bg.png' } });
});

test('device art: an input with no name gets no art and the install still succeeds', t => {
  // An empty-string key (or whitespace-only) is the one shape the matcher
  // refuses; it must not throw, and the install carries on without it.
  const cfg = JSON.stringify({
    watcher: { enabled: true },
    inputs: {
      '': { bg: '/var/local/alvidaa/launcher/x.png' },
      '   ': { name: 'PlayStation 5' },
      'HDMI2': { name: 'PlayStation 5' }
    }
  });
  const art = inputArtFromConfigText(cfg);
  assert.deepEqual(Object.keys(art.map), ['hdmi2'],
    'the nameless inputs are skipped, the named one is filled');
  const tv = watcherFixture(t, cfg);
  let seen = 'not called';
  const builder = stubBuildForWiring(t, (a, b, c, options) => { seen = options; });
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  try {
    install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder });
  } finally { console.log = original; }
  assert.deepEqual(seen.inputArt, { hdmi2: art.map.hdmi2 },
    'only the named input gets config art');
  assert.ok(seen.deviceArt && seen.deviceArt.icons && seen.deviceArt.rules.length > 0,
    'the silhouette bundle travels alongside it');
  assert.ok(logs.some(l => /input art: .*silhouette/.test(l)), logs.join(' | '));
  assert.ok(logs.some(l => l.includes('mode: install')), 'install completed');
});

test('device art: --no-device-art parses, off by default', () => {
  const parsed = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv',
    '--host', '192.0.2.10', '--no-device-art']);
  assert.equal(parsed.opts.noDeviceArt, true);
  assert.equal(parse(['node', 'x', 'status']).opts.noDeviceArt, false);
});

test('input art: the local-file reader accepts a map or a saved bridge config', () => {
  const fromMap = inputArtFromFileText('{"HDMI2":"/x/bg.png","tv":"https://x/y.png"}');
  assert.deepEqual(fromMap.map, { hdmi2: '/x/bg.png' });
  assert.deepEqual(fromMap.warnings, ['tv']);
  const fromCfg = inputArtFromFileText(ART_CFG);
  assert.equal(fromCfg.map.hdmi2, '/var/local/alvidaa/launcher/ps5-bg.png');
  assert.match(fromCfg.map.tv, /^data:image\/svg\+xml;base64,/,
    'a saved bridge config fills its gaps too');
  assert.deepEqual(fromCfg.warnings, ['hdmi3']);
  const bad = inputArtFromFileText('{');
  assert.equal(bad.map, null);
  assert.match(bad.note, /not valid JSON/);
  const arr = inputArtFromFileText('[]');
  assert.equal(arr.map, null);
  assert.match(arr.note, /not a JSON object/);
});

test('--no-record and --no-verify parse, and both are off by default', () => {
  const plain = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv', '--host', '192.0.2.10']);
  assert.equal(plain.opts.noRecord, false);
  assert.equal(plain.opts.noVerify, false);
  const off = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv',
    '--host', '192.0.2.10', '--no-record', '--no-verify']);
  assert.equal(off.opts.noRecord, true);
  assert.equal(off.opts.noVerify, true);
});

test('--no-drift parses, and is off by default', () => {
  assert.equal(parse(['node', 'x', 'status', '--model', '50a51huv', '--host', '192.0.2.10']).opts.noDrift, false);
  assert.equal(parse(['node', 'x', 'status', '--model', '50a51huv', '--host', '192.0.2.10', '--no-drift']).opts.noDrift, true);
});

/* ---- doctor (issue #52): the subcommand shell ----------------------------- */

// The diagnosis itself is doctor.test.cjs's; these cover the subcommand
// surface: routing, the flags it passes through, and the exit contract that
// native-install's require.main catch (exit 1 for every throw) cannot carry.
const doctor = require('./doctor.cjs');

const doctorDeps = () => ({
  transport: {
    exec(cmd) {
      if (cmd === 'echo doctor-lane-ok') throw new Error(
        'ssh failed: ssh: connect to host 192.0.2.10 port 2222: Operation timed out');
      throw new Error('fake tv: unhandled command: ' + cmd);
    },
    readFile(p) { throw new Error('cannot read ' + p + ' over ssh (status 1)'); }
  },
  arpLookup: () => ({ mac: 'bc:5c:17:bc:46:88' }),
  pathProbe: () => '/bin:/usr/bin:/sbin:/usr/local/bin',
  hostProcesses: () => []
});

test('doctor routes through main with the flags it needs and returns the exit code', () => {
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  let code;
  try {
    code = main(['node', 'x', 'doctor', '--model', '50a51huv', '--host', '192.0.2.10',
      '--port', '2222', '--key', 'k'], doctorDeps());
  } finally { console.log = original; }
  assert.equal(code, doctor.EXIT.ANSWER);
  assert.ok(logs.some(l => /likely cause: napping/.test(l)), logs.join('\n'));
  assert.ok(logs.some(l => l.startsWith('next: ')), logs.join('\n'));
});

test('doctor with missing flags: exit 2 with the usage on stderr, not a throw', () => {
  const errLines = [];
  const original = console.error;
  console.error = (...a) => errLines.push(a.join(' '));
  let code;
  try { code = main(['node', 'x', 'doctor', '--model', '50a51huv']); }
  finally { console.error = original; }
  assert.equal(code, doctor.EXIT.USAGE);
  assert.ok(errLines.some(l => l.includes('--host')), errLines.join('\n'));
});

test('doctor --help prints the usage and exits clean', () => {
  const logs = [];
  const original = console.log;
  console.log = message => logs.push(String(message));
  let code;
  try { code = main(['node', 'x', 'doctor', '--help']); }
  finally { console.log = original; }
  assert.equal(code, doctor.EXIT.ANSWER);
  assert.match(logs[0], /^usage:/);
});

test('--help parses (doctor needs it through the subcommand shell)', () => {
  assert.equal(parse(['node', 'x', 'doctor', '--help']).opts.help, true);
  assert.equal(parse(['node', 'x', 'status', '--model', '50a51huv', '--host', '192.0.2.10']).opts.help, false);
});

// --- per-app tint (issue #56) -------------------------------------------------

test('app colours: the flag parses, and cleanAppColours enforces basenames and #rrggbb', () => {
  const parsed = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv',
    '--host', '192.0.2.10', '--app-colours', '/tmp/colours.json']);
  assert.equal(parsed.opts.appColoursFile, '/tmp/colours.json');
  assert.equal(parse(['node', 'x', 'status']).opts.appColoursFile, null);
  const good = cleanAppColours('{"netflix.png":"#B20710","plex.png":"#e5a00d"}');
  assert.deepEqual(good.map, { 'netflix.png': '#b20710', 'plex.png': '#e5a00d' },
    'values are normalised to lowercase, basename keys kept');
  assert.deepEqual(good.warnings, []);
  const mixed = cleanAppColours(JSON.stringify({
    'ok.png': '#112233',
    'full/path.png': '#112233',
    'rgb.png': 'rgb(1,2,3)',
    'short.png': '#fff',
    '': '#112233'
  }));
  assert.deepEqual(mixed.map, { 'ok.png': '#112233' });
  assert.equal(mixed.warnings.length, 4, 'every dropped entry is named');
  const broken = cleanAppColours('{ oops');
  assert.equal(broken.map, null);
  assert.match(broken.error, /not valid JSON/);
  assert.match(cleanAppColours('[]').error, /not a JSON object/);
  const entries = {};
  for (let i = 0; i < APP_COLOURS_MAX + 2; i++) entries['k' + i + '.png'] = '#112233';
  const capped = cleanAppColours(JSON.stringify(entries));
  assert.equal(Object.keys(capped.map).length, APP_COLOURS_MAX);
  assert.equal(capped.warnings.length, 2, 'the overflow is named, not dropped silently');
});

test('app colours: install bakes the map into the builder; absent flag stays silent', t => {
  const dir = fs.mkdtempSync('/tmp/alvidaa-app-colours-');
  const file = path.join(dir, 'colours.json');
  fs.writeFileSync(file, '{"netflix.png":"#b20710"}');
  const logs = [];
  const originalLog = console.log;
  console.log = message => logs.push(String(message));
  try {
    const tv = watcherFixture(t);
    let seen = 'not called';
    const builder = stubBuildForWiring(t, (a, b, c, options) => { seen = options; });
    install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv', builder, appColoursFile: file, noRecord: true });
    assert.deepEqual(seen.appColours, { 'netflix.png': '#b20710' });
    assert.ok(logs.some(l => /app colours: baked 1 icon tint/.test(l)), logs.join(' | '));

    logs.length = 0;
    const tvQuiet = watcherFixture(t);
    let seenQuiet = 'not called';
    const builderQuiet = stubBuildForWiring(t, (a, b, c, options) => { seenQuiet = options; });
    install('alvidaa', { ssh: tvQuiet.ssh, sleep: () => {}, model: '50a51huv', builder: builderQuiet, noRecord: true });
    assert.equal(seenQuiet.appColours, undefined, 'no flag, no key in the builder options');
    assert.equal(logs.some(l => /app colours/.test(l)), false, 'and nothing is logged');

    let seenMissing = 'not called';
    const builderMissing = stubBuildForWiring(t, (a, b, c, options) => { seenMissing = options; });
    const tvMissing = watcherFixture(t);
    install('alvidaa', { ssh: tvMissing.ssh, sleep: () => {}, model: '50a51huv',
      builder: builderMissing, appColoursFile: path.join(dir, 'nope.json'), noRecord: true });
    assert.equal(seenMissing.appColours, undefined, 'an unreadable file still builds');
    assert.ok(logs.some(l => /--app-colours file unreadable/.test(l) && /building without app colours/.test(l)),
      'it says so on the note line: ' + logs.join(' | '));
  } finally { console.log = originalLog; }
  fs.rmSync(dir, { recursive: true, force: true });
});
