#!/usr/bin/env node
'use strict';
/* deploy-check — a one-command go/no-go preflight for a lane-3 deploy.
 *
 *   node tools/launcher-host/deploy-check.cjs --model 50a51huv --host <tv-ip> [--variant alvidaa] [--json]
 *   node tools/launcher-host/deploy-check.cjs --model 50a51huv --fixture <dir>
 *
 * The deploy was blocked twice, and both times the blocker (TV off the
 * network, wrong bundle path, moved stock hash) was only found by hand after
 * a wasted round trip. This answers the one question that matters before
 * touching a TV: is this deploy safe to run right now, and if not, exactly
 * what is wrong?
 *
 * The checks are claims about the TV. The tool only observes: it never
 * writes, restarts or kills anything, and every fix it names is a command
 * owned by native-install.cjs or the operator. A preflight that can change
 * the thing it is checking is not a preflight.
 *
 * Shape: cheap and local first (profile, pinned stock, build), remote last
 * (reachability, root, TV state), so a broken toolchain never costs a round
 * trip. Reachability and root are hard gates; once they fail the remaining
 * checks would only produce noise, so they are not attempted.
 *
 * Every remote interaction goes through one small interface,
 * { exec(cmd) -> string, readFile(path) -> Buffer, connect(port) -> bool },
 * with two implementations: sshRemote() for the real TV and fixtureRemote()
 * for a fake TV tree on disk, so the whole command is testable with no TV
 * on the network (see DEPLOY-CHECK.md).
 */
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const cp = require('node:child_process');

