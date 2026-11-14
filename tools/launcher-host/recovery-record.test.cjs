'use strict';
/* Tests for recovery-record. No TV is reachable from CI, so every case runs
 * against a scripted fake transport ({ exec, readFile }) standing in for the
 * real SSH lane; the fixture facts (MAC, engine path, hook, watcher) are the
 * ones measured on the reference unit where stated. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const RR = require('./recovery-record.cjs');
const nativeInstall = require('./native-install.cjs');

const MODEL = '50a51huv';
const M = nativeInstall.MODELS.models[MODEL];
const CONFIG = RR.CONFIG;
const WIFI_MAC = 'bc:5c:17:bc:46:88'; // the MAC the project already records
const ENGINE_EXE = '/opt/hisenseUI/bin/hisenseUI';

/* A scripted fake TV. Files are returned by readFile; exec answers exactly
 * the command shapes recovery-record issues (md5sum, the /proc engine scan,
 * ls) and throws on anything else, so drift between the module and its
 * transport contract fails loudly. */
function fakeTransport(tv) {
  return {
    exec(cmd) {
      const c = cmd.replace(/\s*2>\/dev\/null/g, '').trim();
      if (c.startsWith('md5sum ')) {
        const file = c.slice(7).trim();
        const digest = tv.md5[file];
        return digest ? digest + '  ' + file + '\n' : '';
      }
      if (c.includes('/proc/[0-9]*')) return tv.enginePid ? tv.enginePid + '\n' : '';
      const exe = c.match(/^ls -l \/proc\/(\d+)\/exe$/);
      if (exe) {
        return tv.engineExe
          ? 'lrwxrwxrwx 1 u g 0 Jan  1 00:00 /proc/' + exe[1] + '/exe -> ' + tv.engineExe + '\n'
          : '';
      }
      if (c.startsWith('ls ')) {
        const target = c.replace(/^ls\s+(-l\s+)?/, '').trim();
        if (tv.dirs[target]) return tv.dirs[target].join('\n') + '\n';
        if (target in tv.files) {
          return '-rw-r--r-- 1 root root ' + tv.files[target].length + ' Jan  1 00:00 ' + target + '\n';
        }
        return '';
      }
      throw new Error('fake transport cannot emulate: ' + cmd);
    },
    readFile(file) {
      if (!(file in tv.files)) {
        const error = new Error('ENOENT: no such file or directory, open \'' + file + '\'');
        error.code = 'ENOENT';
        throw error;
      }
      return Buffer.from(tv.files[file]);
    }
  };
}

/* A healthy stock unit, identified by MAC — the measured reality of the
 * reference unit: no device-tree serial, an empty Did file. */
function makeTv(overrides = {}) {
  const tv = Object.assign({
    ip: '192.168.0.175', // deliberately present; the module must never read it
    enginePid: '6224',
    engineExe: ENGINE_EXE,
    files: {
      '/sys/class/net/wlan0/address': WIFI_MAC + '\n',
      [CONFIG]: JSON.stringify({ watcher: { enabled: false } }) + '\n',
      '/var/local/otaTest.sh': '#!/bin/sh\n# the root boot hook\n'
    },
    dirs: {
      '/var/local/alvidaa': ['alvidaa-bridge', 'config.json', 'config.json.bak-nativetest', 'launcher']
    },
    md5: { [M.app]: M.stock_md5 }
  }, overrides);
  return tv;
}

function tmpRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-recovery-record-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

/* 1: identify on a fixture TV. */
test('identify returns model, firmware, the measured serial and a stable key', t => {
  const id = RR.identify({ transport: fakeTransport(makeTv()), model: MODEL });
  assert.equal(id.model, MODEL);
  assert.equal(id.model_name, M.name);
  assert.equal(id.firmware, '09.01O.P0813');
  assert.equal(id.serial, WIFI_MAC, 'no serial exists, so the MAC is the identifier');
  assert.equal(id.serial_source, 'mac:wlan0');
  assert.equal(id.key, '50a51huv:bc5c17bc4688');
});

