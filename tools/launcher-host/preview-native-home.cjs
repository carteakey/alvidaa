#!/usr/bin/env node
'use strict';
/* preview-native-home — the native Home in a browser, no TV (issue ffad3e3a).
 *
 *   node tools/launcher-host/preview-native-home.cjs [--port 8080]
 *   node tools/launcher-host/preview-native-home.cjs --out preview.html
 *
 * Every visual change today costs a deploy and a human looking at a TV — that
 * is why the last icon took five rounds. This serves (or writes) one self-
 * contained HTML page that runs the REAL component — the same
 * native-alvidaa.js the build ships, loaded the way native-alvidaa.test.cjs
 * loads it (stub `self`, stub SDK, fixture platform payload) — and renders
 * its own render(h) tree into real DOM with a ~30-line h→element function.
 * No framework, no bundler, no npm install.
 *
 * Why this works without Vue: the component is a plain object whose
 * render(h) is a pure function of its state; the tests already call it with
 * a stub h. The page re-calls render after every key, click and clock tick,
 * so preview redraw = full tree swap — state lives in the instance, not in
 * the DOM.
 *
 * Keyboard works like the TV: the component's own body keydown listener (the
 * one mounted() registers) walks the focus; the page only re-draws after it.
 * Nothing here reimplements navigation.
 *
 * The fixture drives it: six inputs with mixed signal state and the device
 * names a real living room reports, ~40 apps with the icon shapes the dock
 * actually shows (allowlisted inline icons, letter badges with brand
 * colours, and the entries the component filters out), the real
 * AlvidaaNativeDeviceArt rules the build bakes, and the real generated
 * wallpaper. A banner reads "stub preview — not device-verified" because a
 * laptop is not the engine: it paints SVG data URIs the TV refuses, it has
 * no vendor icon font, no real storeAppIcon files, and no Cobalt timing.
 * A preview is not verification; it only kills the deploy round trips for
 * design work.
 *
 * Exports are shaped for node:test with no browser: elementFrom() converts a
 * rendered tree into DOM-shaped objects, renderSnapshot() drives the fixture
 * instance, buildPage() produces the page text, and main() serves or writes
 * it.
 */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const deviceArt = require('./device-art.cjs');
const wallpaper = require('./wallpaper.cjs');

const HERE = __dirname;
const SOURCE = fs.readFileSync(path.join(HERE, 'native-alvidaa.js'), 'utf8');
const WALLPAPER_URI = 'data:image/png;base64,' + wallpaper.render().toString('base64');

const BANNER = 'stub preview — not device-verified';
// Same vendor keycodes the component's tests use.
const KEYS = { HOME: 36, LAUNCHER: 547, SOURCE: 515, KEYPAD_INPUT: 516,
  UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, ENTER: 13, BACK: 8, RETURN: 461,
  NUM_0: 48, NUM_1: 49, NUM_2: 50, NUM_3: 51, NUM_4: 52,
  NUM_5: 53, NUM_6: 54, NUM_7: 55, NUM_8: 56, NUM_9: 57 };
const EXIT = { OK: 0, USAGE: 2 };
const DEFAULT_PORT = 8080;

/* ---------------------------------------------------------------- usage -- */

class UsageError extends Error {
  constructor(message) { super(message); this.usage = true; }
}

function parse(argv) {
  const args = argv.slice(2);
  const opts = { port: DEFAULT_PORT, out: null, view: 'dock' };
  let i = 0;
  const need = name => {
    if (i >= args.length) throw new UsageError(name + ' needs a value');
    return args[i++];
  };
  while (i < args.length) {
    const arg = args[i++];
    if (arg === '--port') {
      opts.port = Number(need('--port'));
      if (!Number.isInteger(opts.port) || opts.port < 0) throw new UsageError('--port must be a non-negative integer');
    } else if (arg === '--out') opts.out = need('--out');
    else if (arg === '--view') {
      opts.view = need('--view');
      if (!VIEWS.includes(opts.view)) throw new UsageError('--view must be one of: ' + VIEWS.join(', '));
    } else if (arg === '--help') opts.help = true;
    else throw new UsageError('unknown flag: ' + arg);
  }
  return opts;
}

