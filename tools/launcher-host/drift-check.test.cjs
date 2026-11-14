'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const driftCheck = require('./drift-check.cjs');
const recoveryRecord = require('./recovery-record.cjs');
const { MODELS } = require('./native-install.cjs');
const { CONFIG } = require('./native-trial.cjs');

const M0 = MODELS.models['50a51huv'];
const APP = M0.app;
const MAC = 'bc:5c:17:bc:46:88';
const KEY = '50a51huv:bc5c17bc4688';
const HERE = __dirname;

const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const STOCK = Buffer.from('/* pinned stock bundle */\n');
const CANDIDATE = Buffer.from('/* candidate bundle v2 */\n');
const OTHER = Buffer.from('/* something neither stock nor candidate */\n');
const HOOK_TEXT = '#!/bin/sh\n# the boot hook\n';
const STORAGE_KEYS = 'alvidaa_last_used\t"src1"\nalvidaa_favorites\t["a"]\n';
const STOCK_BACKUP_REL = 'var/local/alvidaa/native-home/backup/app.js.stock';
const CANDIDATE_MD5_REL = 'var/local/alvidaa/native-home/candidate.md5';
const HOOK_REL = 'var/local/otaTest.sh';
const CONFIG_REL = 'var/local/alvidaa/config.json';
const WATCHER_BACKUP_REL = 'var/local/alvidaa/config.json.bak-native-home';
const STORAGE_REL = 'var/local/hisenseUI/cobalt_home/' + driftCheck.homeStorageName();

/* ---- one fake TV per test: a directory read as if it were the root fs ----
 * The transport is drift-check's fixtureRemote, which composes deploy-check's
 * (md5sum, ls -ldn, ...) with the commands this tool adds — so the tests
 * exercise the same parsing the real TV needs. Defaults describe the healthy
 * native-Home install; every test mutates one thing. */
function buildWorld(t, spec = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-check-fixture-'));
  const recDir = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-check-records-'));
  t.after(() => { fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(recDir, { recursive: true, force: true }); });

  const write = (rel, data) => {
    fs.mkdirSync(path.join(dir, rel, '..'), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), data);
  };

  write(APP, spec.bundle || CANDIDATE);
  write(CANDIDATE_MD5_REL, (spec.candidateMd5 || md5(CANDIDATE)) + '\n');
  if (spec.stockBackup !== null) write(STOCK_BACKUP_REL, spec.stockBackup || STOCK);
  write(CONFIG_REL, JSON.stringify({ watcher: { enabled: spec.watcher === true } }));
  // Pre-native watcher value the once-taken backup holds: on, for the canvas
  // launcher that ran before the first native install.
  if (spec.backupWatcher !== null) write(WATCHER_BACKUP_REL, JSON.stringify({ watcher: { enabled: spec.backupWatcher !== false } }));
  if (spec.hook !== null) write(HOOK_REL, spec.hook || HOOK_TEXT);
  write('sys/class/net/wlan0/address', MAC + '\n');
  if (spec.storage !== null) {
    if (spec.storageDir) fs.mkdirSync(path.join(dir, STORAGE_REL), { recursive: true });
    else {
      write(STORAGE_REL, spec.storage === undefined ? STORAGE_KEYS : spec.storage);
      write(STORAGE_REL + '.owner', spec.storageOwner || '305:909');
    }
  }
  for (const h of spec.openHosts || []) write('dev/tcp/' + h + '-443', '');
  for (const h of spec.hangHosts || []) write('dev/tcp/' + h + '-443.hang', '');

  // The host-side recovery record, keyed the way identify() derives it.
  if (spec.record !== null) {
    fs.writeFileSync(recoveryRecord.recordPath(recDir, KEY), JSON.stringify(spec.record || {
      schema: 1, key: KEY, model: '50a51huv',
      created: '2026-11-10T10:00:00.000Z', updated: '2026-11-10T12:00:00.000Z',
      facts: { at: '2026-11-10T10:00:00.000Z', bundle: { md5: md5(STOCK), is_stock: true }, watcher: { enabled: true } },
      latest: { at: '2026-11-10T12:00:00.000Z', bundle: { md5: spec.recordBundleMd5 || md5(CANDIDATE) }, watcher: { enabled: false } },
      history: []
    }, null, 2));
  }

  // The pinned stock md5 moves with the fixture content: the profile is
  // injected the deploy-check way (the real one is gitignored anyway).
  const model = Object.assign({}, M0, { stock_md5: md5(STOCK) });
  const opts = { model: '50a51huv', fixture: dir, recordDir: recDir, json: true, port: 2222, key: 'key' };
  return { dir, recDir, model, opts, deps: { modelTable: { '50a51huv': model } } };
}

