'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { hash } = require('./native-trial.cjs');

const SOURCE = fs.readFileSync(path.join(__dirname, 'native-alvidaa.js'), 'utf8');
const ENTRY = fs.readFileSync(path.join(__dirname, 'native-entry.js'), 'utf8');
const KEYS = { HOME: 36, LAUNCHER: 547, SOURCE: 515, KEYPAD_INPUT: 516,
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, ENTER: 13, BACK: 8, RETURN: 461,
  NUM_0: 48, NUM_1: 49, NUM_2: 50, NUM_3: 51, NUM_4: 52,
  NUM_5: 53, NUM_6: 54, NUM_7: 55, NUM_8: 56, NUM_9: 57 };

function setup(options = {}) {
  const calls = [], timers = new Map();
  let next = 0;
  const bodyListeners = new Set();
  const root = {
    innerWidth: 1920,
    addEventListener() {}, removeEventListener() {},
    document: { body: {
      addEventListener(_name, fn) { bodyListeners.add(fn); },
      removeEventListener(_name, fn) { bodyListeners.delete(fn); }
    } }
  };
  const store = new Map(Object.entries(options.storage || {}));
  const sdk = {
    key: { KEYMAP: KEYS },
    storage: options.noStorage ? undefined : {
      get: key => store.get(key),
      set: (key, val) => { store.set(key, val); calls.push(['storage:set', key, val]); }
    },
    apc: { CMDMETHOD: { KEY_INPUT_START: 'input' } },
    router: { isCurrentPathEqualTo: () => true }
  };
  root._V_SDK_ = { vre: { SDK: () => sdk } };
  let notify;
  root.AlvidaaNativePlatform = (_sdk, callback) => {
    notify = callback;
    return {
      start() {
        calls.push(['start']);
        callback({
          apps: [
            { appId: '1', appName: 'Netflix', img: 'var/local/storeAppIcon/netflix.png' },
            { appId: '2', appName: 'Plex', img: 'https://cdn.example/plex.png' },
            { appId: 'vidaa-home', appName: 'Old browser home' },
            { appId: '206', appName: 'Stock Home' },
            { appId: '3', appName: '   ' }
          ],
          sources: [
            { sourceId: 0, name: 'TV', is_signal: '1' },
            { sourceId: 'HDMI2', name: 'HDMI2', displayname2: 'PlayStation 5', is_signal: 0 },
            { sourceId: 'HDMI3', name: 'HDMI3', rename: 'Fire TV Stick', has_signal: '1' }
          ],
          errors: [], waiting: false
        });
      },
      stop() { calls.push(['stop']); },
      refresh() { calls.push(['refresh']); },
      launchApp(id) { calls.push(['launch', String(id)]); },
      changeSource(id) { calls.push(['source', id]); },
      openSettings() { calls.push(['settings']); }
    };
  };
  const timeouts = new Map();
  vm.runInNewContext(SOURCE, {
    self: root,
    setTimeout(fn, delay) { const id = ++next; timeouts.set(id, fn); return id; },
    clearTimeout(id) { timeouts.delete(id); },
    setInterval(fn) { const id = ++next; timers.set(id, fn); return id; },
    clearInterval(id) { timers.delete(id); }
  });
  const component = root.AlvidaaNativeHome(sdk);
  const instance = component.data();
  instance.$route = { query: {} };
  for (const [key, fn] of Object.entries(component.methods)) instance[key] = fn.bind(instance);
  return { root, sdk, component, instance, calls, timers, timeouts, notify: () => notify, bodyListeners, store };
}

function flatten(tree) {
  const out = [];
  (function walk(node) {
    if (!node || typeof node !== 'object') return;
    out.push(node);
    for (const child of node.children || []) walk(child);
  }(tree));
  return out;
}

test('starts once, filters apps and inputs, and cleans up', () => {
  const f = setup(), v = f.instance;
  f.component.mounted.call(v);
  f.component.activated.call(v);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 1);
  assert.equal(v.apps.length, 2);
  assert.deepEqual(v.apps.map(a => a.appId), ['1', '2']);
  assert.equal(v.sources.length, 3);
  assert.equal(v.toast, '');
  assert.equal(v.toastUntil, 0);
  assert.equal(f.root.AlvidaaNativeActive, v);
  assert.equal(f.bodyListeners.size, 1);
  f.component.deactivated.call(v);
  assert.equal(f.calls.filter(c => c[0] === 'stop').length, 1);
  assert.equal(f.timers.size, 0);
  assert.equal(f.bodyListeners.size, 0);
  assert.equal(f.root.AlvidaaNativeActive, null);
  f.component.activated.call(v);
  assert.equal(f.calls.filter(c => c[0] === 'start').length, 2);
  v.stop();
});

