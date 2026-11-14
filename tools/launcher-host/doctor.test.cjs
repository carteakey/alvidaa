'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const doctor = require('./doctor.cjs');
const { MODELS } = require('./native-install.cjs');
const { CONFIG } = require('./native-trial.cjs');

const M0 = MODELS.models['50a51huv'];
const APP = M0.app;
const MAC = 'bc:5c:17:bc:46:88';

const md5 = b => crypto.createHash('md5').update(b).digest('hex');
const STOCK = Buffer.from('/* pinned stock bundle */\n');
const CANDIDATE = Buffer.from('/* candidate bundle v2 */\n');

/* ---- a scripted fake over deploy-check's transport shape -----------------
 * Defaults describe a TV with the lane up and no trap; each cause test
 * mutates one thing. diagnose() returns the verdict and prints nothing;
 * main() prints — so each cause is asserted twice: the named cause from
 * diagnose(), and the printed next command from main()'s lines. The exec
 * strip mirrors the house fakes (verify-install, drift-check) so the tests
 * cover what the module actually sees. */
function fakeTV(spec = {}) {
  const files = new Map();
  if (spec.noConfig !== true) {
    files.set(CONFIG, JSON.stringify({ watcher: { enabled: spec.watcher === true } }));
  }
  files.set(APP, spec.bundle || CANDIDATE);
  if (spec.candidateMd5 !== null) {
    files.set(M0.state + '/candidate.md5', Buffer.from((spec.candidateMd5 || md5(CANDIDATE)) + '\n'));
  }
  const lane = spec.lane === undefined ? 'up' : spec.lane;
  return {
    exec(cmd) {
      const c = cmd.replace(/^export PATH=[^;]*; /, '').replace(/\s*2>\/dev\/null/g, '').trim();
      if (lane === 'up' && c === doctor.LANE_PROBE) return doctor.LANE_OK + '\n';
      if (lane === 'auth-fail') throw new Error('ssh failed: root@192.0.2.10: Permission denied (publickey,password).');
      if (lane === 'closed-by') throw new Error('ssh failed: Connection closed by 192.0.2.10 port 2222');
      if (lane === 'refused') throw new Error('ssh failed: ssh: connect to host 192.0.2.10 port 2222: Connection refused');
      if (lane === 'timeout') throw new Error('ssh failed: ssh: connect to host 192.0.2.10 port 2222: Operation timed out');
      if (c.startsWith('md5sum ')) {
        const data = files.get(c.slice('md5sum '.length));
        return data ? md5(data) + '  x\n' : ''; // missing file: empty stdout
      }
      if (c.includes('/proc/net/tcp')) {
        // What the awk would print: the remote column, hex ip:port.
        const sessions = spec.sessions || [];
        return sessions.join('\n') + (sessions.length ? '\n' : '');
      }
      throw new Error('fake tv: unhandled command: ' + c);
    },
    readFile(p) {
      if (!files.has(p)) throw new Error('cannot read ' + p + ' over ssh (status 1)');
      return files.get(p);
    }
  };
}

/* The host-side probes are injectable: arp (the napping vs wrong-address
 * discriminator), the prefix-free PATH probe, and the local process list. */
function deps(spec = {}) {
  return {
    modelTable: { '50a51huv': Object.assign({}, M0, { stock_md5: md5(STOCK) }) },
    transport: fakeTV(spec),
    arpLookup: () => spec.arp === undefined ? { mac: MAC } : spec.arp,
    pathProbe: () => spec.path === undefined ? '/bin:/usr/bin:/sbin:/usr/local/bin' : spec.path,
    hostProcesses: () => spec.processes === undefined ? [] : spec.processes
  };
}

const OPTS = ['node', 'doctor.cjs', '--model', '50a51huv', '--host', '192.0.2.10', '--port', '2222', '--key', 'k'];

function run(spec, opts) {
  return doctor.diagnose(Object.assign({ model: '50a51huv', host: '192.0.2.10', port: 2222, key: 'k' }, opts), deps(spec));
}

function runMain(spec) {
  const original = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    const code = doctor.main(OPTS, deps(spec));
    return { code, lines };
  } finally { console.log = original; }
}

const causeLine = lines => lines.find(l => l.startsWith('likely cause:'));
const nextLine = lines => lines.find(l => l.startsWith('next: '));
const obs = (r, name) => r.obs.find(o => o.name === name);

/* ---- one test per cause: the named cause, and the next command printed --- */

