'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const preview = require('./preview-native-home.cjs');

/* Walk a rendered snapshot flat, the way the component's own tests do. */
function flatten(tree) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    out.push(node);
    for (const child of node.children || []) walk(child);
  }(tree));
  return out;
}

function load() {
  const f = preview.loadFixtureComponent();
  return Object.assign(f, { snap: () => preview.renderSnapshot(f.component, f.instance), flat: () => flatten(preview.renderSnapshot(f.component, f.instance)) });
}

/* ---- the fixture ----------------------------------------------------------- */

test('the fixture loads the component exactly like the tests do', () => {
  const f = load();
  const v = f.instance;
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1);
  // 39 fixture apps; the component filters browser home, stock home and the
  // blank name, and the fixture hides two (Twitch early, Search in the tail —
  // the settings apps-page then carries both row values) — 34 reach the dock
  // and the overlay.
  assert.equal(v.apps.length, 34);
  const dropped = ['vidaa-home', '206', '301'];
  for (const id of dropped) {
    assert.ok(!v.apps.some(a => a.appId === id), 'filtered: ' + id);
  }
  assert.equal(v.sources.length, 6);
  assert.equal(f.root.AlvidaaNativeActive, v);
  assert.equal(f.bodyListeners.size, 1, 'the component registered its own key listener');
  v.stop();
});

test('fixture inputs carry mixed signal state and the living-room names', () => {
  const f = load();
  const v = f.instance;
  const names = v.sources.map(s => v.sourceName(s));
  assert.deepEqual(names, ['TV', 'PlayStation 5', 'Fire TV Stick', 'Nintendo Switch', 'Steam Machine', 'HDMI6']);
  assert.equal(v.smartIndex(), 0, 'the TV tuner has signal, so smart focus lands there');
  // The same fields the component reads: a live input reports signal on
  // is_signal or has_signal; three of the six are dark, like the real room.
  const dark = v.sources.filter(s => String(s.is_signal) !== '1' && String(s.has_signal) !== '1');
  assert.deepEqual(dark.map(s => s.name), ['HDMI2', 'HDMI5', 'HDMI6']);
  v.stop();
});

test('fixture apps cover the icon shapes the dock actually shows', () => {
  const withIcon = preview.fixtureApps().filter(a => a.img);
  const bare = preview.fixtureApps().filter(a => !a.img);
  assert.ok(withIcon.length >= 5, 'icon apps: generated PNG tiles, allowlist-clean');
  assert.ok(bare.length >= 25, 'bare apps: letter badges with brand colours');
  for (const app of withIcon) {
    assert.match(app.img, /^data:image\/png;base64,/, app.appName + ': PNG, not SVG — the app-icon allowlist refuses svg+xml');
  }
});

/* ---- the h -> DOM-shaped-object conversion --------------------------------- */

test('renderSnapshot converts the tree into DOM-shaped objects', () => {
  const f = load();
  const snap = f.snap();
  assert.equal(snap.tag, 'div');
  assert.equal(snap.attributes.id, 'alvidaa-native');
  assert.equal(snap.style.backgroundColor, '#07080c');
  assert.ok(snap.children.length >= 4, 'dock, apps row, HUD layers');
  const flat = f.flat();
  assert.ok(flat.some(n => n.text === 'APPS'), 'text children become text specs');
  assert.ok(flat.some(n => typeof n.onClick === 'function'), 'on.click survives as onClick');
  const img = flat.find(n => n.tag === 'img');
  assert.ok(img, 'the favorite with an allowlisted icon renders an <img> spec');
  assert.match(img.attributes.src, /^data:image\/png;base64,/);
  assert.equal(img.attributes.alt, 'Netflix');
  const px = flat.find(n => typeof (n.style || {}).fontSize === 'string' && /px$/.test(n.style.fontSize));
  assert.ok(px, 'numeric style values resolve to px strings');
  const unitless = flat.find(n => typeof (n.style || {}).opacity === 'number');
  assert.ok(unitless !== undefined, 'opacity stays unitless like Vue renders it');
  f.instance.stop();
});

test('device shapes are divs, not images (findings 13 section 8)', () => {
  const f = load();
  const flat = f.flat();
  const shapes = flat.filter(n => (n.style || {}).border && /solid/.test(n.style.border) &&
    (n.style || {}).position === 'absolute');
  assert.ok(shapes.length > 10, 'the dock device icons are border/background divs');
  assert.equal(flat.filter(n => n.tag === 'svg').length, 0, 'no SVG elements anywhere');
  f.instance.stop();
});

/* ---- the fixture drives the dock and the overlay --------------------------- */