test('input names follow the bridge order and signal drives smart focus', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.sourceName(v.sources[0]), 'TV');
  assert.equal(v.sourceName(v.sources[1]), 'PlayStation 5');
  assert.equal(v.sourceName(v.sources[2]), 'Fire TV Stick');
  assert.equal(v.smartIndex(), 0);
  v.sources = [{ sourceId: 1, name: 'A' }, { sourceId: 2, name: 'B', is_signal: '1' }];
  assert.equal(v.smartIndex(), 1);
  v.sources = [{ sourceId: 1, name: 'A' }];
  assert.equal(v.smartIndex(), 0);
  f.sdk.i18n = { t: key => key === 'LA0159' ? 'Media' : key };
  assert.equal(v.sourceName({ sourceId: 'x', rename: 'LA0159', name: 'Media' }), 'Media');
  assert.equal(v.sourceName({ sourceId: 'x', rename: 'PlayStation', name: 'HDMI3' }), 'PlayStation');
  v.stop();
});

test('remote walks the dock, the apps row and the stock settings door', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  assert.equal(v.zone, 'dock');
  v.handleKey(k.RIGHT);
  assert.equal(v.dock, 1);
  v.handleKey(k.LEFT);
  v.handleKey(k.LEFT);
  assert.equal(v.dock, 0);
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['source', 0]);
  v.handleKey(k.DOWN);
  assert.equal(v.zone, 'apps');
  v.handleKey(k.ENTER);
  assert.equal(v.overlay, true);
  v.handleKey(k.BACK);
  assert.equal(v.overlay, false);
  v.handleKey(k.RIGHT);
  assert.equal(v.app, 1);
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['settings']);
  v.handleKey(k.BACK);
  assert.equal(v.zone, 'dock');
  assert.equal(v.handleKey(k.BACK), false);
  assert.equal(v.handleKey(k.UP), false);
  assert.equal(v.handleKey(999), false);
  v.stop();
});

test('app overlay pages, launches and clamps at both ends', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  v.apps = Array.from({ length: 12 }, (_, i) => ({ appId: String(i), appName: 'App ' + i }));
  v.zone = 'apps';
  v.app = 0;
  v.handleKey(k.ENTER);
  assert.equal(v.overlay, true);
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 1);
  v.handleKey(k.DOWN);
  assert.equal(v.overlayIndex, 7);
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['launch', '7']);
  assert.equal(v.overlay, false);
  v.overlay = true;
  v.overlayIndex = 11;
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 11);
  v.overlayIndex = 0;
  v.handleKey(k.UP);
  assert.equal(v.overlayIndex, 0);
  v.overlay = false;
  v.apps = [];
  v.zone = 'apps';
  v.app = 0;
  v.handleKey(k.ENTER);
  assert.equal(v.overlay, false);
  assert.match(v.toast, /No apps reported/);
  v.stop();
});

test('failed actions surface in the toast HUD instead of throwing', () => {
  const f = setup(), v = f.instance;
  v.start();
  v._platform.changeSource = () => { throw new Error('input busy'); };
  v.zone = 'dock';
  v.dock = 0;
  v.activate();
  assert.match(v.toast, /Action failed: input busy/);
  assert.ok(v.toastUntil > Date.now());
  v._platform.openSettings = () => Promise.reject(new Error('denied'));
  v.zone = 'apps';
  v.app = 1;
  v.activate();
  return Promise.resolve().then(() => {
    assert.match(v.toast, /Action failed: denied/);
    v.stop();
  });
});

test('toast HUD manages timing, expiry, and floating glass pill presentation', () => {
  const f = setup(), v = f.instance;
  v.start();
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));

  // Initially empty and hidden
  assert.equal(v.toast, '');
  assert.equal(v.toastUntil, 0);
  let tree = flatten(draw());
  let hud = tree.find(n => n.data && n.data.attrs && n.data.attrs.role === 'status');
  assert.ok(hud, 'floating toast HUD pill exists in root layers');
  assert.equal(hud.data.style.opacity, 0);
  assert.equal(hud.data.style.visibility, 'hidden');
  assert.ok(hud.data.style.transition.includes('opacity'));
  assert.ok(hud.data.style.transition.includes('transform'));

  // Setting a toast makes it visible and shows message
  v.showToast('Test notice', 1500);
  assert.equal(v.toast, 'Test notice');
  assert.ok(v.toastUntil > Date.now());
  tree = flatten(draw());
  hud = tree.find(n => n.data && n.data.attrs && n.data.attrs.role === 'status');
  assert.equal(hud.data.style.opacity, 1);
  assert.equal(hud.data.style.visibility, 'visible');
  assert.ok(hud.children.includes('Test notice'));

  // Clock tick before deadline does not expire toast
  const clockTick = Array.from(f.timers.values())[0];
  assert.ok(typeof clockTick === 'function', '1s clock interval exists');
  v.toastUntil = Date.now() + 5000;
  clockTick();
  assert.equal(v.toast, 'Test notice');

  // Clock tick at or past deadline expires toast
  v.toastUntil = Date.now() - 10;
  clockTick();
  assert.equal(v.toast, '');
  assert.equal(v.toastUntil, 0);

  // Hidden again after expiry
  tree = flatten(draw());
  hud = tree.find(n => n.data && n.data.attrs && n.data.attrs.role === 'status');
  assert.equal(hud.data.style.opacity, 0);
  assert.equal(hud.data.style.visibility, 'hidden');

  // openOverlay with no apps triggers a toast
  v.apps = [];
  v.openOverlay();
  assert.equal(v.toast, 'No apps reported');
  assert.equal(v.overlay, false);

  v.stop();
});