const nativeInstall = require('./native-install.cjs');
const { hash } = require('./native-trial.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const SSH_PORT = 2222;
const SSH_KEY = path.join(REPO, 'server/keys/tv_root_ed25519');
// Dropbear sessions get no PATH; native-install.cjs exports one per command.
const PATH_PREFIX = 'export PATH=/bin:/usr/bin:/sbin:/usr/local/bin; ';
const CONFIG = '/var/local/alvidaa/config.json';
const BRIDGE_URL = 'http://127.0.0.1:8770/api/debug';
const MIN_FREE_KB = 5 * 1024;
const EXIT = { GO: 0, NOGO: 1, USAGE: 2 };

const USAGE = [
  'usage: node tools/launcher-host/deploy-check.cjs --model <id> --host <tv-ip> [--variant alvidaa] [--json]',
  '       node tools/launcher-host/deploy-check.cjs --model <id> --fixture <dir>',
  '',
  'A read-only go/no-go preflight for a lane-3 deploy. Exit 0 = go,',
  '1 = no-go, 2 = bad usage. See tools/launcher-host/DEPLOY-CHECK.md.'
].join('\n');

class UsageError extends Error {
  constructor(message) { super(message); this.usage = true; }
}

/* ---------------------------------------------------------------- usage -- */

function parse(argv) {
  const args = argv.slice(2);
  const opts = { variant: 'alvidaa', port: SSH_PORT, key: SSH_KEY, json: false };
  let i = 0;
  const need = name => {
    // i points at the value: the loop already consumed the flag itself.
    if (i >= args.length) throw new UsageError(name + ' needs a value');
    return args[i++];
  };
  while (i < args.length) {
    const arg = args[i++];
    if (arg === '--model') opts.model = need('--model');
    else if (arg === '--host') opts.host = need('--host');
    else if (arg === '--variant') opts.variant = need('--variant');
    else if (arg === '--port') {
      opts.port = Number(need('--port'));
      if (!Number.isInteger(opts.port) || opts.port <= 0) throw new UsageError('--port must be a positive integer');
    } else if (arg === '--key') { opts.key = need('--key'); opts.keyExplicit = true; }
    else if (arg === '--fixture') opts.fixture = need('--fixture');
    else if (arg === '--json') opts.json = true;
    else if (arg === '--help') opts.help = true;
    else throw new UsageError('unknown flag: ' + arg);
  }
  return opts;
}

function lookupModel(table, id) {
  const m = table[id];
  if (!m) throw new UsageError('unknown model: ' + id + ' (try: ' + Object.keys(table).join(', ') + ')');
  return m;
}

function lookupVariant(list, id) {
  const v = list.find(x => x.id === id);
  if (!v) throw new UsageError('unknown variant: ' + id + ' (try: ' + list.map(x => x.id).join(', ') + ')');
  return v;
}

/* ------------------------------------------------------- remote lanes ---- */

function sshArgs(opts, command) {
  return ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-p', String(opts.port), '-i', opts.key, 'root@' + opts.host, command];
}

function sshRemote(opts) {
  // The TV's dropbear resets a connection now and then under a burst of
  // sequential calls — three times on 2026-11-12 alone, always mid-run and
  // always transient. One retry after a short pause turns a spurious no-go into
  // a correct answer; a real failure still fails twice and is reported.
  const TRANSIENT = /connection (closed|reset)|kex_exchange_identification|broken pipe/i;
  // Returns the raw spawnSync result after retrying a transient lane failure.
  // Used by both exec and readFile: a 176 KB frame read is exactly the kind of
  // call dropbear resets, and it did on the first real verification run
  // (2026-11-12).
  function spawnRaw(command, encoding) {
    let last;
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = cp.spawnSync('ssh', sshArgs(opts, PATH_PREFIX + command), {
        encoding, maxBuffer: 64 * 1024 * 1024
      });
      if (r.error) throw new Error('cannot run ssh: ' + r.error.message);
      if (r.status !== 255) return r;
      last = r;
      if (!TRANSIENT.test(String(r.stderr || ''))) break;
      cp.spawnSync('sleep', ['1']);
    }
    // ssh's own exit code: the lane, not the command, failed.
    throw new Error('ssh failed: ' + String(last.stderr || '').trim().split('\n').pop());
  }
  function spawn(command, encoding) {
    return spawnRaw(command, encoding).stdout;
  }
  return {
    exec(cmd) { return String(spawn(cmd, 'utf8')); },
    readFile(remotePath) {
      // Buffer for binary-safe reads; a non-zero status means the read
      // failed (missing file, permissions) and must reach the caller.
      const r = spawnRaw('cat ' + remotePath, 'buffer');
      if (r.status !== 0) throw new Error('cannot read ' + remotePath + ' over ssh (status ' + r.status + ')');
      return r.stdout;
    },
    // The firmware drops ICMP, so the probe is TCP — but through ssh, not a raw
    // socket. Two reasons: this is the lane the deploy actually uses, so its
    // answer is the one that matters; and node's net.connect returns
    // EHOSTUNREACH on this host for addresses the OS reaches fine (measured
    // 2026-11-12: .1 and .175 fail from node while ssh, nc and curl all
    // connect, and .85 succeeds from node). Probing with ssh sidesteps that
    // entirely and needs no extra dependency.
    connect(port) {
      const r = cp.spawnSync('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5',
        '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
        '-p', String(port), '-i', opts.key, 'root@' + opts.host, 'true'],
      { encoding: 'utf8' });
      return Promise.resolve(r.status === 0);
    }
  };
}

function modeToPerm(mode) {
  const bit = (n, c) => (mode & n ? c : '-');
  return bit(0o400, 'r') + bit(0o200, 'w') + bit(0o100, 'x') +
    bit(0o040, 'r') + bit(0o020, 'w') + bit(0o010, 'x') +
    bit(0o004, 'r') + bit(0o002, 'w') + bit(0o001, 'x');
}

/* A fake TV: a directory read as if it were the TV's root filesystem, plus
 * marker files for the things that are not files (reachability, the shell's
 * uid, free space). exec() emulates exactly the handful of busybox
 * invocations deploy-check issues and throws on anything else, so drift
 * between this tool and the fixture contract fails the tests loudly. The
 * emulated output is busybox-shaped on purpose: it exercises the same
 * parsing the real TV needs. Layout: DEPLOY-CHECK.md. */