/* -------------------------------------------------------------- fixture -- */
/* The payload a real living room produces, mixed the way one actually is:
 * inputs with and without signal, named devices, a nameless port, apps with
 * allowlisted inline icons, apps that fall back to letter badges, and the
 * entries the component filters out. Device art is the REAL baked rules, so
 * the dock draws the same shapes the TV draws. */

/* A 96x96 rounded tile as a PNG data URI. The app-icon allowlist accepts
 * data:image/(png|jpeg|webp) but NOT svg+xml (that is the input-art rule, a
 * different parser path), so the fixture's icon'd apps carry generated PNGs —
 * no network, and the same <img>/background-image shape a storeAppIcon
 * download produces on the TV. */
function fixtureTilePng(hex) {
  const size = 96, radius = 18;
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    raw[row] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      const cx = Math.min(x, size - 1 - x), cy = Math.min(y, size - 1 - y);
      const inside = cx + cy > 0 && (cx >= radius || cy >= radius ||
        (radius - 1 - cx) * (radius - 1 - cx) + (radius - 1 - cy) * (radius - 1 - cy) < radius * radius);
      const at = row + 1 + x * 4;
      raw[at] = r; raw[at + 1] = g; raw[at + 2] = b; raw[at + 3] = inside ? 255 : 0;
    }
  }
  const table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })();
  const crc32 = buf => {
    let c = -1;
    for (const byte of buf) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // colour type: RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return 'data:image/png;base64,' + png.toString('base64');
}

function fixtureApps() {
  const named = [
    ['1', 'Netflix', fixtureTilePng('#b20710')],
    ['2', 'YouTube', fixtureTilePng('#c4302b')],
    ['3', 'Prime Video', fixtureTilePng('#17689c')],
    ['4', 'Disney+', fixtureTilePng('#113ccf')],
    ['5', 'Spotify', fixtureTilePng('#1db954')],
    ['6', 'Plex', fixtureTilePng('#e5a00d')]
  ];
  const bare = ['Twitch', 'Steam', 'Discord', 'Vimeo', 'Tubi', 'Pluto TV',
    'Crunchyroll', 'Kodi', 'Jellyfin', 'RetroArch', 'Dropbox', 'Weather',
    'Stocks', 'News', 'Podcasts', 'Calculator', 'Gallery', 'Media Player',
    'Browser', 'Files', 'Clock', 'Notes', 'Games', 'Music', 'Radio', 'Photos',
    'Cast', 'Screen Share', 'Help', 'Search'];
  const apps = named.map(([appId, appName, img]) => ({ appId, appName, img }));
  for (let i = 0; i < bare.length; i++) {
    apps.push({ appId: String(100 + i), appName: bare[i] });
  }
  // The entries the component filters: browser home, stock home, blank names.
  apps.push({ appId: 'vidaa-home', appName: 'Old browser home' });
  apps.push({ appId: '206', appName: 'Stock Home' });
  apps.push({ appId: '301', appName: '   ' });
  return apps;
}

function fixtureSources() {
  return [
    { sourceId: 0, name: 'TV', deviceName: 'TV', displayname2: 'TV', is_signal: '1' },
    { sourceId: 'HDMI2', name: 'HDMI2', deviceName: 'PlayStation 5', displayname2: 'PlayStation 5', is_signal: 0 },
    { sourceId: 'HDMI3', name: 'HDMI3', deviceName: 'Fire TV Stick', displayname2: 'Fire TV Stick', rename: 'Fire TV Stick', has_signal: '1' },
    { sourceId: 'HDMI4', name: 'HDMI4', deviceName: 'Nintendo Switch', displayname2: 'Nintendo Switch', is_signal: '1' },
    { sourceId: 'HDMI5', name: 'HDMI5', deviceName: 'Steam Machine', displayname2: 'Steam Machine', is_signal: 0 },
    { sourceId: 'HDMI6', name: 'HDMI6' }
  ];
}