test('arrows move dock focus through the component handleKey', () => {
  const f = load();
  const v = f.instance;
  assert.equal(v.zone, 'dock');
  assert.equal(flat_focus(f), 1, 'one focused tile');
  v.handleKey(preview.KEYS.RIGHT);
  assert.equal(v.dock, 1);
  assert.equal(flat_focus(f), 1, 'exactly one focused tile after the move');
  const tree = f.snap();
  const flat = flatten(tree);
  const stage = flat.find(n => (n.style || {}).transform);
  assert.match(stage.style.transform, /translateY\(0px\)/, 'dock zone holds the stage at view 1');
  v.handleKey(preview.KEYS.LEFT);
  assert.equal(v.dock, 0);
  v.instance && v.stop();
});

function flat_focus(f) {
  return flatten(f.snap()).filter(n => (n.style || {}).transform === 'scale(1.03)').length;
}

test('ENTER on the Apps tile opens the overlay and BACKSPACE closes it', () => {
  const f = load();
  const v = f.instance;
  v.handleKey(preview.KEYS.DOWN);
  assert.equal(v.zone, 'apps');
  // The row starts on the favorites (the fixture has three); walk to the
  // Apps tile the way the remote would.
  const appsTile = v.appItems().findIndex(i => i.kind === 'apps');
  assert.ok(appsTile > 0, 'favorites sit before the Apps tile in this fixture');
  for (let i = 0; i < appsTile; i++) v.handleKey(preview.KEYS.RIGHT);
  assert.equal(v.app, appsTile);
  const before = flatten(f.snap());
  const stage = before.find(n => (n.style || {}).transform);
  assert.match(stage.style.transform, /translateY\(-/, 'the stage slides to view 2');
  v.handleKey(preview.KEYS.ENTER);
  assert.equal(v.overlay, true);
  const open = flatten(f.snap());
  assert.ok(open.some(n => n.text === 'OK to open \u00b7 BACK to close'), 'the overlay panel is in the tree');
  assert.ok(open.some(n => n.text === 'Netflix'), 'fixture app names fill the grid');
  v.handleKey(preview.KEYS.BACK);
  assert.equal(v.overlay, false);
  assert.ok(!flatten(f.snap()).some(n => n.text === 'OK to open \u00b7 BACK to close'), 'overlay gone from the tree');
  v.stop();
});

test('a favorite tile launches through the platform on ENTER', () => {
  const f = load();
  const v = f.instance;
  v.handleKey(preview.KEYS.DOWN);
  assert.equal(v.zone, 'apps');
  assert.equal(v.appItems()[0].kind, 'favorite');
  assert.equal(v.appItems()[0].label, 'Netflix');
  v.handleKey(preview.KEYS.ENTER);
  assert.deepEqual(f.calls.at(-1), ['launch', '1'], 'the favorite launches its app');
  v.stop();
});

test('arrow keys page the overlay and ENTER launches from it', () => {
  const f = load();
  const v = f.instance;
  v.zone = 'apps';
  v.app = v.appItems().findIndex(i => i.kind === 'apps');
  v.handleKey(preview.KEYS.ENTER);
  assert.equal(v.overlay, true);
  assert.equal(v.overlayIndex, 0);
  v.handleKey(preview.KEYS.RIGHT);
  assert.equal(v.overlayIndex, 1);
  // The overlay pages over overlayList() — with groups in the fixture that is
  // the flattened curated list, not this.apps — and the launch goes to the app
  // it focused. Read before the launch re-sorts apps by recency (issue #55).
  const focused = String(v.overlayList()[v.overlayIndex].appId);
  v.handleKey(preview.KEYS.ENTER);
  assert.deepEqual(f.calls.at(-1), ['launch', focused], 'launch goes through the platform stub');
  v.handleKey(preview.KEYS.BACK);
  assert.equal(v.overlay, false);
  v.stop();
});

/* ---- layer views: applyView drives each layer through public state --------- */

function layerTexts(view) {
  const { component, instance } = preview.loadFixtureComponent();
  preview.applyView(instance, view);
  const flat = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (node.text !== undefined) flat.push(String(node.text));
    for (const child of node.children || []) walk(child);
  }(preview.renderSnapshot(component, instance)));
  return { flat, texts: flat, has: s => flat.some(t => t === s) };
}

test('the fixture carries the groups and non-default prefs the layers need', () => {
  const storage = preview.fixtureStorage();
  const groups = JSON.parse(storage.alvidaa_groups);
  assert.deepEqual(groups.map(g => g.name), ['Essentials', 'Media']);
  assert.equal(storage.alvidaa_auto_switch, 'true');
  assert.equal(storage.alvidaa_idle_minutes, '5');
  const f = load();
  // Spread into a host array: prefs.groups is built inside the component's
  // vm realm, and deepStrictEqual compares Array prototypes across realms.
  assert.deepEqual([...f.instance.prefs.groups.map(g => g.name)], ['Essentials', 'Media']);
  assert.equal(f.instance.prefs.autoSwitch, true);
  assert.equal(f.instance.prefs.idleMinutes, 5);
  f.instance.stop();
});

