#!/usr/bin/env node
'use strict';
/* verify-install — the post-install gate for a lane-3 switch (issue #49).
 *
 *   node tools/launcher-host/verify-install.cjs --model 50a51huv --host <tv-ip> \
 *     --expect-md5 <candidate md5> [--kind candidate|stock] [--previous-pid <pid>] [--json]
 *   node tools/launcher-host/verify-install.cjs --model 50a51huv --fixture <dir> ...
 *
 * deploy-check.cjs covers the *before*; this is the *after*. A lane-3 install
 * used to end at "the switch reported OK" plus a human with a screenshot, and
 * on 2026-11-10 that cost two debugging rounds: the bridge watcher bounced a
 * GOOD install back to the canvas page within a second, and the compiled-JS
 * cache served a STALE bundle after a same-filename push. Both are silent;
 * neither shows in the switch script's exit code. This tool answers the one
 * question that matters after a switch: is the thing that is running the
 * thing we just installed?
 *
 * The one rule is deploy-check's: the checks are claims about the TV, and the
 * tool only observes. No writes, no restarts, no kill — the single exception
 * is the frame capture, which lands in /tmp (tmpfs, gone at reboot) through
 * the same vendor lane tools/screenshot.sh uses, and whose temp file this
 * tool removes after reading. Every remedy it prints names a command owned
 * by native-install.cjs, the switch script, or the operator.
 *
 * Every remote interaction goes through the same interface deploy-check uses,
 * { exec(cmd) -> string, readFile(path) -> Buffer, connect(port) -> bool },
 * with sshRemote() borrowed from there for the real TV and a small
 * fixtureRemote() here for a fake TV tree on disk, so the whole command is
 * testable with no TV on the network (see VERIFY-INSTALL.md).
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const cp = require('node:child_process');

const deployCheck = require('./deploy-check.cjs');
const nativeInstall = require('./native-install.cjs');
const { CONFIG } = require('./native-trial.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const SSH_PORT = 2222;
const SSH_KEY = path.join(REPO, 'server/keys/tv_root_ed25519');
// native-install.cjs owns this constant; mirror it through its export so a
// rename there cannot silently desync the rollback check.
const WATCHER_BACKUP = nativeInstall.WATCHER_BACKUP || CONFIG + '.bak-native-home';
// Distinct from tools/screenshot.sh's alvidaa-shot.jpg so a verify run never
// collides with a manual capture. PNG bytes regardless of the name — the HAL
// decides the format (tools/screenshot.sh:33).
const CAPTURE_NAME = 'alvidaa-verify.png';
const CAPTURE = '/tmp/' + CAPTURE_NAME;
// One exec, the shape of tools/screenshot.sh:29-31 verbatim: the vendor HAL
// capture is asynchronous (6–8 s and occasionally longer — trap 3 in the
// lane-3 handoff), so the on-TV loop polls for the file before ls reports it.
const CAPTURE_CMD = '/usr/local/bin/screenshot /tmp ' + CAPTURE_NAME + ' >/dev/null 2>&1; ' +
  'n=0; while [ $n -lt 100 ] && [ ! -s ' + CAPTURE + ' ]; do sleep 0.2; n=$((n+1)); done; ' +
  'ls -la ' + CAPTURE + ' 2>/dev/null';
const EXIT = { OK: 0, NOT_VERIFIED: 1, USAGE: 2 };

const USAGE = [
  'usage: node tools/launcher-host/verify-install.cjs --model <id> --host <tv-ip> \\',
  '         --expect-md5 <md5> [--kind candidate] [--previous-pid <pid>] [--json]',
  '       node tools/launcher-host/verify-install.cjs --model <id> --host <tv-ip> --kind stock \\',
  '         [--previous-pid <pid>] [--json]',
  '       node tools/launcher-host/verify-install.cjs --model <id> --fixture <dir> ...',
  '',
  'A read-only post-install gate: is the thing that is running the thing we',
  'just installed? Exit 0 = verified, 1 = not verified, 2 = bad usage.',
  'See tools/launcher-host/VERIFY-INSTALL.md.'
].join('\n');

class UsageError extends Error {
  constructor(message) { super(message); this.usage = true; }
}

/* ---------------------------------------------------------------- usage -- */

