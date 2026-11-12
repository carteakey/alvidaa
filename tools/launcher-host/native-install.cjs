#!/usr/bin/env node
'use strict';
/* Pick a lane-3 native Home variant and put it on a TV.
 *
 *   node native-install.cjs list
 *   node native-install.cjs install <variant> --model <id> --host <ip> [--force]
 *   node native-install.cjs rollback --model <id> --host <ip>
 *   node native-install.cjs status   --model <id> --host <ip>
 *
 * Why a CLI and not a page on the TV: lane 3 replaces the thing a picker would
 * live in. If a variant renders badly, a picker inside the native Home is
 * unreachable. The picker has to sit outside the swapped component, so this is
 * a host-side tool over the root SSH lane. A bridge-served page can drive the
 * same functions later.
 *
 * Safety rules, all enforced here:
 *   - a variant is only offered for a build it has actually run on; --force
 *     overrides that, loudly.
 *   - the stock bundle is pulled from the TV and verified against the model
 *     profile before anything is written.
 *   - the stock backup is taken once, by bootstrap, and is never replaced by a
 *     variant switch. Rollback therefore works whichever variant is installed.
 *   - every build states the stock sha256 it targets.
 */
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const { hash } = require('./native-trial.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const VARIANTS = JSON.parse(fs.readFileSync(path.join(HERE, 'variants.json'), 'utf8'));
const MODELS = JSON.parse(fs.readFileSync(path.join(HERE, 'models.json'), 'utf8'));

function variant(id) {
  const found = VARIANTS.variants.filter(v => v.id === id)[0];
  if (!found) {
    throw new Error('unknown variant: ' + id + ' (try: ' +
      VARIANTS.variants.map(v => v.id).join(', ') + ')');
  }
  return found;
}

function model(id) {
  const found = MODELS.models[id];
  if (!found) {
    throw new Error('unknown model: ' + id + ' (try: ' +
      Object.keys(MODELS.models).join(', ') + ')');
  }
  return found;
}

function verified(v, m) {
  return (v.verified || []).some(entry => entry.model === m.name.split(' / ')[0]);
}

function checkPair(v, m, force) {
  if (verified(v, m)) return;
  const where = (v.verified || []).map(e => e.model + ' / ' + e.firmware).join(', ') || 'nowhere yet';
  const message = v.name + ' has not been verified on ' + m.name + ' (verified on: ' + where + ')';
  if (!force) throw new Error(message + '. Pass --force only if you accept the risk.');
  console.warn('WARNING: ' + message + '. Proceeding because --force was passed.');
}

function sshArgs(opts, command) {
  return ['-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null',
    '-p', String(opts.port), '-i', opts.key, 'root@' + opts.host, command];
}

function ssh(opts, command, input) {
  if (opts.dryRun) {
    console.log('[dry-run] ssh ' + opts.host + ' ' + command.split('\n')[0]);
    return '';
  }
  const result = cp.spawnSync('ssh', sshArgs(opts, command), {
    input: input == null ? undefined : input,
    encoding: input == null ? 'utf8' : 'buffer',
    maxBuffer: 64 * 1024 * 1024
  });
  if (result.status !== 0) {
    throw new Error('ssh failed (' + result.status + '): ' +
      String(result.stderr || '').trim().split('\n').slice(-2).join(' '));
  }
  return input == null ? String(result.stdout) : result.stdout;
}

function upload(opts, local, remote) {
  if (opts.dryRun) {
    console.log('[dry-run] upload ' + local + ' -> ' + remote);
    return;
  }
  ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/local/bin; cat > ' + remote, fs.readFileSync(local));
}

function bootstrap(opts, m) {
  console.log('bootstrap ' + m.name);
  const localStock = path.join(REPO, m.local_stock);
  fs.mkdirSync(path.dirname(localStock), { recursive: true });
  const stock = ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + m.app);
  if (!opts.dryRun) {
    fs.writeFileSync(localStock, stock, { mode: 0o600 });
    const md5 = cp.execFileSync('md5sum', [localStock], { encoding: 'utf8' }).split(/\s/)[0];
    assert.equal(md5, m.stock_md5, 'pulled stock md5 does not match the model profile');
    assert.equal(hash(fs.readFileSync(localStock)), m.stock_sha256,
      'pulled stock sha256 does not match the model profile');
    console.log('  stock verified: ' + md5);
  }
  ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; mkdir -p ' + m.state + '/backup; chmod 700 ' + m.state);
  upload(opts, path.join(HERE, m.switch), m.state + '/switch-home.sh');
  upload(opts, localStock, m.state + '/backup/app.js.stock');
  ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; chmod 700 ' + m.state + '/switch-home.sh; ' +
    'chmod 600 ' + m.state + '/backup/app.js.stock');
  console.log('  switch script and stock backup installed');
}

function currentMd5(opts, m) {
  const out = ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; md5sum ' + m.app);
  return String(out).split(/\s/)[0];
}