test('remote number hotkeys 1-9 focus and activate dock items, 0 focuses without activating', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  // Provide 10 sources so digits 1-9 are all in range
  v.sources = Array.from({ length: 10 }, (_, i) => ({ sourceId: 'in' + i, name: 'Input ' + i }));
  v.zone = 'dock';
  v.dock = 0;

  // Digits 1 through 9 focus and activate matching dock index (digit - 1)
  for (let d = 1; d <= 9; d++) {
    const key = k['NUM_' + d];
    const initialSourceCalls = f.calls.filter(c => c[0] === 'source').length;
    const handled = v.handleKey(key);
    assert.equal(handled, true, 'NUM_' + d + ' must be handled');
    assert.equal(v.dock, d - 1, 'NUM_' + d + ' must set dock index to ' + (d - 1));
    assert.equal(f.calls.filter(c => c[0] === 'source').length, initialSourceCalls + 1, 'NUM_' + d + ' must trigger activation');
    assert.deepEqual(f.calls.at(-1), ['source', 'in' + (d - 1)]);
  }

  // Digit 0 focuses dock 0 without activating
  v.dock = 5;
  const sourceCallsBeforeZero = f.calls.filter(c => c[0] === 'source').length;
  const handledZero = v.handleKey(k.NUM_0);
  assert.equal(handledZero, true, 'NUM_0 must be handled');
  assert.equal(v.dock, 0, 'NUM_0 must focus dock index 0');
  assert.equal(f.calls.filter(c => c[0] === 'source').length, sourceCallsBeforeZero, 'NUM_0 must not trigger activation');

  // Out-of-range digits pass through (e.g. source count is 3, digit 4..9)
  v.sources = [
    { sourceId: 'in0', name: 'In 0' },
    { sourceId: 'in1', name: 'In 1' },
    { sourceId: 'in2', name: 'In 2' }
  ];
  v.dock = 1;
  const sourceCallsBeforeOOR = f.calls.filter(c => c[0] === 'source').length;
  assert.equal(v.handleKey(k.NUM_4), false, 'out-of-range digit 4 must return false');
  assert.equal(v.handleKey(k.NUM_9), false, 'out-of-range digit 9 must return false');
  assert.equal(v.dock, 1, 'out-of-range digit must not change dock focus');
  assert.equal(f.calls.filter(c => c[0] === 'source').length, sourceCallsBeforeOOR, 'out-of-range digit must not trigger activation');

  // 0 with empty dock passes through
  v.sources = [];
  assert.equal(v.handleKey(k.NUM_0), false, '0 with empty dock must return false');
  assert.equal(v.handleKey(k.NUM_1), false, '1 with empty dock must return false');

  v.stop();
});

test('remote number hotkeys do not fire while overlay is open and handle missing KEYMAP', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  v.sources = Array.from({ length: 5 }, (_, i) => ({ sourceId: 'in' + i, name: 'In ' + i }));
  v.dock = 0;
  v.apps = [{ appId: '1', appName: 'App 1' }];

  // Open overlay
  v.zone = 'apps';
  v.openOverlay();
  assert.equal(v.overlay, true);

  const callsBefore = f.calls.length;
  assert.equal(v.handleKey(k.NUM_1), false, 'NUM_1 must not fire while overlay is open');
  assert.equal(v.handleKey(k.NUM_0), false, 'NUM_0 must not fire while overlay is open');
  assert.equal(f.calls.length, callsBefore);
  assert.equal(v.dock, 0);

  // Missing KEYMAP in SDK key
  const guardedComp = f.root.AlvidaaNativeHome({ key: { KEYMAP: {} } });
  const guardedInstance = guardedComp.data();
  guardedInstance.dock = 0;
  guardedInstance.sources = [{ sourceId: 1, name: 'In 1' }];
  for (const [key, fn] of Object.entries(guardedComp.methods)) guardedInstance[key] = fn.bind(guardedInstance);
  assert.equal(guardedInstance.handleKey(49), false, 'unmapped number key must pass through');
  assert.equal(guardedInstance.handleKey(48), false, 'unmapped 0 key must pass through');

  v.stop();
});

