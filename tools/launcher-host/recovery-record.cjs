'use strict';
/* recovery-record — a host-side record of what a TV looked like before
 * alvidaa touched it, keyed by device (issue #51).
 *
 *   const rr = require('./recovery-record.cjs');
 *   rr.identify({ transport, model })   -> { model, firmware, serial, key, ... }
 *   rr.record({ transport, model, path }) -> record object (written)
 *   rr.read({ model, key, path })       -> record | null
 *   rr.compare(record, live)            -> [{ field, recorded, live, drift }]
 *
 * Why: every backup alvidaa takes lives on the TV, in /var/local/alvidaa/.
 * That is the right place for the restore path and the wrong place for the
 * record of it — a bad TV-side change takes the recovery path with it, and
 * nothing on the host answers "what did this unit look like before?". This
 * module is that second copy, and it makes the AGENTS.md warning that
 * "another agent session may be working the same TV" auditable instead of
 * prose.
 *
 * Identity: the key is the model id plus a stable per-unit identifier, so a
 * record follows the TV when DHCP moves it and refuses a different unit.
 * There is no readable per-unit serial on the reference unit — the
 * candidates were measured, not guessed (see SERIAL_CANDIDATES and
 * RECOVERY-RECORD.md) — so the identifier falls back to the WiFi MAC, with
 * that limitation documented.
 *
 * Read-only against the TV: the transport only execs and reads. Every write
 * happens on the host, under firmware/ (gitignored, private). The busybox on
 * the TV has no id, curl, wget, nc, sha256sum, netstat — nothing here uses
 * them; md5, presence and process facts come from md5sum/ls/grep and
 * /proc (see deploy-check.cjs's engineScan, reused for the same zombie
 * rules).
 */
const fs = require('node:fs');
const path = require('node:path');

const deployCheck = require('./deploy-check.cjs');
const nativeInstall = require('./native-install.cjs');

const HERE = __dirname;
const REPO = path.resolve(HERE, '../..');
const SCHEMA = 1;
// Measured on the reference unit (50A51HUV @ 192.168.0.175, 2026-11-10,
// read-only over the root SSH lane):
//   - /proc/device-tree/serial-number: absent; the Mstar device tree has no
//     serial or uuid node at all.
//   - /vendor/tvconfig/config/Did: exists (37 bytes) but DID0..DID5 are all
//     empty on this unit.
//   - /serialdata/common/serials.ini and /serialdata/characteristic/ are
//     per-series/per-model tables, not per-unit.
// So on this unit the identity falls back to the WiFi MAC — which matches
// the MAC the project already records (bc:5c:17:bc:46:88 on wlan0).
const SERIAL_CANDIDATES = [
  '/proc/device-tree/serial-number',
  '/sys/firmware/devicetree/base/serial-number',
  '/vendor/tvconfig/config/Did'
];
const MAC_IFACES = ['wlan0', 'eth0'];
const CONFIG = '/var/local/alvidaa/config.json';
// The root boot hook and its rolling backup (findings 05/07).
const HOOK = '/var/local/otaTest.sh';
const HOOK_BACKUP = '/var/local/otaTest.v1.bak';

/* ------------------------------------------------------------- helpers -- */

// The real lane: the exact ssh flags native-install.cjs uses, borrowed from
// deploy-check so they cannot drift between the two tools.
function sshTransport(opts) {
  return deployCheck.sshRemote(opts);
}

function sanitize(name) {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}

function recordPath(root, key) {
  return path.join(root, sanitize(key) + '.json');
}

function trimNul(text) {
  return String(text).replace(/\0+$/, '').trim();
}

function md5OfOut(out) {
  return String(out).trim().split(/\s+/)[0] || null;
}

function isoNow() {
  return new Date().toISOString();
}

/* ------------------------------------------------------------- identity -- */

function readSerialCandidate(transport, candidate) {
  let data;
  try { data = transport.readFile(candidate); }
  catch { return null; }
  const text = trimNul(data.toString('utf8'));
  if (!text) return null;
  // The Did file is an ini of DID0..DID5 lines; the serial is whatever is
  // populated, in index order. Anything else is taken as the raw value.
  const dids = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^DID\d+=(.*)$/);
    if (m) dids.push(m[1].trim());
  }
  if (dids.length) return dids.filter(Boolean).join('') || null;
  return text;
}

function readMac(transport) {
  for (const iface of MAC_IFACES) {
    try {
      const mac = trimNul(transport.readFile('/sys/class/net/' + iface + '/address').toString('utf8')).toLowerCase();
      if (/^[0-9a-f:]{17}$/.test(mac)) return { mac, iface };
    } catch { /* interface absent on this unit */ }
  }
  return null;
}