test('cause 1 — napping: ARP resolves, nothing listens on 2222', () => {
  const { code, lines } = runMain({ lane: 'refused' });
  assert.equal(code, doctor.EXIT.ANSWER);
  assert.match(causeLine(lines), /likely cause: napping — .*the address is right and the box looks dead/);
  assert.match(nextLine(lines), /wake the TV/);
  const r = run({ lane: 'refused' });
  assert.match(obs(r, 'arp').observed, new RegExp(MAC));
  assert.match(obs(r, 'lane').observed, /Connection refused/);
});

test('cause 3 — wrong-address: no ARP entry even after probing', () => {
  const { code, lines } = runMain({ lane: 'refused', arp: null });
  assert.equal(code, doctor.EXIT.ANSWER);
  assert.match(causeLine(lines), /likely cause: wrong-address — .*no ARP entry/);
  assert.match(nextLine(lines), /Network Information|lease list/);
  const r = run({ lane: 'refused', arp: null });
  assert.match(obs(r, 'arp').observed, /no ARP entry/);
  // ARP absence is the only thing separating this from napping — same ssh error.
  assert.match(obs(r, 'lane').observed, /Connection refused/);
});

test('ARP unobservable: the run still answers, saying what it could not look up', () => {
  const d = deps({ lane: 'refused' });
  d.arpLookup = () => { throw new Error('arp: not found'); };
  const r = doctor.diagnose({ model: '50a51huv', host: '192.0.2.10' }, d);
  assert.equal(obs(r, 'arp').status, 'SKIP');
  // Without the ARP evidence the ssh error speaks for itself; both network
  // causes are on the table and the run names one rather than refusing.
  assert.ok(['napping', 'wrong-address'].includes(r.cause));
});

test('TCP on 2222 but ssh auth fails: key or dropbear, not the network', () => {
  const { lines } = runMain({ lane: 'auth-fail' });
  assert.match(causeLine(lines), /likely cause: key-or-dropbear — .*the key or dropbear, not the network/);
  assert.match(nextLine(lines), /\.\/server\/tv/);
  const r = run({ lane: 'auth-fail' });
  assert.match(obs(r, 'lane').observed, /Permission denied/);
});

test('TCP on 2222 but the session closes mid-kex: key or dropbear too', () => {
  const { lines } = runMain({ lane: 'closed-by', arp: null });
  assert.match(causeLine(lines), /likely cause: key-or-dropbear/);
  assert.match(nextLine(lines), /dropbear/);
});

test('cause 5 — no-path: ssh works, a raw session has an empty PATH', () => {
  const { lines } = runMain({ path: '' });
  assert.match(causeLine(lines), /likely cause: no-path — .*empty PATH/);
  assert.match(nextLine(lines), /export PATH=|\.\/server\/tv/);
  const r = run({ path: '' });
  assert.equal(obs(r, 'path').status, 'FAIL');
});

test('PATH probe failure: SKIP, and it does not invent the trap', () => {
  const r = run({ path: null });
  assert.equal(obs(r, 'path').status, 'SKIP');
  assert.notEqual(r.cause, 'no-path');
});

test('cause 4 — watcher-bounce: watcher on with the native Home in place', () => {
  const { lines } = runMain({ watcher: true });
  assert.match(causeLine(lines), /likely cause: watcher-bounce — .*bounces the TV back to the canvas page within a second/);
  assert.match(nextLine(lines), /install <variant>/);
  const r = run({ watcher: true });
  assert.equal(obs(r, 'watcher').status, 'FAIL');
});

test('watcher on with stock in place is the canvas setup, not a trap', () => {
  const r = run({ watcher: true, bundle: STOCK, candidateMd5: null });
  assert.equal(obs(r, 'watcher').status, 'PASS');
  assert.match(obs(r, 'watcher').observed, /expected for the canvas launcher/);
  assert.notEqual(r.cause, 'watcher-bounce');
});

test('cause 2 — second-mqtt-server: two external sessions on the broker port', () => {
  // Two established sessions to :36669 as the TV's /proc/net/tcp reports
  // them (hex remotes): one from the Mac, one from the Pi.
  const spec = {
    sessions: ['C0A80063:9C4A', 'C0A8000B:AA20'],  // 192.168.0.99, 192.168.0.11
    processes: [' 4321 /usr/bin/python3 server/vidaa_server.py']
  };
  const { lines } = runMain(spec);
  assert.match(causeLine(lines), /likely cause: second-mqtt-server — .*2 MQTT sessions/);
  assert.match(causeLine(lines), /192\.168\.0\.99, 192\.168\.0\.11/);
  assert.match(nextLine(lines), /stop the extra vidaa_server\.py/);
  assert.match(nextLine(lines), /this host has 1: pid 4321/);
  const r = run(spec);
  assert.equal(obs(r, 'mqtt').status, 'FAIL');
});