test('render keeps the dock design, scales it and never loads the open web', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.width = 1280;
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const tree = draw();
  const flat = flatten(tree);
  const texts = flat.flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('INPUTS & SOURCES'));
  assert.ok(texts.includes('APPS'));
  assert.ok(texts.includes('Apps'));
  assert.ok(texts.includes('Settings'));
  assert.ok(texts.includes('TV'));
  assert.ok(texts.includes('connected'));
  assert.equal(flat.filter(n => ['canvas', 'iframe', 'img', 'script'].includes(n.tag)).length, 0);
  const title = flat.find(n => (n.children || []).includes('INPUTS & SOURCES'));
  assert.equal(title.data.style.fontSize, 22 * 1280 / 1920 + 'px');
  // Lengths scale with the viewport; font weights must not.
  assert.equal(title.data.style.lineHeight, 26 * 1280 / 1920 + 'px');
  const clock = flat.find(n => n.data && n.data.style && n.data.style.letterSpacing);
  assert.equal(clock.data.style.fontWeight, '300');
  assert.equal(clock.data.style.lineHeight, 120 * 1280 / 1920 + 'px');
  assert.equal(v.overlay, false);
  assert.doesNotMatch(JSON.stringify(tree), /cdn\.example/);
  // The focused dock tile lifts; the others stay put.
  const scales = flat.filter(n => n.data && n.data.style && n.data.style.transform)
    .map(n => n.data.style.transform);
  assert.ok(scales.includes('scale(1.03)'));
  assert.ok(scales.includes('scale(1)'));
  // A no-signal port keeps the design's grey name and its own subline.
  v.dock = 1;
  const quiet = flatten(draw());
  const quietTexts = quiet.flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(quietTexts.includes('PlayStation 5'));
  assert.ok(quietTexts.includes('no signal'));
  v.stop();
});

test('the apps row pans into view and the overlay paints local icons only', () => {
  const f = setup(), v = f.instance;
  v.start();
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const dockTree = flatten(draw());
  const stage = dockTree.find(n => n.data && n.data.style && n.data.style.transition);
  assert.equal(stage.data.style.transform, 'translateY(0px)');
  assert.equal(stage.data.style.height, '2160px');
  v.zone = 'apps';
  assert.equal(flatten(draw()).find(n => n.data && n.data.style && n.data.style.transition)
    .data.style.transform, 'translateY(-1080px)');
  v.zone = 'dock';
  v.overlay = true;
  v.overlayIndex = 0;
  const overlay = flatten(draw());
  const images = overlay.filter(n => n.data && n.data.style && n.data.style.backgroundImage);
  const urls = images.map(n => n.data.style.backgroundImage).filter(value => value.indexOf('url(') === 0);
  assert.deepEqual(urls, ['url("file:///hisenseUI/var/local/storeAppIcon/netflix.png")']);
  assert.ok(overlay.some(n => (n.children || []).includes('Netflix')));
  assert.ok(overlay.some(n => (n.children || []).includes('OK to open · BACK to close')));
  // Plex has only a remote icon, so it falls back to its brand colour rather
  // than a random hue, and never fetches the remote URL.
  const plexBadge = overlay.find(n => n.data && n.data.style &&
    n.data.style.backgroundColor === '#e5a00d');
  assert.ok(plexBadge, 'Plex badge should use its brand colour');
  v.stop();
});

test('icon policy: local files and the vendor host only', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.appIcon({ img: 'var/local/storeAppIcon/x.png' }), 'file:///hisenseUI/var/local/storeAppIcon/x.png');
  assert.equal(v.appIcon({ img: 'file:///local/x.png' }), 'file:///local/x.png');
  assert.equal(v.appIcon({ img: 'https://img.vidaahub.com/a/b.png' }), 'https://img.vidaahub.com/a/b.png');
  assert.equal(v.appIcon({ img: 'https://cdn.example/x.png' }), '');
  assert.equal(v.appIcon({ img: 'http://img.vidaahub.com/x.png' }), '');
  assert.equal(v.appIcon({ icon_local_url: '/data/x.png' }), '/data/x.png');
  // Some builds wrap the URL in a data:image trampoline.
  assert.equal(v.appIcon({ httpIcon: 'data:image/png;base64,zzziconDownloadhttps://img.vidaahub.com/x.png' }),
    'https://img.vidaahub.com/x.png');
  v.stop();
});

test('the dock pages six at a time and the wallpaper is a build-time global', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.sources = Array.from({ length: 8 }, (_, i) => ({ sourceId: i, name: 'In ' + i }));
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const flat = flatten(draw());
  const tiles = flat.filter(n => (n.children || []).some(c => c === 'LIVE' || c === 'STANDBY'));
  assert.equal(tiles.length, 6);
  assert.ok(flat.some(n => n.data && n.data.style && n.data.style.backgroundImage &&
    n.data.style.backgroundImage.indexOf('linear-gradient(180deg, rgba(56,189,248') === 0));
  f.root.AlvidaaNativeWallpaper = 'data:image/png;base64,AAA';
  const withArt = flatten(draw()).filter(n => n.data && n.data.style &&
    n.data.style.backgroundImage === 'url("data:image/png;base64,AAA")');
  assert.equal(withArt.length, 1);
  v.stop();
});