test('?view=dock is the default: no settings or overlay text in the tree', () => {
  const dock = layerTexts('dock');
  assert.equal(dock.has('HOME SETTINGS'), false);
  assert.equal(dock.has('Essentials'), false);
  assert.equal(dock.has('OK to open \u00b7 BACK to close'), false);
});

test('?view=overlay renders the grouped apps overlay', () => {
  const overlay = layerTexts('overlay');
  assert.equal(overlay.has('OK to open \u00b7 BACK to close'), true);
  // The curated groups render as headers, in config order.
  assert.equal(overlay.has('Essentials'), true);
  assert.equal(overlay.has('Media'), true);
  // "Other apps" (the unclaimed tail) paginates below the first page, so it
  // is not in the first-page tree — the headers above it are the assertion.
  const appNames = overlay.texts.filter(t => ['Netflix', 'YouTube', 'Prime Video', 'Spotify', 'Plex'].includes(t));
  assert.ok(appNames.length >= 4, 'grouped apps render under their headers');
});

test('?view=settings shows non-default values, not factory rows', () => {
  const settings = layerTexts('settings');
  assert.equal(settings.has('HOME SETTINGS'), true);
  assert.equal(settings.has('on'), true, 'auto-switch reads on, not the default off');
  assert.equal(settings.has('5 min'), true, 'idle screen reads 5 min, not the default off');
});

test('?view=settings-apps shows the app rows with real state', () => {
  const apps = layerTexts('settings-apps');
  assert.equal(apps.has('APPS'), true);
  assert.equal(apps.has('shown'), true, 'visible apps carry their shown value');
  assert.equal(apps.has('hidden'), true, 'filtered apps carry their hidden value');
  assert.equal(apps.has('★ Netflix'), true, 'the favorite carries its pin marker');
});

test('applyView drives only public state, and dock closes every layer', () => {
  const f = load();
  const v = f.instance;
  preview.applyView(v, 'overlay');
  assert.equal(v.overlay, true);
  preview.applyView(v, 'settings');
  assert.equal(v.settings, true);
  assert.equal(v.overlay, false, 'the settings view closes the overlay');
  preview.applyView(v, 'dock');
  assert.equal(v.settings, false);
  assert.equal(v.overlay, false);
  assert.equal(v.zone, 'dock');
  v.stop();
});

/* ---- the page: --out and the served HTML ----------------------------------- */

test('--out writes one self-contained file with the banner and the fixture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-native-home-'));
  const file = path.join(dir, 'preview.html');
  try {
    const code = preview.main(['node', 'preview-native-home.cjs', '--out', file]);
    assert.equal(code, preview.EXIT.OK);
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /<!doctype html>/);
    assert.ok(html.includes(preview.BANNER), 'the banner is in the file');
    assert.ok(html.includes('PlayStation 5') && html.includes('Nintendo Switch'), 'fixture device names');
    assert.ok(html.includes('AlvidaaNativeHome(sdk)'), 'the real component source is embedded');
    assert.ok(html.includes('data:image/svg+xml;base64,'), 'the real baked device-art rules are embedded');
    assert.ok(html.includes('iVBORw0KGgo'), 'the generated wallpaper is embedded');
    assert.ok(html.includes('function elementFrom('), 'the h→element converter is embedded for the live redraw');
    // The server-side snapshot is real markup, so the page renders even with JS off.
    assert.match(html, /<div id="alvidaa-native" style="position: absolute;/);
    assert.ok(html.includes('border: 3px solid'), 'rendered device-shape borders are in the static markup');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the served page answers with the same HTML, then closes', async () => {
  const server = preview.startServer(0, preview.buildPage());
  await new Promise(resolve => server.on('listening', resolve));
  const port = server.address().port;
  const res = await fetch('http://127.0.0.1:' + port + '/');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const body = await res.text();
  assert.ok(body.includes(preview.BANNER));
  assert.ok(body.includes('AlvidaaNativeHome(sdk)'));
  await new Promise(resolve => server.close(resolve));
});