function fixtureRemote(dir) {
  const map = p => path.join(dir, p);
  const readText = p => { try { return fs.readFileSync(map(p), 'utf8'); } catch { return null; } };

  // The real build has no `id`, so root is read from /proc/self/status.
  function procStatusUid() {
    return fs.existsSync(map('.nonroot'))
      ? 'Uid:\t1000\t1000\t1000\t1000\nGid:\t1000\t1000\t1000\t1000\n'
      : 'Uid:\t0\t0\t0\t0\nGid:\t0\t0\t0\t0\n';
  }

  function busyboxMd5(target) {
    try {
      const data = fs.readFileSync(map(target));
      return crypto.createHash('md5').update(data).digest('hex') + '  ' + target + '\n';
    } catch { return ''; }
  }

  function busyboxLs(target) {
    let st;
    try { st = fs.statSync(map(target)); } catch { return ''; }
    // Owner comes from a <path>.owner sidecar when present (tests run
    // unprivileged, so real uid/gid cannot stand in for the TV's 305:305).
    const owner = (readText(target + '.owner') || st.uid + ':' + st.gid).trim().split(':');
    return '-' + modeToPerm(st.mode) + '    1 ' + owner[0] + ' ' + owner[1] + ' ' +
      st.size + ' Nov  9 21:14 ' + target + '\n';
  }

  function busyboxDf() {
    const free = Number(readText('/var/local/.free-kb')) || 819200;
    return 'Filesystem           1K-blocks      Used Available Use% Mounted on\n' +
      '/dev/mmcblk0p17        1048576    262144 ' + String(free).padStart(9) + '  25% /var/local\n';
  }

  function busyboxEngineScan(cmd) {
    const engine = cmd.match(/grep -q '\/([^']+)\$'/)[1];
    let pids = [];
    try { pids = fs.readdirSync(map('/proc')).filter(p => /^\d+$/.test(p)); } catch { /* no /proc */ }
    let out = '';
    for (const pid of pids) {
      let exe;
      try { exe = fs.readlinkSync(map('/proc/' + pid + '/exe')); } catch { continue; }
      if (!exe.endsWith('/' + engine)) continue;
      // Same zombie rule as the switch script's live_engine().
      if (/\nState:.* Z\b/.test('\n' + (readText('/proc/' + pid + '/status') || ''))) continue;
      out += pid + '\n';
    }
    return out;
  }

  return {
    exec(cmd) {
      const c = cmd.replace(/^export PATH=[^;]*; /, '').replace(/\s*2>\/dev\/null/g, '').trim();
      if (c === 'id') return procStatusUid();
      if (c.startsWith('grep -E "^Uid|^Gid" /proc/self/status')) return procStatusUid();
      let m = c.match(/^md5sum (.+)$/);
      if (m) return busyboxMd5(m[1]);
      m = c.match(/^ls -ldn? (.+)$/);
      if (m) return busyboxLs(m[1]);
      if (c.startsWith('df -k ') || c.startsWith('/usr/local/bin/busybox df -k ')) return busyboxDf();
      if (c === 'curl -s -m 3 ' + BRIDGE_URL) return readText('/bridge/api-debug.json') || '';
      if (c.includes('/proc/[0-9]*')) return busyboxEngineScan(c);
      throw new Error('fixture cannot emulate: ' + cmd);
    },
    readFile(p) { return fs.readFileSync(map(p)); },
    connect() { return !fs.existsSync(map('.unreachable')); }
  };
}

/* --------------------------------------------------------------- checks -- */

function record(ctx, name, status, observed, remedy) {
  const r = { name, status, observed, remedy: status === 'PASS' ? null : (remedy || null) };
  ctx.results.push(r);
  if (!ctx.opts.json) console.log(renderLine(r));
  return r;
}

function renderLine(r) {
  let line = r.status + '  ' + r.name.padEnd(14) + ' ' + r.observed;
  if (r.status !== 'PASS' && r.remedy) line += ' | remedy: ' + r.remedy;
  return line;
}

function bootstrapCmd(ctx) {
  return 'node tools/launcher-host/native-install.cjs bootstrap --model ' + ctx.opts.model +
    ' --host ' + ctx.hostOrPlaceholder;
}

function checkProfile(ctx) {
  record(ctx, 'profile', 'PASS', ctx.m.name + ', engine ' + ctx.m.engine + ', bundle ' + ctx.m.app);
}