function fixtureStorage() {
  return {
    alvidaa_favorites: JSON.stringify(['1', '5', '100']),
    // Groups (issue #57): the overlay renders these as headered sections plus
    // the automatic "Other apps" catch-all for everything unclaimed.
    alvidaa_groups: JSON.stringify([
      { name: 'Essentials', apps: ['1', '2', '3'] },
      { name: 'Media', apps: ['5', '6'] }
    ]),
    // Non-default preference values, so the settings layer shows real state
    // instead of every row at its factory default. No custom input names:
    // customNames outrank the reported device names in sourceName(), and this
    // fixture's device names are the living-room contract the dock must show.
    // Two hidden apps so the settings apps-page carries both row values —
    // Twitch sorts early enough to be inside the panel's first page (Search
    // pages out of view, and is hidden anyway as the far tail).
    alvidaa_auto_switch: 'true',
    alvidaa_idle_minutes: '5',
    alvidaa_hidden_apps: JSON.stringify(['100', '129'])
  };
}

function fixturePayload() {
  return { apps: fixtureApps(), sources: fixtureSources(), errors: [], waiting: false };
}

/* --------------------------------------------------------- layer views -- */
/* The layers a reviewer needs to see without pressing keys. Every state
 * change goes through the component's own public methods or its data object —
 * never a reimplementation — so the preview shows exactly what the TV shows
 * for the same state. Views are EXCLUSIVE by preview contract: the component
 * layers settings over a still-open overlay, but a reviewer asking for one
 * layer gets exactly that layer in the snapshot. Self-contained for
 * toString() embedding in the page. */
const VIEWS = ['dock', 'overlay', 'settings', 'settings-apps'];

function applyView(instance, view) {
  var v = instance;
  if (view === 'overlay') {
    v.settings = false;
    v.zone = 'apps';
    v.app = 0;
    v.openOverlay();
  } else if (view === 'settings') {
    v.overlay = false;
    v.openLauncherSettings();
  } else if (view === 'settings-apps') {
    v.overlay = false;
    v.openLauncherSettings();
    v.settingsPage = 'apps';
    v.settingsIndex = 0;
  } else { v.settings = false; v.overlay = false; v.zone = 'dock'; }
  return v;
}

/* ------------------------------------------------- loading the component -- */
/* Exactly the native-alvidaa.test.cjs harness, with the fixture standing in
 * for the platform payload and the REAL baked globals standing in for the
 * build. Timers are stubbed so a test never waits on the clock. */

function loadFixtureComponent(options = {}) {
  const calls = [];
  const timers = new Map();
  let next = 0;
  const bodyListeners = new Set();
  const root = {
    innerWidth: options.innerWidth || 1280,
    addEventListener() {}, removeEventListener() {},
    document: { body: {
      addEventListener(_name, fn) { bodyListeners.add(fn); },
      removeEventListener(_name, fn) { bodyListeners.delete(fn); }
    } }
  };
  const store = new Map(Object.entries(options.storage || fixtureStorage()));
  const sdk = {
    key: { KEYMAP: KEYS },
    storage: {
      get: key => store.get(key),
      set: (key, val) => { store.set(key, val); calls.push(['storage:set', key, val]); }
    },
    apc: { CMDMETHOD: { KEY_INPUT_START: 'input' } },
    router: { isCurrentPathEqualTo: () => true }
  };
  root._V_SDK_ = { vre: { SDK: () => sdk } };
  root.AlvidaaNativeDeviceArt = options.deviceArt || deviceArt.bundle();
  if (options.wallpaper !== null) root.AlvidaaNativeWallpaper = options.wallpaper || WALLPAPER_URI;
  root.AlvidaaNativePlatform = (_sdk, callback) => {
    return {
      start() { callback(options.payload || fixturePayload()); calls.push(['start']); },
      stop() { calls.push(['stop']); },
      refresh() { calls.push(['refresh']); },
      launchApp(id) { calls.push(['launch', String(id)]); },
      changeSource(id) { calls.push(['source', id]); },
      openSettings() { calls.push(['settings']); }
    };
  };
  vm.runInNewContext(SOURCE, {
    self: root,
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn, delay) { const id = ++next; timers.set(id, { fn, delay, every: true }); return id; },
    clearInterval(id) { timers.delete(id); }
  });
  const component = root.AlvidaaNativeHome(sdk);
  const instance = component.data();
  instance.$route = { query: {} };
  for (const [key, fn] of Object.entries(component.methods)) instance[key] = fn.bind(instance);
  component.mounted.call(instance);
  component.activated.call(instance);
  return { root, sdk, component, instance, calls, timers, bodyListeners, store };
}