function parse(argv) {
  const args = argv.slice(2);
  const opts = { port: SSH_PORT, key: SSH_KEY, json: false };
  let i = 0;
  const need = name => {
    if (i >= args.length) throw new UsageError(name + ' needs a value');
    return args[i++];
  };
  while (i < args.length) {
    const arg = args[i++];
    if (arg === '--model') opts.model = need('--model');
    else if (arg === '--host') opts.host = need('--host');
    else if (arg === '--expect-md5') opts.expectMd5 = need('--expect-md5');
    else if (arg === '--kind') {
      opts.kind = need('--kind');
      if (opts.kind !== 'candidate' && opts.kind !== 'stock') {
        throw new UsageError("--kind must be 'candidate' or 'stock'");
      }
    } else if (arg === '--previous-pid') {
      opts.previousPid = Number(need('--previous-pid'));
      if (!Number.isInteger(opts.previousPid) || opts.previousPid <= 0) {
        throw new UsageError('--previous-pid must be a positive integer');
      }
    } else if (arg === '--port') {
      opts.port = Number(need('--port'));
      if (!Number.isInteger(opts.port) || opts.port <= 0) throw new UsageError('--port must be a positive integer');
    } else if (arg === '--key') opts.key = need('--key');
    else if (arg === '--fixture') opts.fixture = need('--fixture');
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help') opts.help = true;
    else throw new UsageError('unknown flag: ' + arg);
  }
  return opts;
}

/* ------------------------------------------------------- remote lanes ---- */
/* sshRemote comes from deploy-check.cjs — one transport convention for both
 * tools. Only the fixture lives here, because the frame check needs a
 * behaviour deploy-check's fixture does not model: the async capture. */

/* A fake TV: a directory read as if it were the TV's root filesystem. exec()
 * emulates exactly the busybox invocations this tool issues and throws on
 * anything else. The frame must already exist at <dir>/tmp/alvidaa-verify.png
 * for the capture to "succeed": the fixture is a still, not an animator —
 * retry and black-frame behaviour is tested with scripted transports in the
 * test file. Layout: VERIFY-INSTALL.md. */
function fixtureRemote(dir) {
  const map = p => path.join(dir, p);
  const readText = p => { try { return fs.readFileSync(map(p), 'utf8'); } catch { return null; } };
  return {
    exec(cmd) {
      const c = cmd.replace(/^export PATH=[^;]*; /, '').replace(/\s*2>\/dev\/null/g, '').trim();
      let m = c.match(/^md5sum (\S+)$/);
      if (m) {
        try {
          return crypto.createHash('md5').update(fs.readFileSync(map(m[1]))).digest('hex') + '  ' + m[1] + '\n';
        } catch { return ''; } // busybox md5sum of a missing file: stdout only, empty
      }
      if (c.includes('/proc/[0-9]*')) {
        // Same zombie rule as the switch script's live_engine() and
        // deploy-check's fixture: a dead engine must not read as up.
        const engine = c.match(/grep -q '\/([^']+)\$'/)[1];
        let pids = [];
        try { pids = fs.readdirSync(map('/proc')).filter(p => /^\d+$/.test(p)); } catch { /* no /proc */ }
        let out = '';
        for (const pid of pids) {
          let exe;
          try { exe = fs.readlinkSync(map('/proc/' + pid + '/exe')); } catch { continue; }
          if (!exe.endsWith('/' + engine)) continue;
          if (/\nState:.* Z\b/.test('\n' + (readText('/proc/' + pid + '/status') || ''))) continue;
          out += pid + '\n';
        }
        return out;
      }
      if (c.startsWith('/usr/local/bin/screenshot ')) {
        try {
          const st = fs.statSync(map(CAPTURE));
          return st.size > 0 ? '-rw-r--r-- 1 root root ' + st.size + ' Nov 10 12:00 ' + CAPTURE : '';
        } catch { return ''; }
      }
      if (c === 'rm -f ' + CAPTURE) return '';
      throw new Error('fixture cannot emulate: ' + cmd);
    },
    readFile(p) { return fs.readFileSync(map(p)); },
    connect() { return !fs.existsSync(map('.unreachable')); }
  };
}