function checkStockBundle(ctx) {
  if (!fs.existsSync(ctx.stockPath)) {
    // gitignored and private: absence is normal on a fresh clone.
    record(ctx, 'stock-bundle', 'FAIL', 'no pinned stock bundle at ' + ctx.m.local_stock,
      'run: ' + bootstrapCmd(ctx));
    ctx.skipStock = 'no local stock bundle to hash';
    return;
  }
  record(ctx, 'stock-bundle', 'PASS', ctx.m.local_stock);
}

function checkStockHashes(ctx) {
  if (ctx.skipStock) { record(ctx, 'stock-hashes', 'SKIP', ctx.skipStock, bootstrapCmd(ctx)); return; }
  const data = fs.readFileSync(ctx.stockPath);
  const md5 = crypto.createHash('md5').update(data).digest('hex');
  const sha = hash(data);
  const wrong = [];
  if (md5 !== ctx.m.stock_md5) wrong.push('md5 ' + md5 + ' != pinned ' + ctx.m.stock_md5);
  if (sha !== ctx.m.stock_sha256) wrong.push('sha256 ' + sha + ' != pinned ' + ctx.m.stock_sha256);
  if (!wrong.length) {
    record(ctx, 'stock-hashes', 'PASS', 'md5 ' + md5 + ', sha256 ' + sha);
    return;
  }
  record(ctx, 'stock-hashes', 'FAIL', wrong.join(', '),
    'the pinned bundle moved: re-run bootstrap to re-pin it; never build against a moved bundle');
  ctx.skipStock = 'local stock does not match the pinned hashes';
}