function runSwitch(opts, m, mode) {
  const done = m.state + '/switch.done';
  const log = m.state + '/switch.log';
  ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; rm -f ' + done + ' ' + log + '; ' +
    '/bin/sh -c \'trap "" HUP; exec /bin/sh ' + m.state + '/switch-home.sh ' + mode + '\' ' +
    '>/dev/null 2>&1 </dev/null & echo started');
  if (opts.dryRun) return;
  for (let i = 0; i < 45; i++) {
    cp.execFileSync('sleep', ['2']);
    let text = '';
    try {
      text = ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + done + ' 2>/dev/null');
    } catch (_) { /* not there yet */ }
    if (String(text).trim()) {
      const logText = ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; cat ' + log + ' 2>/dev/null');
      console.log(String(logText).trim());
      if (!/^OK /.test(String(text).trim())) throw new Error('switch failed: ' + String(text).trim());
      return;
    }
  }
  throw new Error('switch did not finish in 90s; SSH is still up, check ' + log);
}

function install(id, opts) {
  const v = variant(id);
  const m = model(opts.model);
  checkPair(v, m, opts.force);

  const builder = require(path.join(HERE, v.build));
  const localStock = path.join(REPO, m.local_stock);
  assert.ok(fs.existsSync(localStock),
    'no pinned stock bundle at ' + m.local_stock + '; run bootstrap first');
  const out = path.join(REPO, 'firmware', opts.model, 'candidate-' + v.id + '.js');
  const candidate = builder.build(localStock, out, m.stock_sha256);
  console.log('built ' + v.name + ': ' + Buffer.byteLength(candidate) + ' bytes, sha256 ' + hash(candidate));

  if (!opts.dryRun) {
    const probe = ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; test -f ' + m.state + '/switch-home.sh && echo yes || echo no');
    if (String(probe).trim() !== 'yes') bootstrap(opts, m);
  }

  upload(opts, out, m.state + '/candidate-native-home.js');
  const md5 = opts.dryRun ? '<dry-run>' :
    cp.execFileSync('md5sum', [out], { encoding: 'utf8' }).split(/\s/)[0];
  ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; printf "%s\\n" "' + md5 + '" > ' +
    m.state + '/candidate.md5; chmod 600 ' + m.state + '/candidate-native-home.js');

  // install when the bundle is stock, switch when another variant is in place.
  const mode = opts.dryRun ? 'install' : (currentMd5(opts, m) === m.stock_md5 ? 'install' : 'switch');
  console.log('mode: ' + mode);
  runSwitch(opts, m, mode);
  if (!opts.dryRun) console.log(v.name + ' is installed on ' + m.name);
}

function rollback(opts) {
  const m = model(opts.model);
  runSwitch(opts, m, 'rollback');
  console.log('stock restored on ' + m.name);
}

function status(opts) {
  const m = model(opts.model);
  const out = ssh(opts, 'export PATH=/bin:/usr/bin:/sbin:/usr/bin; /bin/sh ' + m.state + '/switch-home.sh status');
  console.log(String(out).trim());
}

function list() {
  console.log('variants');
  for (const v of VARIANTS.variants) {
    console.log('  ' + v.id.padEnd(24) + v.name + '  (' + v.author + ')');
    console.log('    ' + v.summary);
    console.log('    verified: ' + ((v.verified || []).map(e => e.model + ' / ' + e.firmware).join(', ') || 'nowhere yet'));
  }
  console.log('\nmodels');
  for (const [id, m] of Object.entries(MODELS.models)) {
    console.log('  ' + id.padEnd(12) + m.name + '  engine ' + m.engine);
  }
  console.log('\ninstall: node tools/launcher-host/native-install.cjs install <variant> --model <id> --host <tv-ip>');
}

function parse(argv) {
  const args = argv.slice(2);
  const command = args.shift();
  const positional = [];
  const opts = { port: 2222, key: path.join(REPO, 'server/keys/tv_root_ed25519'), dryRun: false, force: false };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--model') opts.model = args[++i];
    else if (arg === '--host') opts.host = args[++i];
    else if (arg === '--key') opts.key = args[++i];
    else if (arg === '--port') opts.port = Number(args[++i]);
    else if (arg === '--force') opts.force = true;
    else if (arg === '--dry-run') opts.dryRun = true;
    else positional.push(arg);
  }
  return { command, positional, opts };
}

function main(argv) {
  const { command, positional, opts } = parse(argv);
  if (command === 'list' || !command) return list();
  if (command === 'install') {
    assert.ok(positional[0], 'usage: install <variant> --model <id> --host <ip>');
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return install(positional[0], opts);
  }
  if (command === 'rollback') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return rollback(opts);
  }
  if (command === 'status') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return status(opts);
  }
  if (command === 'bootstrap') {
    assert.ok(opts.model && opts.host, '--model and --host are required');
    return bootstrap(opts, model(opts.model));
  }
  throw new Error('unknown command: ' + command);
}

if (require.main === module) {
  try { main(process.argv); }
  catch (error) { console.error('error: ' + error.message); process.exit(1); }
}

module.exports = { VARIANTS, MODELS, variant, model, verified, checkPair, parse, main, install, bootstrap };