/* ---------------------------------------------------- the frame pixels --- */
/* Black-frame detection without an image library: parse the PNG container,
 * inflate the IDAT with node:zlib on the host, and treat "every decompressed
 * byte identical" as a uniform frame. The size heuristic below it is a fast
 * path, not the decision. Limits of the heuristic: VERIFY-INSTALL.md. */
function analyzeFrame(png) {
  const SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!Buffer.isBuffer(png) || png.length < 8 || !png.subarray(0, 8).equals(SIG)) {
    throw new Error('capture is not a PNG');
  }
  let ihdr = null;
  const idat = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const len = png.readUInt32BE(at);
    const type = png.toString('ascii', at + 4, at + 8);
    // One chunk is 4 (len) + 4 (type) + len (data) + 4 (crc) bytes.
    if (at + 12 + len > png.length) throw new Error('capture is truncated');
    const data = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      if (len < 13) throw new Error('capture has a malformed IHDR');
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        color: data[9],
        interlace: data[12]
      };
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    at += 12 + len;
  }
  if (!ihdr) throw new Error('capture has no IHDR');
  if (!idat.length) throw new Error('capture has no image data');
  const packed = Buffer.concat(idat);
  const dims = ihdr.width + 'x' + ihdr.height;
  // A uniform frame compresses to a few KB at any resolution this TV outputs
  // (DEFLATE runs of zeros); anything this large has real content in it, and
  // inflating it would only confirm that. Fast path, not the decision.
  if (packed.length > 4 * 1024 * 1024) {
    return { uniform: false, width: ihdr.width, height: ihdr.height, idat: packed.length, detail: dims + ', IDAT ' + kb(packed.length) + ' — too much content to be uniform' };
  }
  let raw;
  try { raw = zlib.inflateSync(packed); }
  catch { throw new Error('capture image data does not inflate (IDAT ' + kb(packed.length) + ')'); }
  // "Every pixel identical" is judged per scanline, not per byte: each row
  // begins with a PNG filter byte, and a pixel is 1–4 bytes (R,G,B[,A]), so
  // a solid red frame is uniform even though its bytes are not all equal.
  const bpp = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ihdr.color];
  let uniform = false;
  let detail = dims + ', IDAT ' + kb(packed.length);
  if (ihdr.depth !== 8 || !bpp) {
    // A layout this heuristic cannot walk: fall back to the strict check,
    // which is exact when it passes (all bytes equal covers any layout).
    uniform = raw.length > 0 && raw.equals(Buffer.alloc(raw.length, raw[0]));
  } else {
    const stride = 1 + ihdr.width * bpp;
    if (raw.length !== stride * ihdr.height) {
      throw new Error('capture raw size does not match its ' + dims + ' header');
    }
    let firstRow = null;
    uniform = true;
    for (let y = 0; y < ihdr.height; y++) {
      const row = raw.subarray(y * stride, (y + 1) * stride);
      if (row[0] !== 0) { // a filtered row: uniformity is no longer provable
        uniform = false;
        detail += ' — row ' + y + ' uses PNG filter ' + row[0] + ', judged as content';
        break;
      }
      const pixels = row.subarray(1);
      if (!firstRow) firstRow = Buffer.from(pixels);
      else if (!pixels.equals(firstRow)) { uniform = false; break; }
    }
  }
  return {
    uniform,
    width: ihdr.width,
    height: ihdr.height,
    idat: packed.length,
    raw: raw.length,
    detail
  };
}

function kb(n) {
  return n >= 10240 ? Math.round(n / 1024) + ' KB' : n + ' B';
}

/* --------------------------------------------------------------- checks -- */

function record(ctx, name, status, observed, remedy) {
  const r = { name, status, observed, remedy: status === 'PASS' ? null : (remedy || null) };
  ctx.results.push(r);
  return r;
}