test('one external session is the healthy case for the broker', () => {
  const r = run({ sessions: ['C0A80063:9C4A'] });
  assert.equal(obs(r, 'mqtt').status, 'PASS');
  assert.match(obs(r, 'mqtt').observed, /192\.168\.0\.99/);
  assert.notEqual(r.cause, 'second-mqtt-server');
});

test('no external session at all: WARN naming the disconnected server, not a false cause-2', () => {
  const r = run({ sessions: [] });
  assert.equal(obs(r, 'mqtt').status, 'WARN');
  assert.match(obs(r, 'mqtt').observed, /not connected right now/);
  assert.notEqual(r.cause, 'second-mqtt-server');
});

test('broker sessions unreadable: SKIP, never a false cause-2', () => {
  const d = deps({});
  d.transport = {
    exec(cmd) {
      if (cmd === doctor.LANE_PROBE) return doctor.LANE_OK + '\n';
      if (cmd.includes('/proc/net/tcp')) throw new Error('ssh failed: Connection closed by remote host');
      throw new Error('fake tv: unhandled command: ' + cmd);
    },
    readFile(p) { return fakeTV({}).readFile(p); }
  };
  const r = doctor.diagnose({ model: '50a51huv', host: '192.0.2.10' }, d);
  assert.equal(obs(r, 'mqtt').status, 'SKIP');
  assert.notEqual(r.cause, 'second-mqtt-server');
});

test('healthy: every observation clean, verdict healthy', () => {
  const r = run({ sessions: ['C0A80063:9C4A'] });
  assert.equal(r.cause, 'healthy');
  assert.match(r.next, /status --model/);
  for (const o of r.obs) assert.equal(o.status, 'PASS', o.name + ': ' + o.observed);
});

test('the lane-down verdict names what could not be observed', () => {
  const r = run({ lane: 'timeout' });
  assert.equal(r.cause, 'napping');
  assert.equal(r.laneDown, true);
  const { lines } = runMain({ lane: 'timeout' });
  assert.ok(lines.some(l => /lane is down/.test(l) && /PATH, watcher and broker-session/.test(l)));
});

/* ---- hex decoding: the /proc/net/tcp addresses the report names ----------- */

test('hexToIp decodes the remote column the way awk prints it', () => {
  assert.equal(doctor.hexToIp('C0A8000B'), '192.168.0.11');
  assert.equal(doctor.hexToIp('C0A80063'), '192.168.0.99');
  assert.equal(doctor.hexToIp('7F000001'), '127.0.0.1');
});

/* ---- the exit contract and usage ----------------------------------------- */

test('main exits 0 when it has an answer — even "the TV is asleep"', () => {
  const { code } = runMain({ lane: 'timeout' });
  assert.equal(code, doctor.EXIT.ANSWER);
});

test('usage errors: usage-flagged, and the doctor subcommand maps them to exit 2', () => {
  for (const argv of [
    ['node', 'doctor.cjs'],
    ['node', 'doctor.cjs', '--model', '50a51huv'],
    ['node', 'doctor.cjs', '--host', '192.0.2.10'],
    ['node', 'doctor.cjs', '--model', 'nosuch', '--host', 'x'],
    ['node', 'doctor.cjs', '--model', '50a51huv', '--host', 'x', '--nope']
  ]) {
    try {
      doctor.main(argv, deps({}));
      assert.fail('expected UsageError for ' + argv.join(' '));
    } catch (error) {
      assert.ok(error.usage, 'usage-flagged: ' + argv.join(' '));
    }
  }
  const original = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  let code;
  try { code = doctor.main(['node', 'doctor.cjs', '--help']); }
  finally { console.log = original; }
  assert.equal(code, doctor.EXIT.ANSWER);
  assert.match(lines[0], /^usage:/);
});

/* ---- the native-install.cjs doctor subcommand -----------------------------
 * The subcommand shell itself (routing, flag passthrough, the exit code it
 * returns through main()) is native-install.test.cjs's; doctor.test.cjs owns
 * the diagnosis. */