/* ------------------------------------------- the h -> DOM-shaped objects -- */
/* The one conversion both the tests and the page use. Self-contained on
 * purpose: the page embeds this function's source with toString(). Numbers
 * resolve the way Vue's style binding does on the TV — px is appended except
 * for the unitless properties, so fontSize 116 renders as "116px" while
 * lineHeight stays unitless. */
function elementFrom(node) {
  const UNITLESS = { animationIterationCount: 1, columnCount: 1, fillOpacity: 1,
    flex: 1, flexGrow: 1, flexShrink: 1, fontWeight: 1, lineHeight: 1, opacity: 1,
    order: 1, stopOpacity: 1, strokeOpacity: 1, widows: 1, zIndex: 1, zoom: 1 };
  function resolve(key, value) {
    return typeof value === 'number' && !UNITLESS[key] ? value + 'px' : value;
  }
  if (node === null || node === undefined) return null;
  if (typeof node === 'string' || typeof node === 'number') return { text: String(node) };
  const data = node.data || {};
  const style = {};
  if (data.style) {
    for (const key of Object.keys(data.style)) style[key] = resolve(key, data.style[key]);
  }
  return {
    tag: node.tag,
    attributes: Object.assign({}, data.attrs),
    style,
    onClick: data.on && data.on.click ? data.on.click : null,
    children: (node.children || []).map(elementFrom).filter(Boolean)
  };
}

/* The materializer the page runs — the same specs, onto real elements. Kept
 * here (never called in Node) so the page embeds one implementation via
 * toString(); `redraw` is the boot script's draw(), passed in so clicks
 * re-render after the handler mutates state. */
function materialize(spec, redraw) {
  if (spec === null || spec === undefined) return document.createComment('');
  if (spec.text !== undefined) return document.createTextNode(spec.text);
  const el = document.createElement(spec.tag || 'div');
  for (const key of Object.keys(spec.attributes || {})) {
    el.setAttribute(key, String(spec.attributes[key]));
  }
  for (const key of Object.keys(spec.style || {})) {
    try { el.style[key] = spec.style[key]; } catch (_) { /* unknown property */ }
  }
  if (spec.onClick) {
    el.addEventListener('click', ev => { ev.preventDefault(); spec.onClick(ev); redraw(); });
  }
  for (const child of spec.children || []) el.appendChild(materialize(child, redraw));
  return el;
}

/* Static serialization for the --out/--serve snapshot: the page carries a
 * server-side render of the fixture state, so a screenshot tool (or a
 * browser with JS off) still shows the Home. */
function kebab(key) { return key.replace(/([A-Z])/g, '-$1').toLowerCase(); }

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlFrom(spec) {
  if (spec === null || spec === undefined) return '';
  if (spec.text !== undefined) return escapeHtml(spec.text);
  const attrs = [];
  for (const [key, value] of Object.entries(spec.attributes || {})) {
    attrs.push(' ' + kebab(key) + '="' + escapeHtml(value) + '"');
  }
  if (spec.style && Object.keys(spec.style).length) {
    const css = Object.entries(spec.style)
      .map(([key, value]) => kebab(key) + ': ' + String(value))
      .join('; ');
    attrs.push(' style="' + escapeHtml(css) + '"');
  }
  return '<' + (spec.tag || 'div') + attrs.join('') + '>' +
    (spec.children || []).map(htmlFrom).join('') +
    '</' + (spec.tag || 'div') + '>';
}

/* One render pass from the fixture instance, as DOM-shaped objects. render
 * lives on the component and is invoked with the instance as `this`, exactly
 * like native-alvidaa.test.cjs does it. */
function renderSnapshot(component, instance) {
  const h = (tag, data, children) => ({ tag, data, children });
  return elementFrom(component.render.call(instance, h));
}

/* ----------------------------------------------------------------- page -- */

