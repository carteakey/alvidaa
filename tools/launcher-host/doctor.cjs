#!/usr/bin/env node
'use strict';
/* doctor — the five failures every owner hits, each already a documented trap
 * (issue #52).
 *
 *   node tools/launcher-host/native-install.cjs doctor --model <id> --host <ip>
 *   (also runnable directly: node tools/launcher-host/doctor.cjs --model <id> --host <ip>)
 *
 *   1. napping          — every port closed, MAC still in ARP: the IP is right,
 *                         the box looks dead (deep standby)
 *   2. second-mqtt-server — the paired client identity is one-session-per-
 *                         credential-set; a second server kicks the first off
 *                         the broker at publish (findings 05)
 *   3. wrong-address    — the DHCP lease moved and the old IP answers nothing
 *   4. watcher-bounce   — the bridge watcher is on, so a native Home is bounced
 *                         back to the canvas page within a second
 *   5. no-path          — dropbear answered but the session has no PATH, so
 *                         bare commands fail with "not found"
 *
 * On 2026-11-12 the answer was "read the handoff and work it out", which cost
 * an hour before the first deploy. This command runs only the observations
 * the host can make — read-only, no writes, no restarts, nothing that could
 * take a session — then prints the likely cause and the next command.
 *
 * The interesting case is (1) vs (3), and the discriminator is ARP, not ICMP
 * (the firmware drops echo): ping still makes the host's kernel ARP before
 * it sends, so one ignored ping populates the cache. Then:
 *   - no ARP entry at all                → wrong address, or not on this LAN
 *   - ARP entry, no TCP on 2222          → standby (the MAC stays, the OS sleeps)
 *   - TCP on 2222, ssh fails             → key or dropbear, not the network
 *   - ssh works, `echo $PATH` is empty   → the PATH trap
 *
 * Transport: deploy-check.cjs's sshRemote — borrowed, retry included, so a
 * spurious dropbear reset cannot turn into a wrong diagnosis. Its thrown
 * error text is the TCP/auth evidence the ladder reads. Nothing here
 * duplicates deploy-check's preflight checks; the bundle/watcher reads below
 * exist only as the *condition* of cause 4, not as health checks.
 *
 * One probe deliberately bypasses the transport: `echo $PATH` over a raw ssh
 * session. The transport's PATH_PREFIX is the FIX for the trap cause 5
 * detects — every exec through it re-exports PATH, so the trap is invisible
 * through the transport by construction. The probe is one prefix-free spawn
 * with deploy-check's exact ssh flags, run only after the lane is proven up.
 *
 * Exit 0 when it has an answer (even "the TV is asleep"), 2 on usage.
 */
const cp = require('node:child_process');
const path = require('node:path');

const deployCheck = require('./deploy-check.cjs');
const nativeInstall = require('./native-install.cjs');
const { CONFIG } = require('./native-trial.cjs');

const REPO = path.resolve(__dirname, '../..');
const EXIT = { ANSWER: 0, USAGE: 2 };
const LANE_PROBE = 'echo doctor-lane-ok';
const LANE_OK = 'doctor-lane-ok';
// The TLS broker listener (findings 11). 36669 in hex, the /proc/net/tcp form.
const MQTT_PORT = 36669;
const MQTT_PORT_HEX = MQTT_PORT.toString(16).toUpperCase();
// Established (st 01) sessions the broker holds, remote address per session.
// No netstat on this build; /proc/net/tcp is the raw lane (findings 05 v2
// harvest used exactly this). tcp6 is best-effort.
const MQTT_SESSIONS_CMD = "awk '$2 ~ /:" + MQTT_PORT_HEX + "$/ && $4 == \"01\" {print $3}' " +
  '/proc/net/tcp /proc/net/tcp6 2>/dev/null; true';

const USAGE = [
  'usage: node tools/launcher-host/native-install.cjs doctor --model <id> --host <tv-ip> [--port <p>] [--key <p>]',
  '',
  'Diagnoses the five failures every owner hits (standby, second MQTT server,',
  'wrong address, watcher bounce, empty PATH) with host-side, read-only',
  'observations. Exit 0 when it has an answer, 2 on usage.'
].join('\n');

class UsageError extends Error {
  constructor(message) { super(message); this.usage = true; }
}

/* ---------------------------------------------------------------- usage -- */

