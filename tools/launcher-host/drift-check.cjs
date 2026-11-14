#!/usr/bin/env node
'use strict';
/* drift-check — what came back? (issue #50)
 *
 *   node tools/launcher-host/drift-check.cjs --model 50a51huv --host <tv-ip> [--json]
 *   node tools/launcher-host/drift-check.cjs --model 50a51huv --fixture <dir>
 *
 * An engine restart, a half-applied session or a vendor update can silently
 * revert what alvidaa set, and nothing notices. deploy-check.cjs is the
 * *before* and verify-install.cjs is the *after* of a deliberate action;
 * this is the tool for every moment in between: it compares the TV's live
 * state against what the last deliberate action left behind and prints the
 * named repair per failure — the same idea as dumbtv's verify loop and
 * CleanMyTV's "clean up after a firmware update", ranked top of both
 * Android-TV audits of this class of check.
 *
 * The one rule is deploy-check's, inherited whole: the checks are claims
 * about the TV, and the tool only observes. Read-only against the TV — no
 * writes, no restarts, no kills. Every remedy names a command owned by
 * native-install.cjs, the switch script, or the operator.
 *
 * Last-known-good comes from recovery-record.cjs (the pre-install state it
 * already captures, keyed by unit) plus the TV-side facts the install lane
 * itself leaves (candidate.md5, the stock backup); no second store is
 * invented here.
 *
 * Transport: deploy-check's { exec(cmd) -> string, readFile(path) -> Buffer,
 * connect(port) -> bool }, with sshRemote() borrowed from there for the real
 * TV. The fixture extends deploy-check's with the handful of commands this
 * tool adds (a glob ls, a grep count, the TCP sinkhole probe), so the whole
 * command is testable with no TV on the network (see DRIFT-CHECK.md).
 */
const fs = require('node:fs');
const path = require('node:path');