function run(world, opts) {
  const ctx = driftCheck.runDriftCheck(opts || world.opts, world.deps);
  return Object.assign(ctx, { code: driftCheck.verdict(ctx.results).code });
}

const byName = (ctx, name) => ctx.results.find(c => c.name === name);
const names = ctx => ctx.results.map(c => c.name);

/* ---- the healthy TV: every check PASS, exit 0 ---------------------------- */

test('no drift: a native-Home install that is exactly what was left behind', t => {
  const w = buildWorld(t);
  const ctx = run(w);
  assert.equal(ctx.code, 0);
  for (const r of ctx.results) {
    assert.equal(r.status, 'PASS', r.name + ': ' + r.observed);
    assert.equal(r.remedy, null);
  }
  assert.deepEqual(names(ctx), ['dropbear', 'record', 'bundle', 'watcher', 'stock-backup', 'boot-hook', 'sinkhole', 'prefs']);
  assert.match(byName(ctx, 'bundle').observed, /candidate/);
  assert.match(byName(ctx, 'bundle').observed, /matches the record/);
  assert.match(byName(ctx, 'watcher').observed, /matches the native-Home setup/);
  assert.match(byName(ctx, 'prefs').observed, /2 alvidaa_\* key\(s\)/);
  assert.match(byName(ctx, 'sinkhole').observed, /8\/8 kill-list hosts closed/);
});

/* ---- bundle ---------------------------------------------------------------- */

test('bundle changed to an unknown revision: FAIL, and the record says what it used to be', t => {
  const w = buildWorld(t, { bundle: OTHER });
  const ctx = run(w);
  assert.equal(ctx.code, 1);
  const bundle = byName(ctx, 'bundle');
  assert.equal(bundle.status, 'FAIL');
  assert.match(bundle.observed, new RegExp(md5(OTHER)));
  assert.match(bundle.observed, /not what the record last saw/);
  assert.match(bundle.remedy, /bootstrap/);
  // Independent evidence still runs after the FAIL (verify-install's rule).
  assert.equal(byName(ctx, 'sinkhole').status, 'PASS');
  assert.equal(byName(ctx, 'prefs').status, 'PASS');
});

test('bundle is an unknown revision but unchanged since the record: WARN, not FAIL', t => {
  // The rest of the world stays coherent with the pre-native setup (watcher
  // on), so the only non-PASS is the bundle WARN itself.
  const w = buildWorld(t, { bundle: OTHER, watcher: true, recordBundleMd5: md5(OTHER) });
  const ctx = run(w);
  assert.equal(ctx.code, 0);
  assert.equal(byName(ctx, 'bundle').status, 'WARN');
  assert.match(byName(ctx, 'bundle').observed, /unchanged since the record/);
});

test('stock in place still passes when the record last saw the candidate', t => {
  // Watcher on, matching the pre-native backup: coherent with stock in place.
  const w = buildWorld(t, { bundle: STOCK, watcher: true });
  const ctx = run(w);
  assert.equal(byName(ctx, 'bundle').status, 'PASS');
  assert.match(byName(ctx, 'bundle').observed, /stock/);
  assert.match(byName(ctx, 'bundle').observed, /record last saw/);
});

/* ---- watcher --------------------------------------------------------------- */

test('watcher flipped on under the native Home: FAIL with the install remedy', t => {
  const w = buildWorld(t, { watcher: true });
  const ctx = run(w);
  assert.equal(ctx.code, 1);
  const watcher = byName(ctx, 'watcher');
  assert.equal(watcher.status, 'FAIL');
  assert.match(watcher.observed, /bounce it back to the canvas page/);
  assert.match(watcher.remedy, /native-install\.cjs install/);
});

test('watcher mismatch on stock: the once-taken backup is the expected value', t => {
  const w = buildWorld(t, { bundle: STOCK, watcher: true, backupWatcher: false });
  const ctx = run(w);
  assert.equal(ctx.code, 1);
  const watcher = byName(ctx, 'watcher');
  assert.equal(watcher.status, 'FAIL');
  assert.match(watcher.observed, /watcher is on but/);
  assert.match(watcher.remedy, /rollback/);
});

