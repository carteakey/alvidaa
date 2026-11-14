'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { EXIT, UsageError, parse, verifyAfter, analyzeFrame, main, fixtureRemote,
  CAPTURE, WATCHER_BACKUP } = require('./verify-install.cjs');
const { CONFIG } = require('./native-trial.cjs');
const { MODELS } = require('./native-install.cjs');

const M = MODELS.models['50a51huv'];
const APP = M.app;
const HERE = __dirname;

const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const CANDIDATE = Buffer.from('/* candidate bundle v2 */\n');
const STOCK = Buffer.from('/* pinned stock bundle */\n');
const NO_SLEEP = async () => {};

/* ---- tiny PNG builder: real chunks, CRC fields zeroed (the analyzer does
 * not verify CRCs — it is a heuristic, not an image validator) ------------- */
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const head = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); // zeros: the analyzer ignores CRCs by design
  return Buffer.concat([len, head, crc]);
}
function ihdr(width, height) {
  const d = Buffer.alloc(13);
  d.writeUInt32BE(width, 0);
  d.writeUInt32BE(height, 4);
  d[8] = 8;  // bit depth
  d[9] = 2;  // colour type: truecolour RGB
  // compression, filter, interlace: 0
  return chunk('IHDR', d);
}
function rawRows(width, height, fill) {
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x++) {
      const v = fill(x, y);
      row[1 + x * 3] = v;
      row[2 + x * 3] = v;
      row[3 + x * 3] = v;
    }
    rows.push(row);
  }
  return Buffer.concat(rows);
}
const CONTENT_PNG = Buffer.concat([PNG_SIG, ihdr(32, 18),
  chunk('IDAT', zlib.deflateSync(rawRows(32, 18, (x, y) => (x * 7 + y * 13 + x * y) & 0xff))), chunk('IEND', Buffer.alloc(0))]);
const BLACK_PNG = Buffer.concat([PNG_SIG, ihdr(32, 18),
  chunk('IDAT', zlib.deflateSync(rawRows(32, 18, () => 0x10))), chunk('IEND', Buffer.alloc(0))]);
const GREY_PNG = Buffer.concat([PNG_SIG, ihdr(32, 18),
  chunk('IDAT', zlib.deflateSync(rawRows(32, 18, () => 0x80))), chunk('IEND', Buffer.alloc(0))]);

/* ---- a scripted fake TV over deploy-check's transport shape --------------
 * The engine scan emulates the shell's zombie rule (deploy-check's
 * engineScan filters server-side), so the tests cover what the module sees. */
function fakeTV(spec = {}) {
  const files = new Map();
  files.set(APP, spec.bundle !== undefined ? spec.bundle : CANDIDATE);
  if (spec.config !== null) {
    files.set(CONFIG, spec.config === undefined
      ? JSON.stringify({ watcher: { enabled: spec.watcher === true } })
      : spec.config);
  }
  if (spec.backupWatcher !== undefined) {
    files.set(WATCHER_BACKUP, JSON.stringify({ watcher: { enabled: spec.backupWatcher } }));
  }
  const pids = spec.pids === undefined ? [{ pid: 5150, state: 'S' }] : spec.pids;
  const captures = [...(spec.captures || ['content'])];
  const pngOf = kind => (kind === 'black' ? BLACK_PNG : CONTENT_PNG);
  const state = { lastCapture: null, commands: [] };
  return {
    state,
    exec(cmd) {
      state.commands.push(cmd);
      const c = cmd.replace(/^export PATH=[^;]*; /, '').replace(/\s*2>\/dev\/null/g, '').trim();
      let m;
      if ((m = c.match(/^md5sum (\S+)$/))) {
        const data = files.get(m[1]);
        return data ? md5(data) + '  ' + m[1] + '\n' : ''; // missing file: empty stdout
      }
      if (c.includes('/proc/[0-9]*')) {
        const engine = (c.match(/grep -q '\/([^']+)\$'/) || [])[1];
        return pids.filter(p => p.matches !== false && p.state !== 'Z').map(p => String(p.pid)).join('\n')
          + (pids.some(p => p.matches !== false && p.state !== 'Z') ? '\n' : '');
      }
      if (c.startsWith('/usr/local/bin/screenshot ')) {
        const kind = captures.length ? captures.shift() : 'missing';
        state.lastCapture = kind;
        if (kind === 'missing') return '';
        return '-rw-r--r-- 1 root root ' + pngOf(kind).length + ' Nov 10 12:00 ' + CAPTURE;
      }
      if (c === 'rm -f ' + CAPTURE) { state.lastCapture = null; return ''; }
      throw new Error('fake tv: unhandled command: ' + c);
    },
    readFile(p) {
      if (p === CAPTURE) {
        if (!state.lastCapture) throw new Error('cannot read ' + p + ' over ssh (status 1)');
        return pngOf(state.lastCapture);
      }
      if (!files.has(p)) throw new Error('cannot read ' + p + ' over ssh (status 1)');
      return Buffer.from(files.get(p));
    },
    connect() { return true; }
  };
}