test('entry prefers the alvidaa variant, falls back to Free My TV, and only swaps Home', () => {
  function run(globals) {
    const context = Object.assign({
      _V_SDK_: { vre: { SDK: function () { return { key: { KEYMAP: {} } }; } } }
    }, globals);
    context.self = context;
    vm.runInNewContext(ENTRY, context);
    return context;
  }
  const guard = () => {}, kids = () => {}, init = () => {};
  const stock = () => ({
    route: [{ path: '/Launcher', component: { old: true }, beforeEnter: guard },
      { path: '/KidsLauncher', component: kids }],
    page: { kidsLauncherHome: kids }, init
  });
  const mine = function () { return { name: 'Launcher', marker: 'alvidaa' }; };
  const theirs = function () { return { name: 'Launcher', marker: 'free-my-tv' }; };
  const a = run({ _V_M_: { launcher: stock }, AlvidaaNativeComponent: mine, AlvidaaFreeMyTV: theirs });
  const wrapped = a._V_M_.launcher();
  assert.equal(wrapped.route[0].component.marker, 'alvidaa');
  assert.equal(wrapped.route[0].beforeEnter, guard);
  assert.equal(wrapped.route[1].component, kids);
  assert.equal(wrapped.init, init);
  assert.equal(a._V_M_.launcher(), wrapped);
  const b = run({ _V_M_: { launcher: stock }, AlvidaaFreeMyTV: theirs });
  assert.equal(b._V_M_.launcher().route[0].component.marker, 'free-my-tv');
  assert.throws(() => run({ _V_M_: { launcher: stock } }), /Native Home component is required/);
  assert.throws(() => run({}), /Stock launcher factory is required/);
});

test('build refuses an unpinned stock bundle and assembles a runnable candidate', () => {
  const { build, PARTS, MARKER } = require('./build-native-alvidaa.cjs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-build-'));
  const stockFile = path.join(dir, 'stock.js');
  const stock = '/* private vendor bundle */\nself._V_M_ = { launcher: function () { return { route: [{ path: "/Launcher", component: {} }] }; } };\n';
  fs.writeFileSync(stockFile, stock);
  const digest = hash(Buffer.from(stock));
  assert.throws(() => build(stockFile, null, ''), /expected sha256/);
  assert.throws(() => build(stockFile, null, '0'.repeat(64)), /does not match/);
  const candidate = build(stockFile, null, digest);
  assert.ok(candidate.startsWith('/* ' + MARKER));
  assert.ok(candidate.includes(stock));
  assert.ok(candidate.includes('AlvidaaNativeWallpaper="data:image/png;base64,'));
  for (const part of PARTS) assert.ok(candidate.includes(part));
  const context = {
    key: { KEYMAP: {} },
    _V_SDK_: { vre: { SDK: function () { return { key: { KEYMAP: {} } }; } } }
  };
  context.self = context;
  vm.runInNewContext(candidate, context);
  assert.equal(typeof context.AlvidaaNativeHome, 'function');
  assert.equal(context.AlvidaaNativeComponent, context.AlvidaaNativeHome);
  assert.equal(context._V_M_.launcher().route[0].component.name, 'Launcher');
  assert.throws(() => build(stockFile, path.join(__dirname, 'candidate.js'), digest),
    /must stay private/);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('preferences: absent storage falls back safely without error', () => {
  const f = setup({ noStorage: true }), v = f.instance;
  v.start();
  assert.equal(v.apps.length, 2);
  assert.equal(v.sources.length, 3);
  assert.equal(v.sourceName(v.sources[0]), 'TV');
  assert.equal(v.smartIndex(), 0);
  v.activate();
  assert.equal(v.prefs.lastUsed, 0);
  v.stop();
});

test('preferences: hidden apps removes matching app IDs or names', () => {
  const f = setup({
    storage: {
      alvidaa_hidden_apps: ['1']
    }
  }), v = f.instance;
  v.start();
  assert.equal(v.apps.length, 1);
  assert.equal(v.apps[0].appId, '2');
  assert.equal(v.apps[0].appName, 'Plex');
  v.stop();
});

test('preferences: hidden apps accepts JSON string in storage and matches names case-insensitively', () => {
  const f = setup({
    storage: {
      alvidaa_hidden_apps: JSON.stringify(['netflix'])
    }
  }), v = f.instance;
  v.start();
  assert.equal(v.apps.length, 1);
  assert.equal(v.apps[0].appName, 'Plex');
  v.stop();
});

test('preferences: only apps allows only matching app IDs or names', () => {
  const f = setup({
    storage: {
      alvidaa_only_apps: ['1']
    }
  }), v = f.instance;
  v.start();
  assert.equal(v.apps.length, 1);
  assert.equal(v.apps[0].appId, '1');
  assert.equal(v.apps[0].appName, 'Netflix');
  v.stop();
});

test('preferences: custom input names apply in sourceName after stock resolution', () => {
  const f = setup({
    storage: {
      alvidaa_custom_names: {
        HDMI2: 'PlayStation 5 Pro',
        0: 'Antenna Live'
      }
    }
  }), v = f.instance;
  v.start();
  assert.equal(v.sourceName(v.sources[1]), 'PlayStation 5 Pro');
  assert.equal(v.sourceName(v.sources[0]), 'Antenna Live');
  assert.equal(v.sourceName(v.sources[2]), 'Fire TV Stick');
  v.stop();
});

test('preferences: smartIndex falls back to last-used sourceId when no input has signal and persists on activate', () => {
  const f = setup({
    storage: {
      alvidaa_last_used: 'HDMI2'
    }
  }), v = f.instance;
  v.start();
  assert.equal(v.smartIndex(), 0);
  v.sources = [
    { sourceId: 0, name: 'TV', is_signal: 0 },
    { sourceId: 'HDMI2', name: 'HDMI2', is_signal: 0 },
    { sourceId: 'HDMI3', name: 'HDMI3', is_signal: 0 }
  ];
  assert.equal(v.smartIndex(), 1);

  v.dock = 2;
  v.activate();
  assert.equal(JSON.parse(f.store.get('alvidaa_last_used')), 'HDMI3');
  assert.equal(v.prefs.lastUsed, 'HDMI3');
  v.stop();
});

test('preferences: re-read on activated refreshes apps and smart focus', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.apps.length, 2);
  f.store.set('alvidaa_hidden_apps', ['1']);
  f.store.set('alvidaa_last_used', 'HDMI2');
  v.sources = [
    { sourceId: 0, name: 'TV', is_signal: 0 },
    { sourceId: 'HDMI2', name: 'HDMI2', is_signal: 0 }
  ];
  f.component.activated.call(v);
  assert.equal(v.apps.length, 1);
  assert.equal(v.apps[0].appId, '2');
  assert.equal(v.dock, 1);
  v.stop();
});

