'use strict';
/* Tests for deploy-check. The TV is not reachable from CI, so every case
 * runs against a fixtureRemote() tree: a fake TV on disk. The model and
 * variant tables are injected the same way (main(argv, deps)), because the
 * pinned stock bundle is gitignored and cannot exist in a fresh clone.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { EXIT, UsageError, main } = require('./deploy-check.cjs');

const HERE = __dirname;
const APP = '/APPS/channelA/operation-ui/apps/launcher/js/app.js';
const ENGINE_BIN = '/opt/testEngine/bin/testEngine';
// A stand-in for the private vendor bundle: the builders only require that
// the pinned hashes match the bytes they are handed.
const STOCK = '/* fake vendor stock */\nself._V_M_ = { launcher: function () { return { route: [{ path: "/Launcher" }] } } };\n';

const md5 = d => crypto.createHash('md5').update(d).digest('hex');
const sha256 = d => crypto.createHash('sha256').update(d).digest('hex');

/* A scratch world: a fake repo root holding the pinned stock, a fake TV
 * tree, and the model/variant tables that point at both. Options flip the
 * knobs each test needs. */
function makeWorld(t, options = {}) {
  const root = fs.mkdtempSync('/tmp/alvidaa-deploy-check-test-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const stockRel = 'firmware/testmodel/operationui/apps/launcher/js/app.js';
  fs.mkdirSync(path.join(root, path.dirname(stockRel)), { recursive: true });
  const pinned = options.pinnedStock ?? STOCK;
  const onDisk = options.stock ?? pinned;
  fs.writeFileSync(path.join(root, stockRel), onDisk);

  const profile = {
    name: 'TESTMODEL / 1.0.0',
    app: APP,
    state: '/var/local/test/native-home',
    switch: 'switch-home-50a51huv.sh',
    engine: 'testEngine',
    owner: '305:305',
    mode: '0755',
    local_stock: stockRel,
    stock_md5: md5(pinned),
    stock_sha256: sha256(pinned)
  };
  const variant = {
    id: 'testv',
    name: 'Test Variant',
    author: 'test',
    summary: 'test variant',
    build: 'build-native-alvidaa.cjs',
    parts: ['native-platform.js', 'native-alvidaa.js', 'native-entry.js'],
    verified: options.unverified ? [] : [{ model: 'TESTMODEL', firmware: '1.0.0' }]
  };
  const fixture = makeFixture(path.join(root, 'tv'), options);
  return {
    root, fixture, profile, variant,
    deps: { modelTable: { testmodel: profile }, variantTable: [variant], repoRoot: root }
  };
}

function makeFixture(dir, options = {}) {
  fs.mkdirSync(path.join(dir, path.dirname(APP)), { recursive: true });
  const app = path.join(dir, APP);
  fs.writeFileSync(app, options.tvApp ?? STOCK);
  fs.chmodSync(app, 0o755);
  if (options.owner !== null) fs.writeFileSync(app + '.owner', (options.owner || '305:305') + '\n');

  fs.mkdirSync(path.join(dir, 'var/local/test/native-home'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'var/local/alvidaa'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'var/local/.free-kb'), String(options.freeKb ?? 819200) + '\n');
  fs.writeFileSync(path.join(dir, 'var/local/alvidaa/config.json'),
    JSON.stringify({ watcher: { enabled: options.watcher === true } }, null, 2) + '\n');

  fs.mkdirSync(path.join(dir, 'bridge'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bridge/api-debug.json'),
    JSON.stringify({ mqtt: { connected: !options.bridgeDown } }) + '\n');

  if (options.engine !== false) {
    fs.mkdirSync(path.join(dir, 'proc/431'), { recursive: true });
    fs.symlinkSync(ENGINE_BIN, path.join(dir, 'proc/431/exe'));
    fs.writeFileSync(path.join(dir, 'proc/431/status'), 'Name:\ttestEngine\nState:\tS (sleeping)\n');
  }

  if (options.unreachable) fs.writeFileSync(path.join(dir, '.unreachable'), '');
  if (options.nonroot) fs.writeFileSync(path.join(dir, '.nonroot'), '');
  return dir;
}

async function runMain(world, extra = []) {
  const argv = ['node', 'deploy-check.cjs', '--model', 'testmodel', '--variant', 'testv',
    '--fixture', world.fixture, ...extra];
  const lines = [];
  const original = console.log;
  console.log = (...parts) => lines.push(parts.join(' '));
  try {
    const code = await main(argv, world.deps);
    return { code, lines };
  } finally { console.log = original; }
}

const CHECK_RE = /^(PASS|WARN|FAIL|SKIP)  (\S+) /;
const checkNames = lines => lines.map(l => (l.match(CHECK_RE) || [])[2]).filter(Boolean);
const findLine = (lines, prefix) => lines.find(l => l.startsWith(prefix));

/* 1 + 6: the healthy TV. */
test('a healthy fixture TV passes every check and names the install command', async t => {
  const w = makeWorld(t);
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO);
  const names = checkNames(lines);
  assert.deepEqual(names, ['profile', 'stock-bundle', 'stock-hashes', 'build', 'pairing',
    'reachability', 'root', 'bundle-path', 'current-bundle', 'engine', 'bridge', 'watcher', 'space']);
  const statuses = lines.map(l => (l.match(CHECK_RE) || [])[1]).filter(Boolean);
  assert.ok(statuses.every(s => s === 'PASS'), 'every check PASS, got:\n' + lines.join('\n'));
  assert.match(lines[lines.length - 1],
    /^next: node tools\/launcher-host\/native-install\.cjs install testv --model testmodel --host <tv-ip>$/);
  // the current bundle is identified as stock, not "unknown"
  assert.match(findLine(lines, 'PASS  current-bundle'), / — stock$/);
});

test('watcher off is a PASS', async t => {
  const w = makeWorld(t);
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO);
  assert.match(findLine(lines, 'PASS  watcher'), /watcher disabled/);
});

