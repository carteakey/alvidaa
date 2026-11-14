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
  // The visual pass measured 7 columns at 1080p (labels fit the 192px tile),
  // so a flat row step is 7 now — the launched app is index 8.
  assert.equal(v.overlayIndex, 8);
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['launch', '8']);
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

test('favorites: empty favorites keeps the [Apps, Settings, Launcher] doors', () => {
  const f = setup(), v = f.instance;
  v.start();
  const items = v.appItems();
  assert.equal(items.length, 3);
  assert.equal(items[0].kind, 'apps');
  assert.equal(items[0].label, 'Apps');
  assert.equal(items[1].kind, 'settings');
  assert.equal(items[1].label, 'Settings');
  assert.equal(items[2].kind, 'launcher');
  assert.equal(items[2].label, 'Launcher');
  assert.equal(items[2].sub, 'Home settings');
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
  assert.equal(items.length, 5);
  assert.equal(items[0].kind, 'favorite');
  assert.equal(items[0].appId, '2');
  assert.equal(items[0].label, 'Plex');
  assert.equal(items[1].kind, 'favorite');
  assert.equal(items[1].appId, '1');
  assert.equal(items[1].label, 'Netflix');
  assert.equal(items[2].kind, 'apps');
  assert.equal(items[3].kind, 'settings');
  assert.equal(items[4].kind, 'launcher');
  v.stop();
});

test('favorites: tiles render the real icon through the allowlist and fall back to the star', () => {
  const f = setup({
    storage: {
      alvidaa_favorites: ['1', '2']
    }
  }), v = f.instance;
  v.start();
  const items = v.appItems();
  assert.equal(items[0].icon, 'file:///hisenseUI/var/local/storeAppIcon/netflix.png',
    'a local icon passes the allowlist onto the favorite tile');
  assert.equal(items[1].icon, '',
    'a remote-only icon is refused, so the star glyph is the fallback');
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const flat = flatten(draw());
  const imgs = flat.filter(n => n.tag === 'img');
  assert.equal(imgs.length, 1, 'only the allowlisted favorite renders an <img>');
  assert.equal(imgs[0].data.attrs.src, 'file:///hisenseUI/var/local/storeAppIcon/netflix.png');
  assert.equal(imgs[0].data.style.objectFit, 'contain');
  assert.ok(flat.some(n => (n.children || []).includes('\u2605')),
    'the refused favorite still renders the star glyph');
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
  assert.equal(v.appItems().length, 5);
  v.zone = 'apps';
  v.app = 3; // Settings (index 3)
  v.clamp();
  assert.equal(v.app, 3);

  // Clear favorites and re-read
  f.store.set('alvidaa_favorites', []);
  v.readPrefs();
  assert.equal(v.appItems().length, 3);
  assert.equal(v.app, 2); // safely clamped from 3 to 2 (Launcher door)
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

test('input art: fades the outgoing layer out when the next input has none configured', () => {
  const f = setup(), v = f.instance;
  f.root.AlvidaaNativeInputArt = { 0: 'data:image/png;base64,TVART' };
  v.start();
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  assert.equal(v.dock, 0);
  // HDMI2 has no configured art, so the target layer is empty.
  v.dock = 1;
  v.syncArt();
  let flat = flatten(draw());
  let outgoing = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'outgoing');
  let incoming = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'incoming');
  assert.ok(outgoing, 'outgoing art stays mounted during the fade');
  assert.equal(outgoing.data.style.opacity, 1, 'outgoing starts the fade at opacity 1');
  assert.equal(incoming, undefined, 'no incoming layer when the target has no art');
  const tick = f.timeouts.get(v._artTickTimer);
  assert.ok(tick, 'fade tick scheduled');
  tick();
  flat = flatten(draw());
  outgoing = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'outgoing');
  assert.equal(outgoing.data.style.opacity, 0,
    'outgoing fades 1 -> 0 so the wallpaper arrives as a cross-fade, not a cut');
  const fade = f.timeouts.get(v._artTimer);
  assert.ok(fade, '300ms cleanup timer still scheduled');
  fade();
  flat = flatten(draw());
  outgoing = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'outgoing');
  assert.equal(outgoing, undefined, 'outgoing unmounts after 300ms');
  v.stop();
});

test('input art: resolves by sourceId, lowercased source name, and lowercased display name', () => {
  const f = setup(), v = f.instance;
  // The TV reports names but never art, so a config-built map is keyed by
  // lowercased source names; a build-time map may still key by sourceId.
  f.root.AlvidaaNativeInputArt = {
    0: 'data:image/png;base64,BYID',
    hdmi2: 'data:image/png;base64,BYNAME',
    'fire tv stick': 'data:image/png;base64,BYDISPLAY'
  };
  v.start();
  // sources: 0/TV, HDMI2 (displayname2 "PlayStation 5"), HDMI3 (rename "Fire TV Stick")
  assert.equal(v.inputArtFor(v.sources[0]), 'data:image/png;base64,BYID',
    'sourceId resolution is unchanged and wins first');
  v.sources[1].name = ' HDMI2 '; // the config keys are lowercased and trimmed
  assert.equal(v.inputArtFor(v.sources[1]), 'data:image/png;base64,BYNAME',
    'a map keyed like the bridge config ("hdmi2") matches the port label');
  assert.equal(v.inputArtFor(v.sources[2]), 'data:image/png;base64,BYDISPLAY',
    'the resolved display name is the third lookup');
  // The display name honours a custom rename from the settings surface too.
  v.prefs.customNames = { HDMI3: 'Rig' };
  f.root.AlvidaaNativeInputArt = { rig: 'data:image/png;base64,BYCUSTOM' };
  assert.equal(v.inputArtFor(v.sources[2]), 'data:image/png;base64,BYCUSTOM');
  // End to end: the name-keyed map drives the rendered backdrop layer.
  delete v.prefs.customNames;
  f.root.AlvidaaNativeInputArt = { hdmi2: 'data:image/png;base64,BYNAME' };
  v.dock = 1;
  v.syncArt();
  const flat = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })));
  const incoming = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'incoming');
  assert.ok(incoming, 'the name-keyed art renders as the incoming backdrop');
  assert.match(incoming.data.style.backgroundImage, /BYNAME/);
  v.stop();
});

test('input art: a remote URL in the map is still refused and the wallpaper is used', () => {
  const f = setup(), v = f.instance;
  f.root.AlvidaaNativeInputArt = { hdmi3: 'https://evil.com/art.png' };
  v.start();
  assert.equal(v.inputArtFor(v.sources[2]), 'https://evil.com/art.png',
    'the lookup itself is not the policy');
  v.dock = 2;
  v.syncArt();
  const flat = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })));
  const leaked = flat.filter(n => n.data && n.data.style &&
    n.data.style.backgroundImage && n.data.style.backgroundImage.includes('evil.com'));
  assert.equal(leaked.length, 0, 'allowedInputArt still refuses the remote URL: no art layer');
  const wall = flat.some(n => n.data && n.data.style && n.data.style.backgroundImage &&
    n.data.style.backgroundImage.indexOf('linear-gradient(180deg, rgba(56,189,248') === 0);
  assert.ok(wall, 'the wallpaper fallback is what renders instead');
  v.stop();
});