/* 1. bundle — is the file at the profile's app path the thing we expected? */
function checkBundle(ctx) {
  const out = ctx.transport.exec('md5sum ' + ctx.m.app + ' 2>/dev/null').trim();
  const md5 = out.split(/\s+/)[0] || '';
  if (!md5) {
    return record(ctx, 'bundle', 'FAIL', 'could not md5 ' + ctx.m.app + ' on the TV (no answer)',
      'the bundle path is gone or unreadable; check the model profile and the operation-ui module');
  }
  if (md5 === ctx.expected.md5) {
    return record(ctx, 'bundle', 'PASS', md5 + (ctx.expected.kind === 'stock' ? ' — stock' : ' — the expected candidate'));
  }
  const what = ctx.expected.kind === 'stock'
    ? 'the stock bundle is not in place'
    : 'the old bundle is still in place';
  return record(ctx, 'bundle', 'FAIL',
    'on-TV md5 ' + md5 + ' != expected ' + ctx.expected.md5 + ' — ' + what,
    'the switch reported OK but the bundle did not change; re-run the install and read ' +
    ctx.m.state + '/switch.log');
}

/* 2. engine — is a live engine process running, and is it a NEW process?
 * A switch that did not restart the engine did not load the new bundle, and
 * did not reset the JS caches — the stale-cache half of 2026-11-10. */
function checkEngine(ctx) {
  const out = ctx.transport.exec(deployCheck.engineScan(ctx.m.engine)).trim();
  const pids = out.split('\n').filter(Boolean);
  if (!pids.length) {
    return record(ctx, 'engine', 'FAIL', 'no live ' + ctx.m.engine + ' process after the switch',
      'the engine is down: read ' + ctx.m.state + '/switch.log; restarts go through the switch script, never by hand');
  }
  if (ctx.expected.previousPid && pids.includes(String(ctx.expected.previousPid))) {
    return record(ctx, 'engine', 'FAIL',
      ctx.m.engine + ' did not restart: pid ' + ctx.expected.previousPid + ' is still the live process',
      'the engine must be a new process or the new bundle was never loaded; re-run the install');
  }
  const restart = ctx.expected.previousPid
    ? 'restarted: pid ' + pids[0] + ' (was ' + ctx.expected.previousPid + ')'
    : 'live: pid ' + pids[0] + ' (no pre-switch pid to compare)';
  return record(ctx, 'engine', 'PASS',
    ctx.m.engine + ' ' + restart + (pids.length > 1 ? ', +' + (pids.length - 1) + ' more' : ''));
}

/* 3. frame — is there anything actually drawn? The HAL capture is
 * asynchronous (6–8 s, occasionally longer — trap 3), so the on-TV loop in
 * CAPTURE_CMD polls, and a uniform frame is retried once: a black frame
 * while the engine restarts is not proof of a black screen. */
async function checkFrame(ctx) {
  let cap = captureOnce(ctx);
  if (!cap) {
    await ctx.sleep(2000);
    cap = captureOnce(ctx);
  }
  if (!cap) {
    return record(ctx, 'frame', 'FAIL', 'no capture after two attempts (~40 s of on-TV polling)',
      'the HAL capture is asynchronous and slow (6–8 s, occasionally longer — trap 3 in the lane-3 handoff); ' +
      'check /usr/local/bin/screenshot and sysctrlservice, or run tools/screenshot.sh by hand');
  }
  let first;
  try {
    first = analyzeFrame(ctx.transport.readFile(CAPTURE));
  } catch (e) {
    cleanupCapture(ctx);
    return record(ctx, 'frame', 'FAIL', e.message + ' (' + cap.size + ' B captured)',
      'the HAL wrote something unexpected; run tools/screenshot.sh by hand and inspect the file');
  }
  if (!first.uniform) {
    cleanupCapture(ctx);
    return record(ctx, 'frame', 'PASS', 'frame has content: ' + first.detail);
  }
  // Uniform. Retry once before failing: a black frame while the engine
  // restarts is expected and proves nothing.
  await ctx.sleep(2000);
  let second = null;
  let secondCap = captureOnce(ctx);
  if (secondCap) {
    try { second = analyzeFrame(ctx.transport.readFile(CAPTURE)); } catch { second = null; }
  }
  cleanupCapture(ctx);
  if (second && !second.uniform) {
    return record(ctx, 'frame', 'PASS',
      'frame has content on retry: ' + second.detail + ' (first capture was uniform — a black frame during the restart, trap 3)');
  }
  return record(ctx, 'frame', 'FAIL',
    secondCap
      ? 'frame is uniformly black even on retry (' + first.detail + ')'
      : 'frame was uniformly black and the retry produced no capture',
    'watch the TV: if it shows a picture, the capture is lying (a restart-time frame, trap 3) — judge with your eyes; ' +
    'if it is truly black, the swap or the cache reset failed and the engine is drawing nothing');
}