test('favorites: empty favorites preserves stock [Apps, Settings] behavior', () => {
  const f = setup(), v = f.instance;
  v.start();
  const items = v.appItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].kind, 'apps');
  assert.equal(items[0].label, 'Apps');
  assert.equal(items[1].kind, 'settings');
  assert.equal(items[1].label, 'Settings');
  v.stop();
});

test('favorites: resolves favorites in order, drops stale IDs silently, and caps at 5', () => {
  const f = setup({
    storage: {
      alvidaa_favorites: ['2', 'stale-999', '1', 'nonexistent']
    }
  }), v = f.instance;
  v.start();
  const items = v.appItems();
  assert.equal(items.length, 4);
  assert.equal(items[0].kind, 'favorite');
  assert.equal(items[0].appId, '2');
  assert.equal(items[0].label, 'Plex');
  assert.equal(items[1].kind, 'favorite');
  assert.equal(items[1].appId, '1');
  assert.equal(items[1].label, 'Netflix');
  assert.equal(items[2].kind, 'apps');
  assert.equal(items[3].kind, 'settings');
  v.stop();
});

test('favorites: activating favorite directly launches app without opening overlay; Apps and Settings unchanged', () => {
  const f = setup({
    storage: {
      alvidaa_favorites: ['2']
    }
  }), v = f.instance;
  v.start();
  v.zone = 'apps';
  v.app = 0; // Favorite (Plex)
  v.activate();
  assert.deepEqual(f.calls.at(-1), ['launch', '2']);
  assert.equal(v.overlay, false);
  assert.match(v.toast, /Opening Plex/);

  // Focus Apps tile
  v.app = 1; // Apps
  v.activate();
  assert.equal(v.overlay, true);
  v.closeOverlay();

  // Focus Settings tile
  v.app = 2; // Settings
  v.activate();
  assert.deepEqual(f.calls.at(-1), ['settings']);
  assert.match(v.toast, /Opening Settings/);
  v.stop();
});

test('favorites: clamp tolerates changing favorites list', () => {
  const f = setup({
    storage: {
      alvidaa_favorites: ['1', '2']
    }
  }), v = f.instance;
  v.start();
  assert.equal(v.appItems().length, 4);
  v.zone = 'apps';
  v.app = 3; // Settings (index 3)
  v.clamp();
  assert.equal(v.app, 3);

  // Clear favorites and re-read
  f.store.set('alvidaa_favorites', []);
  v.readPrefs();
  assert.equal(v.appItems().length, 2);
  assert.equal(v.app, 1); // safely clamped from 3 to 1 (Settings)
  v.stop();
});

test('auto-switch: no countdown when disabled (default)', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.prefs.autoSwitch, false);
  assert.equal(v.autoSwitchAt, 0);
  assert.equal(v.autoSwitchId, null);
  v.stop();
});