test('a device-tree serial wins over the MAC fallback when present', t => {
  const tv = makeTv({ files: Object.assign(makeTv().files, {
    '/proc/device-tree/serial-number': 'UNIT-SERIAL-42\0\0'
  }) });
  const id = RR.identify({ transport: fakeTransport(tv), model: MODEL });
  assert.equal(id.serial, 'UNIT-SERIAL-42');
  assert.equal(id.serial_source, '/proc/device-tree/serial-number');
  assert.equal(id.key, '50a51huv:unit-serial-42');
});

test('an empty Did file falls through to the MAC, like on the reference unit', t => {
  const tv = makeTv({ files: Object.assign(makeTv().files, {
    '/vendor/tvconfig/config/Did': 'DID0=\nDID1=\nDID2=\n'
  }) });
  const id = RR.identify({ transport: fakeTransport(tv), model: MODEL });
  assert.equal(id.serial_source, 'mac:wlan0');
});

test('with no serial and no readable MAC there is no record at all', t => {
  const tv = makeTv();
  delete tv.files['/sys/class/net/wlan0/address'];
  assert.throws(() => RR.identify({ transport: fakeTransport(tv), model: MODEL }),
    /no stable unit identity/);
});

/* 2: the key survives a DHCP change. */
test('the key is stable across a DHCP change: the IP is not part of it', t => {
  const before = RR.identify({ transport: fakeTransport(makeTv()), model: MODEL });
  const after = RR.identify({
    transport: fakeTransport(makeTv({ ip: '10.42.0.7' })), // new lease, same unit
    model: MODEL
  });
  assert.equal(after.key, before.key);
  assert.ok(!before.key.includes('192.168') && !before.key.includes('10.42'));
});

/* 3: one file per unit under the configured root. */
test('record writes one JSON file per unit under the configured root', t => {
  const root = tmpRoot(t);
  const rec = RR.record({ transport: fakeTransport(makeTv()), model: MODEL, path: root });
  const file = RR.recordPath(root, rec.key);
  assert.ok(fs.existsSync(file));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).key, rec.key);
  // a second unit lands in its own file
  const other = makeTv({ files: Object.assign(makeTv().files, {
    '/sys/class/net/wlan0/address': 'aa:bb:cc:dd:ee:ff\n' }) });
  RR.record({ transport: fakeTransport(other), model: MODEL, path: root });
  assert.equal(fs.readdirSync(root).filter(f => f.endsWith('.json')).length, 2);
});

/* 4: the overwrite policy — merge, originals preserved. */
test('a second record keeps the original watcher value and appends history', t => {
  const root = tmpRoot(t);
  const tv = makeTv({ files: Object.assign(makeTv().files,
    { [CONFIG]: JSON.stringify({ watcher: { enabled: true } }) + '\n' }) });
  const first = RR.record({ transport: fakeTransport(tv), model: MODEL, path: root });
  assert.equal(first.facts.watcher.enabled, true, 'the value rollback must restore');
  assert.equal(first.pristine, true, 'the bundle was stock at first record');

  tv.files[CONFIG] = JSON.stringify({ watcher: { enabled: false } }) + '\n';
  tv.md5[M.app] = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'; // a variant is installed meanwhile
  const second = RR.record({ transport: fakeTransport(tv), model: MODEL, path: root });

  assert.equal(second.facts.watcher.enabled, true, 'the pristine snapshot is never overwritten');
  assert.equal(second.latest.watcher.enabled, false, 'the re-probe is recorded as latest');
  assert.equal(second.history.length, 2, 'both sessions are auditable');
  assert.equal(second.pristine, true, 'pristine stays what the first record saw');
});

/* 5: unknown unit reads as null. */
test('read on an unknown unit returns null, not an empty record', t => {
  const root = tmpRoot(t);
  assert.equal(RR.read({ model: MODEL, key: '50a51huv:unknown', path: root }), null);
});