test('watcher with no backup falls back to the record\'s pre-install value', t => {
  const w = buildWorld(t, { bundle: STOCK, watcher: true, backupWatcher: null, recordBundleMd5: md5(STOCK) });
  const ctx = run(w);
  const watcher = byName(ctx, 'watcher');
  assert.equal(watcher.status, 'PASS');
  assert.match(watcher.observed, /matches the recovery record/);
});

test('watcher config missing or unreadable: SKIP, never PASS', t => {
  const w = buildWorld(t, { record: null });
  fs.rmSync(path.join(w.dir, CONFIG_REL));
  const ctx = run(w);
  const watcher = byName(ctx, 'watcher');
  assert.equal(watcher.status, 'SKIP');
  assert.match(watcher.observed, /no .*config\.json/);
  assert.equal(ctx.code, 0); // a SKIP is not drift
});

/* ---- stock backup ------------------------------------------------------------ */

test('stock backup missing: rollback is a promise the TV cannot keep', t => {
  const w = buildWorld(t, { stockBackup: null });
  const ctx = run(w);
  assert.equal(ctx.code, 1);
  const backup = byName(ctx, 'stock-backup');
  assert.equal(backup.status, 'FAIL');
  assert.match(backup.observed, /no stock backup/);
  assert.match(backup.remedy, /bootstrap/);
});

test('stock backup tampered: present but no longer the pinned stock', t => {
  const w = buildWorld(t, { stockBackup: Buffer.from('/* half-overwritten */\n') });
  const ctx = run(w);
  const backup = byName(ctx, 'stock-backup');
  assert.equal(backup.status, 'FAIL');
  assert.match(backup.observed, /!= pinned stock/);
});

/* ---- boot hook ---------------------------------------------------------------- */

test('boot hook missing: root SSH will not survive the next reboot', t => {
  const w = buildWorld(t, { hook: null });
  const ctx = run(w);
  assert.equal(ctx.code, 1);
  const hook = byName(ctx, 'boot-hook');
  assert.equal(hook.status, 'FAIL');
  assert.match(hook.observed, /will not survive the next reboot/);
  assert.match(hook.remedy, /boot hook/);
});

/* ---- sinkhole ------------------------------------------------------------------ */

test('sinkhole not sinking: one kill-list host answers TCP :443', t => {
  const w = buildWorld(t, { openHosts: ['evt-na.vidaahub.com'] });
  const ctx = run(w);
  assert.equal(ctx.code, 1);
  const sinkhole = byName(ctx, 'sinkhole');
  assert.equal(sinkhole.status, 'FAIL');
  assert.match(sinkhole.observed, /evt-na\.vidaahub\.com accepted TCP :443/);
  assert.match(sinkhole.remedy, /ADGUARD_APPLY\.md/);
});

test('sinkhole probe watchdog kill counts as closed, not open', t => {
  const w = buildWorld(t, { hangHosts: ['dns.google'] });
  const ctx = run(w);
  const sinkhole = byName(ctx, 'sinkhole');
  assert.equal(sinkhole.status, 'PASS');
  assert.match(sinkhole.observed, /dns\.google unanswered — counted closed/);
  assert.equal(ctx.code, 0);
});

/* ---- prefs: SKIP on unreachable, never PASS ------------------------------------ */

test('prefs unreadable: SKIP, and the exit stays clean', t => {
  const w = buildWorld(t, { storageDir: true });
  const ctx = run(w);
  const prefs = byName(ctx, 'prefs');
  assert.equal(prefs.status, 'SKIP');
  assert.match(prefs.observed, /unreadable/);
  assert.notEqual(prefs.status, 'PASS');
  assert.equal(ctx.code, 0);
});

test('prefs storage reachable but zero keys: WARN for the data-loss trap', t => {
  const w = buildWorld(t, { storage: 'something else entirely\n' });
  const ctx = run(w);
  const prefs = byName(ctx, 'prefs');
  assert.equal(prefs.status, 'WARN');
  assert.match(prefs.observed, /no alvidaa_\* keys/);
});

test('prefs root-owned fossil: WARN naming findings 12', t => {
  const w = buildWorld(t, { storageOwner: 'root:root' });
  const ctx = run(w);
  const prefs = byName(ctx, 'prefs');
  assert.equal(prefs.status, 'WARN');
  assert.match(prefs.observed, /owned by root/);
  assert.match(prefs.observed, /findings 12/);
});

