#!/usr/bin/env node
'use strict';
// Build the alvidaa native Home candidate: private stock bundle + our parts.
//
// The stock bundle is vendor code and never enters the repo, so the expected
// sha256 is a required argument. A build that cannot state which revision it
// targets is a build that cannot be rolled back safely.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { hash } = require('./native-trial.cjs');
const wallpaper = require('./wallpaper.cjs');
const PARTS = ['native-platform.js', 'native-alvidaa.js', 'native-entry.js'];
const MARKER = 'ALVIDAA_NATIVE_HOME_V1';

function build(stockFile, output, expect, options) {
  assert.match(String(expect || ''), /^[0-9a-f]{64}$/,
    'expected sha256 of the stock bundle is required');
  const stock = fs.readFileSync(stockFile);
  assert.equal(hash(stock), expect, 'stock bundle does not match the pinned revision');
  // The wallpaper is generated here and inlined, so the candidate stays one
  // self-contained file and the repo carries no image asset.
  let art = 'self.AlvidaaNativeWallpaper="data:image/png;base64,' +
    wallpaper.render().toString('base64') + '";';
  const inputArt = options && options.inputArt;
  if (inputArt && typeof inputArt === 'object' && Object.keys(inputArt).length > 0) {
    art += '\nself.AlvidaaNativeInputArt=' + JSON.stringify(inputArt) + ';';
  }
  // The device silhouettes (issue #60) travel as rules + icons, not as a map of
  // this TV's inputs: the build does not know which ports exist, and it must
  // not have to. The component applies the rules to the name the TV reports.
  const deviceArt = options && options.deviceArt;
  if (deviceArt && typeof deviceArt === 'object' && deviceArt.icons) {
    art += '\nself.AlvidaaNativeDeviceArt=' + JSON.stringify(deviceArt) + ';';
  }
  // Per-app tint (issue #56): dominant colours extracted host-side from the
  // allowlisted icons (app-colours.cjs), keyed by icon basename. Absent when
  // the pipeline had no icons, and the component keeps the plain wash.
  const appColours = options && options.appColours;
  if (appColours && typeof appColours === 'object' && Object.keys(appColours).length > 0) {
    art += '\nself.AlvidaaNativeAppColours=' + JSON.stringify(appColours) + ';';
  }
  const candidate = '/* ' + MARKER + '\n * variant: native-alvidaa.js\n */\n' + art + '\n' +
    stock + '\n;\n' +
    PARTS.map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n;\n');
  new vm.Script(candidate, { filename: 'native-candidate.js' });
  if (output) {
    const target = path.resolve(output);
    const privateRoot = path.resolve(__dirname, '../../firmware') + path.sep;
    assert.ok(target.startsWith(privateRoot) || target.startsWith('/tmp/'),
      'vendor-containing output must stay private');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, candidate, { mode: 0o600 });
    fs.chmodSync(target, 0o600);
  }
  return candidate;
}

if (require.main === module) {
  const [stock, output, expect] = process.argv.slice(2);
  assert.ok(stock && output && expect,
    'Usage: build-native-alvidaa.cjs private-stock.js private-output.js <expected-sha256>');
  const candidate = build(stock, output, expect);
  console.log('Built alvidaa native candidate: ' + Buffer.byteLength(candidate) +
    ' bytes; sha256 ' + hash(candidate));
}
module.exports = { build, PARTS, MARKER };
