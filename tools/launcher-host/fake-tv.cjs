'use strict';
/* A fake TV that speaks the switch script's file protocol (issue #59).
 *
 * native-install.test.cjs fakes ssh() with a command-string map: it asserts
 * the commands we mean to send, then pretends they succeeded. That cannot
 * catch protocol-shaped failures — a stale cache, a switch that reports OK
 * but left the old bundle, an engine that never comes back, a dropbear that
 * resets mid-run — because those live in what the TV DOES with the commands,
 * not in what we send. This fake is the what-the-TV-does side: a filesystem,
 * a process table and a native re-implementation of switch-home-50a51huv.sh's
 * state machine, so native-install.cjs runs against it unmodified.
 *
 *   const tv = createFakeTv({ engine: 'hisenseUI', state, app,
 *     stockMd5, candidateMd5 });
 *   install('alvidaa', { ssh: tv.ssh, sleep: () => {}, model: '50a51huv',
 *     builder, noRecord: true, noVerify: true });
 *
 * Design laws:
 *   - An unknown command throws loudly. A fake that returns empty output for
 *     a command it does not know hides exactly the bugs it exists to catch;
 *     a new remote command must be taught here before it can be tested.
 *   - Known commands against missing files fail the way busybox does (a
 *     non-zero exit reaches the installer as a throw), so callers' error
 *     paths are exercised, not bypassed.
 *   - The uploaded switch script's bytes are stored, never interpreted. The
 *     state machine below IS the protocol under test; if the real script
 *     drifts from it, the drift shows up as a failed acceptance run here.
 *   - No network, no TV, no subprocesses: a pure host-side double.
 *
 * Out of scope, on purpose (see FAKE-TV.md): bootstrap's host-side md5 gate
 * needs the real pinned stock bytes, so the fake seeds an already-bootstrapped
 * TV; the recovery-record and verify-install steps run on host-side transports
 * of their own and are skipped with --no-record / --no-verify.
 */
const crypto = require('node:crypto');
const { WATCHER_BACKUP } = require('./native-install.cjs');

// The bridge config lives one name away from the watcher backup the installer
// exports; deriving it keeps one source of truth for the path. If the name
// ever drifts, syncWatcher refuses loudly ("no bridge config") and the tests
// fail with it.
const CONFIG = WATCHER_BACKUP.replace(/\.bak-native-home$/, '');

function md5Hex(buf) {
  return crypto.createHash('md5').update(buf).digest('hex');
}
function sha256Hex(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}
function parentOf(p) {
  const cut = p.lastIndexOf('/');
  return cut <= 0 ? '/' : p.slice(0, cut);
}

// Stand-in bytes for the pinned vendor bundle, which never enters the repo.
// The fake is told what md5 those bytes should report (stockMd5), so the
// placeholder content is arbitrary as long as it is stable.
const STOCK_STANDIN =
  '/* fake TV: stand-in for the pinned stock bundle (vendor code stays private) */\n';

