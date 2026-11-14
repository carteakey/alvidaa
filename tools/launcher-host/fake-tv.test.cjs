'use strict';
/* fake-tv.test.cjs — the fake TV (issue #59).
 *
 * The centre of the suite is the acceptance run: native-install.cjs, unmodified
 * (only its ssh lane and poll sleep swapped, per its own seams), driving the
 * fake through a real install, a re-run switch, and a rollback. Around it: one
 * test per failure flag, each asserting the TV state the real failure leaves
 * behind; the dropbear-reset flag exercising the poll loop's retry; and the
 * loud-refusal contract.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { MODELS, install, rollback, status, WATCHER_BACKUP } = require('./native-install.cjs');
const { engineScan } = require('./deploy-check.cjs');
const { createFakeTv } = require('./fake-tv.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const M = MODELS.models['50a51huv'];
const P = 'export PATH=/bin:/usr/bin:/sbin:/usr/local/bin; ';

// Deterministic candidate bytes: the installer computes the candidate md5 on
// the host with real md5sum, and the fake is told the same value, so the
// switch gate compares like against like.
const CANDIDATE_TEXT =
  '/* fake-tv acceptance candidate: deterministic bytes so the md5 contract holds */\n';
const CANDIDATE_MD5 = crypto.createHash('md5').update(CANDIDATE_TEXT).digest('hex');
const ORIGINAL_CONFIG = JSON.stringify({ watcher: { enabled: true } });

function makeTv(flags) {
  return createFakeTv({
    engine: M.engine, state: M.state, app: M.app,
    stockMd5: M.stock_md5, candidateMd5: CANDIDATE_MD5, flags
  });
}

// The stock bundle is vendor code and never enters the repo, so the acceptance
// run stubs the builder — the same stand-in pattern as the wiring tests in
// native-install.test.cjs — and cleans up only what it created.
function stubBuilder(t) {
  const stock = path.join(REPO, M.local_stock);
  const out = path.join(REPO, 'firmware', '50a51huv', 'candidate-alvidaa.js');
  const hadStock = fs.existsSync(stock);
  const hadOut = fs.existsSync(out);
  fs.mkdirSync(path.dirname(stock), { recursive: true });
  if (!hadStock) fs.writeFileSync(stock, '/* test stand-in for the pinned stock bundle */\n');
  t.after(() => {
    if (!hadStock) {
      fs.rmSync(stock, { force: true });
      for (let dir = path.dirname(stock); dir !== path.join(REPO, 'firmware'); dir = path.dirname(dir)) {
        try { fs.rmdirSync(dir); } catch (_) { break; }
      }
    }
    if (!hadOut) {
      fs.rmSync(out, { force: true });
      try { fs.rmdirSync(path.dirname(out)); } catch (_) { /* not empty or already gone */ }
    }
  });
  return { build: (stockFile, outFile) => { fs.writeFileSync(outFile, CANDIDATE_TEXT); return CANDIDATE_TEXT; } };
}

function capture(fn) {
  const logs = [], warnings = [];
  const originalLog = console.log, originalWarn = console.warn;
  console.log = message => logs.push(String(message));
  console.warn = message => warnings.push(String(message));
  try { return { logs, warnings, result: fn() }; }
  finally { console.log = originalLog; console.warn = originalWarn; }
}

// native-install.cjs runs unmodified: the only substitutions are the seams it
// already exposes for tests (opts.ssh, opts.sleep) and the two flags that skip
// its host-side side modules (recovery-record and verify-install run on
// transports of their own; see FAKE-TV.md).
function runInstall(tv, t, extra) {
  return capture(() => install('alvidaa', Object.assign({
    ssh: tv.ssh, sleep: () => {}, model: '50a51huv',
    builder: stubBuilder(t), noRecord: true, noVerify: true
  }, extra || {})));
}

function runRollback(tv) {
  return capture(() => rollback({ ssh: tv.ssh, sleep: () => {}, model: '50a51huv', noVerify: true }));
}

/* ------------------------------------------------- the refusal contract -- */