test('the embedded boot script and component source parse as JS (no browser needed)', () => {
  // The page's live path — component source plus the boot script with the
  // toString()-embedded converter — is exactly the code no node:test can
  // execute without a browser. Parsing it catches template breakage (a bad
  // toString embedding, an unescaped </script>) before the owner opens it.
  const vm = require('node:vm');
  const html = preview.buildPage();
  const scripts = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2, 'component source, then the boot script');
  for (const [which, body] of scripts.entries()) {
    assert.doesNotThrow(() => new vm.Script(body, { filename: 'page-script-' + which + '.js' }),
      'script ' + which + ' must parse');
  }
  assert.match(scripts[1], /component\.render\.call\(v, h\)/, 'the boot script renders through the component');
  // The component listens for the vendor's custom "key-down" event
  // (native-alvidaa.js mounted), which real keypresses never fire — they are
  // "keydown". The boot script must therefore BRIDGE: keydown → handleKey →
  // draw, or the served page's keyboard is a no-op (caught on the first real
  // browser pass: a redraw-only listener passed every node:test).
  assert.match(scripts[0], /addEventListener\("key-down"/, 'the component registers its vendor key event');
  assert.match(scripts[1], /addEventListener\("keydown"[\s\S]*?v\.handleKey\(e\.keyCode\)/,
    'the boot script bridges real keydown to handleKey');
  assert.match(scripts[1], /v\.handleKey\(e\.keyCode\);[\s\S]*?draw\(\);[\s\S]*?preventDefault/,
    'handled keys redraw then preventDefault');
  // Deep links and the control strip: ?view= selects the layer, the strip's
  // buttons drive the same public state, and neither is a second input path —
  // both land in applyView, which only touches the data object and public
  // methods.
  assert.match(scripts[1], /location\.search/, 'deep links are read from the URL');
  assert.match(scripts[1], /applyView\(v, requested\)/, 'the requested view is applied');
  assert.match(scripts[1], /setView\(requested\)/, 'the control strip starts on the requested view');
  const strip = html.slice(html.indexOf('id="preview-controls"'), html.indexOf('id="preview-stage"'));
  for (const view of preview.VIEWS) {
    assert.match(strip, new RegExp('data-view="' + view + '"'), 'control strip button for ' + view);
  }
});

test('--view bakes a layer into the --out snapshot and validates its value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-native-home-'));
  try {
    // Assertions run on the SSR snapshot region only: the embedded component
    // source carries every layer's text ('HOME SETTINGS' included) in EVERY
    // page, so a file-wide includes proves nothing about the snapshot.
    const snapshotOf = html => html.slice(
      html.indexOf('<div id="alvidaa-native"'),
      html.indexOf('<div id="preview-banner"'));
    const overlayFile = path.join(dir, 'overlay.html');
    assert.equal(preview.main(['node', 'preview-native-home.cjs', '--view', 'overlay', '--out', overlayFile]), preview.EXIT.OK);
    const overlaySnap = snapshotOf(fs.readFileSync(overlayFile, 'utf8'));
    assert.match(overlaySnap, /<div id="alvidaa-native" style="position: absolute;/);
    assert.ok(overlaySnap.includes('Essentials'), 'the overlay snapshot carries the group headers');
    assert.ok(overlaySnap.includes('OK to open \u00b7 BACK to close'), 'the overlay snapshot is the overlay layer');
    assert.ok(!overlaySnap.includes('HOME SETTINGS'), 'the overlay snapshot does not carry the settings layer');

    const settingsFile = path.join(dir, 'settings.html');
    assert.equal(preview.main(['node', 'preview-native-home.cjs', '--view', 'settings', '--out', settingsFile]), preview.EXIT.OK);
    const settingsSnap = snapshotOf(fs.readFileSync(settingsFile, 'utf8'));
    assert.ok(settingsSnap.includes('HOME SETTINGS'), 'the settings snapshot is the settings layer');
    assert.ok(settingsSnap.includes('5 min'), 'non-default idle value in the static markup');
    assert.ok(!settingsSnap.includes('Essentials'), 'the settings snapshot does not carry the overlay');

    assert.throws(() => preview.main(['node', 'preview-native-home.cjs', '--view', 'nonsense']),
      /--view must be one of/, 'an unknown layer is a usage error');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('usage: unknown flags and bad ports are usage errors; --help is clean', () => {
  assert.throws(() => preview.main(['node', 'preview-native-home.cjs', '--nope']), preview.UsageError);
  assert.throws(() => preview.main(['node', 'preview-native-home.cjs', '--port', 'abc']), /--port/);
  assert.throws(() => preview.main(['node', 'preview-native-home.cjs', '--port']), /--port/);
  const logs = [];
  const original = console.log;
  console.log = l => logs.push(String(l));
  let code;
  try { code = preview.main(['node', 'preview-native-home.cjs', '--help']); }
  finally { console.log = original; }
  assert.equal(code, preview.EXIT.OK);
  assert.match(logs[0], /^usage:/);
});