test('input art: an inline SVG data URI is accepted and a remote URL still refused', () => {
  const f = setup(), v = f.instance;
  // The device silhouettes (device-art.cjs) arrive as base64 SVG data URIs.
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#94a3b8"><rect x="2" y="7" width="20" height="15" rx="2"/></svg>';
  const svgUri = 'data:image/svg+xml;base64,' + Buffer.from(svg, 'utf8').toString('base64');
  // The unencoded form stays out: only the base64 shape is allowlisted.
  const rawUri = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
  f.root.AlvidaaNativeInputArt = { hdmi2: svgUri, hdmi3: rawUri, tv: 'https://evil.com/art.svg' };
  v.start();
  v.dock = 1;
  v.syncArt();
  let flat = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })));
  const incoming = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-art-layer'] === 'incoming');
  assert.ok(incoming, 'the SVG silhouette renders as the backdrop');
  assert.match(incoming.data.style.backgroundImage, /data:image\/svg\+xml;base64,/);
  v.dock = 2;
  v.syncArt();
  flat = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })));
  assert.equal(flat.filter(n => n.data && n.data.style && n.data.style.backgroundImage &&
    (n.data.style.backgroundImage.includes('evil.com') ||
     /svg\+xml,</.test(n.data.style.backgroundImage))).length, 0,
    'a remote URL and an unencoded SVG URI both stay off the canvas');
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

// ---- the launcher settings surface -----------------------------------------

function openSettings(v) {
  v.zone = 'apps';
  const items = v.appItems();
  v.app = items.indexOf(items.find(i => i.kind === 'launcher'));
  v.activate();
}

test('settings: the Launcher door opens the layer, Back returns to view 2, glass renders', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  const items = v.appItems();
  const door = items.find(i => i.kind === 'launcher');
  assert.ok(door, 'the Launcher door exists in view 2');
  assert.equal(door.label, 'Launcher');
  assert.equal(door.glyph, '\u2630');
  assert.equal(door.sub, 'Home settings');
  assert.notEqual(door.glyph, items.find(i => i.kind === 'settings').glyph,
    'the two settings doors must not look alike');
  openSettings(v);
  assert.equal(v.settings, true);
  assert.equal(v.settingsPage, 'root');
  assert.equal(v.zone, 'apps');
  const flat = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })));
  assert.ok(flat.find(n => n.data && n.data.style &&
    n.data.style.backgroundColor === 'rgba(3,5,9,0.86)'), 'modal dark glass renders');
  const texts = flat.flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('HOME SETTINGS'));
  assert.ok(texts.includes('Auto-switch on boot'));
  assert.ok(texts.includes('Input names'));
  assert.ok(texts.includes('Home settings'), 'the door itself is on the row behind the glass');
  v.handleKey(k.BACK);
  assert.equal(v.settings, false);
  assert.equal(v.zone, 'apps', 'Back closes the layer and stays in view 2');
  v.handleKey(k.UP); // view 2 -> dock
  assert.equal(v.handleKey(k.BACK), false, 'Back at the dock still belongs to the vendor');
  v.stop();
});

test('settings: auto-switch toggle writes real booleans and the row follows', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  openSettings(v);
  assert.equal(v.settingsRows()[0].kind, 'autoswitch');
  assert.equal(v.settingsRows()[0].value, 'off');
  v.handleKey(k.ENTER);
  assert.equal(f.store.get('alvidaa_auto_switch'), 'true', 'stored as a real JSON boolean');
  assert.equal(v.prefs.autoSwitch, true);
  assert.equal(v.settingsRows()[0].value, 'on');
  v.handleKey(k.ENTER);
  assert.equal(f.store.get('alvidaa_auto_switch'), 'false');
  assert.equal(v.settingsRows()[0].value, 'off');
  v.handleKey(k.RIGHT);
  assert.equal(f.store.get('alvidaa_auto_switch'), 'true', 'Left/Right changes the value too');
  v.handleKey(k.LEFT);
  assert.equal(f.store.get('alvidaa_auto_switch'), 'false');
  v.stop();
});

test('settings: hiding an app writes the hidden list and the overlay loses it immediately', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  openSettings(v);
  assert.equal(v.settingsRows()[1].kind, 'open-apps');
  assert.equal(v.settingsRows()[1].sub, '2 shown, 0 hidden');
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // apps page
  assert.equal(v.settingsPage, 'apps');
  assert.equal(v.settingsRows().length, 2);
  assert.equal(v.settingsRows()[0].label, 'Netflix');
  assert.equal(v.settingsRows()[0].value, 'shown');
  v.handleKey(k.ENTER); // hide Netflix
  assert.equal(f.store.get('alvidaa_hidden_apps'), '["1"]');
  assert.deepEqual(v.apps.map(a => a.appId), ['2'],
    'the filtered overlay list updates without a restart');
  assert.equal(v.settingsRows()[0].value, 'hidden');
  v.handleKey(k.BACK); // root
  assert.equal(v.settingsPage, 'root');
  assert.equal(v.settingsRows()[1].sub, '1 shown, 1 hidden', 'the root sub-label follows');
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // apps page again
  v.handleKey(k.ENTER); // unhide
  assert.equal(f.store.get('alvidaa_hidden_apps'), '[]');
  assert.deepEqual(v.apps.map(a => a.appId), ['1', '2']);
  v.stop();
});

test('settings: pin and unpin write favorites, the sixth pin is refused with a toast', () => {
  const f = setup({ storage: { alvidaa_favorites: ['1', '2', 'f3', 'f4', 'f5'] } }),
    v = f.instance, k = KEYS;
  v.start();
  // Prefilled storage holds a raw array until the component writes it back
  // as JSON, so parse either shape.
  const favs = () => {
    const raw = f.store.get('alvidaa_favorites');
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  };
  // Two more valid apps so there is an unpinned row to try pinning.
  v._lastData.apps.push({ appId: '4', appName: 'Alpha' }, { appId: '5', appName: 'Beta' });
  v.readPrefs();
  openSettings(v);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // apps page
  assert.equal(v.settingsRows().length, 4);
  assert.equal(v.settingsRows()[0].label, '\u2605 Netflix', 'pinned apps carry the star marker');
  v.settingsIndex = 2; // Alpha
  v.handleKey(k.RIGHT); // pin
  assert.match(v.toast, /favorites are full/);
  assert.equal(favs().length, 5, 'the stored list stays at 5, nothing dropped silently');
  v.settingsIndex = 0; // Netflix
  v.handleKey(k.RIGHT); // unpin always works
  assert.deepEqual(favs(), ['2', 'f3', 'f4', 'f5']);
  assert.equal(v.settingsRows()[0].label, 'Netflix');
  v.handleKey(k.RIGHT); // pin again
  assert.deepEqual(favs(), ['2', 'f3', 'f4', 'f5', '1']);
  assert.equal(v.appItems()[0].appId, '2',
    'view 2 reads the same favorites as the settings list');
  v.stop();
});