function checkBuild(ctx) {
  if (ctx.skipStock) { record(ctx, 'build', 'SKIP', ctx.skipStock, bootstrapCmd(ctx)); return; }
  const builder = require(path.join(HERE, ctx.v.build));
  const tmp = fs.mkdtempSync('/tmp/alvidaa-deploy-check-');
  try {
    // The builder refuses to write outside firmware/ or /tmp, so the
    // candidate is built into a scratch dir and deleted below.
    const out = path.join(tmp, 'candidate-' + ctx.v.id + '.js');
    const candidate = builder.build(ctx.stockPath, out, ctx.m.stock_sha256);
    ctx.candidateMd5 = crypto.createHash('md5').update(candidate).digest('hex');
    // The expected-hash argument is the only guard against building against
    // the wrong stock revision; prove it still throws instead of trusting it.
    let refused = false;
    try { builder.build(ctx.stockPath, path.join(tmp, 'guard.js'), '0'.repeat(64)); }
    catch { refused = true; }
    if (!refused) {
      record(ctx, 'build', 'FAIL', ctx.v.build + ' accepted a wrong expected sha256',
        'the pinned-revision guard is broken; fix the builder before any deploy');
      return;
    }
    record(ctx, 'build', 'PASS', Buffer.byteLength(candidate) + ' bytes, sha256 ' + hash(candidate));
  } catch (error) {
    record(ctx, 'build', 'FAIL', 'build threw: ' + error.message,
      'fix the build for variant ' + ctx.v.id + '; no candidate was produced');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function checkPairing(ctx) {
  if (nativeInstall.verified(ctx.v, ctx.m)) {
    record(ctx, 'pairing', 'PASS', ctx.v.name + ' is verified on ' + ctx.m.name);
    return;
  }
  const where = (ctx.v.verified || []).map(e => e.model + ' / ' + e.firmware).join(', ') || 'nowhere yet';
  ctx.pairingWarned = true;
  record(ctx, 'pairing', 'WARN', ctx.v.name + ' has not been verified on ' + ctx.m.name + ' (verified on: ' + where + ')',
    'pass --force to native-install.cjs install only if you accept the risk');
}

async function checkReachability(ctx) {
  const ok = await ctx.remote.connect(ctx.opts.port);
  // The fixture has no host; report the probe target either way.
  const where = ctx.opts.host || 'fixture';
  if (!ok) {
    record(ctx, 'reachability', 'FAIL',
      'TV not reachable: no TCP answer on ' + where + ':' + ctx.opts.port +
      ' — it may be in deep standby (all ports close, the MAC stays in ARP) or on another network',
      'check Settings → Network → Network Information for its address');
    ctx.stop = true;
    return;
  }
  record(ctx, 'reachability', 'PASS', where + ':' + ctx.opts.port + ' answers');
}

function checkRoot(ctx) {
  // Not `id`: this build has no id binary (measured 2026-11-10 — it also has no
  // curl, wget, nc or sha256sum). /proc/self/status always exists.
  let out;
  try { out = ctx.remote.exec('grep -E "^Uid|^Gid" /proc/self/status').trim(); }
  catch (error) {
    record(ctx, 'root', 'FAIL', 'reading /proc/self/status over ssh failed: ' + error.message,
      'check the root key (server/keys/) and that dropbear answers on port ' + ctx.opts.port);
    ctx.stop = true;
    return;
  }
  const uid = (out.match(/^Uid:\s*(\d+)/m) || [])[1];
  if (uid === '0') { record(ctx, 'root', 'PASS', out.replace(/\s+/g, ' ')); return; }
  record(ctx, 'root', 'FAIL', 'ssh answers but uid is ' + (uid === undefined ? 'unknown' : uid) + ': ' + out,
    'lane 3 needs root; the key must authenticate as root@tv');
  ctx.stop = true;
}

function lsDashL(remote, target) {
  // -n for numeric owners: the profile's 305:305 has no passwd entry. Older
  // busybox builds drop -n, so fall back to plain -l; the columns line up.
  for (const flags of ['-ldn', '-ld']) {
    const line = remote.exec('ls ' + flags + ' ' + target + ' 2>/dev/null').trim();
    if (line) return line;
  }
  return '';
}

function permToOctal(perms) {
  const p = perms.slice(-9); // the 9 permission chars after the file-type char
  let out = '';
  for (let t = 0; t < 3; t++) {
    let n = 0;
    if (p[t * 3] === 'r') n += 4;
    if (p[t * 3 + 1] === 'w') n += 2;
    if ('xst'.includes(p[t * 3 + 2])) n += 1;
    out += n;
  }
  return out;
}

function normMode(mode) { return (parseInt(mode, 8) & 0o777).toString(8); }

function checkBundlePath(ctx) {
  const line = lsDashL(ctx.remote, ctx.m.app);
  if (!line) {
    record(ctx, 'bundle-path', 'FAIL', ctx.m.app + ' does not exist on the TV',
      'wrong model id, or the operation-ui module was reflashed; re-check the profile');
    return;
  }
  const f = line.split(/\s+/);
  const owner = f[2] + ':' + f[3];
  const mode = permToOctal(f[0]);
  if (owner === ctx.m.owner && mode === normMode(ctx.m.mode)) {
    record(ctx, 'bundle-path', 'PASS', ctx.m.app + ' is ' + owner + ' ' + mode);
    return;
  }
  record(ctx, 'bundle-path', 'WARN',
    ctx.m.app + ' is ' + owner + ' ' + mode + ', profile expects ' + ctx.m.owner + ' ' + normMode(ctx.m.mode),
    'the switch script sets owner and mode at switch time; a difference means someone has been here');
}

function checkCurrentBundle(ctx) {
  const out = ctx.remote.exec('md5sum ' + ctx.m.app + ' 2>/dev/null').trim();
  const md5 = out.split(/\s+/)[0] || '';
  if (!md5) {
    record(ctx, 'current-bundle', 'SKIP', 'cannot md5 ' + ctx.m.app + ' on the TV',
      'check by hand over ssh: md5sum ' + ctx.m.app);
    return;
  }
  if (md5 === ctx.m.stock_md5) {
    record(ctx, 'current-bundle', 'PASS', md5 + ' — stock');
    return;
  }
  if (ctx.candidateMd5 && md5 === ctx.candidateMd5) {
    record(ctx, 'current-bundle', 'PASS', md5 + ' — ' + ctx.v.name + ' (this candidate) is already installed');
    return;
  }
  // An unknown revision is not a blocker: install will switch, not install.
  record(ctx, 'current-bundle', 'PASS',
    md5 + ' — unknown: neither the pinned stock nor this candidate; install will switch, not install');
}

function engineScan(engine) {
  // Mirrors the switch script's live_engine(): match the binary the
  // /proc/<pid>/exe link points at, zombies excluded — a dead engine must
  // not read as up.
  return 'for d in /proc/[0-9]*; do [ -e "$d/exe" ] || continue; ' +
    "ls -l \"$d/exe\" 2>/dev/null | grep -q '/" + engine + "$' || continue; " +
    "grep '^State:' \"$d/status\" 2>/dev/null | grep -q ' Z' && continue; " +
    'echo "${d#/proc/}"; done; true';
}

function checkEngine(ctx) {
  const out = ctx.remote.exec(engineScan(ctx.m.engine)).trim();
  if (!out) {
    record(ctx, 'engine', 'WARN', 'no live ' + ctx.m.engine + ' process',
      'the switch script restarts it, but the UI is down right now');
    return;
  }
  const pids = out.split('\n').filter(Boolean);
  record(ctx, 'engine', 'PASS',
    ctx.m.engine + ' running (pid ' + pids[0] + (pids.length > 1 ? ', +' + (pids.length - 1) + ' more' : '') + ')');
}

function checkBridge(ctx) {
  const body = ctx.remote.exec('curl -s -m 3 ' + BRIDGE_URL + ' 2>/dev/null').trim();
  if (!body) {
    // WARN, not FAIL: the native Home does not need the bridge, but the
    // watcher and tools/screenshot.sh live there.
    record(ctx, 'bridge', 'WARN', 'no answer from ' + BRIDGE_URL,
      'the native Home does not need the bridge, but the watcher and tools/screenshot.sh do; start /var/local/alvidaa/alvidaa-bridge (docs/launcher/BRIDGE_DEPLOY.md)');
    return;
  }
  try {
    const debug = JSON.parse(body);
    if (debug.mqtt && debug.mqtt.connected) {
      record(ctx, 'bridge', 'PASS', 'answers, MQTT connected');
      return;
    }
    record(ctx, 'bridge', 'WARN', 'answers, but MQTT is disconnected',
      'restart the bridge (docs/launcher/BRIDGE_DEPLOY.md); the watcher and screenshot tool need it');
  } catch {
    record(ctx, 'bridge', 'WARN', 'answers non-JSON: ' + body.slice(0, 60),
      'something else is listening on 8770; check the bridge (docs/launcher/BRIDGE_DEPLOY.md)');
  }
}

function checkWatcher(ctx) {
  let data;
  try { data = ctx.remote.readFile(CONFIG); }
  catch {
    record(ctx, 'watcher', 'SKIP', 'no ' + CONFIG + ' on the TV', 'no bridge config; the watcher cannot be on');
    return;
  }
  let config;
  try { config = JSON.parse(data.toString('utf8')); }
  catch {
    record(ctx, 'watcher', 'SKIP', CONFIG + ' is not valid JSON', 'inspect it by hand over ssh');
    return;
  }
  if (config && config.watcher && config.watcher.enabled) {
    record(ctx, 'watcher', 'WARN', 'watcher.enabled is true',
      'native-install.cjs owns this; a native Home with the watcher on is bounced back to the canvas page within a second');
    return;
  }
  record(ctx, 'watcher', 'PASS', 'watcher disabled');
}

function checkSpace(ctx) {
  // df the mount, not the state dir: on a not-yet-bootstrapped TV the state
  // dir does not exist and df on it would fail. And it is busybox's df, not a
  // standalone one: this build has no `df` on PATH at all (measured 2026-11-12),
  // so the applet has to be called explicitly.
  const out = ctx.remote.exec('/usr/local/bin/busybox df -k /var/local 2>/dev/null');
  const row = out.split('\n')
    .map(l => l.trim().split(/\s+/))
    .find(f => f.length >= 6 && f[0].startsWith('/') && !isNaN(Number(f[3])));
  if (!row) {
    record(ctx, 'space', 'WARN', 'could not read free space on /var/local',
      'check df -k /var/local by hand over ssh');
    return;
  }
  const freeKB = Number(row[3]);
  const free = (freeKB / 1024).toFixed(1) + ' MB free on ' + row[5];
  if (freeKB < MIN_FREE_KB) {
    record(ctx, 'space', 'WARN', free + ' (under the ' + (MIN_FREE_KB / 1024) + ' MB a candidate wants)',
      'clear /var/local: old candidates, switch.log, the backup once rollback is decided');
    return;
  }
  record(ctx, 'space', 'PASS', free);
}

const STEPS = [
  checkProfile, checkStockBundle, checkStockHashes, checkBuild, checkPairing,
  checkReachability, checkRoot, checkBundlePath, checkCurrentBundle,
  checkEngine, checkBridge, checkWatcher, checkSpace
];

/* ------------------------------------------------------------- verdicts -- */

// One place for the go/no-go decision; the text and JSON renderers both
// consume it, so the two modes cannot disagree.
function verdict(results) {
  const fails = results.filter(r => r.status === 'FAIL');
  return { go: fails.length === 0, code: fails.length ? EXIT.NOGO : EXIT.GO };
}

function nextStep(ctx) {
  const fails = ctx.results.filter(r => r.status === 'FAIL');
  if (fails.length) {
    return { blocked: 'blocked by ' + fails[0].name + ': ' + fails[0].observed +
      (fails.length > 1 ? ' (+' + (fails.length - 1) + ' more FAIL)' : '') };
  }
  let cmd = 'node tools/launcher-host/native-install.cjs install ' + ctx.opts.variant +
    ' --model ' + ctx.opts.model + ' --host ' + ctx.hostOrPlaceholder;
  if (ctx.opts.port !== SSH_PORT) cmd += ' --port ' + ctx.opts.port;
  if (ctx.opts.keyExplicit) cmd += ' --key ' + ctx.opts.key;
  if (ctx.pairingWarned) cmd += ' --force';
  return { next: cmd };
}

function toJSON(ctx, step) {
  const v = verdict(ctx.results);
  return {
    tool: 'deploy-check',
    go: v.go,
    exit: v.code,
    model: ctx.opts.model,
    variant: ctx.opts.variant,
    host: ctx.opts.host || null,
    port: ctx.opts.port,
    fixture: ctx.opts.fixture || null,
    checks: ctx.results,
    next: step.next || null,
    blocked: step.blocked || null
  };
}

async function runPreflight(opts, deps = {}) {
  const m = lookupModel(deps.modelTable || nativeInstall.MODELS.models, opts.model);
  const v = lookupVariant(deps.variantTable || nativeInstall.VARIANTS.variants, opts.variant);
  const ctx = {
    opts, m, v,
    remote: opts.fixture ? fixtureRemote(opts.fixture) : sshRemote(opts),
    results: [], stop: false, skipStock: null, candidateMd5: null, pairingWarned: false,
    hostOrPlaceholder: opts.host || '<tv-ip>'
  };
  ctx.stockPath = path.join(deps.repoRoot || REPO, m.local_stock);
  for (const step of STEPS) {
    if (ctx.stop) break;
    await step(ctx);
  }
  return ctx;
}

async function main(argv, deps = {}) {
  const opts = parse(argv);
  if (opts.help) { console.log(USAGE); return EXIT.GO; }
  if (!opts.host && !opts.fixture) throw new UsageError('--host <tv-ip> or --fixture <dir> is required');
  const ctx = await runPreflight(opts, deps);
  const step = nextStep(ctx);
  if (opts.json) console.log(JSON.stringify(toJSON(ctx, step), null, 2));
  else console.log(step.next ? 'next: ' + step.next : step.blocked);
  return verdict(ctx.results).code;
}

if (require.main === module) {
  main(process.argv).then(code => process.exit(code)).catch(error => {
    console.error((error.usage ? 'usage: ' : 'error: ') + error.message);
    process.exit(error.usage ? EXIT.USAGE : EXIT.NOGO);
  });
}

module.exports = { EXIT, UsageError, parse, sshRemote, fixtureRemote, runPreflight, main, verdict, nextStep, toJSON, engineScan, renderLine };