test('auto-switch: no countdown with 0 or 2+ live inputs when enabled', () => {
  // Test with 2 live inputs (default setup platform callback returns 2: TV and HDMI3)
  const f2 = setup({ storage: { alvidaa_auto_switch: true } }), v2 = f2.instance;
  v2.start();
  assert.equal(v2.prefs.autoSwitch, true);
  assert.equal(v2.autoSwitchAt, 0, 'must not start countdown when 2 inputs have signal');
  v2.stop();

  // Test with 0 live inputs
  const f0 = setup({ storage: { alvidaa_auto_switch: true } }), v0 = f0.instance;
  f0.root.AlvidaaNativePlatform = (_sdk, callback) => ({
    start() {
      callback({
        apps: [],
        sources: [
          { sourceId: 'HDMI1', name: 'HDMI1', is_signal: 0 },
          { sourceId: 'HDMI2', name: 'HDMI2', is_signal: 0 }
        ],
        errors: [], waiting: false
      });
    },
    stop() {}
  });
  v0.start();
  assert.equal(v0.autoSwitchAt, 0, 'must not start countdown when 0 inputs have signal');
  v0.stop();
});

test('auto-switch: starts 3500ms countdown when exactly one live input and fires at zero', () => {
  const f = setup({ storage: { alvidaa_auto_switch: true } }), v = f.instance;
  f.root.AlvidaaNativePlatform = (_sdk, callback) => ({
    start() {
      f.calls.push(['start']);
      callback({
        apps: [],
        sources: [
          { sourceId: 'TV', name: 'TV', is_signal: 0 },
          { sourceId: 'HDMI2', name: 'HDMI2', displayname2: 'PlayStation 5', is_signal: 1 }
        ],
        errors: [], waiting: false
      });
    },
    stop() { f.calls.push(['stop']); },
    changeSource(id) { f.calls.push(['source', id]); }
  });
  v.start();
  assert.equal(v.autoSwitchId, 'HDMI2');
  assert.equal(v.autoSwitchName, 'PlayStation 5');
  assert.ok(v.autoSwitchAt > Date.now());

  // HUD pill renders countdown message
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const flat = flatten(draw());
  const hud = flat.find(n => n.data && n.data.attrs && n.data.attrs.role === 'status');
  assert.ok(hud);
  assert.equal(hud.data.style.opacity, 1);
  assert.match(hud.children[0], /Switching to PlayStation 5 in \d+s - press any key to stay/);

  // Fire timer at zero
  assert.ok(f.timeouts.size > 0, 'auto-switch timeout should be registered');
  for (const fn of f.timeouts.values()) fn();

  assert.equal(v.autoSwitchAt, 0);
  assert.equal(v.autoSwitchId, null);
  assert.deepEqual(f.calls.at(-1), ['source', 'HDMI2']);
  v.stop();
});

test('auto-switch: any handled key cancels countdown and shows toast', () => {
  const f = setup({ storage: { alvidaa_auto_switch: true } }), v = f.instance, k = KEYS;
  f.root.AlvidaaNativePlatform = (_sdk, callback) => ({
    start() {
      callback({
        apps: [],
        sources: [
          { sourceId: 'HDMI2', name: 'HDMI2', displayname2: 'PlayStation 5', is_signal: 1 }
        ],
        errors: [], waiting: false
      });
    },
    stop() {},
    changeSource(id) { f.calls.push(['source', id]); }
  });
  v.start();
  assert.ok(v.autoSwitchAt > 0);

  // Pressing an unhandled key does not cancel
  const unhandled = v.handleKey(999);
  assert.equal(unhandled, false);
  assert.ok(v.autoSwitchAt > 0);

  // Pressing a navigation key cancels countdown
  const handled = v.handleKey(k.ENTER);
  assert.equal(handled, true);
  assert.equal(v.autoSwitchAt, 0);
  assert.equal(v.autoSwitchId, null);
  assert.equal(v.toast, 'auto-switch cancelled');

  // Verify changeSource was not called
  assert.equal(f.calls.filter(c => c[0] === 'source').length, 0);
  v.stop();
});

test('auto-switch: cancels on stop()', () => {
  const f = setup({ storage: { alvidaa_auto_switch: true } }), v = f.instance;
  f.root.AlvidaaNativePlatform = (_sdk, callback) => ({
    start() {
      callback({
        apps: [],
        sources: [
          { sourceId: 'HDMI2', name: 'PlayStation', is_signal: 1 }
        ],
        errors: [], waiting: false
      });
    },
    stop() {}
  });
  v.start();
  assert.ok(v.autoSwitchAt > 0);
  v.stop();
  assert.equal(v.autoSwitchAt, 0);
  assert.equal(v.autoSwitchId, null);
  assert.equal(f.timeouts.size, 0);
  v.stop();
});