test('settings: the keyboard renames an input and the dock labels follow', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  openSettings(v);
  v.handleKey(k.DOWN);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // inputs page
  assert.equal(v.settingsPage, 'inputs');
  assert.equal(v.settingsRows().length, 3);
  assert.equal(v.settingsRows()[1].label, 'PlayStation 5');
  assert.equal(v.settingsRows()[1].value, '');
  v.settingsIndex = 1;
  v.handleKey(k.ENTER); // name editor
  assert.equal(v.settingsPage, 'name');
  assert.equal(v.nameDraft, '');
  // Grid is A-Z then 0-9: P=15, S=18, 5=31; DONE=39.
  v.nameIndex = 15; v.handleKey(k.ENTER);
  v.nameIndex = 18; v.handleKey(k.ENTER);
  v.nameIndex = 31; v.handleKey(k.ENTER);
  assert.equal(v.nameDraft, 'PS5');
  const draftTree = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })));
  assert.ok(draftTree.some(n => (n.children || []).includes('PS5')),
    'the editor renders the draft');
  v.nameIndex = 39; v.handleKey(k.ENTER); // DONE
  assert.equal(v.settingsPage, 'inputs');
  assert.equal(f.store.get('alvidaa_custom_names'), '{"HDMI2":"PS5"}');
  assert.equal(v.settingsRows()[1].value, 'custom');
  assert.equal(v.settingsRows().length, 4, 'a Reset row appeared under the renamed input');
  assert.equal(v.sourceName(v.sources[1]), 'PS5');
  v.zone = 'dock';
  v.dock = 1;
  const texts = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })))
    .flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('PS5'), 'the big label above the dock shows the custom name');
  v.stop();
});

test('settings: a draft that trims to empty deletes the custom name', () => {
  const f = setup({ storage: { alvidaa_custom_names: { HDMI2: 'PlayStation 5 Pro' } } }),
    v = f.instance, k = KEYS;
  v.start();
  assert.equal(v.sourceName(v.sources[1]), 'PlayStation 5 Pro');
  openSettings(v);
  v.handleKey(k.DOWN);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // inputs page
  assert.equal(v.settingsRows()[1].value, 'custom');
  v.settingsIndex = 1;
  v.handleKey(k.ENTER); // editor, seeded from the current custom name
  assert.equal(v.settingsPage, 'name');
  assert.equal(v.nameDraft, 'PlayStation 5 Pro');
  v.nameIndex = 38; v.handleKey(k.ENTER); // CLEAR
  assert.equal(v.nameDraft, '');
  v.nameIndex = 36; v.handleKey(k.ENTER); // SPACE
  v.nameIndex = 36; v.handleKey(k.ENTER); // SPACE
  assert.equal(v.nameDraft, '  ');
  v.nameIndex = 39; v.handleKey(k.ENTER); // DONE
  assert.equal(f.store.get('alvidaa_custom_names'), '{}', 'the key is deleted, not stored empty');
  assert.equal(v.sourceName(v.sources[1]), 'PlayStation 5', 'the vendor name returns');
  v.stop();
});

test('settings: the Reset row clears one custom name', () => {
  const f = setup({ storage: { alvidaa_custom_names: { HDMI2: 'Custom Name' } } }),
    v = f.instance, k = KEYS;
  v.start();
  openSettings(v);
  v.handleKey(k.DOWN);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // inputs page
  assert.equal(v.settingsRows().length, 4);
  assert.equal(v.settingsRows()[2].kind, 'reset-name');
  assert.equal(v.settingsRows()[2].label, 'Reset name');
  v.settingsIndex = 2;
  v.handleKey(k.ENTER);
  assert.equal(f.store.get('alvidaa_custom_names'), '{}');
  assert.equal(v.sourceName(v.sources[1]), 'PlayStation 5');
  assert.equal(v.settingsRows().length, 3, 'the Reset row disappears with the custom name');
  v.stop();
});

test('settings: the only-list row appears only when set and OK clears it', () => {
  const f = setup(), v = f.instance;
  v.start();
  openSettings(v);
  assert.equal(v.settingsRows().some(r => r.kind === 'only-list'), false);
  v.stop();

  const g = setup({ storage: { alvidaa_only_apps: ['1'] } }), w = g.instance, k = KEYS;
  w.start();
  openSettings(w);
  const rows = w.settingsRows();
  assert.equal(rows.length, 6, 'five root rows plus the recently-used toggle');
  assert.equal(rows[3].kind, 'only-list');
  w.settingsIndex = 3;
  w.handleKey(k.ENTER);
  assert.equal(g.store.get('alvidaa_only_apps'), '[]');
  assert.equal(w.settingsRows().some(r => r.kind === 'only-list'), false);
  assert.deepEqual(w.apps.map(a => a.appId), ['1', '2'],
    'clearing the only-list restores the hidden-list behaviour');
  w.stop();
});

test('settings: the surface renders and navigates with storage absent and writes nothing', () => {
  const f = setup({ noStorage: true }), v = f.instance, k = KEYS;
  v.start();
  openSettings(v);
  assert.equal(v.settings, true);
  const texts = flatten(f.component.render.call(v, (tag, data, children) => ({ tag, data, children })))
    .flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('HOME SETTINGS'));
  v.handleKey(k.ENTER); // toggle auto-switch: silent no-op, no throw
  assert.equal(v.prefs.autoSwitch, false);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // apps page
  v.handleKey(k.ENTER); // toggle visibility: no throw
  v.handleKey(k.RIGHT); // pin: no throw
  v.handleKey(k.BACK);
  v.handleKey(k.DOWN);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // inputs page
  v.handleKey(k.ENTER); // name editor
  v.nameIndex = 0; v.handleKey(k.ENTER); // type "A"
  assert.equal(v.nameDraft, 'A');
  v.nameIndex = 39; v.handleKey(k.ENTER); // DONE: no throw
  v.handleKey(k.BACK); // root
  v.handleKey(k.BACK); // close
  assert.equal(v.settings, false);
  assert.equal(f.calls.filter(c => c[0] === 'storage:set').length, 0);
  v.stop();
});

test('settings: number hotkeys do not fire while the settings layer is open', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  v.sources = Array.from({ length: 5 }, (_, i) => ({ sourceId: 'in' + i, name: 'In ' + i }));
  openSettings(v);
  const before = f.calls.length;
  assert.equal(v.handleKey(k.NUM_1), false);
  assert.equal(v.handleKey(k.NUM_0), false);
  assert.equal(v.dock, 0);
  v.handleKey(k.DOWN);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // inputs page
  assert.equal(v.handleKey(k.NUM_3), false);
  v.handleKey(k.ENTER); // name editor
  assert.equal(v.settingsPage, 'name');
  assert.equal(v.handleKey(k.NUM_7), false);
  assert.equal(f.calls.length, before, 'no source switch fired behind the layer');
  v.stop();
});

test('settings: the name draft is capped at 24 characters', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  openSettings(v);
  v.handleKey(k.DOWN);
  v.handleKey(k.DOWN);
  v.handleKey(k.ENTER); // inputs page
  v.handleKey(k.ENTER); // editor
  v.nameDraft = 'x'.repeat(24);
  v.nameIndex = 0; // 'A'
  v.handleKey(k.ENTER);
  assert.equal(v.nameDraft.length, 24, 'no character past the cap');
  assert.match(v.toast, /24 characters max/);
  v.nameIndex = 37; // BACKSPACE still works at the cap
  v.handleKey(k.ENTER);
  assert.equal(v.nameDraft.length, 23);
  v.stop();
});

test('settings: announce speaks the focused row and keyboard cell', () => {
  const f = setup(), v = f.instance;
  const spoken = [];
  f.sdk.tts = { isEnable: () => true, speak: m => spoken.push(m) };
  v.start();
  openSettings(v);
  v.announce();
  assert.deepEqual(spoken, ['Auto-switch on boot, off']);
  v.settingsIndex = 2;
  v.announce();
  assert.equal(spoken[1], 'Input names');
  v.handleKey(KEYS.ENTER); // inputs page
  v.announce();
  assert.equal(spoken[2], 'TV');
  v.handleKey(KEYS.ENTER); // name editor
  v.announce();
  assert.equal(spoken[3], 'A', 'keyboard cells speak their character');
  v.stop();
});