function unitId(transport) {
  for (const candidate of SERIAL_CANDIDATES) {
    const serial = readSerialCandidate(transport, candidate);
    if (serial) return { serial, source: candidate };
  }
  const mac = readMac(transport);
  if (mac) return { serial: mac.mac, source: 'mac:' + mac.iface, mac: mac.mac, macIface: mac.iface };
  // A record without a stable identity would be keyed on nothing that
  // survives a reboot or a DHCP move; refuse rather than guess.
  throw new Error('no stable unit identity: no serial at ' + SERIAL_CANDIDATES.join(', ') +
    ' and no readable MAC at ' + MAC_IFACES.map(i => '/sys/class/net/' + i).join(', '));
}

function identify({ transport, model }) {
  const m = nativeInstall.model(model); // throws on an unknown model
  const id = unitId(transport);
  const serial = id.serial.replace(/[:\s]+/g, '');
  return {
    model,
    model_name: m.name,
    firmware: m.name.split(' / ')[1] || '',
    serial: id.serial,
    serial_source: id.source,
    mac: id.mac || null,
    mac_iface: id.macIface || null,
    // lowercased so a serial that changes case between reads still matches
    key: (model + ':' + serial).toLowerCase()
  };
}

/* ---------------------------------------------------------------- probe -- */

function probeBundle(transport, m) {
  const md5 = md5OfOut(transport.exec('md5sum ' + m.app + ' 2>/dev/null'));
  return { md5, is_stock: md5 != null && md5 === m.stock_md5 };
}

function probeWatcherFile(transport, file) {
  const config = JSON.parse(transport.readFile(file).toString('utf8'));
  return { enabled: !!(config && config.watcher && config.watcher.enabled) };
}

function probeWatcher(transport) {
  // The live value is what rollback restores, so a flaky lane must fail the
  // record loudly instead of recording a silent null — re-run until clean.
  const current = probeWatcherFile(transport, CONFIG);
  // The pre-install value rollback must restore is not always the live one:
  // on 2026-11-10 the live config was already watcher-off while the true
  // original sat in config.json.bak-nativetest. Capture every backup's
  // value; a backup that cannot be read is recorded as null WITH the reason,
  // because backups are optional context, not the restore value.
  const backups = [];
  const listing = transport.exec('ls ' + path.dirname(CONFIG) + ' 2>/dev/null');
  for (const line of String(listing).split('\n')) {
    const name = line.trim();
    if (!/^config\.json\.bak-/.test(name)) continue;
    const file = path.dirname(CONFIG) + '/' + name;
    try {
      backups.push(Object.assign({ file: name }, probeWatcherFile(transport, file)));
    } catch (error) {
      backups.push({ file: name, enabled: null, error: error.message });
    }
  }
  return Object.assign({ backups }, current);
}

function probeEngine(transport, m) {
  const out = String(transport.exec(deployCheck.engineScan(m.engine))).trim();
  const pids = out ? out.split('\n').filter(Boolean) : [];
  let binary = null;
  if (pids.length) {
    // busybox ps shows short names only; the /proc/<pid>/exe link is where
    // the full binary path lives (same trick as the switch script).
    const line = String(transport.exec('ls -l /proc/' + pids[0] + '/exe 2>/dev/null')).trim();
    const arrow = line.split(' -> ')[1];
    if (arrow) binary = arrow.trim();
  }
  return { binary, pids };
}

function probeHook(transport) {
  function one(file) {
    const listed = String(transport.exec('ls -l ' + file + ' 2>/dev/null')).trim();
    if (!listed) return { present: false, md5: null };
    return { present: true, md5: md5OfOut(transport.exec('md5sum ' + file + ' 2>/dev/null')) };
  }
  return { hook: one(HOOK), backup: one(HOOK_BACKUP) };
}

// Everything cheap and read-only, in one pass. `live` objects carry the same
// shape as a record's facts, so compare() can diff them directly.
function probe({ transport, model }) {
  const m = nativeInstall.model(model);
  return {
    at: isoNow(),
    model,
    model_name: m.name,
    firmware: m.name.split(' / ')[1] || '',
    bundle: probeBundle(transport, m),
    watcher: probeWatcher(transport),
    engine: probeEngine(transport, m),
    boot: probeHook(transport)
  };
}

/* ------------------------------------------------------- record and read -- */

function validate(record, where) {
  const bad = what => { throw new Error('malformed record ' + where + ': ' + what); };
  if (!record || typeof record !== 'object' || Array.isArray(record)) bad('not an object');
  if (record.schema !== SCHEMA) bad('unknown schema ' + JSON.stringify(record.schema));
  if (typeof record.key !== 'string' || !record.key) bad('missing key');
  if (typeof record.model !== 'string' || !record.model) bad('missing model');
  if (!record.facts || typeof record.facts !== 'object') bad('missing facts');
}