function captureOnce(ctx) {
  const line = ctx.transport.exec(CAPTURE_CMD).trim();
  if (!line) return null;
  const size = Number(line.split(/\s+/)[4]);
  return Number.isFinite(size) && size > 0 ? { size } : null;
}

/* The one sanctioned TV-side mutation, inherited from tools/screenshot.sh:
 * the capture's temp file in /tmp (tmpfs) is removed after reading. Best
 * effort; its failure never fails the check. */
function cleanupCapture(ctx) {
  try { ctx.transport.exec('rm -f ' + CAPTURE + ' 2>/dev/null'); } catch { /* best effort */ }
}

/* 4. watcher — WARN, never FAIL: the watcher is a footgun, not a broken
 * install. Native: it must be off. Rollback: it must match the pre-native
 * value, which is what the once-taken backup holds. */
function checkWatcher(ctx) {
  const cfg = readJson(ctx, CONFIG);
  if (cfg.error) {
    return record(ctx, 'watcher', 'WARN', cfg.error, 'inspect ' + CONFIG + ' by hand over ssh');
  }
  const enabled = !!((cfg.json.watcher || {}).enabled);
  if (ctx.expected.kind === 'stock') {
    const bak = readJson(ctx, WATCHER_BACKUP);
    if (bak.error) {
      return record(ctx, 'watcher', 'WARN',
        'no readable pre-native backup at ' + WATCHER_BACKUP + ' (' + bak.error + ') — the pre-native watcher state is unknown',
        'the watcher CLI prints the same warning on rollback; restore by hand from an older backup if the canvas launcher is wanted');
    }
    const wasOn = !!((bak.json.watcher || {}).enabled);
    if (wasOn === enabled) {
      return record(ctx, 'watcher', 'PASS', 'watcher ' + (enabled ? 'on' : 'off') + ' — matches the pre-native value');
    }
    return record(ctx, 'watcher', 'WARN',
      'watcher is ' + (enabled ? 'on' : 'off') + ' but the pre-native backup says ' + (wasOn ? 'on' : 'off'),
      're-run native-install.cjs rollback, which owns this restore');
  }
  if (enabled) {
    return record(ctx, 'watcher', 'WARN', 'watcher.enabled is true after a native install',
      'the bridge will bounce the native Home to the canvas page within a second (the 2026-11-10 failure); ' +
      're-run the install, which owns the watcher flip');
  }
  return record(ctx, 'watcher', 'PASS', 'watcher disabled');
}

function readJson(ctx, file) {
  let data;
  try { data = ctx.transport.readFile(file); }
  catch { return { error: 'no ' + file + ' on the TV' }; }
  try { return { json: JSON.parse(data.toString('utf8')) }; }
  catch { return { error: file + ' is not valid JSON' }; }
}

/* ------------------------------------------------------------- verdicts -- */

const STEPS = [checkBundle, checkEngine, checkFrame, checkWatcher];

// One place for the verdict; the text and JSON renderers both consume it, so
// the two modes cannot disagree.
function composeVerdict(m, results) {
  const fails = results.filter(r => r.status === 'FAIL');
  const warns = results.filter(r => r.status === 'WARN');
  if (fails.length) {
    return 'NOT VERIFIED on ' + m.name + ': ' +
      fails.map(f => f.name + ' — ' + f.observed).join('; ');
  }
  return 'VERIFIED on ' + m.name + (warns.length ? ' (warnings: ' + warns.map(w => w.name).join(', ') + ')' : '');
}