test('input names prefer the SDK deviceName, then the MQTT displayname2', () => {
  const f = setup(), v = f.instance;
  f.component.mounted.call(v);
  // The vendor JS SDK (all-inputs.getAllInputsData) reports `deviceName`; the
  // MQTT sourcelist the bridge reads calls the same thing `displayname2`. The
  // native lane only ever sees the SDK, so deviceName must win — without it
  // HDMI3 read "HDMI3" while the canvas lane read "Fire TV Stick".
  assert.equal(v.sourceName({ sourceId: 'HDMI3', name: 'HDMI3', deviceName: 'Fire TV Stick' }), 'Fire TV Stick');
  assert.equal(v.sourceName({ sourceId: 'HDMI2', name: 'HDMI2', displayname2: 'PlayStation 5' }), 'PlayStation 5');
  assert.equal(v.sourceName({ sourceId: 'X', name: 'X', deviceName: 'Switch', displayname2: 'Other' }), 'Switch');
  // A custom name still beats both.
  v.prefs.customNames = { hdmi3: 'Stick' };
  assert.equal(v.sourceName({ sourceId: 'HDMI3', name: 'HDMI3', deviceName: 'Fire TV Stick' }), 'Stick');
});

test('the dock tile draws the device icon as shapes, not as an image', () => {
  const f = setup(), v = f.instance;
  f.root.AlvidaaNativeDeviceArt = {
    rules: [['(fire tv|cast)', 'cast'], ['(switch|playstation)', 'gamepad-2']],
    icons: { cast: 'data:image/svg+xml;base64,CAST', 'gamepad-2': 'data:image/svg+xml;base64,PAD',
      box: 'data:image/svg+xml;base64,BOX' },
    fallback: 'box'
  };
  f.component.mounted.call(v);
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const flat = flatten(draw());
  // This engine paints neither an SVG data URI (img or background-image) nor the
  // vendor icon-font class, so the icon has to be divs with borders/backgrounds.
  assert.equal(flat.filter(n => n.tag === 'img').length, 0, 'no <img> is used for tile art');
  assert.equal(flat.filter(n => n.data && n.data.style && /url\(/.test(String(n.data.style.backgroundImage || ''))).length, 0,
    'no tile art is painted as a background-image');
  const shapes = flat.filter(n => n.data && n.data.style && n.data.style.position === 'absolute' &&
    (/(^|;|\s)border:/.test(String(n.data.style.border || '')) || n.data.style.backgroundColor));
  assert.ok(shapes.length >= 6, 'the dock draws shape primitives for the inputs, got ' + shapes.length);
  // The name still resolves, and the matcher is what picks the shape.
  assert.equal(v.deviceArtName('Fire TV Stick'), 'cast');
  assert.equal(v.deviceArtName('PlayStation 5'), 'gamepad-2');
  assert.equal(v.deviceArtName('something unknown'), 'box');
});

// ---- recently-used ordering (issue #55) -------------------------------------

function fourApps(v) {
  // The stock payload reports two valid apps; two more give the ordering
  // enough unrecorded entries to prove their relative order survives.
  v._lastData.apps.push({ appId: '4', appName: 'Alpha' }, { appId: '5', appName: 'Beta' });
  v.readPrefs();
}

test('recent ordering: launched apps list newest-first, unlaunched apps keep vendor order', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.prefs.recentOrder, true, 'default on');
  fourApps(v);
  assert.deepEqual(v.apps.map(a => a.appId), ['1', '2', '4', '5'],
    'without records the vendor order is untouched');
  f.store.set('alvidaa_recent', JSON.stringify({ '5': 3000, '4': 2000 }));
  v.readPrefs();
  assert.deepEqual(v.apps.map(a => a.appId), ['5', '4', '1', '2'],
    'recorded apps newest-first, then never-launched apps in vendor order');
  v.stop();
});

test('recent ordering: launches record a timestamp and reorder the overlay live', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.overlay = true;
  v.overlayIndex = 1; // Plex
  v.launchFocused();
  assert.deepEqual(f.calls.at(-1), ['launch', '2']);
  const stored = JSON.parse(f.store.get('alvidaa_recent'));
  assert.ok(stored['2'] > 0 && Math.abs(stored['2'] - Date.now()) < 5000,
    'the launch is stamped with the current time');
  assert.deepEqual(v.apps.map(a => a.appId), ['2', '1'],
    'the freshly launched app is first when the overlay reopens');
  // A favorite launch records too.
  fourApps(v);
  f.store.set('alvidaa_favorites', ['5']);
  v.readPrefs();
  v.zone = 'apps';
  v.app = 0; // the Beta favorite tile
  v.activate();
  assert.deepEqual(f.calls.at(-1), ['launch', '5']);
  assert.ok(JSON.parse(f.store.get('alvidaa_recent'))['5'] > 0,
    'the favorite launch is recorded under its app id');
  v.stop();
});

test('recent ordering: the toggle row turns the feature off and back on', () => {
  const f = setup({ storage: {
    alvidaa_recent_order: false,
    alvidaa_recent: JSON.stringify({ '2': 1000 })
  } }), v = f.instance, k = KEYS;
  v.start();
  assert.equal(v.prefs.recentOrder, false);
  assert.deepEqual(v.apps.map(a => a.appId), ['1', '2'], 'off keeps the vendor order');
  v.overlay = true;
  v.overlayIndex = 1;
  v.launchFocused();
  assert.equal(f.store.get('alvidaa_recent'), JSON.stringify({ '2': 1000 }),
    'nothing is recorded while the ordering is off');
  openSettings(v);
  const rows = v.settingsRows();
  assert.equal(rows[rows.length - 1].kind, 'recent');
  assert.equal(rows[rows.length - 1].value, 'off');
  v.settingsIndex = rows.length - 1;
  v.handleKey(k.ENTER);
  assert.equal(f.store.get('alvidaa_recent_order'), 'true', 'stored as a real JSON boolean');
  assert.equal(v.prefs.recentOrder, true);
  assert.deepEqual(v.apps.map(a => a.appId), ['2', '1'], 'ordering applies once on');
  v.handleKey(k.RIGHT);
  assert.equal(f.store.get('alvidaa_recent_order'), 'false', 'Left/Right changes the value too');
  v.stop();
});

test('recent ordering: the record caps at 40 entries, dropping the oldest', () => {
  const f = setup(), v = f.instance;
  v.start();
  for (let i = 0; i < 45; i++) v.recordLaunch(String(i));
  const stored = JSON.parse(f.store.get('alvidaa_recent'));
  assert.equal(Object.keys(stored).length, 40);
  assert.equal(stored['4'], undefined, 'the oldest records are pruned');
  assert.ok(stored['5'] > 0 && stored['44'] > 0, 'the newest records survive');
  v.stop();
});

// ---- first-frame dock placeholders (issue #54) ------------------------------

