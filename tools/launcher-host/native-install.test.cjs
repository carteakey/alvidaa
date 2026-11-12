'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hash } = require('./native-trial.cjs');
const { VARIANTS, MODELS, variant, model, verified, checkPair, parse } = require('./native-install.cjs');

const HERE = __dirname;

test('every variant names real parts, a real builder, and one effective component', () => {
  for (const v of VARIANTS.variants) {
    assert.ok(fs.existsSync(path.join(HERE, v.build)), v.id + ': missing build script');
    const builder = require(path.join(HERE, v.build));
    assert.equal(typeof builder.build, 'function', v.id + ': build is not exported');
    assert.deepEqual(builder.PARTS, v.parts, v.id + ': manifest parts drifted from the builder');
    for (const part of v.parts) {
      assert.ok(fs.existsSync(path.join(HERE, part)), v.id + ': missing part ' + part);
    }
    assert.equal(v.parts[v.parts.length - 1], 'native-entry.js',
      v.id + ': the entry must be appended last');
    const components = v.parts.filter(p => !/^native-platform/.test(p) && p !== 'native-entry.js');
    assert.ok(components.length >= 1, v.id + ': no component part');
    const effective = components[components.length - 1];
    const source = fs.readFileSync(path.join(HERE, effective), 'utf8');
    assert.match(source, /root\.Alvidaa[A-Za-z]+\s*=/, v.id + ': ' + effective + ' exports no global');
    assert.ok(v.summary && v.author && v.name, v.id + ': incomplete metadata');
  }
});

test('every model profile points at a real switch script and a private stock path', () => {
  for (const [id, m] of Object.entries(MODELS.models)) {
    assert.ok(fs.existsSync(path.join(HERE, m.switch)), id + ': missing switch script');
    assert.match(m.stock_md5, /^[0-9a-f]{32}$/, id + ': bad md5');
    assert.match(m.stock_sha256, /^[0-9a-f]{64}$/, id + ': bad sha256');
    assert.ok(m.local_stock.startsWith('firmware/'), id + ': stock copy must stay private');
    assert.ok(m.app.startsWith('/APPS/'), id + ': app path must be the writable module');
    assert.ok(m.state.startsWith('/var/local/'), id + ': state must live on /var/local');
    assert.equal(typeof m.engine, 'string');
  }
});

test('verification is per model, not per variant', () => {
  const fmtv = variant('free-my-tv');
  assert.equal(verified(fmtv, model('50a51huv')), true);
  assert.equal(verified(fmtv, model('75u8qtuk')), false);
  const ours = variant('alvidaa');
  assert.equal(verified(ours, model('50a51huv')), true);
  assert.equal(verified(ours, model('75u8qtuk')), false);
  const port = variant('free-my-tv-75u8qtuk');
  assert.equal(verified(port, model('75u8qtuk')), true);
  assert.equal(verified(port, model('50a51huv')), false);
});

test('an unverified pairing is refused unless forced, and says why', () => {
  const port = variant('free-my-tv-75u8qtuk');
  const reference = model('50a51huv');
  assert.throws(() => checkPair(port, reference, false), /has not been verified on 50A51HUV/);
  const warnings = [];
  const original = console.warn;
  console.warn = message => warnings.push(message);
  try { checkPair(port, reference, true); } finally { console.warn = original; }
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /--force/);
  assert.doesNotThrow(() => checkPair(variant('alvidaa'), reference, false));
});

test('each builder assembles its variant against a pinned stock and parses', () => {
  const dir = fs.mkdtempSync('/tmp/alvidaa-variants-');
  const stockFile = path.join(dir, 'stock.js');
  const stock = '/* private vendor bundle */\nself._V_M_={launcher:function(){return {route:[{path:"/Launcher",component:{}}]}}};\n';
  fs.writeFileSync(stockFile, stock);
  const digest = hash(Buffer.from(stock));
  function fixtureAssets(dir){
    fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'f.txt'),'install asset\n');
    fs.writeFileSync(path.join(dir,'fonts.css'),'@font-face{font-family:FMTVWeb16;src:url(f16.ttf)}\n');
    fs.writeFileSync(path.join(dir,'assets.json'),JSON.stringify({
      files:{'f.txt':hash(fs.readFileSync(path.join(dir,'f.txt')))},colors:['ffffff'],symbols:[]
    }));
    return dir;
  }
  for (const v of VARIANTS.variants) {
    const builder = require(path.join(HERE, v.build));
    const out = path.join(dir, v.id + '.js');
    // Native builders take (stockFile, output, expect) and return the candidate
    // string; web builders stage an asset directory first and return an object:
    // (stockFile, assetsDirectory, output, {expectedSha256}). Arity is not a
    // reliable signal (some native builders take an options tail), so the web
    // builders are told apart by their exported ASSET_BASE.
    const web = typeof builder.ASSET_BASE === 'string';
    const assets = web ? fixtureAssets(path.join(dir, 'assets-' + v.id)) : null;
    const result = web
      ? builder.build(stockFile, assets, out, { expectedSha256: digest })
      : builder.build(stockFile, out, digest);
    const candidate = typeof result === 'string' ? result : result.candidate;
    assert.ok(candidate.includes(stock), v.id + ': stock bundle missing');
    for (const part of v.parts) {
      assert.ok(candidate.includes(fs.readFileSync(path.join(HERE, part), 'utf8')),
        v.id + ': ' + part + ' missing from the candidate');
    }
    assert.doesNotThrow(() => new vm.Script(candidate), v.id + ': candidate does not parse');
    assert.ok(fs.existsSync(out), v.id + ': output not written');
    assert.throws(() => web
      ? builder.build(stockFile, assets, path.join(HERE, 'x.js'), { expectedSha256: digest })
      : builder.build(stockFile, path.join(HERE, 'x.js'), digest),
      /must stay private/, v.id + ': private-output guard missing');
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the command line parses flags and rejects unknown variants and models', () => {
  const parsed = parse(['node', 'x', 'install', 'alvidaa', '--model', '50a51huv',
    '--host', '192.0.2.10', '--port', '2222', '--force', '--dry-run']);
  assert.equal(parsed.command, 'install');
  assert.deepEqual(parsed.positional, ['alvidaa']);
  assert.equal(parsed.opts.model, '50a51huv');
  assert.equal(parsed.opts.host, '192.0.2.10');
  assert.equal(parsed.opts.force, true);
  assert.equal(parsed.opts.dryRun, true);
  assert.throws(() => variant('nope'), /unknown variant/);
  assert.throws(() => model('nope'), /unknown model/);
});