test('input art: cross-fades two stacked art layers during transitions and rejects disallowed URLs', () => {
  const f = setup(), v = f.instance;
  f.root.AlvidaaNativeInputArt = {
    0: 'data:image/png;base64,TVARTDATA',
    HDMI2: 'file:///var/local/storeAppIcon/ps5-art.png',
    HDMI3: 'https://evil.com/leak.png'
  };
  v.start();
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));

  // Initially focused on dock index 0 (sourceId 0)
  assert.equal(v.dock, 0);
  let tree = draw();
  let flat = flatten(tree);
  let incoming = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'incoming');
  let outgoing = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'outgoing');
  assert.ok(incoming, 'incoming art layer is present');
  assert.equal(outgoing, undefined, 'no outgoing layer on initial paint');
  assert.equal(incoming.data.attrs['data-input-art'], '0');
  assert.match(incoming.data.style.backgroundImage, /data:image\/png;base64,TVARTDATA/);
  assert.equal(incoming.data.style.opacity, 1);
  assert.equal(incoming.data.style.transition, 'opacity 300ms ease-out');

  // Change focus to dock index 1 (sourceId 'HDMI2') -> triggers cross-fade transition
  v.dock = 1;
  v.syncArt();
  tree = draw();
  flat = flatten(tree);
  incoming = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'incoming');
  outgoing = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'outgoing');

  // At the moment of switch: outgoing opacity 1 and incoming opacity 0
  assert.ok(incoming, 'incoming layer present during transition');
  assert.ok(outgoing, 'outgoing layer present during transition');
  assert.equal(outgoing.data.attrs['data-input-art'], '0');
  assert.match(outgoing.data.style.backgroundImage, /data:image\/png;base64,TVARTDATA/);
  assert.equal(outgoing.data.style.opacity, 1, 'outgoing layer stays at opacity 1 during cross-fade');
  assert.equal(outgoing.data.style.transition, 'opacity 300ms ease-out');

  assert.equal(incoming.data.attrs['data-input-art'], 'HDMI2');
  assert.match(incoming.data.style.backgroundImage, /ps5-art\.png/);
  assert.equal(incoming.data.style.opacity, 0, 'incoming layer starts at opacity 0');
  assert.equal(incoming.data.style.transition, 'opacity 300ms ease-out');

  // Flip incoming opacity on tick
  assert.ok(v._artTickTimer != null, 'tick timer scheduled');
  const tickFn = f.timeouts.get(v._artTickTimer);
  assert.ok(tickFn);
  tickFn();

  // After the flip: incoming is opacity 1
  tree = draw();
  flat = flatten(tree);
  incoming = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'incoming');
  outgoing = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'outgoing');
  assert.equal(incoming.data.style.opacity, 1, 'incoming layer flipped to opacity 1');
  assert.ok(outgoing, 'outgoing layer still present at opacity 1');

  // After 300ms transition timer: outgoing layer is gone
  assert.ok(v._artTimer != null, 'fade timer scheduled');
  const fadeFn = f.timeouts.get(v._artTimer);
  assert.ok(fadeFn);
  fadeFn();

  tree = draw();
  flat = flatten(tree);
  incoming = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'incoming');
  outgoing = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'outgoing');
  assert.ok(incoming);
  assert.equal(outgoing, undefined, 'outgoing layer removed after 300ms');

  // Change focus to dock index 2 (sourceId 'HDMI3' with disallowed https URL)
  v.dock = 2;
  v.syncArt();
  tree = draw();
  flat = flatten(tree);
  const disallowed = flat.filter(n => n.data && n.data.style && n.data.style.backgroundImage && n.data.style.backgroundImage.includes('evil.com'));
  assert.equal(disallowed.length, 0, 'disallowed network art emitted no url()');

  // Clear timers
  for (const fn of f.timeouts.values()) fn();

  // Completely absent art map
  delete f.root.AlvidaaNativeInputArt;
  v.dock = 0;
  v.syncArt();
  tree = draw();
  flat = flatten(tree);
  const absentLayers = flat.filter(n => n.data && n.data.attrs && 'data-input-art' in n.data.attrs);
  assert.equal(absentLayers.length, 0, 'no art layer rendered when AlvidaaNativeInputArt is absent');
  v.stop();
});

test('build script embeds AlvidaaNativeInputArt when present and works unchanged when absent', () => {
  const { build } = require('./build-native-alvidaa.cjs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-art-build-'));
  const stockFile = path.join(dir, 'stock.js');
  const stock = '/* stock */\nself._V_M_ = { launcher: function () { return { route: [{ path: "/Launcher", component: {} }] }; } };\n';
  fs.writeFileSync(stockFile, stock);
  const digest = hash(Buffer.from(stock));

  // Without options: works unchanged, no AlvidaaNativeInputArt
  const candidatePlain = build(stockFile, null, digest);
  assert.ok(!candidatePlain.includes('self.AlvidaaNativeInputArt='));

  // With inputArt option: embeds self.AlvidaaNativeInputArt
  const candidateWithArt = build(stockFile, null, digest, {
    inputArt: { HDMI1: 'data:image/png;base64,INLINEART' }
  });
  assert.ok(candidateWithArt.includes('self.AlvidaaNativeInputArt={"HDMI1":"data:image/png;base64,INLINEART"};'));

  fs.rmSync(dir, { recursive: true, force: true });
});