test('first frame: the dock paints placeholder tiles at final geometry before the payload', () => {
  const f = setup(), v = f.instance;
  let deliver;
  f.root.AlvidaaNativePlatform = (_sdk, callback) => ({
    start() { deliver = callback; },
    stop() {},
    launchApp() {}, changeSource() {}, openSettings() {}
  });
  f.root.AlvidaaNativeDeviceArt = {
    rules: [['(playstation|switch)', 'gamepad-2']],
    fallback: 'box'
  };
  v.start();
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const placeholders = flat => flat.filter(n => n.data && n.data.attrs &&
    n.data.attrs['data-dock-placeholder']);
  const texts = flat => flat.flatMap(n => n.children || []).filter(c => typeof c === 'string');

  // First frame: no payload yet — placeholder tiles at the exact geometry a
  // real tile occupies, carrying the fallback silhouette, and no verdict.
  let flat = flatten(draw());
  let ph = placeholders(flat);
  assert.equal(ph.length, 6, 'one full page of placeholders');
  assert.ok(!texts(flat).includes('no inputs reported'),
    'pre-payload is not a verdict about the inputs');
  assert.ok(!texts(flat).includes('TV'), 'no real tiles yet');
  const phTile = ph[0].data.style;
  assert.equal(phTile.left, '112px');
  assert.equal(phTile.top, '848px');
  assert.equal(phTile.width, '264px');
  assert.equal(phTile.height, '180px');
  assert.equal(phTile.borderRadius, '28px');
  assert.equal(phTile.backgroundImage, 'linear-gradient(180deg, #161b24, #0d1017)');
  assert.equal(ph[1].data.style.left, '396px', 'page pitch matches the real dock');
  // The fallback shape sits in the same 56px box at the same offsets the real
  // tile's shape container uses, so the swap changes nothing but the shape.
  const shapeBox = flat.find(n => n.data && n.data.style &&
    n.data.style.width === '56px' && n.data.style.height === '56px' &&
    n.data.style.top === '40px' && n.data.style.left === '104px');
  assert.ok(shapeBox, 'the placeholder carries a shape container');
  const primitive = flatten(ph[0]).find(n => n.data && n.data.style &&
    (/(^|;|\s)border:/.test(String(n.data.style.border || '')) || n.data.style.backgroundColor));
  assert.ok(primitive, 'the fallback silhouette is drawn as div shapes');

  // The payload lands: placeholders are gone, real tiles sit at the same
  // geometry, and the shape container has not moved.
  deliver({
    apps: [{ appId: '1', appName: 'Netflix' }],
    sources: [
      { sourceId: 0, name: 'TV', is_signal: '1' },
      { sourceId: 'HDMI2', name: 'HDMI2', displayname2: 'PlayStation 5', is_signal: 0 }
    ],
    errors: [], waiting: false
  });
  flat = flatten(draw());
  assert.equal(placeholders(flat).length, 0, 'placeholders unmount with the payload');
  const tiles = flat.filter(n => n.data && n.data.attrs &&
    n.data.attrs.role === 'button' && n.data.style.top === '848px');
  assert.equal(tiles.length, 2, 'real dock tiles render');
  assert.equal(tiles[0].data.style.left, '112px', 'same geometry as the placeholder');
  const realShapeBox = flat.find(n => n.data && n.data.style &&
    n.data.style.width === '56px' && n.data.style.height === '56px' &&
    n.data.style.top === '40px' && n.data.style.left === '104px');
  assert.ok(realShapeBox, 'the real tile draws its shape in the same box');
  assert.ok(texts(flat).includes('PlayStation 5'));

  // A re-activated instance keeps its sources even before the next payload:
  // placeholders must never replace real tiles.
  v._payloadReceived = false;
  assert.equal(placeholders(flatten(draw())).length, 0);

  // And a payload reporting zero inputs gets the verdict, not placeholders.
  deliver({ apps: [], sources: [], errors: [], waiting: false });
  flat = flatten(draw());
  assert.equal(placeholders(flat).length, 0);
  assert.ok(texts(flat).includes('no inputs reported'));
  v.stop();
});


// ---- idle screen (issue #58) -------------------------------------------------

function clockTick(f) {
  return Array.from(f.timers.values())[0];
}

test('idle: off by default and the row says so', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(v.prefs.idleMinutes, 0, 'alvidaa_idle_minutes defaults to 0 = off');
  assert.equal(v.idleAt, 0, 'no deadline armed when off');
  assert.equal(v.idle, false);
  openSettings(v);
  const rows = v.settingsRows();
  const row = rows.find(r => r.kind === 'idle');
  assert.ok(row, 'the Idle screen row exists on the root page');
  assert.equal(row.label, 'Idle screen');
  assert.equal(row.value, 'off');
  assert.equal(rows.indexOf(rows.find(r => r.kind === 'recent')), rows.length - 1,
    'the recently-used row stays last');
  v.stop();
});

test('idle: fades in after the timeout and renders clock, date and nothing else', () => {
  const f = setup({ storage: { alvidaa_idle_minutes: 1 } }), v = f.instance;
  f.root.AlvidaaNativeWallpaper = 'data:image/png;base64,AAAWALL';
  v.start();
  assert.equal(v.prefs.idleMinutes, 1);
  assert.ok(v.idleAt > Date.now(), 'the deadline is armed from the existing clock interval');
  const tick = clockTick(f);
  tick();
  assert.equal(v.idle, false, 'before the deadline nothing happens');
  v.idleAt = Date.now() - 1;
  tick();
  assert.equal(v.idle, true, 'the clock tick alone enters idle');
  assert.equal(v.idleAt, 0, 'the deadline is spent');

  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  let flat = flatten(draw());
  const idle = flat.find(n => n.data && n.data.attrs && n.data.attrs['data-idle-screen'] === 'true');
  assert.ok(idle, 'the idle layer renders');
  assert.equal(idle.data.style.opacity, 0, 'the fade starts transparent');
  assert.ok(idle.data.style.transition.includes('opacity'));
  assert.ok(v._idleFadeTimer != null, 'the fade tick is scheduled');
  f.timeouts.get(v._idleFadeTimer)();
  flat = flatten(draw());
  assert.equal(flat.find(n => n.data.attrs['data-idle-screen']).data.style.opacity, 1,
    'the fade flips to 1 on the tick');

  // Wallpaper, a large clock, the date — no dock, no chrome, no HUD. Shapes
  // and text only: no <img>, no SVG data URI (findings 13 section 8).
  const texts = flat.flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes(':'), 'the clock is rendered');
  assert.ok(texts.some(t => /^[A-Z]+ \u00b7 [A-Z]+ \d+$/.test(t)), 'the date is rendered');
  assert.equal(texts.includes('INPUTS & SOURCES'), false, 'no dock chrome');
  assert.equal(texts.includes('LIVE') || texts.includes('STANDBY'), false, 'no dock tiles');
  assert.equal(texts.includes('APPS'), false, 'no apps row');
  assert.equal(flat.some(n => n.data && n.data.attrs && n.data.attrs.role === 'status'),
    false, 'no HUD pill');
  assert.equal(flat.filter(n => n.tag === 'img').length, 0, 'no images');
  assert.equal(flat.filter(n => n.data && n.data.style &&
    /url\(/.test(String(n.data.style.backgroundImage || ''))).length, 1,
    'only the build-time wallpaper paints as an image');
  v.stop();
});