/* 2: unreachable TV. */
test('an unreachable TV fails at reachability with the standby remedy and stops there', async t => {
  const w = makeWorld(t, { unreachable: true });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.NOGO);
  const names = checkNames(lines);
  assert.equal(names[names.length - 1], 'reachability', 'no check attempted after reachability');
  const line = findLine(lines, 'FAIL  reachability');
  assert.match(line, /deep standby/);
  assert.match(line, /Network Information for its address/);
  assert.match(lines[lines.length - 1], /^blocked by reachability: /);
});

/* 3: non-root shell. */
test('a non-root shell is a no-go and stops the run', async t => {
  const w = makeWorld(t, { nonroot: true });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.NOGO);
  const names = checkNames(lines);
  assert.equal(names[names.length - 1], 'root', 'no check attempted after root');
  assert.match(findLine(lines, 'FAIL  root'), /uid is 1000/);
  assert.match(lines[lines.length - 1], /^blocked by root: /);
});

/* 4: wrong current bundle hash. */
test('a live bundle that is neither stock nor the candidate is reported as unknown', async t => {
  const w = makeWorld(t, { tvApp: STOCK + '\n;// someone edited the live bundle\n' });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO, 'unknown is not a blocker');
  const line = findLine(lines, 'PASS  current-bundle');
  assert.match(line, /unknown/);
  assert.doesNotMatch(line, / — stock$/);
  assert.doesNotMatch(line, /already installed/);
});

/* 5: watcher on. */
test('the watcher on is a WARN with the bounce remedy, and still a go', async t => {
  const w = makeWorld(t, { watcher: true });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO, 'a footgun, not a blocker');
  const line = findLine(lines, 'WARN  watcher');
  assert.match(line, /watcher\.enabled is true/);
  assert.match(line, /bounced back to the canvas page within a second/);
  assert.match(lines[lines.length - 1], /^next: node /);
});

/* 7: missing local stock. */
test('a fresh clone without the pinned stock fails with the bootstrap remedy, remotes still run', async t => {
  const w = makeWorld(t);
  fs.rmSync(path.join(w.root, w.profile.local_stock));
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.NOGO);
  assert.match(findLine(lines, 'FAIL  stock-bundle'), /bootstrap --model testmodel --host <tv-ip>/);
  assert.ok(findLine(lines, 'SKIP  stock-hashes'));
  assert.ok(findLine(lines, 'SKIP  build'), 'nothing is built without pinned stock');
  assert.ok(findLine(lines, 'PASS  engine'), 'remote checks still ran');
});

/* 8: tampered local stock. */
test('a moved pinned stock fails naming the mismatch and is never built against', async t => {
  const w = makeWorld(t, { pinnedStock: STOCK, stock: STOCK + '\n;// moved on disk\n' });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.NOGO);
  const line = findLine(lines, 'FAIL  stock-hashes');
  assert.match(line, /md5 [0-9a-f]{32} != pinned [0-9a-f]{32}/);
  assert.match(line, /re-pin/);
  assert.ok(findLine(lines, 'SKIP  build'), 'never build against a moved bundle');
});