test('no sdk.storage file at all: SKIP (the engine never wrote prefs)', t => {
  const w = buildWorld(t, { storage: null });
  const ctx = run(w);
  assert.equal(byName(ctx, 'prefs').status, 'SKIP');
});

/* ---- the recovery record -------------------------------------------------------- */

test('no recovery record: SKIP, and the bundle check says it compared nothing', t => {
  const w = buildWorld(t, { record: null });
  const ctx = run(w);
  assert.equal(byName(ctx, 'record').status, 'SKIP');
  assert.equal(ctx.code, 0);
  assert.match(byName(ctx, 'bundle').observed, /no recovery record to compare/);
});

test('malformed recovery record: SKIP with the reason, not a crash', t => {
  const w = buildWorld(t);
  fs.writeFileSync(recoveryRecord.recordPath(w.recDir, KEY), '{not json');
  const ctx = run(w);
  const record = byName(ctx, 'record');
  assert.equal(record.status, 'SKIP');
  assert.match(record.observed, /unreadable/);
  assert.equal(ctx.code, 0);
});

/* ---- the lane gate --------------------------------------------------------------- */

test('dropbear not answering: the lane gate fails and nothing else runs', t => {
  const w = buildWorld(t);
  const transport = {
    exec() { throw new Error('ssh failed: Connection closed by remote host'); },
    readFile() { throw new Error('unreachable'); },
    connect: () => Promise.resolve(false)
  };
  const ctx = driftCheck.runDriftCheck(Object.assign({}, w.opts, { transport }), w.deps);
  assert.deepEqual(names(ctx), ['dropbear']);
  assert.equal(byName(ctx, 'dropbear').status, 'FAIL');
  assert.equal(driftCheck.verdict(ctx.results).code, 1);
});

/* ---- --json ---------------------------------------------------------------------- */

test('--json emits exactly one parseable object with the verdict and the unit', t => {
  const w = buildWorld(t, { watcher: true }); // one FAIL so the JSON shows drift
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try {
    code = driftCheck.main(['node', 'drift-check.cjs', '--model', '50a51huv',
      '--fixture', w.dir, '--record-dir', w.recDir, '--json'], w.deps);
  } finally {
    console.log = orig;
  }
  assert.equal(code, 1);
  assert.equal(lines.length, 1, 'one line of stdout');
  const parsed = JSON.parse(lines[0]);
  assert.equal(parsed.tool, 'drift-check');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.exit, 1);
  assert.equal(parsed.model, '50a51huv');
  assert.equal(parsed.unit.key, KEY);
  assert.equal(parsed.checks.length, 8);
  assert.ok(parsed.checks.every(c => c.name && c.status && typeof c.observed === 'string'));
  assert.match(parsed.verdict, /^DRIFT on 50A51HUV/);
  const jsonNoDrift = buildWorld(t);
  const lines2 = [];
  console.log = (...a) => lines2.push(a.join(' '));
  try {
    code = driftCheck.main(['node', 'drift-check.cjs', '--model', '50a51huv',
      '--fixture', jsonNoDrift.dir, '--record-dir', jsonNoDrift.recDir, '--json'], jsonNoDrift.deps);
  } finally {
    console.log = orig;
  }
  assert.equal(code, 0);
  assert.equal(JSON.parse(lines2[0]).ok, true);
});

/* ---- usage ------------------------------------------------------------------------ */

test('usage errors exit 2 with the usage text; --help exits clean', t => {
  assert.throws(() => driftCheck.main(['node', 'drift-check.cjs', '--fixture', '/tmp']), driftCheck.UsageError);
  assert.throws(() => driftCheck.main(['node', 'drift-check.cjs', '--model', '50a51huv']), driftCheck.UsageError);
  assert.throws(() => driftCheck.main(['node', 'drift-check.cjs', '--model', 'nosuch', '--fixture', '/tmp']), /unknown model/);
  assert.throws(() => driftCheck.main(['node', 'drift-check.cjs', '--model', '50a51huv', '--host', 'x', '--nope']), /unknown flag/);
  const orig = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try {
    code = driftCheck.main(['node', 'drift-check.cjs', '--help']);
  } finally { console.log = orig; }
  assert.equal(code, driftCheck.EXIT.CLEAN);
  assert.match(lines[0], /^usage:/);
});