test('idle: any key wakes and is consumed — nothing activates', () => {
  const f = setup({ storage: { alvidaa_idle_minutes: 5 } }), v = f.instance, k = KEYS;
  v.start();
  const tick = clockTick(f);
  const goIdle = () => { v.idleAt = Date.now() - 1; tick(); assert.equal(v.idle, true); };
  const sources = () => f.calls.filter(c => c[0] === 'source').length;

  // The dock's focused input is TV (sourceId 0); ENTER must not switch to it.
  v.dock = 0;
  goIdle();
  assert.equal(v.handleKey(k.ENTER), true, 'the wake key is consumed');
  assert.equal(v.idle, false, 'and it wakes');
  assert.equal(sources(), 0, 'ENTER must not switch source on wake');
  assert.ok(v.idleAt > Date.now(), 'the window re-arms after the wake');

  goIdle();
  assert.equal(v.handleKey(k.NUM_3), true, 'a number key wakes too');
  assert.equal(v.idle, false);
  assert.equal(v.dock, 0, 'and must not jump the dock to slot 3');
  assert.equal(sources(), 0, 'or launch whatever slot 3 holds');

  goIdle();
  assert.equal(v.handleKey(k.BACK), true, 'BACK wakes instead of leaving Home');
  assert.equal(v.idle, false);

  goIdle();
  assert.equal(v.handleKey(999), true, 'even a key no layer handles wakes the screen');
  assert.equal(v.idle, false);

  // State is preserved under the idle layer: wake returns to what was there.
  openSettings(v);
  assert.equal(v.settings, true);
  goIdle();
  assert.equal(v.handleKey(k.ENTER), true);
  assert.equal(v.settings, true, 'wake restores the layer that was open');
  v.closeSettings();
  v.stop();
});

test('idle: a source going live cancels the screen; an unchanged poll does not', () => {
  const f = setup({ storage: { alvidaa_idle_minutes: 1 } }), v = f.instance;
  v.start();
  const sameSources = [
    { sourceId: 0, name: 'TV', is_signal: '1' },
    { sourceId: 'HDMI2', name: 'HDMI2', displayname2: 'PlayStation 5', is_signal: 0 },
    { sourceId: 'HDMI3', name: 'HDMI3', rename: 'Fire TV Stick', has_signal: '1' }
  ];
  const liveSources = sameSources.map(s => Object.assign({}, s,
    { is_signal: s.sourceId === 'HDMI2' ? '1' : s.is_signal }));
  v.idleAt = Date.now() - 1;
  clockTick(f)();
  assert.equal(v.idle, true);
  f.notify()({ apps: [], sources: sameSources, errors: [], waiting: false });
  assert.equal(v.idle, true, 'an unchanged poll must not wake the screen');
  f.notify()({ apps: [], sources: liveSources, errors: [], waiting: false });
  assert.equal(v.idle, false, 'a source going live wakes the screen');
  assert.ok(v.idleAt > Date.now(), 'and re-arms the window');
  v.stop();
});

test('idle: an app launch cancels the screen', () => {
  const f = setup({ storage: { alvidaa_idle_minutes: 1 } }), v = f.instance;
  v.start();
  v.idleAt = Date.now() - 1;
  clockTick(f)();
  assert.equal(v.idle, true);
  v.overlay = true;
  v.overlayIndex = 0;
  v.launchFocused();
  assert.equal(v.idle, false, 'the launch cancels idle');
  assert.deepEqual(f.calls.at(-1), ['launch', '1']);
  assert.ok(v.idleAt > Date.now(), 'the window re-arms');
  v.stop();
});

test('idle: the setting round-trips through the settings row', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  openSettings(v);
  // Root page order: autoswitch, open-apps, open-inputs, idle, recent.
  assert.equal(v.settingsRows()[3].kind, 'idle');
  v.settingsIndex = 3;
  v.handleKey(k.ENTER);
  assert.equal(f.store.get('alvidaa_idle_minutes'), '1', 'stored as a JSON number');
  assert.equal(v.prefs.idleMinutes, 1);
  assert.equal(v.settingsRows()[3].value, '1 min');
  v.handleKey(k.RIGHT);
  assert.equal(f.store.get('alvidaa_idle_minutes'), '5');
  v.handleKey(k.RIGHT);
  assert.equal(f.store.get('alvidaa_idle_minutes'), '15');
  assert.equal(v.settingsRows()[3].value, '15 min');
  v.handleKey(k.RIGHT);
  assert.equal(f.store.get('alvidaa_idle_minutes'), '0', '15 wraps to off');
  assert.equal(v.settingsRows()[3].value, 'off');
  v.handleKey(k.LEFT);
  assert.equal(f.store.get('alvidaa_idle_minutes'), '15', 'Left steps back');
  assert.ok(v.idleAt > Date.now(), 'the armed deadline follows the setting');
  v.stop();
});

test('idle: stop() clears the layer, the deadline and the fade timer', () => {
  const f = setup({ storage: { alvidaa_idle_minutes: 1 } }), v = f.instance;
  v.start();
  v.idleAt = Date.now() - 1;
  clockTick(f)();
  assert.equal(v.idle, true);
  assert.ok(f.timeouts.size >= 1, 'the fade tick is pending');
  v.stop();
  assert.equal(v.idle, false);
  assert.equal(v.idleAt, 0);
  assert.equal(f.timeouts.size, 0, 'the fade timer is cleaned up');
});

// ---- groups in the apps overlay (issue #57) ----------------------------------

test('groups: unset config keeps the flat grid exactly as before', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  assert.equal(v.overlayGroups(), null, 'no config means no groups');
  assert.equal(v.overlaySpans(), null);
  v.apps = Array.from({ length: 12 }, (_, i) => ({ appId: String(i), appName: 'App ' + i }));
  v.overlay = true;
  v.overlayIndex = 0;
  v.handleKey(k.DOWN);
  // 7 columns after the measured density change; the flat grid itself is
  // still the flat grid — no headers, no catch-all.
  assert.equal(v.overlayIndex, 7, 'Up/Down still steps a full flat row');
  v.handleKey(k.UP);
  assert.equal(v.overlayIndex, 0);
  assert.equal(v.overlayList(), v.apps, 'the shown list is the app list itself');
  const texts = flatten(f.component.render.call(v, (tag, data, children) =>
    ({ tag, data, children }))).flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.equal(texts.includes('Other apps'), false, 'no catch-all header on the flat grid');
  v.stop();
});

test('groups: rendering follows the config array with an Other apps catch-all', () => {
  const f = setup({ storage: { alvidaa_groups: [
    { name: 'Media', apps: ['1'] },
    { name: 'Games', apps: ['stale-9'] }
  ] } }), v = f.instance;
  v.start();
  v.overlay = true;
  v.overlayIndex = 0;
  const draw = () => f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const texts = flatten(draw()).flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('Media'), 'the configured group renders its header');
  assert.ok(texts.includes('Other apps'), 'the long tail gets a home without curation');
  assert.equal(texts.includes('Games'), false,
    'a group whose apps all fail to resolve renders nothing, not an empty header');
  assert.ok(texts.includes('Netflix') && texts.includes('Plex'));
  assert.equal(v.overlayList().length, 2, 'Netflix grouped, Plex caught by Other');
  assert.deepEqual(v.overlayList().map(a => a.appId), ['1', '2'],
    'group members first in config order, then the catch-all');
  v.stop();
});

test('groups: ordering follows the config array, against the vendor order', () => {
  const f = setup({ storage: { alvidaa_groups: [
    { name: 'Media', apps: ['2', '1'] }
  ] } }), v = f.instance;
  v.start();
  assert.deepEqual(v.apps.map(a => a.appId), ['1', '2'], 'vendor order untouched');
  assert.deepEqual(v.overlayList().map(a => a.appId), ['2', '1'],
    'the group lists Plex before Netflix because the config says so');
  const texts = flatten(f.component.render.call(v, (tag, data, children) =>
    ({ tag, data, children }))).flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.equal(texts.includes('Other apps'), false,
    'every app is claimed, so there is no catch-all');
  v.stop();
});