function normalizeExpected(expected) {
  const kind = expected.kind || 'candidate';
  if (kind !== 'candidate' && kind !== 'stock') {
    throw new Error("expected.kind must be 'candidate' or 'stock'");
  }
  const md5 = String(expected.md5 || '').toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(md5)) {
    throw new Error('expected.md5 must be the 32-hex md5 of the bundle you expect on the TV');
  }
  let previousPid;
  if (expected.previousPid != null) {
    previousPid = Number(expected.previousPid);
    if (!Number.isInteger(previousPid) || previousPid <= 0) {
      throw new Error('expected.previousPid must be a positive integer');
    }
  }
  return { md5, kind, previousPid };
}

/**
 * verifyAfter({ transport, model, expected, sleep }) -> { ok, checks, verdict }
 *   transport — deploy-check's { exec(cmd) -> string, readFile(path) -> Buffer }
 *   model     — a models.json profile (m.app, m.engine, m.state, m.name)
 *   expected  — { md5, kind: 'candidate'|'stock', previousPid? }
 * Read-only against the TV except the /tmp capture (see the header). Every
 * check runs even after an earlier FAIL: each is independent evidence.
 */
async function verifyAfter(opts) {
  const transport = opts.transport;
  if (!transport || typeof transport.exec !== 'function' || typeof transport.readFile !== 'function') {
    throw new Error('verifyAfter needs a transport with exec(cmd) and readFile(path), as deploy-check.cjs defines them');
  }
  const m = opts.model;
  if (!m || !m.app || !m.engine || !m.state || !m.name) {
    throw new Error('verifyAfter needs a model profile with app, engine, state and name');
  }
  const ctx = {
    transport,
    m,
    expected: normalizeExpected(opts.expected || {}),
    results: [],
    sleep: opts.sleep || (ms => new Promise(r => setTimeout(r, ms)))
  };
  for (const step of STEPS) await step(ctx);
  const ok = !ctx.results.some(r => r.status === 'FAIL');
  return { ok, checks: ctx.results, verdict: composeVerdict(m, ctx.results) };
}

function toJSON(result, opts, expected) {
  return {
    tool: 'verify-install',
    ok: result.ok,
    exit: result.ok ? EXIT.OK : EXIT.NOT_VERIFIED,
    model: opts.model,
    host: opts.host || null,
    fixture: opts.fixture || null,
    expected,
    checks: result.checks,
    verdict: result.verdict
  };
}

async function main(argv, deps = {}) {
  const opts = parse(argv);
  if (opts.help) { console.log(USAGE); return EXIT.OK; }
  if (!opts.host && !opts.fixture) throw new UsageError('--host <tv-ip> or --fixture <dir> is required');
  const table = deps.modelTable || nativeInstall.MODELS.models;
  const m = table[opts.model];
  if (!m) throw new UsageError('unknown model: ' + opts.model + ' (try: ' + Object.keys(table).join(', ') + ')');
  const kind = opts.kind || 'candidate';
  const md5 = opts.expectMd5 ? String(opts.expectMd5).toLowerCase() : (kind === 'stock' ? m.stock_md5 : undefined);
  if (!md5) {
    throw new UsageError('--expect-md5 <md5> is required for kind candidate — the md5 native-install.cjs computed for the built candidate');
  }
  const expected = { md5, kind, previousPid: opts.previousPid };
  const transport = deps.transport || (opts.fixture ? fixtureRemote(opts.fixture) : deployCheck.sshRemote(opts));
  const result = await verifyAfter({ transport, model: m, expected, sleep: deps.sleep });
  if (opts.json) console.log(JSON.stringify(toJSON(result, opts, expected), null, 2));
  else {
    for (const r of result.checks) console.log(deployCheck.renderLine(r));
    console.log(result.verdict);
  }
  return result.ok ? EXIT.OK : EXIT.NOT_VERIFIED;
}

if (require.main === module) {
  main(process.argv).then(code => process.exit(code)).catch(error => {
    console.error((error.usage ? 'usage: ' : 'error: ') + error.message);
    process.exit(error.usage ? EXIT.USAGE : EXIT.NOT_VERIFIED);
  });
}

module.exports = { EXIT, UsageError, parse, verifyAfter, analyzeFrame, fixtureRemote, main, toJSON, CAPTURE, CAPTURE_CMD, WATCHER_BACKUP };