const deployCheck = require('./deploy-check.cjs');
const nativeInstall = require('./native-install.cjs');
const recoveryRecord = require('./recovery-record.cjs');
const { CONFIG } = require('./native-trial.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const SSH_PORT = 2222;
const SSH_KEY = path.join(REPO, 'server/keys/tv_root_ed25519');
// native-install.cjs owns these two; mirror them through the exports so a
// rename there cannot silently desync the checks (same trick as verify-install).
const WATCHER_BACKUP = nativeInstall.WATCHER_BACKUP || CONFIG + '.bak-native-home';
const HOOK = recoveryRecord.HOOK;                  // /var/local/otaTest.sh
// The stock backup bootstrap takes once and never replaces.
const STOCK_BACKUP = m => m.state + '/backup/app.js.stock';
// The md5 install writes after pushing a candidate: the TV-side record of
// "what we installed" that rollback deliberately leaves behind.
const CANDIDATE_MD5_FILE = m => m.state + '/candidate.md5';
// sdk.storage on this engine is the Cobalt Starboard store over SQLite
// (findings 12 §6): the home page's origin key is the file name's base64.
const COBALT_HOME = '/var/local/hisenseUI/cobalt_home';
const STORAGE_GLOB = COBALT_HOME + '/.starboard.*.storage';
const HOME_ORIGIN = 'file:///hisenseUI/index.html';
const homeStorageName = () => '.starboard.' + Buffer.from(HOME_ORIGIN).toString('base64') + '.storage';
// The pref keys the native launcher reads and writes (native-alvidaa.js).
const PREF_KEY = 'alvidaa_';
// The kill-list, resolver layer first: mirrors tools/alvidaa.py's
// PRIVACY_TIER1 plus the DoH bootstrap (dns.google) that ADGUARD_APPLY.md
// calls load-bearing. findings 09 measured the resolver layer carrying the
// whole load while the kernel backstop was empty — the probe must answer for
// the pair, not for either alone.
const KILL_LIST_HOSTS = [
  'evt-na.vidaahub.com', 'ter-jrnl-na.vidaahub.com', 'exc-jrnl-na.vidaahub.com',
  'policy-jrnl-na.vidaahub.com', 'dvcstatus-dataretrv.vidaahub.com',
  'file-ul.vidaahub.com', 'rsc-ads.vidaahub.com', 'dns.google'
];
const KILL_LIST_PORT = 443;
const PROBE_TIMEOUT_S = 5;
const EXIT = { CLEAN: 0, DRIFT: 1, USAGE: 2 };

const USAGE = [
  'usage: node tools/launcher-host/drift-check.cjs --model <id> --host <tv-ip> [--record-dir <dir>] [--json]',
  '       node tools/launcher-host/drift-check.cjs --model <id> --fixture <dir> [--record-dir <dir>] [--json]',
  '',
  'A read-only drift check: is the TV still in the state the last deliberate',
  'action left it in? Exit 0 = no drift, 1 = drift found, 2 = bad usage.',
  'See tools/launcher-host/DRIFT-CHECK.md.'
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
    else if (arg === '--record-dir') opts.recordDir = need('--record-dir');
    else if (arg === '--port') {
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

function lookupModel(table, id) {
  const m = table[id];
  if (!m) throw new UsageError('unknown model: ' + id + ' (try: ' + Object.keys(table).join(', ') + ')');
  return m;
}

/* ------------------------------------------------------- remote lanes ---- */
/* sshRemote is deploy-check's — one transport convention, borrowed not
 * copied, so a lane fix there lands here too. The fixture composes
 * deploy-check's fixtureRemote (md5sum, ls -ldn, df, engine scan) with the
 * extra commands this tool issues, and still throws on anything unknown so
 * tool/fixture drift fails the tests loudly. */

function fixtureRemote(dir) {
  const base = deployCheck.fixtureRemote(dir);
  const map = p => path.join(dir, p);
  const readText = p => { try { return fs.readFileSync(map(p), 'utf8'); } catch { return null; } };

  function extraExec(cmd) {
    const c = cmd.replace(/^export PATH=[^;]*; /, '').replace(/\s*2>\/dev\/null/g, '').trim();
    if (c === LANE_PROBE) return LANE_OK + '\n';
    let m = c.match(/^ls -d (.+)$/);
    if (m) {
      // One glob shape is used, the storage glob; expand it against the tree.
      const glob = m[1];
      const slash = glob.lastIndexOf('/');
      const dirPart = glob.slice(0, slash);
      const re = new RegExp('^' + glob.slice(slash + 1).replace(/[.+(){}[\]$^]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
      let names = [];
      try { names = fs.readdirSync(map(dirPart)).filter(n => re.test(n)).sort(); } catch { /* absent dir */ }
      return names.map(n => dirPart + '/' + n).join('\n') + (names.length ? '\n' : '');
    }
    m = c.match(/^grep -c (\S+) (.+)$/);
    if (m) {
      // busybox grep -c of a missing/unreadable file: empty stdout, error on
      // stderr. Readable file: one line, the number of matching lines.
      const text = readText(m[2]);
      if (text === null) return '';
      return text.split('\n').filter(line => line.includes(m[1])).length + '\n';
    }
    if (c.includes('/dev/tcp/')) {
      // The sinkhole probe. The fixture models the network as a filesystem:
      // dev/tcp/<host>-<port> existing = a connect succeeds (the sinkhole is
      // NOT sinking); a .hang sibling = the connect never answers (killed by
      // the watchdog, no line); absent = blocked (pin, NXDOMAIN or REJECT).
      const hosts = (c.match(/^for h in (.+?); do/) || [])[1];
      const port = (c.match(/\/dev\/tcp\/\$h\/(\d+)/) || [])[1];
      if (!hosts || !port) throw new Error('fixture cannot emulate: ' + cmd);
      let out = '';
      for (const h of hosts.split(' ')) {
        if (fs.existsSync(map('dev/tcp/' + h + '-' + port))) out += h + ' OPEN\n';
        else if (fs.existsSync(map('dev/tcp/' + h + '-' + port + '.hang'))) { /* watchdog kill: no line */ }
        else out += h + ' BLOCKED\n';
      }
      return out;
    }
    throw new Error('fixture cannot emulate: ' + cmd);
  }

  return {
    exec(cmd) {
      try { return base.exec(cmd); }
      catch (error) {
        if (!/^fixture cannot emulate:/.test(error.message)) throw error;
        return extraExec(cmd);
      }
    },
    readFile(p) { return fs.readFileSync(map(p)); },
    connect() { return !fs.existsSync(map('.unreachable')); }
  };
}

/* ------------------------------------------------------ the sinkhole probe */
/* TCP, never ICMP — the firmware ignores echo (findings 05). And TCP because
 * the question is "can telemetry leave", not "is the name pinned": a 0.0.0.0
 * resolver pin, an NXDOMAIN and a kernel REJECT all close the path, and the
 * probe only needs to know whether ANY of them still does.
 *
 * The primitive is bash's /dev/tcp — findings 05 measured that /bin/sh is
 * real bash and this build's busybox has no nc applet ("nc: applet not
 * found"). Each connect runs under a sleep watchdog because a SYN-blackholed
 * host would otherwise hang the ssh lane on the kernel's connect timeout;
 * `timeout` does not exist on this build (findings 11). A killed connect
 * prints no line and counts as closed — the probe fails on positive evidence
 * (an OPEN connect) only. */

function sinkholeProbeCmd() {
  return 'for h in ' + KILL_LIST_HOSTS.join(' ') + '; do ' +
    '( (exec 3<>"/dev/tcp/$h/' + KILL_LIST_PORT + '") 2>/dev/null && echo "$h OPEN" || echo "$h BLOCKED" ) & ' +
    'p=$!; ( sleep ' + PROBE_TIMEOUT_S + '; kill $p 2>/dev/null ) & w=$!; ' +
    'wait $p 2>/dev/null; kill $w 2>/dev/null; wait $w 2>/dev/null; done; true';
}

function parseProbeOut(out) {
  const tags = {};
  for (const line of String(out).split('\n')) {
    const m = line.trim().match(/^(\S+) (OPEN|BLOCKED)$/);
    if (m) tags[m[1]] = m[2];
  }
  return KILL_LIST_HOSTS.map(h => ({ host: h, state: tags[h] || 'TIMEOUT' }));
}

/* --------------------------------------------------------------- checks -- */

function record(ctx, name, status, observed, remedy) {
  const r = { name, status, observed, remedy: status === 'PASS' ? null : (remedy || null) };
  ctx.results.push(r);
  if (!ctx.opts.json) console.log(deployCheck.renderLine(r));
  return r;
}

/* The lane IS dropbear here: the transport is the root ssh session, so
 * "dropbear answering" is answered by one trivial exec. It runs first and is
 * the only hard gate — with the lane down the remaining checks would only
 * produce noise (deploy-check's rule for its own hard gates). */
const LANE_PROBE = 'echo drift-check-lane';
const LANE_OK = 'drift-check-lane';

function checkDropbear(ctx) {
  let out;
  try { out = ctx.transport.exec(LANE_PROBE); }
  catch (error) {
    record(ctx, 'dropbear', 'FAIL', 'no answer on the root ssh lane: ' + error.message,
      'check the TV is up and the root key (server/keys/) still authenticates; run ./server/tv by hand');
    ctx.stop = true;
    return;
  }
  if (out.trim() !== LANE_OK) {
    record(ctx, 'dropbear', 'FAIL', 'lane answered but not with the probe echo: ' + JSON.stringify(out.slice(0, 60)),
      'the shell on the lane is not the root dropbear session; run ./server/tv by hand');
    ctx.stop = true;
    return;
  }
  record(ctx, 'dropbear', 'PASS', 'answering on port ' + ctx.opts.port);
}

/* Load the last-known-good: the unit identity from recovery-record.cjs's
 * measured candidates, then the record it already stores for that unit. No
 * identity or no record is not drift — the checks that wanted a comparison
 * say so in their observed lines instead. */
function checkRecord(ctx) {
  let id;
  try { id = recoveryRecord.identify({ transport: ctx.transport, model: ctx.opts.model }); }
  catch (error) {
    ctx.record = null;
    record(ctx, 'record', 'SKIP', 'no stable unit identity: ' + error.message,
      'recovery-record needs a serial or MAC; without one there is no record to compare against');
    return;
  }
  ctx.unit = { key: id.key, serial_source: id.serial_source };
  let rec = null;
  try { rec = recoveryRecord.read({ model: ctx.opts.model, key: id.key, path: ctx.opts.recordDir }); }
  catch (error) {
    ctx.record = null;
    record(ctx, 'record', 'SKIP', 'recovery record unreadable: ' + error.message,
      'fix or move the record file; the checks below run without it');
    return;
  }
  if (!rec) {
    ctx.record = null;
    record(ctx, 'record', 'SKIP', 'no recovery record for ' + id.key,
      'one is written by the next native-install.cjs install (it captures pre-install state)');
    return;
  }
  ctx.record = rec;
  record(ctx, 'record', 'PASS', id.key + ' — captured ' + rec.created.slice(0, 10) +
    ', last seen ' + (rec.latest && rec.latest.at ? rec.latest.at.slice(0, 10) : '?'));
}

function md5OfExec(out) {
  return String(out).trim().split(/\s+/)[0] || '';
}

function readCandidateMd5(ctx) {
  try {
    return md5OfExec(ctx.transport.readFile(CANDIDATE_MD5_FILE(ctx.m)).toString('utf8'));
  } catch { return null; } // no candidate.md5: nothing was ever installed, or rollback cleaned it
}

/* bundle — stock, candidate, or unknown, and whether it still matches what
 * the record last saw. "Unknown" is the drift: the pinned stock and the
 * installed candidate are the only two revisions a deliberate action puts
 * here, so a third md5 means something else wrote the bundle (a vendor
 * update above all). */
function checkBundle(ctx) {
  let out;
  try { out = ctx.transport.exec('md5sum ' + ctx.m.app + ' 2>/dev/null'); }
  catch (error) {
    record(ctx, 'bundle', 'FAIL', 'md5 of ' + ctx.m.app + ' failed over the lane: ' + error.message,
      'check the bundle path against the model profile; the operation-ui module may have been reflashed');
    ctx.bundleKind = null;
    return;
  }
  const md5 = md5OfExec(out);
  if (!md5) {
    record(ctx, 'bundle', 'FAIL', ctx.m.app + ' is gone — md5sum returned nothing',
      'the operation-ui module changed or was wiped; re-check the model profile');
    ctx.bundleKind = null;
    return;
  }
  const candidateMd5 = readCandidateMd5(ctx);
  const kind = md5 === ctx.m.stock_md5 ? 'stock'
    : (candidateMd5 && md5 === candidateMd5 ? 'candidate' : 'unknown');
  ctx.bundleKind = kind;
  const recMd5 = ctx.record && ctx.record.latest && ctx.record.latest.bundle ? ctx.record.latest.bundle.md5 : null;
  const recSeen = recMd5 ? ', record last saw ' + recMd5 : ', no recovery record to compare';
  if (kind === 'stock') {
    record(ctx, 'bundle', 'PASS', md5 + ' — stock' + (recMd5 === md5 ? ' (matches the record)' : recSeen));
    return;
  }
  if (kind === 'candidate') {
    record(ctx, 'bundle', 'PASS', md5 + ' — the installed candidate (per ' + ctx.m.state + '/candidate.md5)' +
      (recMd5 === md5 ? ' (matches the record)' : recSeen));
    return;
  }
  if (recMd5 === md5) {
    record(ctx, 'bundle', 'WARN', md5 + ' — unknown revision, unchanged since the record last saw it' +
      (ctx.record && ctx.record.latest && ctx.record.latest.at ? ' (' + ctx.record.latest.at.slice(0, 10) + ')' : ''),
      'if a session replaced the bundle deliberately, re-run native-install.cjs install to re-pin the pair; otherwise treat as drift');
    return;
  }
  record(ctx, 'bundle', 'FAIL', md5 + ' — unknown revision, and it is not what the record last saw (' +
    (recMd5 || 'nothing') + ')',
    'the bundle moved under us — most likely a firmware update; re-pin with native-install.cjs bootstrap and re-deploy');
}

function watcherEnabledOf(text) {
  let config;
  try { config = JSON.parse(text); } catch { return null; }
  if (!config || typeof config !== 'object' || Array.isArray(config) ||
      !config.watcher || typeof config.watcher !== 'object') return null;
  if (config.watcher.enabled === true) return 'on';
  if (config.watcher.enabled === false) return 'off';
  return null;
}

function readWatcherFile(ctx, file) {
  try { return watcherEnabledOf(ctx.transport.readFile(file).toString('utf8')); }
  catch { return undefined; } // absent or unreadable
}

/* watcher — what this setup expects (native Home => off). With the native
 * bundle in place the watcher must be off or the bridge bounces the TV back
 * to the canvas page within a second (the 2026-11-10 failure). With stock in
 * place it must match the pre-native value the once-taken backup holds —
 * falling back to the recovery record's pristine capture when the backup is
 * gone. A flip in either direction is drift, not a footgun: this tool exists
 * because flips are silent. */
function checkWatcher(ctx) {
  const live = readWatcherFile(ctx, CONFIG);
  if (live === undefined) {
    record(ctx, 'watcher', 'SKIP', 'no ' + CONFIG + ' on the TV', 'no bridge config; the watcher cannot be on');
    return;
  }
  if (live === null) {
    record(ctx, 'watcher', 'SKIP', CONFIG + ' has no readable watcher.enabled', 'inspect it by hand over ssh');
    return;
  }
  if (ctx.bundleKind === 'candidate') {
    if (live === 'on') {
      record(ctx, 'watcher', 'FAIL', 'watcher is on with the native Home installed — the bridge will bounce it back to the canvas page within a second',
        're-run native-install.cjs install — it owns this flip');
      return;
    }
    record(ctx, 'watcher', 'PASS', 'watcher off — matches the native-Home setup');
    return;
  }
  const preNative = readWatcherFile(ctx, WATCHER_BACKUP);
  let expected = preNative;
  let source = WATCHER_BACKUP;
  if (expected === undefined && ctx.record) {
    const recWatcher = ctx.record.facts && ctx.record.facts.watcher ? ctx.record.facts.watcher.enabled : null;
    if (recWatcher === true || recWatcher === false) { expected = recWatcher ? 'on' : 'off'; source = 'the recovery record'; }
  }
  if (expected === undefined || expected === null) {
    record(ctx, 'watcher', 'WARN', 'watcher is ' + live + '; no readable pre-native backup and no recorded pre-install value — the expected value is unknown',
      'restore by hand from an older config.json.bak-* if the canvas launcher is wanted');
    return;
  }
  if (live === expected) {
    record(ctx, 'watcher', 'PASS', 'watcher ' + live + ' — matches ' + source);
    return;
  }
  record(ctx, 'watcher', 'FAIL', 'watcher is ' + live + ' but ' + source + ' says ' + expected,
    're-run native-install.cjs rollback — it owns this restore');
}

/* stock backup — present and intact in <state>/backup/, or rollback is a
 * promise the TV cannot keep. Intact = its md5 still equals the pinned stock
 * it was verified against at bootstrap. */
function checkStockBackup(ctx) {
  let md5;
  try { md5 = md5OfExec(ctx.transport.exec('md5sum ' + STOCK_BACKUP(ctx.m) + ' 2>/dev/null')); }
  catch (error) {
    record(ctx, 'stock-backup', 'FAIL', 'md5 of ' + STOCK_BACKUP(ctx.m) + ' failed over the lane: ' + error.message,
      'check the backup by hand over ssh before trusting rollback');
    return;
  }
  if (!md5) {
    record(ctx, 'stock-backup', 'FAIL', 'no stock backup at ' + STOCK_BACKUP(ctx.m),
      'run: node tools/launcher-host/native-install.cjs bootstrap --model ' + ctx.opts.model +
      ' --host ' + (ctx.opts.host || '<tv-ip>'));
    return;
  }
  if (md5 === ctx.m.stock_md5) {
    record(ctx, 'stock-backup', 'PASS', 'present, md5 matches the pinned stock');
    return;
  }
  record(ctx, 'stock-backup', 'FAIL', 'present but md5 ' + md5 + ' != pinned stock ' + ctx.m.stock_md5,
    'either the backup is corrupt or a firmware update moved the stock the profile pins; ' +
    'check the profile before re-running bootstrap, which would replace the backup');
}

/* boot hook — the root lane dies at the next boot without it. A vendor
 * update or an OEM reset can take /var/local silently; the hook's rolling
 * backup (otaTest.v1.bak) is checked by hand if this fires. */
function checkBootHook(ctx) {
  let md5;
  try { md5 = md5OfExec(ctx.transport.exec('md5sum ' + HOOK + ' 2>/dev/null')); }
  catch (error) {
    record(ctx, 'boot-hook', 'FAIL', 'md5 of ' + HOOK + ' failed over the lane: ' + error.message,
      'check the hook by hand over ssh');
    return;
  }
  if (!md5) {
    const recSaw = ctx.record && ctx.record.latest && ctx.record.latest.boot &&
      ctx.record.latest.boot.hook && ctx.record.latest.boot.hook.present;
    record(ctx, 'boot-hook', 'FAIL', HOOK + ' is missing — root SSH will not survive the next reboot' +
      (recSaw ? ' (the record last saw it present)' : ''),
      'reinstall the boot hook (the hookinstall lane; see docs/models/<model>/<firmware>/findings/05-root-primitive.md)');
    return;
  }
  record(ctx, 'boot-hook', 'PASS', 'present, md5 ' + md5);
}

/* sinkhole — kill-list hosts must stay unreachable from the TV, on TCP :443
 * (never ICMP: the firmware drops echo). Any OPEN connect is drift: both the
 * resolver pin and the kernel kill-list have let go at once (the layered
 * design's whole point, findings 09). */
function checkSinkhole(ctx) {
  let out;
  try { out = ctx.transport.exec(sinkholeProbeCmd()); }
  catch (error) {
    record(ctx, 'sinkhole', 'WARN', 'probe failed over the lane: ' + error.message,
      'run the probe by hand over ssh: ' + sinkholeProbeCmd());
    return;
  }
  const probed = parseProbeOut(out);
  const open = probed.filter(p => p.state === 'OPEN');
  const timeouts = probed.filter(p => p.state === 'TIMEOUT').map(p => p.host);
  if (open.length) {
    record(ctx, 'sinkhole', 'FAIL', 'sinkhole not sinking: ' + open.map(p => p.host).join(', ') +
      ' accepted TCP :' + KILL_LIST_PORT + ' — the telemetry path is open',
      're-apply the AdGuard per-client rules (firmware/ADGUARD_APPLY.md) and read the kernel layer with alvidaa.py privacy status');
    return;
  }
  const closed = probed.length - timeouts.length;
  record(ctx, 'sinkhole', 'PASS', closed + '/' + probed.length + ' kill-list hosts closed on TCP :' + KILL_LIST_PORT +
    (timeouts.length ? ' (' + timeouts.join(', ') + ' unanswered — counted closed)' : '') +
    ' — resolver pin or kernel REJECT holds');
}

/* prefs — the native launcher's alvidaa_* keys in sdk.storage, which on this
 * engine is the Cobalt Starboard store (findings 12 §6). Unreachable states
 * SKIP — say SKIP, never PASS. Zero keys is a WARN, not a FAIL: keys exist
 * only once something was written, and without a stored inventory we cannot
 * tell "never customized" from the documented recreation data-loss trap.
 * The root-owned fossil is its own WARN — the engine can neither read nor
 * write storage it does not own (findings 12 §6). */
function checkPrefs(ctx) {
  let listing;
  try { listing = ctx.transport.exec('ls -d ' + STORAGE_GLOB + ' 2>/dev/null'); }
  catch (error) {
    record(ctx, 'prefs', 'SKIP', 'could not list ' + COBALT_HOME + ': ' + error.message,
      'check the cobalt_home directory by hand over ssh');
    return;
  }
  const files = listing.split('\n').map(l => l.trim()).filter(Boolean);
  if (!files.length) {
    record(ctx, 'prefs', 'SKIP', 'no .starboard storage under ' + COBALT_HOME +
      ' — the home engine has never written sdk.storage here', null);
    return;
  }
  const home = COBALT_HOME + '/' + homeStorageName();
  const file = files.includes(home) ? home : files[0];
  // Ownership first: a root-owned file is the findings-12 trap that breaks
  // every read below it, silently, until the engine recreates it (losing
  // everything).
  const line = lsOwnerLine(ctx, file);
  const owner = line ? line.split(/\s+/)[2] : null;
  if (owner === 'root' || owner === '0') {
    // The findings-12 fossil: the engine can neither read nor write this
    // file, so the key count below would be moot — say so and stop.
    record(ctx, 'prefs', 'WARN', file + ' is owned by ' + owner + ' — the engine can neither read nor write its own storage (findings 12)',
      'chown it back to the engine user, or remove it and let the engine recreate it — recreation loses every stored pref');
    return;
  }
  let out;
  try { out = ctx.transport.exec('grep -c ' + PREF_KEY + ' ' + file + ' 2>/dev/null').trim(); }
  catch (error) {
    record(ctx, 'prefs', 'SKIP', 'grep failed over the lane: ' + error.message,
      'check the storage file by hand over ssh');
    return;
  }
  if (!/^\d+$/.test(out)) {
    record(ctx, 'prefs', 'SKIP', file + ' is unreadable (' + (out || 'no answer from grep') + ')',
      'check owner and permissions by hand over ssh (the findings-12 fossil is root:root 0600)');
    return;
  }
  const count = Number(out);
  if (count > 0) {
    record(ctx, 'prefs', 'PASS', count + ' ' + PREF_KEY + '* key(s) present in ' + path.basename(file));
    return;
  }
  record(ctx, 'prefs', 'WARN', 'storage reachable but holds no ' + PREF_KEY + '* keys — never customized, or the recreation data-loss trap wiped them (findings 12)',
    'if the user had customized the Home, re-enter any launcher setting to re-seed the keys');
}

// ls -ldn with the plain -l fallback, exactly as deploy-check reads owners —
// the engine user has no passwd entry, so numeric is what usually answers.
function lsOwnerLine(ctx, file) {
  for (const flags of ['-ldn', '-ld']) {
    const line = ctx.transport.exec('ls ' + flags + ' ' + file + ' 2>/dev/null').trim();
    if (line) return line;
  }
  return '';
}

const STEPS = [checkDropbear, checkRecord, checkBundle, checkWatcher, checkStockBackup, checkBootHook, checkSinkhole, checkPrefs];

/* ------------------------------------------------------------- verdicts -- */

// One place for the verdict; the text and JSON renderers both consume it, so
// the two modes cannot disagree.
function verdict(results) {
  const fails = results.filter(r => r.status === 'FAIL');
  return { drift: fails.length > 0, code: fails.length ? EXIT.DRIFT : EXIT.CLEAN, fails };
}

function composeVerdict(m, results) {
  const warns = results.filter(r => r.status === 'WARN');
  const skips = results.filter(r => r.status === 'SKIP');
  const fails = results.filter(r => r.status === 'FAIL');
  if (fails.length) {
    return 'DRIFT on ' + m.name + ': ' + fails.map(f => f.name + ' — ' + f.observed).join('; ');
  }
  return 'NO DRIFT on ' + m.name + ' (' + results.length + ' checks' +
    (warns.length ? ', ' + warns.length + ' warning' + (warns.length > 1 ? 's' : '') : '') +
    (skips.length ? ', ' + skips.length + ' skipped' : '') + ')';
}

function toJSON(ctx) {
  const v = verdict(ctx.results);
  return {
    tool: 'drift-check',
    ok: !v.drift,
    exit: v.code,
    model: ctx.opts.model,
    host: ctx.opts.host || null,
    fixture: ctx.opts.fixture || null,
    unit: ctx.unit || null,
    record: ctx.record ? { key: ctx.record.key, created: ctx.record.created, updated: ctx.record.updated } : null,
    checks: ctx.results,
    verdict: composeVerdict(ctx.m, ctx.results)
  };
}

/**
 * runDriftCheck(opts, deps?) -> ctx { results, m, record, unit, bundleKind }
 *   opts      — parsed CLI options (or a superset): { model, host?, fixture?,
 *               port?, key?, recordDir?, transport?, json? }
 *   deps      — { modelTable? } for tests (the pinned stock bundle is
 *               gitignored, so profiles are injected the deploy-check way)
 * Read-only against the TV. The lane probe is the only hard gate; every
 * other check runs even after an earlier FAIL — each is independent evidence.
 */
function runDriftCheck(opts, deps = {}) {
  const table = deps.modelTable || nativeInstall.MODELS.models;
  const m = lookupModel(table, opts.model);
  const ctx = {
    opts, m,
    transport: opts.transport || (opts.fixture ? fixtureRemote(opts.fixture) : deployCheck.sshRemote(opts)),
    results: [], stop: false, record: null, unit: null, bundleKind: null
  };
  for (const step of STEPS) {
    if (ctx.stop) break;
    step(ctx);
  }
  return ctx;
}

function main(argv, deps = {}) {
  const opts = parse(argv);
  if (opts.help) { console.log(USAGE); return EXIT.CLEAN; }
  if (!opts.host && !opts.fixture) throw new UsageError('--host <tv-ip> or --fixture <dir> is required');
  if (!opts.model) throw new UsageError('--model <id> is required');
  const ctx = runDriftCheck(opts, deps);
  const v = verdict(ctx.results);
  if (opts.json) console.log(JSON.stringify(toJSON(ctx), null, 2));
  else console.log(composeVerdict(ctx.m, ctx.results));
  return v.code;
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (error) {
    console.error((error.usage ? 'usage: ' : 'error: ') + error.message);
    process.exit(error.usage ? EXIT.USAGE : EXIT.DRIFT);
  }
}

module.exports = {
  EXIT, UsageError, parse, fixtureRemote, sinkholeProbeCmd, parseProbeOut,
  runDriftCheck, main, verdict, composeVerdict, toJSON,
  KILL_LIST_HOSTS, KILL_LIST_PORT, COBALT_HOME, STORAGE_GLOB, homeStorageName,
  STOCK_BACKUP, CANDIDATE_MD5_FILE, WATCHER_BACKUP, HOOK
};