function buildPage(options = {}) {
  const view = VIEWS.includes(options.view) ? options.view : 'dock';
  const { component, instance } = loadFixtureComponent({ innerWidth: options.innerWidth || 1280 });
  applyView(instance, view);
  const snapshot = htmlFrom(renderSnapshot(component, instance));
  const boot = '(function () {\n' +
    'var FIXTURE = ' + JSON.stringify(fixturePayload()) + ';\n' +
    'var STORAGE = ' + JSON.stringify(fixtureStorage()) + ';\n' +
    'var KEYS = ' + JSON.stringify(KEYS) + ';\n' +
    'var DEVICE_ART = ' + JSON.stringify(deviceArt.bundle()) + ';\n' +
    'var WALLPAPER = ' + JSON.stringify(WALLPAPER_URI) + ';\n' +
    'var sdk = { key: { KEYMAP: KEYS },\n' +
    '  storage: { get: function (k) { return STORAGE[k]; }, set: function (k, val) { STORAGE[k] = val; } },\n' +
    '  apc: { CMDMETHOD: { KEY_INPUT_START: "input" } },\n' +
    '  router: { isCurrentPathEqualTo: function () { return true; } } };\n' +
    'window._V_SDK_ = { vre: { SDK: function () { return sdk; } } };\n' +
    'window.AlvidaaNativeDeviceArt = DEVICE_ART;\n' +
    'window.AlvidaaNativeWallpaper = WALLPAPER;\n' +
    'window.AlvidaaNativePlatform = function (_sdk, callback) {\n' +
    '  return { start: function () { callback(FIXTURE); }, stop: function () {}, refresh: function () {},\n' +
    '    launchApp: function () {}, changeSource: function () {}, openSettings: function () {} };\n' +
    '};\n' +
    'var component = window.AlvidaaNativeHome(sdk);\n' +
    'var v = component.data();\n' +
    'v.$route = { query: {} };\n' +
    'Object.keys(component.methods).forEach(function (k) { v[k] = component.methods[k].bind(v); });\n' +
    'component.mounted.call(v);\n' +
    'component.activated.call(v);\n' +
    // Deep links: ?view=overlay, ?view=settings, ?view=settings-apps select the
    // layer without clicking; the baked default is the CLI --view (dock).
    'var requested = (String(location.search).match(/view=([a-z-]+)/) || [])[1] || ' +
    JSON.stringify(view) + ';\n' +
    applyView.toString() + '\n' +
    'applyView(v, requested);\n' +
    'var rootEl = document.getElementById("preview-root");\n' +
    'function h(tag, data, children) { return { tag: tag, data: data, children: children }; }\n' +
    elementFrom.toString() + '\n' +
    materialize.toString() + '\n' +
    'function draw() { rootEl.innerHTML = ""; rootEl.appendChild(materialize(elementFrom(component.render.call(v, h)), draw)); }\n' +
    // The component listens for the vendor's custom "key-down" event (mounted,
    // native-alvidaa.js:324) — real keypresses are "keydown" and never reach it,
    // so the page bridges them to handleKey itself (caught on the first real
    // browser pass: the redraw-only listener made keyboard a no-op). handleKey
    // returns whether it consumed the key; consumed keys preventDefault so
    // arrows and Enter never scroll the page.
    'document.addEventListener("keydown", function (e) {\n' +
    '  var handled = v.handleKey(e.keyCode);\n' +
    '  draw();\n' +
    '  if (handled) e.preventDefault();\n' +
    '});\n' +
    // The control strip is preview chrome, not the product: it drives the same
    // public state the deep links select, so a reviewer can walk layers with
    // the mouse and still screenshot exactly what the TV renders.
    'var strip = document.getElementById("preview-controls");\n' +
    'function setView(view) {\n' +
    '  applyView(v, view);\n' +
    '  Array.prototype.forEach.call(strip.querySelectorAll("[data-view]"), function (btn) {\n' +
    '    btn.className = btn.getAttribute("data-view") === view ? "pv-btn pv-on" : "pv-btn";\n' +
    '  });\n' +
    '  draw();\n' +
    '}\n' +
    'Array.prototype.forEach.call(strip.querySelectorAll("[data-view]"), function (btn) {\n' +
    '  btn.addEventListener("click", function () { setView(btn.getAttribute("data-view")); });\n' +
    '});\n' +
    'window.addEventListener("resize", function () { draw(); });\n' +
    'setInterval(draw, 1000);\n' +
    'setView(requested);\n' +
    '})();\n';
  return '<!doctype html>\n<html>\n<head>\n<meta charset="utf-8">\n' +
    '<title>alvidaa native Home — preview</title>\n' +
    '<style>\n' +
    'html, body { margin: 0; padding: 0; background: #07080c; height: 100%; overflow: hidden; }\n' +
    '#preview-controls { position: fixed; left: 0; right: 0; top: 0; z-index: 99;\n' +
    '  padding: 5px 14px; background: #10141c; color: #94a3b8;\n' +
    '  font: 600 12px/16px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }\n' +
    '.pv-btn { margin: 0 4px; padding: 3px 12px; background: #1c2530; color: #cbd5e1;\n' +
    '  border: 1px solid #334155; border-radius: 5px; cursor: pointer; font: inherit; }\n' +
    '.pv-btn.pv-on { background: #0ea5e9; color: #04121c; border-color: #0ea5e9; }\n' +
    '#preview-stage { position: absolute; left: 0; top: 27px; width: 100%;\n' +
    '  height: calc(100% - 27px - 30px); overflow: hidden; }\n' +
    '#preview-root { position: absolute; left: 0; top: 0; width: 100%; height: 100%; }\n' +
    '#preview-banner { position: fixed; left: 0; right: 0; bottom: 0; z-index: 99;\n' +
    '  padding: 6px 14px; background: #7f1d1d; color: #fecaca;\n' +
    '  font: 600 13px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;\n' +
    '  letter-spacing: 0.06em; text-transform: uppercase; }\n' +
    '</style>\n</head>\n<body>\n' +
    '<div id="preview-controls">view:\n' +
    '<button class="pv-btn" data-view="dock">Dock</button>\n' +
    '<button class="pv-btn" data-view="overlay">Apps overlay</button>\n' +
    '<button class="pv-btn" data-view="settings">Settings</button>\n' +
    '<button class="pv-btn" data-view="settings-apps">Settings · Apps</button>\n' +
    '</div>\n' +
    '<div id="preview-stage"><div id="preview-root">' + snapshot + '</div></div>\n' +
    '<div id="preview-banner">' + escapeHtml(BANNER) + '</div>\n' +
    '<script>\n' + SOURCE.replace(/<\/script/gi, '<\\/script') + '\n</script>\n' +
    '<script>\n' + boot + '</script>\n' +
    '</body>\n</html>\n';
}