/* 6 + 7: compare. */
test('compare reports drift for bundle, watcher, engine and firmware changes', t => {
  const root = tmpRoot(t);
  const rec = RR.record({ transport: fakeTransport(makeTv()), model: MODEL, path: root });
  // each stage is a fresh fixture with exactly one change, so the drifted
  // field list pins down the single mutation
  const drifted = (tv, liveOverride) =>
    RR.compare(rec, liveOverride || RR.probe({ transport: fakeTransport(tv), model: MODEL }))
      .filter(r => r.drift).map(r => r.field);

  assert.deepEqual(drifted(makeTv({ md5: { [M.app]: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' } })),
    ['bundle_md5'], 'bundle md5 changed');

  assert.deepEqual(drifted(makeTv({ files: Object.assign(makeTv().files,
    { [CONFIG]: JSON.stringify({ watcher: { enabled: true } }) + '\n' }) })),
    ['watcher_enabled'], 'watcher flipped');

  assert.deepEqual(drifted(makeTv({ engineExe: '/opt/someother/bin/someother' })),
    ['engine_binary'], 'engine binary changed');

  const firmwareLive = Object.assign(
    RR.probe({ transport: fakeTransport(makeTv()), model: MODEL }), { firmware: 'V999.99.9.X9999' });
  assert.deepEqual(drifted(null, firmwareLive), ['firmware'], 'firmware changed');

  const hookGone = makeTv();
  delete hookGone.files['/var/local/otaTest.sh'];
  assert.deepEqual(drifted(hookGone), ['hook_present'], 'boot hook vanished');
});

test('compare reports no drift for an unchanged TV', t => {
  const root = tmpRoot(t);
  const tv = makeTv();
  const rec = RR.record({ transport: fakeTransport(tv), model: MODEL, path: root });
  const result = RR.compare(rec, RR.probe({ transport: fakeTransport(makeTv()), model: MODEL }));
  assert.ok(result.length >= 5);
  assert.ok(result.every(r => r.drift === false), JSON.stringify(result));
});

test('an engine that was running at record time and is gone now is drift', t => {
  const root = tmpRoot(t);
  const rec = RR.record({ transport: fakeTransport(makeTv()), model: MODEL, path: root });
  const down = makeTv({ enginePid: null, engineExe: null });
  const result = RR.compare(rec, RR.probe({ transport: fakeTransport(down), model: MODEL }));
  assert.deepEqual(result.filter(r => r.drift).map(r => r.field), ['engine_binary']);
  assert.equal(result.find(r => r.field === 'engine_binary').live, null);
});

/* 8: cross-model refusal. */
test('a record from another model is refused, naming both', t => {
  const root = tmpRoot(t);
  const rec = RR.record({ transport: fakeTransport(makeTv()), model: MODEL, path: root });
  assert.throws(() => RR.read({ model: '75u8qtuk', key: rec.key, path: root }),
    /belongs to model 50a51huv, not 75u8qtuk/);
  const live = RR.probe({ transport: fakeTransport(makeTv()), model: '75u8qtuk' });
  assert.throws(() => RR.compare(rec, live), /model 50a51huv.*75u8qtuk/);
});

/* 9: malformed records are refused, not half-applied. */
test('a malformed record file is refused, and never overwritten by record', t => {
  const root = tmpRoot(t);
  const rec = RR.record({ transport: fakeTransport(makeTv()), model: MODEL, path: root });
  const file = RR.recordPath(root, rec.key);

  for (const garbage of ['{not json at all', JSON.stringify({ hello: 1 })]) {
    fs.writeFileSync(file, garbage);
    assert.throws(() => RR.read({ model: MODEL, key: rec.key, path: root }),
      /malformed record/, 'read refuses: ' + garbage);
    // record refuses too — a corrupt record must not be silently replaced
    assert.throws(() => RR.record({ transport: fakeTransport(makeTv()), model: MODEL, path: root }),
      /malformed record/, 'record refuses: ' + garbage);
    assert.equal(fs.readFileSync(file, 'utf8'), garbage, 'the file was left untouched');
  }
});

test('an unknown model is refused at every entry point', t => {
  const tv = makeTv();
  assert.throws(() => RR.identify({ transport: fakeTransport(tv), model: 'nope' }), /unknown model/);
  assert.throws(() => RR.record({ transport: fakeTransport(tv), model: 'nope', path: '/tmp' }),
    /unknown model/);
});