test('groups: Left/Right stay in the group, Up/Down step between groups, OK launches', () => {
  const f = setup(), v = f.instance, k = KEYS;
  v.start();
  v.apps = ['a', 'b', 'c', 'd', 'e'].map(id => ({ appId: id, appName: 'App ' + id }));
  v.prefs.groups = [{ name: 'First', apps: ['a', 'b'] }, { name: 'Second', apps: ['c', 'd', 'e'] }];
  v.overlay = true;
  v.overlayIndex = 0; // a
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 1, 'b');
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 1, 'Right stops at the group end');
  v.handleKey(k.DOWN);
  assert.equal(v.overlayIndex, 3, 'into Second at the same offset, clamped (d)');
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 4, 'e');
  v.handleKey(k.RIGHT);
  assert.equal(v.overlayIndex, 4, 'and stops at the last app of the last group');
  v.handleKey(k.ENTER);
  assert.deepEqual(f.calls.at(-1), ['launch', 'e'], 'OK opens the focused app');
  assert.equal(v.overlay, false, 'the launch closes the overlay');
  // Back in: the groups pin their members by config order, so the flattened
  // list and the focus position survive the launch's recency re-sort.
  v.overlay = true;
  v.overlayIndex = 4; // e, last of Second
  v.handleKey(k.LEFT);
  assert.equal(v.overlayIndex, 3, 'd');
  v.handleKey(k.LEFT);
  assert.equal(v.overlayIndex, 2, 'c');
  v.handleKey(k.LEFT);
  assert.equal(v.overlayIndex, 2, 'Left stops at the group start');
  v.handleKey(k.UP);
  assert.equal(v.overlayIndex, 0, 'back into First at the same offset (a)');
  v.handleKey(k.UP);
  assert.equal(v.overlayIndex, 0, 'Up at the first group stays put, still consumed');
  v.handleKey(k.DOWN);
  assert.equal(v.overlayIndex, 2, 'Down lands at Second start for offset 0');
  v.stop();
});

test('groups: the grouped overlay renders headers and cells from one focus path', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.apps = ['a', 'b', 'c', 'd'].map(id => ({ appId: id, appName: 'App ' + id }));
  v.prefs.groups = [{ name: 'First', apps: ['a', 'b', 'c'] }, { name: 'Second', apps: ['d'] }];
  v.overlay = true;
  v.overlayIndex = 2; // c — with 7 columns First's three apps share one row
  const tree = f.component.render.call(v, (tag, data, children) => ({ tag, data, children }));
  const flat = flatten(tree);
  const texts = flat.flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('First') && texts.includes('Second'), 'both headers render');
  // Scope to the overlay panel: the dock keeps rendering underneath it, and
  // its tiles are role=button too.
  const panel = flat.find(n => n.data && n.data.style &&
    n.data.style.borderRadius === '48px' && n.data.style.backgroundColor === 'rgba(14,18,26,0.97)');
  assert.ok(panel, 'the overlay panel renders');
  const cells = flatten(panel).filter(n => n.data && n.data.attrs &&
    n.data.attrs.role === 'button' && n.data.style.borderRadius === '24px');
  assert.equal(cells.length, 4, 'all four apps render as overlay cells');
  // The focused cell is c: the lift treatment (hairline + sheen), not a ring —
  // non-focused siblings keep the quiet hairline.
  assert.equal(cells.filter(n => n.data.style.border === '1px solid rgba(255,255,255,0.22)').length, 1,
    'exactly one focused cell — a single focus path');
  assert.equal(flat.filter(n => n.tag === 'img').length, 0, 'shapes and text only');
  v.stop();
});

// ---- per-app tint (issue #56) -----------------------------------------------

const TINT_H = (tag, data, children) => ({ tag, data, children });

test('app tint: no map no layer; with a map the layer mounts at opacity 0', () => {
  const f = setup(), v = f.instance;
  v.start();
  assert.equal(flatten(f.component.render.call(v, TINT_H))
    .some(n => n.data && n.data.attrs && n.data.attrs['data-app-tint']), false,
    'no baked map, no tint layer at all');
  f.root.AlvidaaNativeAppColours = { 'netflix.png': '#b20710' };
  const tint = flatten(f.component.render.call(v, TINT_H))
    .find(n => n.data && n.data.attrs && n.data.attrs['data-app-tint']);
  assert.ok(tint, 'the layer mounts once the map is baked');
  assert.equal(tint.data.style.opacity, 0, 'invisible until a favourite is focused');
  v.stop();
});

test('app tint: focusing a favourite fades the wash toward its colour and back', () => {
  const f = setup({ storage: { alvidaa_favorites: ['1'] } }), v = f.instance, k = KEYS;
  f.root.AlvidaaNativeAppColours = { 'netflix.png': '#b20710' };
  v.start();
  assert.equal(v.appItems()[0].kind, 'favorite', 'the Netflix favourite is item 0');
  v.zone = 'apps';
  v.app = 0;
  v.syncTint();
  assert.equal(v.tintColour, '#b20710');
  assert.equal(v.tintOpacity, 1);
  const tint = flatten(f.component.render.call(v, TINT_H))
    .find(n => n.data && n.data.attrs && n.data.attrs['data-app-tint']);
  assert.equal(tint.data.style.backgroundColor, '#b20710');
  assert.equal(tint.data.style.opacity, 0.22, 'a tint, never a wash-out');
  assert.match(tint.data.style.transition, /opacity 350ms/);
  assert.match(tint.data.style.transition, /background-color 350ms/,
    'moving between two tinted favourites cross-fades the hue');
  // The Apps door has no icon: the fade-out starts from the colour it was on.
  v.app = 1;
  v.syncTint();
  assert.equal(v.tintOpacity, 0);
  assert.equal(v.tintColour, '#b20710');
  // And the dock keeps the plain wash.
  v.zone = 'dock';
  v.syncTint();
  assert.equal(v.tintOpacity, 0);
  // readPrefs re-reads the favourites the tint depends on.
  f.store.set('alvidaa_favorites', []);
  v.readPrefs();
  assert.equal(v.tintOpacity, 0);
  v.stop();
});

test('app tint: the component clamp is the guarantee, whatever the map says', () => {
  const f = setup(), v = f.instance;
  v.start();
  f.root.AlvidaaNativeAppColours = {
    'white.png': '#ffffff',
    'red.png': '#b20710',
    'named.png': 'red',
    'rgb.png': 'rgb(1,2,3)',
    'upper.png': '#B20710'
  };
  assert.equal(v.appColourFor('file:///x/white.png'), '#7f7f7f',
    'a white icon is clamped even when the baked map forgot to cap it');
  assert.equal(v.appColourFor('file:///x/red.png'), '#b20710');
  assert.equal(v.appColourFor('file:///x/upper.png'), '#b20710', 'normalised to lowercase');
  assert.equal(v.appColourFor('file:///x/named.png'), '');
  assert.equal(v.appColourFor('file:///x/rgb.png'), '');
  assert.equal(v.appColourFor(''), '');
  assert.equal(v.appColourFor('https://img.vidaahub.com/plex.png'), '',
    'no entry means the current background, not a guess');
  v.stop();
});