/* ------------------------------------------------------------------ CLI -- */

function startServer(port, page) {
  return http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(page);
  }).listen(port);
}

function main(argv) {
  const opts = parse(argv);
  if (opts.help) {
    console.log('usage: node tools/launcher-host/preview-native-home.cjs [--port 8080] [--out file.html] [--view ' + VIEWS.join('|') + ']');
    console.log('');
    console.log('The native Home in a browser, no TV: same component, same render tree,');
    console.log('fixture payload, keyboard wired through the component\'s own handleKey.');
    console.log('Layers: --view or ?view= deep links (dock, overlay, settings, settings-apps);');
    console.log('the control strip in the page switches layers without clicking through.');
    console.log('A banner marks it "stub preview — not device-verified".');
    return EXIT.OK;
  }
  const page = buildPage({ innerWidth: 1280, view: opts.view });
  if (opts.out) {
    fs.writeFileSync(opts.out, page);
    console.log('written: ' + opts.out + ' (' + Buffer.byteLength(page) + ' bytes, view: ' + opts.view + ') — open it in a browser');
    return EXIT.OK;
  }
  const server = startServer(opts.port, page);
  server.on('listening', () => {
    console.log('preview on http://localhost:' + server.address().port +
      ' — ' + BANNER);
    console.log('deep links: /?view=overlay  /?view=settings  /?view=settings-apps');
  });
  return server;
}

if (require.main === module) {
  try {
    const started = main(process.argv);
    // Serving blocks by design; --out and --help fall through with a code.
    if (typeof started === 'number') process.exitCode = started;
  } catch (error) {
    console.error((error.usage ? 'usage: ' : 'error: ') + error.message);
    process.exitCode = error.usage ? EXIT.USAGE : 1;
  }
}

module.exports = {
  BANNER, KEYS, EXIT, UsageError, parse, VIEWS, applyView,
  fixtureApps, fixtureSources, fixtureStorage, fixturePayload,
  loadFixtureComponent, elementFrom, materialize, htmlFrom, renderSnapshot,
  buildPage, startServer, main, SOURCE, WALLPAPER_URI
};