function run(spec, expected = {}) {
  return verifyAfter({
    transport: fakeTV(spec),
    model: M,
    expected: { md5: md5(spec.bundle || CANDIDATE), kind: 'candidate', previousPid: 4242, ...expected },
    sleep: NO_SLEEP
  });
}

const byName = (r, name) => r.checks.find(c => c.name === name);

/* ---- the frame analyzer --------------------------------------------------- */

test('analyzeFrame separates content from uniform frames and refuses garbage', () => {
  assert.equal(analyzeFrame(CONTENT_PNG).uniform, false);
  assert.equal(analyzeFrame(BLACK_PNG).uniform, true);
  // "Uniform" is not "dark": a solid grey is exactly as undrawn as black.
  assert.equal(analyzeFrame(GREY_PNG).uniform, true);
  assert.throws(() => analyzeFrame(Buffer.from('GIF89a not a png at all')), /not a PNG/);
  assert.throws(() => analyzeFrame(PNG_SIG.subarray(0, 4)), /not a PNG/);
  // A real truncation (ssh cut mid-transfer) lands inside the IDAT body.
  const truncated = CONTENT_PNG.subarray(0, CONTENT_PNG.length - 100);
  assert.throws(() => analyzeFrame(truncated), /truncated/);
  const noIdat = Buffer.concat([PNG_SIG, ihdr(4, 4), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => analyzeFrame(noIdat), /no image data/);
  const badZlib = Buffer.concat([PNG_SIG, ihdr(4, 4), chunk('IDAT', Buffer.from('not deflate')), chunk('IEND', Buffer.alloc(0))]);
  assert.throws(() => analyzeFrame(badZlib), /does not inflate/);
});

/* ---- the four checks, end to end ------------------------------------------ */

test('a healthy install verifies: md5, new pid, content frame, watcher off', async () => {
  const r = await run({});
  assert.equal(r.ok, true);
  assert.deepEqual(r.checks.map(c => c.status), ['PASS', 'PASS', 'PASS', 'PASS']);
  assert.match(byName(r, 'bundle').observed, new RegExp(md5(CANDIDATE).slice(0, 8)));
  assert.match(byName(r, 'engine').observed, /restarted: pid 5150 \(was 4242\)/);
  assert.match(byName(r, 'frame').observed, /frame has content/);
  assert.match(r.verdict, /^VERIFIED on 50A51HUV/);
});

test('an md5 mismatch fails, names both hashes, and the verdict blames the old bundle', async () => {
  const r = await run({ bundle: STOCK }, { md5: md5(CANDIDATE) });
  const bundle = byName(r, 'bundle');
  assert.equal(bundle.status, 'FAIL');
  assert.ok(bundle.observed.includes('on-TV md5 ' + md5(STOCK)), bundle.observed);
  assert.ok(bundle.observed.includes('!= expected ' + md5(CANDIDATE)), bundle.observed);
  assert.ok(bundle.observed.includes('the old bundle is still in place'), bundle.observed);
  assert.equal(r.ok, false);
  assert.ok(r.verdict.includes('the old bundle is still in place'), r.verdict);
});

test('an unchanged engine pid fails: the engine did not restart', async () => {
  const r = await run({ pids: [{ pid: 4242, state: 'S' }] });
  const engine = byName(r, 'engine');
  assert.equal(engine.status, 'FAIL');
  assert.ok(engine.observed.includes('did not restart'), engine.observed);
  assert.ok(engine.observed.includes('pid 4242'), engine.observed);
  assert.match(engine.remedy, /never loaded/);
  assert.equal(r.ok, false);
  assert.ok(r.verdict.includes('did not restart'), r.verdict);
});

test('an absent engine fails, and points at switch.log', async () => {
  const r = await run({ pids: [] });
  const engine = byName(r, 'engine');
  assert.equal(engine.status, 'FAIL');
  assert.match(engine.observed, /no live hisenseUI process/);
  assert.match(engine.remedy, new RegExp(M.state.replace(/\//g, '\\/') + '\\/switch\\.log'));
  assert.equal(r.ok, false);
});

test('a zombie engine is not counted as alive', async () => {
  // The shell-side scan filters zombies (same rule as live_engine()); the TV
  // where the only engine process is a zombie reads as "no live engine".
  const r = await run({ pids: [{ pid: 4242, state: 'Z' }] });
  const engine = byName(r, 'engine');
  assert.equal(engine.status, 'FAIL');
  assert.match(engine.observed, /no live hisenseUI process/);
});

test('a black frame retries once: black then content passes, black twice fails', async () => {
  const good = await run({ captures: ['black', 'content'] });
  assert.equal(byName(good, 'frame').status, 'PASS');
  assert.match(byName(good, 'frame').observed, /on retry/);
  assert.match(byName(good, 'frame').observed, /trap 3/);
  assert.equal(good.ok, true);

  const bad = await run({ captures: ['black', 'black'] });
  const frame = byName(bad, 'frame');
  assert.equal(frame.status, 'FAIL');
  assert.match(frame.observed, /uniformly black even on retry/);
  assert.match(frame.remedy, /trap 3/);
  assert.equal(bad.ok, false);
  assert.ok(bad.verdict.includes('uniformly black'), bad.verdict);
});

test('a capture that never lands fails with the polling remedy', async () => {
  const r = await run({ captures: ['missing', 'missing'] });
  const frame = byName(r, 'frame');
  assert.equal(frame.status, 'FAIL');
  assert.match(frame.observed, /no capture after two attempts/);
  assert.match(frame.remedy, /asynchronous/);
  assert.match(frame.remedy, /6–8 s/);
  assert.match(frame.remedy, /tools\/screenshot\.sh/);
  assert.equal(r.ok, false);
});

test('a watcher left on after a native install warns but still verifies', async () => {
  const r = await run({ watcher: true });
  const watcher = byName(r, 'watcher');
  assert.equal(watcher.status, 'WARN');
  assert.match(watcher.observed, /watcher\.enabled is true/);
  assert.match(watcher.remedy, /bounce the native Home/);
  assert.equal(r.ok, true);
  assert.match(r.verdict, /warnings: watcher/);
});

test('a rollback expectation checks the stock md5 and the pre-native watcher value', async () => {
  // Stock in place, watcher matching the backup: verified.
  const back = await run({ bundle: STOCK, watcher: true, backupWatcher: true },
    { md5: md5(STOCK), kind: 'stock' });
  assert.equal(byName(back, 'bundle').status, 'PASS');
  assert.match(byName(back, 'bundle').observed, /— stock/);
  assert.equal(byName(back, 'watcher').status, 'PASS');
  assert.match(byName(back, 'watcher').observed, /matches the pre-native value/);
  assert.equal(back.ok, true);

  // Stock in place, but the watcher was re-enabled over the rollback: warn.
  const drifted = await run({ bundle: STOCK, watcher: true, backupWatcher: false },
    { md5: md5(STOCK), kind: 'stock' });
  assert.equal(byName(drifted, 'watcher').status, 'WARN');
  assert.match(byName(drifted, 'watcher').observed, /pre-native backup says off/);
  assert.equal(drifted.ok, true);

  // Not-rollback case: the bundle md5 must be the stock one, not just any.
  const wrong = await run({ bundle: CANDIDATE, backupWatcher: true },
    { md5: md5(STOCK), kind: 'stock' });
  assert.equal(byName(wrong, 'bundle').status, 'FAIL');
  assert.ok(byName(wrong, 'bundle').observed.includes('the stock bundle is not in place'));
  assert.equal(wrong.ok, false);

  // No backup at all: warn that the pre-native state is unknown.
  const noBak = await run({ bundle: STOCK }, { md5: md5(STOCK), kind: 'stock' });
  assert.equal(byName(noBak, 'watcher').status, 'WARN');
  assert.match(byName(noBak, 'watcher').observed, /pre-native watcher state is unknown/);
});

test('a bundle the TV will not md5 and a config the TV will not parse degrade loudly', async () => {
  const noBundle = await run({ bundle: null });
  assert.equal(byName(noBundle, 'bundle').status, 'FAIL');
  assert.match(byName(noBundle, 'bundle').observed, /could not md5/);

  const badConfig = await run({ config: '{ oops' });
  assert.equal(byName(badConfig, 'watcher').status, 'WARN');
  assert.match(byName(badConfig, 'watcher').observed, /not valid JSON/);
  assert.equal(badConfig.ok, true); // the config being unreadable is not a broken install

  const noConfig = await run({ config: null });
  assert.equal(byName(noConfig, 'watcher').status, 'WARN');
  assert.match(byName(noConfig, 'watcher').observed, /no .*config\.json on the TV/);
});

test('every check still runs after an earlier FAIL: the results are independent evidence', async () => {
  const r = await run({ bundle: STOCK, pids: [] }, { md5: md5(CANDIDATE) });
  assert.deepEqual(r.checks.map(c => c.name), ['bundle', 'engine', 'frame', 'watcher']);
  assert.equal(r.checks.filter(c => c.status === 'FAIL').length, 2);
});

/* ---- input validation ------------------------------------------------------ */

test('verifyAfter refuses a transport or profile that is not deploy-check shaped', async () => {
  await assert.rejects(() => verifyAfter({ transport: {}, model: M, expected: {} }),
    /transport with exec/);
  await assert.rejects(() => verifyAfter({ transport: fakeTV(), model: { name: 'x' }, expected: {} }),
    /model profile with app, engine/);
  await assert.rejects(() => verifyAfter({ transport: fakeTV(), model: M, expected: { md5: 'nope' } }),
    /32-hex md5/);
  await assert.rejects(() => verifyAfter({ transport: fakeTV(), model: M, expected: { md5: md5(CANDIDATE), kind: 'undo' } }),
    /kind must be/);
  await assert.rejects(() => verifyAfter({ transport: fakeTV(), model: M, expected: { md5: md5(CANDIDATE), previousPid: -1 } }),
    /previousPid/);
});

test('the command line parses flags and refuses bad ones', () => {
  const parsed = parse(['node', 'x', '--model', '50a51huv', '--host', '192.0.2.10',
    '--expect-md5', 'a'.repeat(32), '--previous-pid', '4242', '--json']);
  assert.equal(parsed.model, '50a51huv');
  assert.equal(parsed.expectMd5, 'a'.repeat(32));
  assert.equal(parsed.previousPid, 4242);
  assert.equal(parsed.json, true);
  assert.throws(() => parse(['node', 'x', '--bogus']), UsageError);
  assert.throws(() => parse(['node', 'x', '--kind', 'undo']), /must be 'candidate' or 'stock'/);
  assert.throws(() => parse(['node', 'x', '--previous-pid', '0']), /positive integer/);
  assert.throws(() => parse(['node', 'x', '--expect-md5']), /needs a value/);
});

test('main exits OK on a healthy TV and NOT_VERIFIED on a broken one', async () => {
  const argv = ['node', 'x', '--model', '50a51huv', '--host', '192.0.2.10',
    '--expect-md5', md5(CANDIDATE), '--previous-pid', '4242'];
  assert.equal(await main(argv, { transport: fakeTV({}), sleep: NO_SLEEP }), EXIT.OK);
  assert.equal(await main(argv, { transport: fakeTV({ bundle: STOCK }), sleep: NO_SLEEP }), EXIT.NOT_VERIFIED);
  await assert.rejects(() => main(['node', 'x', '--model', '50a51huv', '--host', 'h']),
    /--expect-md5 <md5> is required/);
  await assert.rejects(() => main(['node', 'x', '--model', 'nope', '--host', 'h']), /unknown model/);
});

test('--json emits one parseable object and nothing else', async () => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args);
  try {
    const code = await main(['node', 'x', '--model', '50a51huv', '--host', '192.0.2.10',
      '--expect-md5', md5(CANDIDATE), '--previous-pid', '4242', '--json'],
      { transport: fakeTV({ watcher: true }), sleep: NO_SLEEP });
    assert.equal(code, EXIT.OK);
  } finally { console.log = original; }
  assert.equal(lines.length, 1, 'exactly one stdout write, got ' + lines.length);
  assert.equal(lines[0].length, 1, 'the write is one string');
  const parsed = JSON.parse(lines[0][0]);
  assert.equal(parsed.tool, 'verify-install');
  assert.equal(parsed.ok, true);
  assert.equal(parsed.exit, EXIT.OK);
  assert.equal(parsed.model, '50a51huv');
  assert.equal(parsed.host, '192.0.2.10');
  assert.equal(parsed.expected.kind, 'candidate');
  assert.equal(parsed.expected.previousPid, 4242);
  assert.equal(parsed.checks.length, 4);
  assert.equal(parsed.checks.find(c => c.name === 'watcher').status, 'WARN');
  assert.match(parsed.verdict, /^VERIFIED/);
});

/* ---- fixture mode ---------------------------------------------------------- */

test('fixture mode runs the healthy path against a fake TV tree', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-verify-fixture-'));
  try {
    const map = p => path.join(dir, p);
    fs.mkdirSync(map(path.dirname(APP)), { recursive: true });
    fs.writeFileSync(map(APP), CANDIDATE);
    fs.mkdirSync(map('/proc/5150'), { recursive: true });
    fs.symlinkSync('/opt/hisenseUI/bin/hisenseUI', map('/proc/5150/exe'));
    fs.writeFileSync(map('/proc/5150/status'), 'State:\tS (sleeping)\n');
    fs.mkdirSync(map(path.dirname(CONFIG)), { recursive: true });
    fs.writeFileSync(map(CONFIG), JSON.stringify({ watcher: { enabled: false } }));
    fs.mkdirSync(map(path.dirname(CAPTURE)), { recursive: true });
    fs.writeFileSync(map(CAPTURE), CONTENT_PNG);
    const lines = [];
    const original = console.log;
    console.log = (...args) => lines.push(args);
    try {
      const code = await main(['node', 'x', '--model', '50a51huv', '--fixture', dir,
        '--expect-md5', md5(CANDIDATE)], { sleep: NO_SLEEP });
      assert.equal(code, EXIT.OK);
    } finally { console.log = original; }
    const text = lines.map(a => a.join(' ')).join('\n');
    assert.match(text, /PASS  bundle /);
    assert.match(text, /PASS  engine /);
    assert.match(text, /PASS  frame /);
    assert.match(text, /PASS  watcher /);
    assert.match(text, /^VERIFIED on 50A51HUV/m);
    // An empty fixture (no engine, no capture file) fails honestly.
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-verify-fixture-'));
    try {
      const code = await main(['node', 'x', '--model', '50a51huv', '--fixture', empty,
        '--expect-md5', md5(CANDIDATE)], { sleep: NO_SLEEP });
      assert.equal(code, EXIT.NOT_VERIFIED);
    } finally { fs.rmSync(empty, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the fixture transport emulates the capture lane and md5 only, and says so otherwise', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-verify-fixture-'));
  try {
    const remote = fixtureRemote(dir);
    assert.equal(remote.exec('/usr/local/bin/screenshot /tmp x >/dev/null 2>&1; ls -la ' + CAPTURE + ' 2>/dev/null'), '');
    assert.equal(remote.exec('rm -f ' + CAPTURE + ' 2>/dev/null'), '');
    assert.throws(() => remote.exec('reboot'), /fixture cannot emulate/);
    assert.equal(remote.connect(), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