function createFakeTv(options) {
  const engine = String(options.engine || 'hisenseUI');
  const state = options.state || '/var/local/alvidaa/native-home';
  const app = options.app || '/APPS/channelA/operation-ui/apps/launcher/js/app.js';
  const stockMd5 = options.stockMd5 || md5Hex(STOCK_STANDIN);
  const candidateMd5 = options.candidateMd5 || '';
  // The 50A51HUV switch script hardcodes the cache under the engine's name;
  // deriving it keeps the double honest for other engines too.
  const cache = options.cache || '/var/local/' + engine + '/cobalt_home/.cache/cobalt';

  const CANDIDATE = state + '/candidate-native-home.js';
  const CANDIDATE_MD5 = state + '/candidate.md5';
  const SWITCH = state + '/switch-home.sh';
  const BACKUP = state + '/backup';
  const DONE = state + '/switch.done';
  const LOG = state + '/switch.log';
  const PHASE = state + '/phase';
  const ENVF = state + '/engine.env';
  const STOCK_BACKUP = BACKUP + '/app.js.stock';

  const stock = Buffer.from(STOCK_STANDIN);
  const initialFlags = Object.assign(
    { homeStuck: false, crashing: false, staleCache: false, resetAfter: 0 },
    options.flags);

  // Everything a test can inspect or seed. files: path -> { content, md5,
  // mode }; dirs: the set of directories; procs: pid -> { exe, state, ppid };
  // calls: every command this fake was handed, in order.
  const files = new Map();
  const dirs = new Set();
  const procs = new Map();
  const calls = [];
  const flags = Object.assign({}, initialFlags);
  // Content whose md5 is a named lie (the stock stand-in reports stockMd5).
  const md5Alias = new Map();
  // Engine pids climb across restarts like the kernel's do; the new engine
  // never reuses the pid the switch just killed.
  let nextPid = 4242;

  let logLines = [];

  /* ------------------------------------------------------------- seed --- */

  function seed() {
    files.clear(); dirs.clear(); procs.clear(); calls.length = 0;
    md5Alias.clear();
    Object.assign(flags, initialFlags);
    nextPid = 4242;
    md5Alias.set(sha256Hex(stock), stockMd5);
    for (const dir of [parentOf(app), parentOf(state), state, BACKUP,
      parentOf(cache), cache, cache + '/compiled_js', cache + '/uncompiled_js',
      parentOf(CONFIG)]) dirs.add(dir);
    setRaw(app, stock, stockMd5, '0755');
    setRaw(STOCK_BACKUP, stock, stockMd5, '0600');
    setRaw(SWITCH, Buffer.from(
      '# stored by bootstrap; this fake implements the protocol natively\n' +
      '# and never interprets these bytes\n'), null, '0700');
    // A mid-life TV has a bridge config with the watcher still on.
    setRaw(CONFIG, Buffer.from(JSON.stringify({ watcher: { enabled: true } })), null, '0600');
    // And an engine that has already compiled the stock bundle.
    setRaw(cache + '/compiled_js/bundle-1.js',
      Buffer.from('/* compiled for the stock bundle */\n'), null, '0644');
    procs.set(4242, { exe: '/opt/' + engine + '/bin/' + engine, state: 'S', ppid: 1 });
  }
  seed();

  /* ----------------------------------------------------- file helpers --- */

  function setRaw(path, content, md5, mode) {
    files.set(path, {
      content: Buffer.isBuffer(content) ? Buffer.from(content) : Buffer.from(String(content)),
      md5: md5 || md5Alias.get(sha256Hex(content)) || md5Hex(content),
      mode: mode || '0644'
    });
    dirs.delete(path);
  }

  // Command-level write (`cat > path` with the payload as stdin). The
  // candidate path is the protocol's well-known slot: whatever bytes land
  // there report candidateMd5, because that is the value the installer
  // writes to candidate.md5 and the switch gate compares against.
  function store(path, input) {
    const buf = Buffer.isBuffer(input) ? Buffer.from(input) : Buffer.from(String(input == null ? '' : input));
    let md5 = md5Alias.get(sha256Hex(buf));
    if (!md5 && path === CANDIDATE && candidateMd5) md5 = candidateMd5;
    setRaw(path, buf, md5, '0644');
  }

  function read(path) {
    if (!files.has(path)) {
      throw new Error('ssh failed (1): cat: can\'t open \'' + path + '\': No such file or directory');
    }
    if (dirs.has(path)) {
      throw new Error('ssh failed (1): cat: read error: ' + path + ': Is a directory');
    }
    return files.get(path).content.toString();
  }

  function copyRecord(from, to) {
    const rec = files.get(from);
    if (!rec) {
      throw new Error('ssh failed (1): cp: can\'t open \'' + from + '\': No such file or directory');
    }
    setRaw(to, Buffer.from(rec.content), rec.md5, rec.mode);
  }

  function moveRecord(from, to) {
    copyRecord(from, to);
    files.delete(from);
  }

  function chmodPath(path, mode) {
    const rec = files.get(path);
    if (rec) { rec.mode = mode; return; }
    if (!dirs.has(path)) {
      throw new Error('ssh failed (1): chmod: ' + path + ': No such file or directory');
    }
    // Directory modes are not modelled further; nothing reads them.
  }

  function makeDir(dir) {
    if (files.has(dir)) {
      throw new Error('ssh failed (1): mkdir: can\'t create directory \'' + dir + '\': File exists');
    }
    dirs.add(dir);
  }

  function makeDirParents(dir) {
    const segs = dir.split('/').filter(Boolean);
    let cur = '';
    for (const seg of segs) { cur += '/' + seg; makeDir(cur); }
  }

  function moveDir(from, to) {
    if (!dirs.has(from)) {
      throw new Error('ssh failed (1): mv: can\'t rename \'' + from + '\': No such file or directory');
    }
    dirs.delete(from); dirs.add(to);
    for (const [p, rec] of Array.from(files)) {
      if (p.indexOf(from + '/') === 0) {
        files.set(to + p.slice(from.length), rec);
        files.delete(p);
      }
    }
  }

  function removeDir(dir) {
    dirs.delete(dir);
    for (const p of Array.from(files.keys())) {
      if (p.indexOf(dir + '/') === 0) files.delete(p);
    }
  }

  /* ------------------------------------------------- process helpers --- */

  // Mirrors live_engine(): match the binary /proc/<pid>/exe points at, not
  // the process name, and exclude zombies — a dead engine must not read as
  // up, or the switch would signal the wrong pid.
  function liveEnginePids() {
    const out = [];
    for (const [pid, proc] of procs) {
      if (!proc.exe.endsWith('/' + engine)) continue;
      if (String(proc.state).indexOf('Z') >= 0) continue;
      out.push(Number(pid));
    }
    return out.sort((a, b) => a - b);
  }

  function stopEngine() {
    for (const pid of liveEnginePids()) procs.delete(pid);
  }

  function startEngine() {
    nextPid += 1;
    procs.set(nextPid, { exe: '/opt/' + engine + '/bin/' + engine, state: 'S', ppid: 1 });
    return nextPid;
  }

  /* ------------------------------------------- the switch state machine --
   *
   * A native re-implementation of switch-home-50a51huv.sh: same gates, same
   * mutation order, same done/log/phase contract. Runs synchronously when
   * the installer kicks the detached script; the poll loop then finds
   * switch.done exactly as it would on the TV.
   */

  function md5of(path) {
    const rec = files.get(path);
    return rec ? rec.md5 : '';
  }

  function log(line) {
    logLines.push(line);
    setRaw(LOG, Buffer.from(logLines.join('\n') + '\n'), null, '0644');
  }

  // CANDIDATE_MD5 is read with 2>/dev/null by the script: a missing file is
  // an empty expectation, and the gate below then fails on md5of() — or, if
  // the candidate itself is missing too, the stage step fails, like the real
  // pipeline does one line later.
  function expectedCandidateMd5() {
    return files.has(CANDIDATE_MD5) ? read(CANDIDATE_MD5).trim() : '';
  }

  function runSwitch(mode) {
    logLines = [];
    log('=== switch-home mode=' + mode + ' ===');
    const fail = message => {
      log('FAIL ' + message);
      setRaw(DONE, Buffer.from('FAIL ' + message + '\n'), null, '0644');
    };

    if (mode === 'dry') {
      if (md5of(app) !== stockMd5) return fail('dry run requires stock app.js');
    } else if (mode === 'install') {
      if (md5of(app) !== stockMd5) return fail('install requires stock app.js');
      if (md5of(CANDIDATE) !== expectedCandidateMd5()) return fail('candidate hash mismatch');
      if (!files.has(STOCK_BACKUP)) return fail('stock backup missing');
      if (dirs.has(BACKUP + '/compiled_js') || files.has(BACKUP + '/compiled_js')) {
        return fail('cache backup already present');
      }
    } else if (mode === 'switch') {
      if (md5of(CANDIDATE) !== expectedCandidateMd5()) return fail('candidate hash mismatch');
      if (!files.has(STOCK_BACKUP)) return fail('stock backup missing');
      if (!dirs.has(BACKUP + '/compiled_js')) return fail('no stock cache backup; run install first');
    } else if (mode === 'rollback') {
      if (!files.has(STOCK_BACKUP)) return fail('stock backup missing');
    } else {
      return fail('unknown mode: ' + mode);
    }

    const live = liveEnginePids();
    if (!live.length) return fail('no live engine to capture');
    const old = live[0];
    setRaw(ENVF, Buffer.from('FAKE_ENGINE_ENV=1\u0000'), null, '0600');
    log('captured env from pid=' + old);
    stopEngine();
    log('engine stopped');

    // Mutate files only while the engine is down, like the script says.
    if (mode === 'install' || mode === 'switch') {
      if (!flags.homeStuck) {
        if (!files.has(CANDIDATE)) return fail('cannot stage candidate');
        const tmp = app + '.alvidaa-tmp';
        copyRecord(CANDIDATE, tmp);
        chmodPath(tmp, '0755');
        moveRecord(tmp, app);
        for (const dir of ['compiled_js', 'uncompiled_js']) {
          if (!flags.staleCache) {
            if (mode === 'install') {
              if (!dirs.has(cache + '/' + dir)) return fail('cannot back up ' + dir);
              moveDir(cache + '/' + dir, BACKUP + '/' + dir);
            } else {
              removeDir(cache + '/' + dir);
            }
            makeDir(cache + '/' + dir);
          }
        }
        setRaw(PHASE, Buffer.from(mode + '\n'), null, '0644');
        log(mode + ' complete; JS cache dirs reset');
      }
      // homeStuck: every gate passed and the switch will still report OK,
      // but the mutation never happened — the silent failure the flag exists
      // to reproduce. Nothing is logged: on the real TV this one is silent,
      // which is exactly what makes it expensive.
    } else if (mode === 'rollback' && !flags.homeStuck) {
      const tmp = app + '.alvidaa-tmp';
      copyRecord(STOCK_BACKUP, tmp);
      chmodPath(tmp, '0755');
      moveRecord(tmp, app);
      for (const dir of ['compiled_js', 'uncompiled_js']) {
        if (dirs.has(BACKUP + '/' + dir)) {
          removeDir(cache + '/' + dir);
          moveDir(BACKUP + '/' + dir, cache + '/' + dir);
        } else {
          log('WARN no backup for ' + dir + '; leaving regenerated cache');
        }
      }
      setRaw(PHASE, Buffer.from('restored\n'), null, '0644');
      log('restored stock app.js and JS cache dirs');
    }

    if (flags.crashing) {
      // APM restores the launcher after a crash, not after a clean SIGTERM;
      // the script then falls back to secure_exec, and when that fails too
      // the TV is left with the new bundle on disk, the engine down, and a
      // FAIL verdict.
      log('APM did not restore the engine; launching through secure_exec');
      return fail('engine did not start; SSH stays up, retry launch manually');
    }
    const fresh = startEngine();
    log('OK mode=' + mode + ' old=' + old + ' new=' + fresh + ' ppid=1');
    log('app.js md5 now ' + md5of(app));
    setRaw(DONE, Buffer.from('OK mode=' + mode + ' new=' + fresh + '\n'), null, '0644');
  }

  function switchStatus() {
    return 'app.js md5 ' + md5of(app) + '\n' +
      'stock md5  ' + stockMd5 + '\n' +
      'engine pid ' + liveEnginePids().join(' ') + '\n' +
      'phase      ' + (files.has(PHASE) ? read(PHASE).trim() : 'unknown') + '\n';
  }

  /* ------------------------------------------------ the command surface --
   *
   * Exactly the forms native-install.cjs and the switch script issue, plus
   * grep for the vocabulary. Anything else throws: teach the fake first.
   */

  function unhandled(body) {
    return new Error('fake TV: unhandled command: ' + body);
  }

  function grepPattern(arg) {
    return arg.replace(/^'(.*)'$/, '$1').replace(/^"(.*)"$/, '$1');
  }

  function dispatch(body, input) {
    let m;
    // The detached switch: clear the verdict, run the state machine.
    if ((m = body.match(/^rm -f (\S+) (\S+); \/bin\/sh -c 'trap "" HUP; exec \/bin\/sh (\S+) ([A-Za-z]+)' >\/dev\/null 2>&1 <\/dev\/null & echo started$/))) {
      if (m[3] !== SWITCH) throw unhandled(body);
      if (m[1] !== DONE || m[2] !== LOG) throw unhandled(body);
      files.delete(m[1]); files.delete(m[2]);
      runSwitch(m[4]);
      return 'started\n';
    }
    if ((m = body.match(/^\/bin\/sh (\S+) status$/))) {
      if (m[1] !== SWITCH) throw unhandled(body);
      return switchStatus();
    }
    if ((m = body.match(/^test -f (\S+) && echo yes \|\| echo no$/))) {
      return files.has(m[1]) && !dirs.has(m[1]) ? 'yes\n' : 'no\n';
    }
    if ((m = body.match(/^mkdir -p (\S+); chmod ([0-7]+) (\S+)$/))) {
      makeDirParents(m[1]); chmodPath(m[3], m[2]); return '';
    }
    if ((m = body.match(/^chmod ([0-7]+) (\S+); chmod ([0-7]+) (\S+)$/))) {
      chmodPath(m[2], m[1]); chmodPath(m[4], m[3]); return '';
    }
    if ((m = body.match(/^printf "%s\\n" "([^"]*)" > (\S+); chmod ([0-7]+) (\S+)$/))) {
      store(m[2], m[1] + '\n'); chmodPath(m[4], m[3]); return '';
    }
    // The engine scan (deploy-check.cjs engineScan, run by previousEnginePid).
    if ((m = body.match(/^for d in \/proc\/\[0-9\]\*; do /))) {
      const scanned = (body.match(/grep -q '\/([^']+)\$'/) || [])[1];
      if (scanned !== engine) throw unhandled(body);
      return liveEnginePids().map(pid => pid + '\n').join('');
    }
    if ((m = body.match(/^cat > (\S+)$/))) { store(m[1], input); return ''; }
    // `cat x 2>/dev/null` still exits non-zero when x is missing; the
    // installer's poll loop counts on that.
    if ((m = body.match(/^cat (\S+) 2>\/dev\/null$/))) return read(m[1]);
    if ((m = body.match(/^cat (\S+)$/))) return read(m[1]);
    if ((m = body.match(/^md5sum (\S+)$/))) {
      const rec = files.get(m[1]);
      if (!rec) {
        throw new Error('ssh failed (1): md5sum: ' + m[1] + ': No such file or directory');
      }
      return rec.md5 + '  ' + m[1] + '\n';
    }
    if ((m = body.match(/^cp -p (\S+) (\S+)$/))) { copyRecord(m[1], m[2]); return ''; }
    if ((m = body.match(/^mv -f (\S+) (\S+)$/))) { moveRecord(m[1], m[2]); return ''; }
    if ((m = body.match(/^chmod ([0-7]+) (\S+)$/))) { chmodPath(m[2], m[1]); return ''; }
    if ((m = body.match(/^mkdir -p (\S+)$/))) { makeDirParents(m[1]); return ''; }
    // grep, for the protocol's vocabulary. -q answers through the exit code
    // (no match is a status-1 throw, like the real applet); plain grep
    // prints the matching lines.
    if ((m = body.match(/^grep -q (\S+) (\S+)$/))) {
      const rec = files.get(m[2]);
      if (!rec) throw new Error('ssh failed (2): grep: ' + m[2] + ': No such file or directory');
      if (!new RegExp(grepPattern(m[1])).test(rec.content.toString())) {
        throw new Error('ssh failed (1): ');
      }
      return '';
    }
    if ((m = body.match(/^grep (\S+) (\S+)$/))) {
      const rec = files.get(m[2]);
      if (!rec) throw new Error('ssh failed (2): grep: ' + m[2] + ': No such file or directory');
      const pattern = new RegExp(grepPattern(m[1]));
      const hits = rec.content.toString().split('\n').filter(line => pattern.test(line));
      return hits.length ? hits.join('\n') + '\n' : '';
    }
    throw unhandled(body);
  }

  function ssh(opts, command, input) {
    calls.push(command);
    // resetAfter: dropbear drops the Nth call of the session (1-based), the
    // way it resets under a burst of sequential calls. The message matches
    // the transient lane failure the tooling knows how to tolerate.
    if (flags.resetAfter && calls.length === Number(flags.resetAfter)) {
      throw new Error('ssh failed (255): Connection closed by 192.0.2.10 port 2222');
    }
    return dispatch(String(command).replace(/^export PATH=[^;]*; /, ''), input);
  }

  function reset() { seed(); }

  return {
    ssh, files, dirs, procs, calls, flags, reset,
    engine, state, app, cache, config: CONFIG,
    candidatePath: CANDIDATE, stockMd5, candidateMd5
  };
}

module.exports = { createFakeTv, CONFIG };