test('the build bakes AlvidaaNativeAppColours when given, nothing when not', () => {
  const { build } = require('./build-native-alvidaa.cjs');
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alvidaa-tint-build-'));
  const stockFile = path.join(dir, 'stock.js');
  const stock = '/* stock */\nself._V_M_ = { launcher: function () { return { route: [{ path: "/Launcher", component: {} }] }; } };\n';
  fs.writeFileSync(stockFile, stock);
  const digest = hash(Buffer.from(stock));
  const plain = build(stockFile, null, digest);
  assert.ok(!plain.includes('self.AlvidaaNativeAppColours='));
  const tinted = build(stockFile, null, digest, { appColours: { 'netflix.png': '#b20710' } });
  assert.ok(tinted.includes('self.AlvidaaNativeAppColours={"netflix.png":"#b20710"}'));
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- overlay visual pass -----------------------------------------------------

function overlayPanelOf(f, v) {
  return flatten(f.component.render.call(v, (tag, data, children) =>
    ({ tag, data, children }))).find(n => n.data && n.data.style &&
    n.data.style.borderRadius === '48px' && n.data.style.backgroundColor === 'rgba(14,18,26,0.97)');
}
function overlayCellsOf(panel) {
  return flatten(panel).filter(n => n.data && n.data.attrs &&
    n.data.attrs.role === 'button' && n.data.style.borderRadius === '24px');
}
function px(value) { return Number(String(value).replace('px', '')); }

test('overlay visual: the focused tile lifts — hairline, sheen and scale, not a ring', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.apps = ['a', 'b', 'c'].map(id => ({ appId: id, appName: 'App ' + id }));
  v.overlay = true;
  v.overlayIndex = 1;
  const panel = overlayPanelOf(f, v);
  const cells = overlayCellsOf(panel);
  assert.equal(cells.length, 3);
  const focused = cells.find(n => n.data.attrs.tabindex === '0');
  const rest = cells.filter(n => n !== focused);
  assert.equal(focused.data.style.transform, 'scale(1.03)', 'the focused tile is lifted');
  assert.equal(focused.data.style.border, '1px solid rgba(255,255,255,0.22)',
    'a hairline at low alpha, not the 2px white ring');
  assert.equal(focused.data.style.boxShadow, '0 12px 28px rgba(0,0,0,0.5)', 'a soft shadow sells the depth');
  const washOf = cell => flatten(cell).find(n => n.data && n.data.style &&
    n.data.style.backgroundColor === 'rgba(255,255,255,0.10)');
  assert.ok(washOf(focused), 'the focused tile carries an inner sheen');
  for (const r of rest) {
    assert.equal(r.data.style.transform, 'scale(1)');
    assert.equal(r.data.style.border, '1px solid rgba(255,255,255,0.05)');
    assert.equal(r.data.style.boxShadow, '0 0 0 rgba(0,0,0,0)');
    assert.equal(washOf(r), undefined, 'unfocused tiles have no sheen');
  }
  assert.equal(flatten(panel).filter(n => n.data && n.data.style &&
    String(n.data.style.border || '').indexOf('2px solid #ffffff') >= 0).length, 0,
    'the white ring is gone from the overlay entirely');
  v.stop();
});

test('overlay visual: the header carries the count and the hint sits with it', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.apps = Array.from({ length: 12 }, (_, i) => ({ appId: String(i), appName: 'App ' + i }));
  v.overlay = true;
  v.overlayIndex = 0;
  const panel = overlayPanelOf(f, v);
  const texts = flatten(panel).flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(texts.includes('APPS'), 'the title');
  assert.ok(texts.includes(' \u00b7 12 apps'), 'the count rides after the title');
  const hint = flatten(panel).find(n => (n.children || []).includes('OK to open \u00b7 BACK to close'));
  assert.ok(hint, 'the hint renders');
  assert.equal(hint.data.style.fontSize, '16px', 'quieter than before');
  assert.equal(hint.data.style.fontWeight, '400');
  assert.equal(hint.data.style.left, '56px', 'on the header\'s left edge');
  assert.equal(hint.data.style.top, '64px', 'under the title, not floating at the right edge');
  // Grouped mode names the focused section in the title.
  const g = setup(), w = g.instance;
  w.start();
  w.apps = ['a', 'b', 'c', 'd'].map(id => ({ appId: id, appName: 'App ' + id }));
  w.prefs.groups = [{ name: 'Media', apps: ['a', 'b'] }, { name: 'Games', apps: ['c', 'd'] }];
  w.overlay = true;
  w.overlayIndex = 2; // c, in Media
  const gTexts = flatten(overlayPanelOf(g, w)).flatMap(n => n.children || []).filter(c => typeof c === 'string');
  assert.ok(gTexts.includes('Media'), 'the focused group names the header');
  assert.ok(gTexts.includes(' \u00b7 4 apps'), 'the count is the whole shown list');
  v.stop(); w.stop();
});

test('overlay visual: the grid gutters are equal at 1920', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.apps = Array.from({ length: 14 }, (_, i) => ({ appId: String(i), appName: 'App ' + i }));
  v.overlay = true;
  v.overlayIndex = 0;
  const cells = overlayCellsOf(overlayPanelOf(f, v));
  assert.equal(cells.length, 14, 'two full rows of seven');
  const lefts = cells.map(n => px(n.data.style.left));
  const tops = cells.map(n => px(n.data.style.top));
  const widths = cells.map(n => px(n.data.style.width));
  assert.ok(widths.every(w => w === 192), 'every tile is the derived 192px width');
  const row1 = lefts.slice(0, 7), row2 = lefts.slice(7);
  const gaps = row1.slice(1).map((l, i) => l - (row1[i] + widths[0]));
  assert.ok(gaps.every(g => g === 56), 'every gutter is 56 — equal to the panel padding');
  assert.equal(row1[0], 56, 'left margin equals the gutter');
  assert.equal(1792 - (row1[6] + widths[0]), 56, 'right margin equals the gutter — the grid is centred');
  assert.deepEqual(row2, row1, 'the second row sits on the same columns');
  assert.equal(tops[7] - tops[0], 160, 'rows sit on the 160px slot');
  v.stop();
});

test('overlay visual: a group heading gets more air above than the rows get between', () => {
  const f = setup(), v = f.instance;
  v.start();
  v.apps = ['a', 'b', 'c', 'd'].map(id => ({ appId: id, appName: 'App ' + id }));
  v.prefs.groups = [{ name: 'First', apps: ['a', 'b', 'c'] }, { name: 'Second', apps: ['d'] }];
  v.overlay = true;
  v.overlayIndex = 0;
  const panel = overlayPanelOf(f, v);
  const cells = overlayCellsOf(panel);
  const tops = cells.map(n => px(n.data.style.top));
  // First's three apps share one row — but the first slot in the panel is
  // First's own heading band (80), so the row starts at 96 + 80.
  assert.equal(tops[0], 176);
  assert.equal(tops[3], 96 + 80 + 160 + 80, 'the Second heading band (80) sits between the rows');
  const heading = flatten(panel).find(n => (n.children || []).includes('Second'));
  const headingTop = px(heading.data.style.top);
  const spaceAbove = headingTop - (tops[0] + 136); // tile height is 136
  const below = tops[3] - (headingTop + 24);
  assert.equal(spaceAbove, 64, 'the 24px row gap plus 40 more above the heading');
  assert.equal(below, 16, 'and less below it');
  const flatGap = 160 - 136;
  assert.ok(spaceAbove > flatGap, 'more space above the heading than the 24px gap between rows');
  v.stop();
});