/* 9: --json. */
test('--json emits exactly one parseable object whose verdict matches the text mode', async t => {
  const healthy = makeWorld(t);
  const ok = await runMain(healthy, ['--json']);
  assert.equal(ok.lines.length, 1, 'one JSON object and nothing else on stdout');
  const parsed = JSON.parse(ok.lines[0]);
  assert.equal(parsed.tool, 'deploy-check');
  assert.equal(parsed.go, true);
  assert.equal(parsed.exit, EXIT.GO);
  assert.equal(ok.code, parsed.exit, 'exit code comes from the same verdict as the JSON');
  assert.equal(parsed.checks.length, 13);
  assert.match(parsed.next, /native-install\.cjs install testv/);
  assert.equal(parsed.blocked, null);

  const dead = makeWorld(t, { unreachable: true });
  const bad = await runMain(dead, ['--json']);
  assert.equal(bad.lines.length, 1);
  const parsedBad = JSON.parse(bad.lines[0]);
  assert.equal(parsedBad.go, false);
  assert.equal(parsedBad.exit, EXIT.NOGO);
  assert.equal(bad.code, parsedBad.exit);
  assert.equal(parsedBad.next, null);
  assert.match(parsedBad.blocked, /reachability/);
  assert.ok(parsedBad.checks.some(c => c.name === 'reachability' && c.status === 'FAIL'));
});

/* 10: usage errors. */
test('unknown model, unknown variant and missing host are usage errors (exit 2)', async t => {
  const w = makeWorld(t);
  const expectUsage = (argv, deps) => main(argv, deps).then(
    () => { throw new Error('expected a UsageError'); },
    error => {
      assert.ok(error instanceof UsageError, 'got: ' + error);
      assert.equal(error.usage, true, 'the CLI wrapper maps this to exit 2');
    });
  await expectUsage(['node', 'deploy-check.cjs', '--model', 'nope', '--fixture', w.fixture], w.deps);
  await expectUsage(['node', 'deploy-check.cjs', '--model', 'testmodel', '--variant', 'nope',
    '--fixture', w.fixture], w.deps);
  await expectUsage(['node', 'deploy-check.cjs', '--model', 'testmodel', '--variant', 'testv'], w.deps);
});

/* Extra coverage below: the WARN paths and the next-command assembly. */

test('an owner drift on the bundle path is a WARN, not a FAIL', async t => {
  const w = makeWorld(t, { owner: null }); // no sidecar: the real uid/gid stands in
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO);
  const line = findLine(lines, 'WARN  bundle-path');
  assert.match(line, /, profile expects 305:305 755/);
  assert.match(line, /someone has been here/);
});

test('a missing engine is a WARN, not a FAIL', async t => {
  const w = makeWorld(t, { engine: false });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO);
  const line = findLine(lines, 'WARN  engine');
  assert.match(line, /no live testEngine process/);
  assert.match(line, /the switch script restarts it/);
});

test('tight space on /var/local is a WARN under 5 MB', async t => {
  const w = makeWorld(t, { freeKb: 4096 });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO);
  const line = findLine(lines, 'WARN  space');
  assert.match(line, /4\.0 MB free on \/var\/local/);
  assert.match(line, /under the 5 MB/);
});

test('an unverified pairing warns and the next command carries --force', async t => {
  const w = makeWorld(t, { unverified: true });
  const { code, lines } = await runMain(w);
  assert.equal(code, EXIT.GO);
  const line = findLine(lines, 'WARN  pairing');
  assert.match(line, /has not been verified on TESTMODEL/);
  assert.match(line, /--force/);
  assert.match(lines[lines.length - 1], /^next: node .* install testv --model testmodel --host <tv-ip> --force$/);
});

test('non-default port and key flow into the next command', async t => {
  const w = makeWorld(t);
  const { code, lines } = await runMain(w, ['--host', '192.0.2.10', '--port', '2223', '--key', '/tmp/k']);
  assert.equal(code, EXIT.GO);
  assert.match(lines[lines.length - 1],
    /^next: node .* install testv --model testmodel --host 192\.0\.2\.10 --port 2223 --key \/tmp\/k$/);
});