function load(file) {
  // Read errors (ENOENT etc.) propagate untouched so callers can tell a
  // missing record from a corrupt one; only bad content is wrapped here.
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (error) { error.file = file; throw error; }
  let record;
  try { record = JSON.parse(text); }
  catch (error) { throw new Error('malformed record ' + file + ': cannot parse JSON (' + error.message + ')'); }
  validate(record, file);
  return record;
}

function writeRecord(root, record) {
  fs.mkdirSync(root, { recursive: true });
  const file = recordPath(root, record.key);
  // Atomic and 0600: the record carries the unit's MAC and bundle hashes —
  // private material, same reason the stock bundles live under firmware/.
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(record, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(tmp, file);
  return file;
}

function read({ model, key, path: root }) {
  const file = recordPath(root || defaultRoot(model), key);
  let record;
  try { record = load(file); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  if (record.model !== model) {
    throw new Error('record ' + file + ' belongs to model ' + record.model + ', not ' + model +
      ' — refusing to apply a record to the wrong unit');
  }
  if (record.key !== key) {
    throw new Error('record ' + file + ' carries key ' + record.key + ', not ' + key);
  }
  return record;
}

// A second record never overwrites the pristine snapshot: `facts` stays the
// first-ever capture (that is the value rollback has to restore), `latest`
// and a compact history line are appended. Merge was chosen over
// refuse-and---replace because refusing pushes an operator towards deleting
// the old record by hand — the exact accident this file exists to prevent —
// while a merge keeps the pristine values authoritative and makes each
// session on the TV auditable.
function historyLine(facts) {
  return {
    at: facts.at,
    bundle_md5: facts.bundle.md5,
    watcher_enabled: facts.watcher.enabled,
    engine_binary: facts.engine.binary,
    hook_present: facts.boot.hook.present
  };
}

// Default home for records: under firmware/ (gitignored, private, already
// the home for per-model private material), one JSON file per unit.
function defaultRoot(model) {
  return path.join(REPO, 'firmware', model, 'recovery');
}

function record({ transport, model, path: root }) {
  const home = root || defaultRoot(model);
  const id = identify({ transport, model });
  const facts = probe({ transport, model });
  const file = recordPath(home, id.key);
  let previous = null;
  try { previous = load(file); }
  catch (error) {
    if (error.code === 'ENOENT') previous = null;
    else throw error; // malformed or unreadable: refuse, never overwrite
  }
  if (previous) {
    if (previous.key !== id.key) {
      throw new Error('record ' + file + ' belongs to unit ' + previous.key + ', not ' + id.key);
    }
    previous.updated = facts.at;
    previous.latest = facts;
    previous.history.push(historyLine(facts));
    writeRecord(home, previous);
    return previous;
  }
  const fresh = Object.assign(id, {
    schema: SCHEMA,
    created: facts.at,
    updated: facts.at,
    // Was the bundle still stock at first record? If not, the watcher value
    // below may already be the flipped one — the pristine value may live in
    // one of the recorded config.json.bak-* files instead.
    pristine: facts.bundle.is_stock,
    facts,
    latest: facts,
    history: [historyLine(facts)]
  });
  writeRecord(home, fresh);
  return fresh;
}

/* -------------------------------------------------------------- compare -- */

const COMPARE_FIELDS = [
  ['firmware', r => r.facts.firmware, l => l.firmware],
  ['bundle_md5', r => r.facts.bundle.md5, l => l.bundle.md5],
  ['watcher_enabled', r => r.facts.watcher.enabled, l => l.watcher.enabled],
  ['engine_binary', r => r.facts.engine.binary, l => l.engine.binary],
  ['hook_present', r => r.facts.boot.hook.present, l => l.boot.hook.present]
];

// Diff the pristine snapshot against a live probe. Every compared field gets
// an entry, drifted or not, so the output is a stable table.
function compare(record, live) {
  validate(record, record.key || '(unknown)');
  if (!live || typeof live !== 'object' || !live.bundle || !live.watcher) {
    throw new Error('live probe missing — pass the object probe() returned');
  }
  if (record.model !== live.model) {
    throw new Error('record is for model ' + record.model + ', live probe is for ' + live.model +
      ' — refusing to compare across models');
  }
  return COMPARE_FIELDS.map(([field, getRecorded, getLive]) => {
    const recorded = getRecorded(record);
    const value = getLive(live);
    return { field, recorded, live: value, drift: recorded !== value };
  });
}

module.exports = {
  identify, record, read, compare, probe, sshTransport, defaultRoot,
  SERIAL_CANDIDATES, MAC_IFACES, CONFIG, HOOK, HOOK_BACKUP, recordPath
};