function parse(argv) {
  const args = argv.slice(2);
  const opts = { port: 2222, key: path.join(REPO, 'server/keys/tv_root_ed25519') };
  let i = 0;
  const need = name => {
    if (i >= args.length) throw new UsageError(name + ' needs a value');
    return args[i++];
  };
  while (i < args.length) {
    const arg = args[i++];
    if (arg === '--model') opts.model = need('--model');
    else if (arg === '--host') opts.host = need('--host');
    else if (arg === '--port') {
      opts.port = Number(need('--port'));
      if (!Number.isInteger(opts.port) || opts.port <= 0) throw new UsageError('--port must be a positive integer');
    } else if (arg === '--key') opts.key = need('--key');
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

/* The deploy-check ssh flags, verbatim (its sshArgs is not exported). Used by
 * the one probe that must bypass the transport — see the header. */
function sshFlags(opts, command) {
  return ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-p', String(opts.port), '-i', opts.key, 'root@' + opts.host, command];
}

/* ------------------------------------------------- host-side observations -- */

/* ARP, with one ignored ping to populate the cache: the TV drops ICMP echo,
 * but the host's kernel ARPs before sending regardless — so the ping result
 * proves nothing and the ARP answer does. The spawnSync timeout guards the
 * platform ping-flag differences away. */
function defaultArpLookup(opts) {
  cp.spawnSync('ping', ['-c', '1', opts.host], { timeout: 4000, stdio: 'ignore' });
  let out = '';
  const arp = cp.spawnSync('arp', ['-n', opts.host], { encoding: 'utf8' });
  if (!arp.error) out = String(arp.stdout || '') + String(arp.stderr || '');
  if (!/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i.test(out)) {
    // macOS: "-- no entry"; Linux net-tools: "no entry"; failed resolution:
    // "(incomplete)". `arp` missing entirely: try `ip neigh` (Linux).
    if (arp.error) {
      const neigh = cp.spawnSync('ip', ['neigh', 'show', opts.host], { encoding: 'utf8' });
      if (!neigh.error) out = String(neigh.stdout || '');
    }
    if (!/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i.test(out) || /incomplete/i.test(out)) return null;
  }
  const mac = out.match(/([0-9a-f]{2}[:-]){5}[0-9a-f]{2}/i)[0].toLowerCase();
  return { mac };
}

/* The prefix-free PATH probe. Returns the remote PATH string, '' for the
 * trap, or null when the probe itself could not run. Single attempt: the
 * lane is already proven up by the transport at this point, so a failure
 * here is transient and the observation says SKIP rather than guessing. */
function defaultPathProbe(opts) {
  const r = cp.spawnSync('ssh', sshFlags(opts, 'echo $PATH'), { encoding: 'utf8', timeout: 15000 });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout).trim();
}

/* Local MQTT servers — corroboration for cause 2, and the thing to kill when
 * the second server lives on this machine. */
function defaultHostProcesses() {
  const r = cp.spawnSync('ps', ['ax', '-o', 'pid=,command='], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return String(r.stdout).split('\n').filter(l => /vidaa_server\.py/.test(l) && !/grep/.test(l));
}

/* ------------------------------------------------------------ rendering -- */

function observe(ctx, name, status, observed) {
  const r = { name, status, observed, remedy: null };
  ctx.obs.push(r);
  return r;
}

/* --------------------------------------------------------------- causes -- */

// One place per cause: the named cause, the one-line story, and the next
// command. The tests assert on these names.
const CAUSES = {
  napping: {
    story: ctx => 'ARP resolves for ' + ctx.opts.host + ' (' + ctx.arp.mac + ') but nothing answers on TCP ' + ctx.opts.port +
      ' — the MAC stays in ARP while the OS sleeps, so the address is right and the box looks dead',
    next: ctx => 'wake the TV (remote or power button), then re-run: node tools/launcher-host/native-install.cjs doctor --model ' +
      ctx.opts.model + ' --host ' + ctx.opts.host
  },
  'wrong-address': {
    story: ctx => 'no ARP entry for ' + ctx.opts.host + ' even after probing — the DHCP lease moved, or the TV is not on this LAN',
    next: ctx => 'find the current address (Settings → Network → Network Information, or the router lease list — match the unit\'s MAC), then re-run: ' +
      'node tools/launcher-host/native-install.cjs doctor --model ' + ctx.opts.model + ' --host <new-ip>'
  },
  'key-or-dropbear': {
    story: ctx => 'TCP ' + ctx.opts.port + ' answers but the ssh session fails — the key or dropbear, not the network',
    next: () => 'run ./server/tv \'echo ok\': if that works the key is fine and dropbear is wedged; if not, recheck server/keys/ and the dropbear install'
  },
  'no-path': {
    story: () => 'ssh answers but a raw session has an empty PATH — bare commands fail with "not found" (the dropbear PATH trap)',
    next: () => 'use ./server/tv (it exports PATH), or prefix raw ssh commands with: export PATH=/bin:/usr/bin:/sbin:/usr/local/bin;'
  },
  'watcher-bounce': {
    story: () => 'watcher.enabled is on with a native Home in place — the bridge bounces the TV back to the canvas page within a second (the 2026-11-10 failure)',
    next: ctx => 're-run the install, which owns the flip: node tools/launcher-host/native-install.cjs install <variant> --model ' +
      ctx.opts.model + ' --host ' + ctx.opts.host
  },
  'second-mqtt-server': {
    story: ctx => ctx.mqtt.externals.length + ' MQTT sessions on the TV broker (:' + MQTT_PORT + ': ' +
      ctx.mqtt.externals.map(s => s.ip).join(', ') + ') — one session per credential set; a second server kicks the first off at publish (findings 05)',
    next: ctx => {
      const local = ctx.mqtt.localProcesses;
      return 'stop the extra vidaa_server.py — one per TV' +
        (local && local.length ? ' (this host has ' + local.length + ': pid ' +
          local.map(l => String(l).trim().split(/\s+/)[0]).join(', ') + ')' : ' (check every host that runs one)') +
        '; re-run doctor afterwards'
    }
  },
  healthy: {
    story: ctx => 'no trap found: the lane answers, PATH is set, the watcher matches the bundle, and the broker holds ' +
      (ctx.mqtt && ctx.mqtt.externals ? String(ctx.mqtt.externals.length) : 'the expected') + ' session(s)',
    next: ctx => 'nothing to fix; if something still misbehaves: node tools/launcher-host/native-install.cjs status --model ' +
      ctx.opts.model + ' --host ' + ctx.opts.host
  }
};

/* Ladder order: network first, then the session, then config, then broker
 * sessions. The first trap in this order is the likely cause; anything else
 * found is printed as "also" — real with the cause, never instead of it. */
const LADDER = ['wrong-address', 'napping', 'key-or-dropbear', 'no-path', 'watcher-bounce', 'second-mqtt-server'];

/* -------------------------------------------------------------- checks --- */

/* ARP: evidence for napping vs wrong-address. Unobservable (arp missing and
 * ip neigh missing) is recorded and leaves both causes open — say so. */
function checkArp(ctx) {
  const lookup = ctx.deps.arpLookup || defaultArpLookup;
  let arp;
  try { arp = lookup(ctx.opts); }
  catch (error) { arp = { error: error.message }; }
  if (arp && arp.error) {
    ctx.arp = null;
    observe(ctx, 'arp', 'SKIP', 'host ARP lookup failed: ' + arp.error);
    return;
  }
  if (!arp) {
    ctx.arp = null;
    // Evidence, not a verdict: a missing entry only means "this host did not
    // answer ARP just now", which is equally true of a wrong address and of a
    // cache that has not settled. The lane check decides; this line must not
    // read as a failure on a TV that is answering ssh (measured 2026-11-12:
    // FAIL arp alongside PASS lane on a healthy unit).
    observe(ctx, 'arp', 'SKIP', 'no ARP entry for ' + ctx.opts.host +
      ' after one ignored ping — the lane check decides whether that matters');
    return;
  }
  ctx.arp = arp;
  observe(ctx, 'arp', 'PASS', ctx.opts.host + ' resolves to ' + arp.mac + ' — the address is live on this LAN (verify the MAC is your unit)');
}

/* The lane IS the diagnosis for causes 1/3 vs key/dropbear. The transport's
 * retry (deploy-check's) is inside exec, so a spurious dropbear reset does
 * not reach the verdict as a network failure. */
function checkLane(ctx) {
  let out;
  try { out = ctx.transport.exec(LANE_PROBE); }
  catch (error) {
    const msg = String(error.message);
    observe(ctx, 'lane', 'FAIL', msg);
    // The stderr tail deploy-check re-throws is the TCP/auth evidence:
    // auth-flavoured failures mean TCP answered; refusals and timeouts mean
    // nothing is listening.
    if (/Permission denied|publickey|Host key|Connection closed by|kex_exchange/i.test(msg)) {
      ctx.traps.push('key-or-dropbear');
    } else if (ctx.arp) {
      ctx.traps.push('napping');
    } else {
      ctx.traps.push('wrong-address');
    }
    return false;
  }
  if (String(out).trim() !== LANE_OK) {
    observe(ctx, 'lane', 'FAIL', 'lane answered with something unexpected: ' + JSON.stringify(String(out).slice(0, 60)));
    ctx.traps.push('key-or-dropbear');
    return false;
  }
  observe(ctx, 'lane', 'PASS', 'ssh answers on port ' + ctx.opts.port);
  return true;
}

/* The PATH trap. The lane probe above ran through the transport, whose
 * PATH_PREFIX fixes PATH on every exec — the trap is invisible through it by
 * construction, so this one probe goes out raw (see the header). */
function checkPath(ctx) {
  const probe = ctx.deps.pathProbe || defaultPathProbe;
  let value;
  try { value = probe(ctx.opts); }
  catch (error) { value = null; }
  if (value === null) {
    observe(ctx, 'path', 'SKIP', 'raw-session probe failed — the PATH state is unknown (use ./server/tv, which exports PATH)');
    return;
  }
  ctx.path = value;
  if (value === '') {
    observe(ctx, 'path', 'FAIL', 'a raw ssh session has an empty PATH — bare commands fail with "not found"');
    ctx.traps.push('no-path');
    return;
  }
  observe(ctx, 'path', 'PASS', 'PATH=' + value + (value.includes('/usr/local/bin') ? '' : ' (no /usr/local/bin — busybox applets need it)'));
}

function md5Of(out) {
  return String(out).trim().split(/\s+/)[0] || '';
}

/* Watcher + a minimal bundle fingerprint: the CONDITION of cause 4, not a
 * health check (deploy-check owns those). The watcher is only a trap when a
 * native Home is what should be on screen. */
function checkWatcher(ctx) {
  let text;
  try { text = ctx.transport.readFile(CONFIG).toString('utf8'); }
  catch {
    observe(ctx, 'watcher', 'SKIP', 'no ' + CONFIG + ' on the TV — the watcher cannot be on');
    return;
  }
  const state = nativeInstall.watcherState(text);
  if (state !== 'on' && state !== 'off') {
    observe(ctx, 'watcher', 'SKIP', CONFIG + ' has no readable watcher.enabled');
    return;
  }
  let md5 = '';
  try { md5 = md5Of(ctx.transport.exec('md5sum ' + ctx.m.app + ' 2>/dev/null')); } catch { /* lane flake */ }
  let candidate = null;
  if (md5) {
    try { candidate = md5Of(ctx.transport.readFile(ctx.m.state + '/candidate.md5').toString('utf8')); }
    catch { candidate = null; }
  }
  const kind = !md5 ? 'unknown' : (md5 === ctx.m.stock_md5 ? 'stock' : (candidate && md5 === candidate ? 'candidate' : 'unknown'));
  if (state === 'on' && kind !== 'stock') {
    observe(ctx, 'watcher', 'FAIL', 'watcher is on with a ' + (kind === 'candidate' ? 'native Home' : 'non-stock bundle') + ' in place');
    ctx.traps.push('watcher-bounce');
    return;
  }
  observe(ctx, 'watcher', 'PASS', state === 'on'
    ? 'watcher on, stock in place — expected for the canvas launcher'
    : 'watcher off');
}

function hexToIp(hex) {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n)) return null;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

/* Broker sessions, from the TV's own /proc/net/tcp — the read-only answer to
 * cause 2. A competing server cannot be probed directly (connecting with the
 * paired identity would steal the session — the opposite of read-only), but
 * the sessions it holds are visible as established connections to :36669.
 * Expected: exactly one external (the paired server) plus the bridge on
 * loopback and whatever TV-internal clients the vendor runs. */
function checkMqtt(ctx) {
  let out;
  try { out = ctx.transport.exec(MQTT_SESSIONS_CMD); }
  catch (error) {
    observe(ctx, 'mqtt', 'SKIP', 'could not read the broker sessions: ' + error.message);
    return;
  }
  const externals = [];
  let v6 = 0;
  for (const line of String(out).split('\n')) {
    const token = line.trim().toUpperCase();
    if (!/^[0-9A-F]{8,32}:[0-9A-F]{1,5}$/.test(token)) continue;
    const [ipHex] = token.split(':');
    if (ipHex.length === 8) {
      const ip = hexToIp(ipHex);
      if (ip && !ip.startsWith('127.') && ip !== '0.0.0.0') externals.push({ ip });
    } else {
      v6++;
    }
  }
  let localProcesses = null;
  if (ctx.deps.hostProcesses) {
    try { localProcesses = ctx.deps.hostProcesses(); } catch { localProcesses = null; }
  } else {
    try { localProcesses = defaultHostProcesses(); } catch { localProcesses = null; }
  }
  ctx.mqtt = { externals, v6, localProcesses };
  if (externals.length > 1) {
    observe(ctx, 'mqtt', 'FAIL', externals.length + ' external MQTT sessions on :' + MQTT_PORT +
      ' (' + externals.map(s => s.ip).join(', ') + ')' +
      (v6 ? ', ' + v6 + ' v6 session(s) not decoded' : '') +
      (localProcesses && localProcesses.length ? '; local vidaa_server.py: ' + localProcesses.length : ''));
    ctx.traps.push('second-mqtt-server');
    return;
  }
  observe(ctx, 'mqtt', externals.length === 1 ? 'PASS' : 'WARN',
    externals.length === 1
      ? 'one external session on :' + MQTT_PORT + ' (' + externals[0].ip + ')' + (v6 ? ', ' + v6 + ' v6 session(s) not decoded' : '')
      : 'no external session on :' + MQTT_PORT + ' — the paired server is not connected right now' +
        (v6 ? ' (' + v6 + ' v6 session(s) not decoded)' : ''));
}

/* ------------------------------------------------------------- diagnosis -- */

/**
 * diagnose(opts, deps?) -> { cause, next, obs, traps }
 *   opts — { model, host, port?, key? }
 *   deps — { modelTable?, transport?, arpLookup?, pathProbe?, hostProcesses? }
 *     transport   — deploy-check's { exec, readFile } shape; default sshRemote
 *     arpLookup   — (opts) -> { mac } | null, host-side
 *     pathProbe   — (opts) -> string | null, prefix-free ssh session
 *     hostProcesses — () -> [ps lines] | null, this machine only
 * Read-only. Runs the ladder; every observation prints as it happens; the
 * verdict is the first trap in LADDER order (or healthy).
 */
function diagnose(opts, deps = {}) {
  const table = deps.modelTable || nativeInstall.MODELS.models;
  const ctx = {
    opts,
    deps,
    m: lookupModel(table, opts.model),
    transport: deps.transport || deployCheck.sshRemote(opts),
    obs: [], traps: [], arp: null, path: null, mqtt: null, laneDown: false
  };
  checkArp(ctx);
  if (checkLane(ctx)) {
    checkPath(ctx);
    checkWatcher(ctx);
    checkMqtt(ctx);
  } else {
    // The remaining causes live behind the lane; saying which could not be
    // observed is part of the answer.
    ctx.laneDown = true;
  }
  const cause = LADDER.find(c => ctx.traps.includes(c)) || 'healthy';
  return {
    cause,
    story: CAUSES[cause].story(ctx),
    next: CAUSES[cause].next(ctx),
    obs: ctx.obs,
    traps: ctx.traps,
    also: ctx.traps.filter(t => t !== cause),
    laneDown: ctx.laneDown
  };
}

function main(argv, deps = {}) {
  const opts = parse(argv);
  if (opts.help) { console.log(USAGE); return EXIT.ANSWER; }
  if (!opts.host) throw new UsageError('--host <tv-ip> is required');
  if (!opts.model) throw new UsageError('--model <id> is required');
  const result = diagnose(opts, deps);
  for (const o of result.obs) console.log(deployCheck.renderLine(o));
  if (result.laneDown) {
    console.log('— the lane is down, so the PATH, watcher and broker-session causes cannot be observed');
  }
  console.log('likely cause: ' + result.cause + ' — ' + result.story);
  console.log('next: ' + result.next);
  if (result.also.length) {
    console.log('also present: ' + result.also.join(', ') +
      ' — the likely cause blocks the rest; work down the list');
  }
  return EXIT.ANSWER;
}

if (require.main === module) {
  try { process.exit(main(process.argv)); }
  catch (error) {
    console.error((error.usage ? 'usage: ' : 'error: ') + error.message);
    process.exit(error.usage ? EXIT.USAGE : 1);
  }
}

module.exports = {
  EXIT, UsageError, parse, diagnose, main, CAUSES, LADDER,
  LANE_PROBE, LANE_OK, MQTT_PORT, MQTT_PORT_HEX, MQTT_SESSIONS_CMD,
  defaultArpLookup, defaultPathProbe, defaultHostProcesses, sshFlags, hexToIp
};