test('an unknown command throws loudly; a known one on a missing file fails TV-shaped', () => {
  const tv = makeTv();
  assert.throws(() => tv.ssh({}, P + 'curl -s -m 3 http://127.0.0.1:8770/api/debug'),
    /fake TV: unhandled command/);
  assert.throws(() => tv.ssh({}, P + '/opt/vendor/bin/frobnicate --all'),
    /fake TV: unhandled command/);
  // Missing files are non-zero exits, not empty output: the installer's poll
  // loop treats exactly this throw as "not there yet".
  assert.throws(() => tv.ssh({}, P + 'cat ' + M.state + '/switch.done 2>/dev/null'),
    /ssh failed \(1\): cat: can't open/);
  assert.throws(() => tv.ssh({}, P + 'md5sum /no/such/file'), /ssh failed \(1\): md5sum/);
  assert.equal(tv.ssh({}, P + 'test -f ' + M.state + '/switch-home.sh && echo yes || echo no').trim(), 'yes');
  assert.equal(tv.ssh({}, P + 'test -f /nope && echo yes || echo no').trim(), 'no');
});

test('grep answers through the exit code with -q and through output without', () => {
  const tv = makeTv();
  assert.equal(tv.ssh({}, P + "grep -q 'enabled' " + tv.config), '');
  assert.throws(() => tv.ssh({}, P + "grep -q 'absent-key' " + tv.config), /ssh failed \(1\)/);
  assert.throws(() => tv.ssh({}, P + "grep -q 'x' /no/such/file"), /ssh failed \(2\): grep/);
  assert.match(tv.ssh({}, P + 'grep watcher ' + tv.config), /watcher/);
});

/* ------------------------------------------------------ the engine scan -- */

test('the engine scan matches the binary and excludes zombies and bystanders', () => {
  const tv = makeTv();
  tv.procs.set(500, { exe: '/opt/hisenseUI/bin/hisenseUI', state: 'Z', ppid: 1 });
  tv.procs.set(501, { exe: '/opt/other/bin/other', state: 'S', ppid: 1 });
  assert.equal(tv.ssh({}, P + engineScan(M.engine)).trim(), '4242',
    'the zombie and the unrelated binary are not engine pids');
  tv.procs.delete(4242);
  assert.equal(tv.ssh({}, P + engineScan(M.engine)).trim(), '',
    'a stopped engine scans as empty, so the switch never signals a zombie');
});

/* ------------------------------------------------- the acceptance runs --- */

test('a clean install runs native-install end to end: bundle, cache, phase, watcher', t => {
  const tv = makeTv();
  const { logs } = runInstall(tv, t);
  assert.ok(logs.includes('mode: install'), logs.join('\n'));
  assert.ok(logs.some(l => l.includes('is installed on ' + M.name)), logs.join('\n'));

  // The bundle is the candidate, byte for byte, reporting the candidate md5;
  // candidate.md5 carries the value the installer computed on the host.
  const appRecord = tv.files.get(M.app);
  assert.equal(appRecord.md5, CANDIDATE_MD5);
  assert.equal(appRecord.content.toString(), CANDIDATE_TEXT);
  assert.equal(tv.files.get(tv.candidatePath).content.toString(), CANDIDATE_TEXT);
  assert.equal(tv.files.get(M.state + '/candidate.md5').content.toString(), CANDIDATE_MD5 + '\n');

  // The stock-era JS cache moved to the backup; the engine starts from empty
  // cache dirs — the 55A7KAU lesson the switch script exists to enforce.
  assert.equal(tv.files.has(tv.cache + '/compiled_js/bundle-1.js'), false);
  assert.equal(tv.files.has(M.state + '/backup/compiled_js/bundle-1.js'), true);
  assert.ok(tv.dirs.has(tv.cache + '/compiled_js') && tv.dirs.has(tv.cache + '/uncompiled_js'));

  // Verdict, log, phase, engine pid: the done/log contract the poll reads.
  assert.match(tv.files.get(M.state + '/switch.done').content.toString(), /^OK mode=install new=\d+\n$/);
  const logText = tv.files.get(M.state + '/switch.log').content.toString();
  assert.match(logText, /=== switch-home mode=install ===/);
  assert.match(logText, /OK mode=install old=4242 new=4243/);
  assert.match(logText, new RegExp('app\\.js md5 now ' + CANDIDATE_MD5));
  assert.equal(tv.files.get(M.state + '/phase').content.toString(), 'install\n');

  // The watcher step: disabled in the live config, the original preserved
  // exactly once, and no staging temp left behind.
  assert.equal(JSON.parse(tv.files.get(tv.config).content.toString()).watcher.enabled, false);
  assert.equal(tv.files.get(WATCHER_BACKUP).content.toString(), ORIGINAL_CONFIG);
  assert.equal(tv.files.has(WATCHER_BACKUP + '.tmp-native-home'), false);

  // status is the operator's view of the same facts.
  const st = capture(() => status({ ssh: tv.ssh, model: '50a51huv' }));
  assert.ok(st.logs.some(l => l.includes('app.js md5 ' + CANDIDATE_MD5)), st.logs.join('\n'));
  assert.ok(st.logs.some(l => l.includes('phase      install')), st.logs.join('\n'));
  assert.ok(st.logs.includes('watcher: off'), st.logs.join('\n'));
});

test('a re-run switches candidate to candidate and keeps the first stock backup', t => {
  const tv = makeTv();
  runInstall(tv, t);
  const { logs } = runInstall(tv, t);
  assert.ok(logs.includes('mode: switch'), logs.join('\n'));
  assert.match(tv.files.get(M.state + '/switch.done').content.toString(), /^OK mode=switch /);
  assert.equal(tv.files.get(M.app).md5, CANDIDATE_MD5, 'still the candidate after the switch');
  assert.equal(tv.files.get(M.state + '/backup/app.js.stock').md5, M.stock_md5,
    'the stock backup survives a candidate-to-candidate switch');
  assert.equal(tv.files.get(WATCHER_BACKUP).content.toString(), ORIGINAL_CONFIG,
    'the watcher backup is never replaced by a second run');
  assert.equal(tv.files.has(tv.cache + '/compiled_js/bundle-1.js'), false,
    'switch clears the cache instead of backing it up');
  assert.equal(tv.dirs.has(M.state + '/backup/compiled_js'), true,
    'the install-time cache backup stays for rollback');
});

test('rollback restores the stock bundle, the stock cache and the watcher', t => {
  const tv = makeTv();
  runInstall(tv, t);
  const { logs } = runRollback(tv);
  assert.ok(logs.some(l => l.includes('stock restored on ' + M.name)), logs.join('\n'));
  assert.equal(tv.files.get(M.app).md5, M.stock_md5);
  assert.deepEqual(tv.files.get(M.app).content,
    tv.files.get(M.state + '/backup/app.js.stock').content);
  assert.equal(tv.files.has(tv.cache + '/compiled_js/bundle-1.js'), true,
    'the stock cache came back from the backup');
  assert.equal(tv.dirs.has(M.state + '/backup/compiled_js'), false, 'the backup moved back');
  assert.equal(tv.files.get(M.state + '/phase').content.toString(), 'restored\n');
  assert.match(tv.files.get(M.state + '/switch.done').content.toString(), /^OK mode=rollback /);
  assert.equal(tv.files.get(tv.config).content.toString(), ORIGINAL_CONFIG,
    'the watcher config is restored byte-for-byte, and re-enabled');
});

/* ----------------------------------------------------- the failure flags -- */

test('homeStuck: the switch reports OK and the old bundle stays — the silent failure', t => {
  const tv = makeTv({ homeStuck: true });
  const { logs } = runInstall(tv, t);
  assert.ok(logs.includes('mode: install'), logs.join('\n'));
  assert.ok(logs.some(l => l.includes('is installed on ' + M.name)),
    'the installer believes it succeeded — that is the failure mode');
  assert.match(tv.files.get(M.state + '/switch.done').content.toString(), /^OK mode=install /);
  assert.equal(tv.files.get(M.app).md5, M.stock_md5, 'the bundle on disk never changed');
  assert.equal(tv.files.has(tv.cache + '/compiled_js/bundle-1.js'), true,
    'the cache was never touched either');
  assert.equal(tv.files.has(M.state + '/phase'), false, 'no phase was ever recorded');
  const st = capture(() => status({ ssh: tv.ssh, model: '50a51huv' }));
  assert.ok(st.logs.some(l => l.includes('app.js md5 ' + M.stock_md5)),
    'status still reports stock — the symptom an operator or verify run sees');
});

test('crashing: the engine never returns, the switch FAILs and the install aborts', t => {
  const tv = makeTv({ crashing: true });
  assert.throws(() => runInstall(tv, t), /switch failed: FAIL engine did not start/);
  assert.match(tv.files.get(M.state + '/switch.done').content.toString(), /^FAIL engine did not start/);
  const logText = tv.files.get(M.state + '/switch.log').content.toString();
  assert.match(logText, /engine stopped/);
  assert.match(logText, /APM did not restore the engine; launching through secure_exec/);
  // The real shape of this failure: the bundle DID swap, the engine is down,
  // and the watcher step never ran.
  assert.equal(tv.files.get(M.app).md5, CANDIDATE_MD5);
  assert.equal(JSON.parse(tv.files.get(tv.config).content.toString()).watcher.enabled, true);
});

test('staleCache: the bundle swaps but the JS cache survives the switch', t => {
  const tv = makeTv({ staleCache: true });
  const { logs } = runInstall(tv, t);
  assert.ok(logs.includes('mode: install'), logs.join('\n'));
  assert.match(tv.files.get(M.state + '/switch.done').content.toString(), /^OK mode=install /);
  assert.equal(tv.files.get(M.app).md5, CANDIDATE_MD5, 'the bundle did change');
  assert.equal(tv.files.has(tv.cache + '/compiled_js/bundle-1.js'), true,
    'the stock-era cache entry is still live — the engine will serve the old UI');
  assert.equal(tv.dirs.has(M.state + '/backup/compiled_js'), false, 'no cache backup was taken');
});

/* -------------------------------------------------------- the lane retry -- */

test('resetAfter: a dropbear reset during the poll is retried and the install completes', t => {
  const tv = makeTv();
  runInstall(tv, t);
  const poll = tv.calls.findIndex(c => /cat \S*switch\.done 2>\/dev\/null$/.test(c));
  assert.ok(poll >= 0, 'the poll was reached on the clean run');
  tv.reset();
  tv.flags.resetAfter = poll + 1; // 1-based: the first poll call is dropped
  const { logs } = runInstall(tv, t);
  assert.ok(logs.includes('mode: install'), logs.join('\n'));
  assert.equal(tv.calls[poll], tv.calls[poll + 1], 'the same poll was issued twice');
  assert.match(tv.calls[poll], /switch\.done/, 'the retry covered the poll call');
  assert.equal(tv.files.get(M.app).md5, CANDIDATE_MD5, 'the install completed');
  assert.match(tv.files.get(M.state + '/switch.done').content.toString(), /^OK mode=install /);
});

test('resetAfter outside the poll loop is fatal, as a mid-run reset is on the real TV', t => {
  const tv = makeTv();
  runInstall(tv, t);
  const upload = tv.calls.findIndex(c => /; cat > \S*candidate-native-home\.js$/.test(c));
  assert.ok(upload >= 0);
  tv.reset();
  tv.flags.resetAfter = upload + 1;
  assert.throws(() => runInstall(tv, t), /ssh failed \(255\)/);
  assert.equal(tv.files.get(M.app).md5, M.stock_md5, 'nothing was swapped');
  assert.equal(tv.files.has(M.state + '/switch.done'), false, 'the switch never started');
});

/* ------------------------------------------------------------ the gates --- */

test('the candidate md5 gate has teeth: a wrong hash FAILs the switch', t => {
  const tv = createFakeTv({
    engine: M.engine, state: M.state, app: M.app,
    stockMd5: M.stock_md5, candidateMd5: '0'.repeat(32)
  });
  assert.throws(() => runInstall(tv, t), /switch failed: FAIL candidate hash mismatch/);
  assert.equal(tv.files.get(M.app).md5, M.stock_md5, 'the stock bundle is untouched');
  assert.match(tv.files.get(M.state + '/switch.log').content.toString(), /FAIL candidate hash mismatch/);
});

/* ------------------------------------------------------------- reset() --- */

test('reset() restores the seeded TV, flags included, and stays installable', t => {
  const tv = makeTv();
  runInstall(tv, t);
  tv.flags.homeStuck = true;
  tv.reset();
  assert.equal(tv.files.get(M.app).md5, M.stock_md5);
  assert.equal(JSON.parse(tv.files.get(tv.config).content.toString()).watcher.enabled, true);
  for (const name of ['switch.done', 'switch.log', 'phase', 'candidate.md5', 'engine.env']) {
    assert.equal(tv.files.has(M.state + '/' + name), false, name + ' is gone after reset');
  }
  assert.equal(tv.files.has(WATCHER_BACKUP), false);
  assert.equal(tv.files.has(tv.cache + '/compiled_js/bundle-1.js'), true);
  assert.deepEqual([...tv.procs.keys()], [4242]);
  assert.equal(tv.calls.length, 0);
  assert.equal(tv.flags.homeStuck, false, 'runtime flags are cleared');
  const { logs } = runInstall(tv, t);
  assert.ok(logs.includes('mode: install'), 'the reset TV takes a clean install: ' + logs.join('\n'));
});
