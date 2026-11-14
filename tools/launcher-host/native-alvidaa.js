/* alvidaa native Home: the canvas launcher's design as a Vue component.
 *
 * This is the alvidaa variant in lane 3, not a second product. It reuses the
 * shared scaffold: native-entry.js does the route swap, native-platform.js
 * supplies apps and inputs through the vendor SDK, and native-home.cjs
 * installs and restores. Only the design lives here.
 *
 * Design, ported from launcher/index.html r4 and tightened:
 *   - clock and date, top left
 *   - the inputs dock at the bottom edge, six tiles per page
 *   - the focused input's real name in large type above the dock, with a
 *     connected / no-signal line under it
 *   - one Apps tile that opens the app list as an overlay
 *   - a Settings tile that opens the real stock TV Settings
 *   - a Launcher door beside it that opens this component's own settings
 *     surface, writing the six preferences back through sdk.storage
 *
 * Two views, panned vertically like the canvas: view 1 is the dock, view 2 is
 * the apps row. No canvas, no iframe, no global CSS.
 *
 * Icons: local files first, then the vendor's own icon host. Anything else is
 * refused, so this never becomes a general web client. The wallpaper is a
 * build-time data URI (self.AlvidaaNativeWallpaper); when it is absent, as in
 * tests, the component falls back to CSS gradients.
 */
(function (root) {
  "use strict";
  var DOCK_SIZE = 264, DOCK_HEIGHT = 180, DOCK_GAP = 20, DOCK_PAGE = 6;
  // The overlay sits on an 8px grid (issue: visual pass). Seven columns at
  // 1080p is the measured density: labels were probed at the current type
  // size (22px, both host and TV-ish stacks) and the worst realistic name
  // measures 163px against a 192px tile — 176px usable — so 7 columns fit
  // with the existing 20-character ellipsis as the backstop for outliers
  // ("Chromecast built-in" measures 194px and ellipsizes). 1792-wide panel,
  // 7 columns, and 8px-grid gutters have exactly one solution: gutters equal
  // to the panel padding, 56 — one spacing value everywhere.
  var OVERLAY_COLS = 7, OVERLAY_CELL = 160, OVERLAY_PAD = 56, OVERLAY_GUTTER = 56;
  var ICON = 80;
  // The name editor's on-screen keyboard: A-Z then 0-9 as a six-column grid,
  // with the four action cells in the last row. Up/Down moves KB_COLS cells.
  var KB_COLS = 6;
  var KB_CELLS = (function () {
    var cells = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789".split("");
    cells.push("SPACE", "BACKSPACE", "CLEAR", "DONE");
    return cells;
  })();
  var NAME_MAX = 24;
  // Recently-used ordering (issue #55): alvidaa_recent maps app id -> last
  // launch epoch ms and is pruned to this many entries.
  var RECENT_MAX = 40;
  // Idle screen (issue #58): minutes of no key and no source change before
  // the Home fades to the clock-only layer. 0 is off, which is the default.
  var IDLE_STEPS = [0, 1, 5, 15];
  // Brand colours, so a letter badge reads as the app rather than as a random
  // hue. Only used when the build gives us no icon.
  var BRANDS = [
    [/netflix/i, "#b20710"],
    [/youtube/i, "#c4302b"],
    [/prime|amazon/i, "#17689c"],
    [/disney/i, "#113ccf"],
    [/spotify/i, "#1db954"],
    [/plex/i, "#e5a00d"],
    [/apple\s*tv/i, "#1d1d1f"],
    [/hulu/i, "#1ce783"],
    [/hbo|max\b/i, "#5b2c8d"],
    [/paramount/i, "#0064ff"],
    [/peacock/i, "#111111"],
    [/browser/i, "#3b82f6"],
    [/live\s*tv|tv\s*channels/i, "#0ea5e9"],
    [/settings/i, "#64748b"]
  ];

  function create(sdk) {
    var keys = (sdk && sdk.key && sdk.key.KEYMAP) || {};
    var numKeys = {};
    for (var d = 0; d <= 9; d++) {
      if (keys["NUM_" + d] != null) numKeys[keys["NUM_" + d]] = d;
    }

    function p2(n) { return (n < 10 ? "0" : "") + n; }
    function hue(value) {
      var h = 0, text = String(value || "");
      for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
      return h;
    }
    function brand(name) {
      var text = String(name || "");
      for (var i = 0; i < BRANDS.length; i++) {
        if (BRANDS[i][0].test(text)) return BRANDS[i][1];
      }
      return "hsl(" + hue(text) + ", 45%, 38%)";
    }
    function signalOf(input) {
      var value = input.is_signal != null ? input.is_signal : input.has_signal;
      return value === 1 || value === "1" || value === true;
    }
    function text(value) { return typeof value === "string" ? value.trim() : ""; }
    // Some builds wrap the icon URL in a data:image trampoline.
    function unwrap(value) {
      if (typeof value !== "string") return "";
      var marker = "iconDownload";
      if (value.indexOf("data:image") === 0 && value.indexOf(marker) >= 0) {
        return value.slice(value.indexOf(marker) + marker.length);
      }
      return value;
    }
    function allowedIcon(value) {
      if (!value) return "";
      if (/^(var\/local\/storeAppIcon\/|file:\/\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/i.test(value)) {
        return value;
      }
      // The vendor's own icon host only. This is what the stock launcher and
      // the 75U8QTUK port load; nothing else is fetched.
      if (/^https:\/\/([a-z0-9-]+\.)*vidaahub\.com\//i.test(value)) return value;
      return "";
    }
    function allowedInputArt(value) {
      if (typeof value !== "string" || !value) return "";
      // svg+xml is here for the bundled device silhouettes (device-art.cjs):
      // an SVG rendered in an <img> or a background-image cannot execute
      // script, the URI is still local (nothing is fetched), and it is ~700
      // bytes against a raster's kilobytes. Only the base64 form is accepted
      // — an unencoded data:image/svg+xml, URL is a different parser path
      // that this allowlist deliberately does not follow.
      if (/^(var\/local\/storeAppIcon\/|file:\/\/\/|\/(?!\/)|data:image\/(png|jpeg|webp|svg\+xml);base64,)/i.test(value)) {
        return value;
      }
      return "";
    }
    function readPref(key, fallback) {
      if (!sdk || !sdk.storage || typeof sdk.storage.get !== "function") return fallback;
      try {
        var raw = sdk.storage.get(key);
        if (raw === undefined || raw === null) return fallback;
        if (typeof raw === "string") {
          try {
            var parsed = JSON.parse(raw);
            return parsed !== undefined && parsed !== null ? parsed : fallback;
          } catch (_) {
            return raw;
          }
        }
        return raw;
      } catch (_) {
        return fallback;
      }
    }
    function writePref(key, val) {
      if (!sdk || !sdk.storage || typeof sdk.storage.set !== "function") return;
      try {
        sdk.storage.set(key, JSON.stringify(val));
      } catch (_) {}
    }
    function isTruthy(val) {
      return val === true || val === "true" || val === 1 || val === "1";
    }
    function inAppList(list, app) {
      if (!Array.isArray(list) || !list.length) return false;
      var id = String(app.appId).toLowerCase();
      var name = (app.appName || "").trim().toLowerCase();
      for (var i = 0; i < list.length; i++) {
        var item = String(list[i]).trim().toLowerCase();
        if (item === id || (name && item === name)) return true;
      }
      return false;
    }
    // Per-app tint (issue #56): the build bakes a dominant colour per icon,
    // luminance-capped at extraction (app-colours.cjs). The clamp here runs
    // too, because a map can also be hand-made — a white icon must never wash
    // the screen out regardless of where the map came from.
    var TINT_LUMINANCE_CAP = 0.5, TINT_MAX_OPACITY = 0.22;
    function luminanceOf(r, g, b) {
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
    }
    function clampTint(hex) {
      var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16),
        b = parseInt(hex.slice(5, 7), 16);
      var l = luminanceOf(r, g, b);
      if (!(l > TINT_LUMINANCE_CAP)) return hex.toLowerCase();
      var f = TINT_LUMINANCE_CAP / l;
      function pair(n) { var s = n.toString(16); return (s.length < 2 ? "0" : "") + s; }
      return "#" + pair(Math.floor(r * f)) + pair(Math.floor(g * f)) + pair(Math.floor(b * f));
    }

    return {
      name: "Launcher", // The shared shell's keep-alive list uses this name.
      data: function () {
        return {
          apps: [], sources: [],
          zone: "dock", dock: 0, app: 0,
          overlay: false, overlayIndex: 0,
          settings: false, settingsPage: "root", settingsIndex: 0,
          nameDraft: "", nameIndex: 0, nameSourceId: null,
          now: new Date(), width: (root && root.innerWidth) || 1920,
          toast: "", toastUntil: 0,
          idle: false, idleAt: 0, idleFade: 1,
          tintColour: "", tintOpacity: 0,
          autoSwitchId: null, autoSwitchName: "", autoSwitchAt: 0,
          activeArt: "", activeArtId: null,
          outgoingArt: "", outgoingArtId: null,
          artIncomingOpacity: 1,
          outgoingArtOpacity: 1,
          prefs: {
            hiddenApps: [], onlyApps: [], customNames: {}, lastUsed: null,
            autoSwitch: false, recentOrder: true, recent: {}, favorites: [],
            idleMinutes: 0, groups: []
          }
        };
      },
      mounted: function () { this.start(); },
      activated: function () { this.readPrefs(); this.start(); this.routeFocus(); },
      deactivated: function () { this.stop(); },
      beforeDestroy: function () { this.stop(); },
      watch: {
        "$route": function () { this.routeFocus(); },
        dock: function () { this.syncArt(); },
        app: function () { this.syncTint(); },
        zone: function () { this.syncTint(); }
      },
      methods: {
        readPrefs: function () {
          this.prefs = {
            hiddenApps: readPref("alvidaa_hidden_apps", []),
            onlyApps: readPref("alvidaa_only_apps", []),
            customNames: readPref("alvidaa_custom_names", {}),
            lastUsed: readPref("alvidaa_last_used", null),
            autoSwitch: isTruthy(readPref("alvidaa_auto_switch", false)),
            recentOrder: isTruthy(readPref("alvidaa_recent_order", true)),
            recent: readPref("alvidaa_recent", {}),
            favorites: readPref("alvidaa_favorites", []),
            idleMinutes: Number(readPref("alvidaa_idle_minutes", 0)) || 0,
            groups: readPref("alvidaa_groups", [])
          };
          if (this._lastData && this._lastData.apps) {
            this.apps = this.sortRecent(this.filterApps(this._lastData.apps));
          }
          this.clamp();
          // The favorites row the tint reads may have changed under us.
          this.syncTint();
        },
        filterApps: function (apps) {
          var vm = this;
          var hidden = vm.prefs && vm.prefs.hiddenApps;
          var only = vm.prefs && vm.prefs.onlyApps;
          return (apps || []).filter(function (app) {
            if (!app || app.appId == null || !text(app.appName)) return false;
            var aid = String(app.appId);
            if (aid === "vidaa-home" || aid === "206") return false;
            if (Array.isArray(only) && only.length) {
              return inAppList(only, app);
            }
            if (Array.isArray(hidden) && hidden.length) {
              return !inAppList(hidden, app);
            }
            return true;
          });
        },
        // Recently-used ordering (issue #55): the overlay lists launched apps
        // newest-first, from alvidaa_recent. Apps with no record keep their
        // existing relative order behind the recorded ones — they are not
        // dumped at the end in whatever order the engine's sort leaves them,
        // so the ranking is written out by original index instead of trusting
        // Array#sort to be stable (older engines in this family are not).
        sortRecent: function (apps) {
          var recent = this.prefs && this.prefs.recent;
          if (!this.prefs || !this.prefs.recentOrder || !recent ||
              typeof recent !== "object" || Array.isArray(recent)) return apps;
          var ranked = [];
          for (var i = 0; i < apps.length; i++) {
            ranked.push({
              app: apps[i],
              at: Number(recent[String(apps[i].appId)]) || 0,
              index: i
            });
          }
          ranked.sort(function (a, b) {
            if (a.at !== b.at) return b.at - a.at; // newest first
            return a.index - b.index;             // vendor order within a group
          });
          // Copy through concat(), not [], so the result stays in the same
          // realm as the list it re-orders (the test harness runs the
          // component in a vm and compares its arrays against host ones).
          var out = apps.concat();
          for (var j = 0; j < ranked.length; j++) out[j] = ranked[j].app;
          return out;
        },
        start: function () {
          this.readPrefs();
          if (this._running) return;
          this._running = true;
          var vm = this;
          this._platform = root.AlvidaaNativePlatform(sdk, function (data) {
            var firstPayload = !vm._payloadReceived;
            vm._payloadReceived = true;
            vm._lastData = data;
            vm.apps = vm.sortRecent(vm.filterApps(data.apps));
            vm.sources = data.sources.filter(function (input) {
              return input && input.sourceId != null;
            });
            // A source going live or dropping is presence too: it cancels the
            // idle screen and restarts the window. An unchanged payload does
            // not — the platform re-reports periodically, and re-arming on
            // every poll would mean the screen never idles at all.
            var liveKey = vm.sources.filter(signalOf).map(function (input) {
              return String(input.sourceId);
            }).join(",");
            if (firstPayload || liveKey !== vm._liveIds) {
              vm._liveIds = liveKey;
              vm.cancelIdle();
            }
            if (data.errors && data.errors.length) {
              vm.showToast(data.errors.join("; "));
            }
            vm.clamp();
            vm.syncArt();
            if (firstPayload && vm.prefs && vm.prefs.autoSwitch) {
              var liveSources = vm.sources.filter(signalOf);
              if (liveSources.length === 1) {
                vm.startAutoSwitch(liveSources[0]);
              }
            } else if (!firstPayload && vm.autoSwitchAt) {
              var live = vm.sources.filter(signalOf);
              if (live.length !== 1 || live[0].sourceId !== vm.autoSwitchId) {
                vm.cancelAutoSwitch();
              }
            }
          });
          this._platform.start();
          this._clock = setInterval(function () {
            vm.now = new Date();
            var nowMs = Date.now();
            if (vm.idleAt && !vm.idle && nowMs >= vm.idleAt) {
              vm.enterIdle();
            }
            if (vm.autoSwitchAt && nowMs >= vm.autoSwitchAt) {
              vm.triggerAutoSwitch();
            }
            if (vm.toast && nowMs >= vm.toastUntil) {
              vm.toast = "";
              vm.toastUntil = 0;
            }
          }, 1000);
          this._resize = function () { vm.width = (root && root.innerWidth) || 1920; };
          if (root.addEventListener) root.addEventListener("resize", this._resize);
          this.routeFocus();
          // Consume handled keys while bubbling, before document-level defaults.
          // Dialogs get first refusal; unrelated keys pass straight through.
          this._keyDown = function (event) {
            if (sdk.router.isCurrentPathEqualTo("/Launcher") && vm.handleKey(event.keyCode)) {
              event.stopPropagation();
              vm.announce();
            }
          };
          if (root.document && root.document.body) {
            root.document.body.addEventListener("key-down", this._keyDown);
          }
          root.AlvidaaNativeActive = this;
        },
        stop: function () {
          this._running = false;
          this._payloadReceived = false;
          if (this._platform) this._platform.stop();
          clearInterval(this._clock);
          if (this._autoSwitchTimer) {
            clearTimeout(this._autoSwitchTimer);
            this._autoSwitchTimer = null;
          }
          if (this._artTimer) {
            clearTimeout(this._artTimer);
            this._artTimer = null;
          }
          if (this._artTickTimer) {
            clearTimeout(this._artTickTimer);
            this._artTickTimer = null;
          }
          this.activeArt = "";
          this.activeArtId = null;
          this.outgoingArt = "";
          this.outgoingArtId = null;
          this.artIncomingOpacity = 1;
          this.outgoingArtOpacity = 1;
          this.autoSwitchAt = 0;
          this.autoSwitchId = null;
          this.autoSwitchName = "";
          this.idle = false;
          this.idleFade = 1;
          this.idleAt = 0;
          this._liveIds = "";
          this.tintColour = "";
          this.tintOpacity = 0;
          if (this._idleFadeTimer) {
            clearTimeout(this._idleFadeTimer);
            this._idleFadeTimer = null;
          }
          if (root.document && root.document.body) {
            root.document.body.removeEventListener("key-down", this._keyDown);
          }
          if (root.removeEventListener) root.removeEventListener("resize", this._resize);
          if (root.AlvidaaNativeActive === this) root.AlvidaaNativeActive = null;
        },
        routeFocus: function () {
          // The dock is the landing view, whether Home was pressed or an input
          // key brought us here. Smart focus lands on the port that is live.
          this.zone = "dock";
          this.overlay = false;
          this.closeSettings();
          this.dock = this.smartIndex();
          this.app = 0;
          this.syncArt();
          this.syncTint();
          // Arriving at the Home is presence: the idle window restarts.
          this.armIdle();
        },
        smartIndex: function () {
          for (var i = 0; i < this.sources.length; i++) {
            if (signalOf(this.sources[i])) return i;
          }
          var last = this.prefs && this.prefs.lastUsed;
          if (last != null && this.sources.length) {
            var lastStr = String(last);
            for (var j = 0; j < this.sources.length; j++) {
              if (String(this.sources[j].sourceId) === lastStr) return j;
            }
          }
          return 0;
        },
        sourceName: function (input) {
          // Custom names override vendor values: sourceId -> name/displayname2/rename.
          var custom = this.prefs && this.prefs.customNames;
          if (custom && typeof custom === "object") {
            var sid = input.sourceId != null ? String(input.sourceId) : "";
            if (sid && text(custom[sid])) return text(custom[sid]);
            var keys = [input.name, input.deviceName, input.displayname2, input.rename];
            for (var k = 0; k < keys.length; k++) {
              var val = text(keys[k]);
              if (!val) continue;
              if (text(custom[val.toLowerCase()])) return text(custom[val.toLowerCase()]);
              if (text(custom[val])) return text(custom[val]);
            }
          }
          // Same order as the bridge, but the field names differ by transport:
          // the vendor JS SDK (all-inputs.getAllInputsData) reports the device
          // as `deviceName`, while the MQTT sourcelist the bridge reads calls it
          // `displayname2`. Missing `deviceName` was why HDMI3 still read "HDMI3"
          // on the native Home while the canvas lane showed "Fire TV Stick"
          // (2026-11-10). Accept both.
          var label = text(input.deviceName) || text(input.displayname2) ||
            text(input.rename) || text(input.name) || String(input.sourceId);
          if (/^[A-Z]{2,4}[0-9]{4,}$/.test(label) && sdk.i18n && sdk.i18n.t) {
            try {
              var translated = sdk.i18n.t(label);
              if (translated && translated !== label) return translated;
            } catch (_) { return text(input.name) || label; }
            return text(input.name) || label;
          }
          return label;
        },
        appIcon: function (app) {
          var candidates = [app.img, app.presetImg, app.icon, app.appIcon,
            app.icon_local_url, app.iconLocalUrl, app.localIcon,
            app.httpIcon, app.icon_web_url];
          var icon = "";
          for (var i = 0; i < candidates.length && !icon; i++) {
            icon = allowedIcon(unwrap(candidates[i]));
          }
          return icon.indexOf("var/local/storeAppIcon/") === 0 ? "file:///hisenseUI/" + icon : icon;
        },
        // Per-app tint (issue #56): the baked map is keyed by icon basename,
        // because that is the part of the resolved icon the build could know.
        // A missing entry, a door tile, or a malformed value all mean "keep
        // the plain wash".
        appColourFor: function (icon) {
          var map = root.AlvidaaNativeAppColours;
          if (!map || typeof map !== "object" || !icon) return "";
          var value = String(icon);
          var base = value.slice(value.lastIndexOf("/") + 1);
          var colour = map[base] != null ? map[base] : map[value];
          if (typeof colour !== "string" || !/^#[0-9a-fA-F]{6}$/.test(colour)) return "";
          return clampTint(colour);
        },
        // The wash fades toward the focused favorite's colour and back to the
        // plain wash when focus has none. The layer stays mounted (opacity 0),
        // so both directions are ordinary CSS transitions — no tick needed.
        syncTint: function () {
          var colour = "";
          if (this.zone === "apps") {
            var item = this.appItems()[this.app];
            if (item && item.kind === "favorite") colour = this.appColourFor(item.icon);
          }
          if (colour) this.tintColour = colour;
          this.tintOpacity = colour ? 1 : 0;
        },
        dockItems: function () { return this.sources; },
        appItems: function () {
          var items = [];
          var favs = (this.prefs && this.prefs.favorites) || [];
          if (Array.isArray(favs)) {
            var count = 0, seen = {};
            for (var i = 0; i < favs.length && count < 5; i++) {
              var favId = String(favs[i]);
              if (seen[favId]) continue;
              seen[favId] = true;
              var app = null;
              for (var j = 0; j < this.apps.length; j++) {
                if (String(this.apps[j].appId) === favId) {
                  app = this.apps[j];
                  break;
                }
              }
              if (app) {
                items.push({
                  kind: "favorite",
                  appId: app.appId,
                  app: app,
                  label: app.appName,
                  // The real icon through the same allowlist as the overlay;
                  // the star is only what renders when appIcon() refuses.
                  icon: this.appIcon(app),
                  glyph: "\u2605",
                  sub: "Favorite"
                });
                count++;
              }
            }
          }
          items.push({
            kind: "apps", label: "Apps", glyph: "\u25A6",
            sub: this.apps.length ? this.apps.length + " apps" : ""
          });
          items.push({
            kind: "settings", label: "Settings", glyph: "\u2699", sub: "TV settings"
          });
          // Our own settings door, kept visually distinct from the stock one:
          // different glyph, label, sub-label and accent colour, because
          // mixing up "TV settings" and "Home settings" is a support burden.
          items.push({
            kind: "launcher", label: "Launcher", glyph: "\u2630",
            sub: "Home settings", accent: "#38bdf8"
          });
          return items;
        },
        dockStart: function () {
          var n = this.dockItems().length;
          if (n <= DOCK_PAGE) return 0;
          return Math.max(0, Math.min(this.dock - 2, n - DOCK_PAGE));
        },
        // --- groups in the apps overlay (issue #57) ---------------------------
        //
        // alvidaa_groups is an owner-curated array of { name, apps: [appId…] }
        // in sdk.storage; order is the array order, both for the groups and
        // for the apps inside each one — explicit curation outranks the
        // recently-used heuristic. Everything no group claims lands in an
        // automatic "Other apps" group, so the long tail has a home without
        // anyone curating it. Unset or empty config means the flat grid,
        // unchanged. There is no settings editor for this — the storage key
        // and the rendering are the deliverable (issue #57).
        appById: function (id) {
          var key = String(id);
          for (var i = 0; i < this.apps.length; i++) {
            if (String(this.apps[i].appId) === key) return this.apps[i];
          }
          return null;
        },
        overlayGroups: function () {
          var config = this.prefs && this.prefs.groups;
          if (!Array.isArray(config) || !config.length) return null;
          var lists = [], claimed = {};
          for (var i = 0; i < config.length; i++) {
            var entry = config[i];
            if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
            if (!text(entry.name)) continue;
            var ids = Array.isArray(entry.apps) ? entry.apps : [];
            var apps = [];
            for (var j = 0; j < ids.length; j++) {
              var app = this.appById(ids[j]);
              // First group to claim an app wins: one app, one focus position.
              if (app && !claimed[String(app.appId)]) {
                claimed[String(app.appId)] = true;
                apps.push(app);
              }
            }
            // A group whose apps all fail to resolve (stale ids, hidden apps)
            // renders nothing rather than an empty header.
            if (apps.length) lists.push({ name: text(entry.name), apps: apps });
          }
          var rest = [];
          for (var k = 0; k < this.apps.length; k++) {
            if (!claimed[String(this.apps[k].appId)]) rest.push(this.apps[k]);
          }
          if (rest.length) lists.push({ name: "Other apps", apps: rest });
          return lists.length ? lists : null;
        },
        // The list the overlay actually shows: the groups flattened, or the
        // plain grid when no config is set. Every overlay-path reader of
        // this.apps goes through here, so focus stays one linear path.
        overlayList: function () {
          var groups = this.overlayGroups();
          if (!groups) return this.apps;
          // Anchor on this.apps so the flattened list stays in the same realm
          // as the list it re-orders (see sortRecent: the test harness runs
          // the component in a vm and compares its arrays against host ones).
          var out = this.apps.slice(0, 0);
          for (var i = 0; i < groups.length; i++) out = out.concat(groups[i].apps);
          return out;
        },
        // Group boundaries over overlayList(): where each group starts and how
        // long it runs. Null when the flat grid is showing.
        overlaySpans: function () {
          var groups = this.overlayGroups();
          if (!groups) return null;
          var spans = [], start = 0;
          for (var i = 0; i < groups.length; i++) {
            spans.push({ name: groups[i].name, start: start, count: groups[i].apps.length });
            start += groups[i].apps.length;
          }
          return spans;
        },
        // Visual rows for the grouped render: a header slot per group, then
        // its apps chunked into OVERLAY_COLS-wide rows. Null when flat.
        overlayLayout: function () {
          var groups = this.overlayGroups();
          if (!groups) return null;
          var rows = [], index = 0;
          for (var g = 0; g < groups.length; g++) {
            rows.push({ header: groups[g].name });
            for (var i = 0; i < groups[g].apps.length; i += OVERLAY_COLS) {
              rows.push({ cells: groups[g].apps.slice(i, i + OVERLAY_COLS), start: index + i });
            }
            index += groups[g].apps.length;
          }
          return rows;
        },
        clamp: function () {
          var dockLen = this.dockItems().length;
          this.dock = dockLen > 0 ? Math.max(0, Math.min(this.dock, dockLen - 1)) : 0;
          var appLen = this.appItems().length;
          this.app = appLen > 0 ? Math.max(0, Math.min(this.app, appLen - 1)) : 0;
          var overlayLen = this.overlayList().length;
          this.overlayIndex = overlayLen > 0 ? Math.max(0, Math.min(this.overlayIndex, overlayLen - 1)) : 0;
          if (this.settings) {
            if (this.settingsPage === "name") {
              this.nameIndex = Math.max(0, Math.min(this.nameIndex, KB_CELLS.length - 1));
            } else {
              var rows = this.settingsRows();
              this.settingsIndex = rows.length ?
                Math.max(0, Math.min(this.settingsIndex, rows.length - 1)) : 0;
            }
          }
        },
        showToast: function (text, ms) {
          if (!text) return;
          this.toast = String(text);
          this.toastUntil = Date.now() + (typeof ms === "number" ? ms : 2500);
        },
        // Where the focused input's art lives in the map. The TV reports the
        // *name* of the device on a port but never per-source art, so config
        // keys are lowercased source names ("hdmi2") — match on more than
        // sourceId: the id first (build-time maps may still key by id), then
        // the port label the config keys are derived from, then the resolved
        // display name for people who key by "playstation 5".
        inputArtFor: function (input) {
          if (!input) return "";
          var artMap = root.AlvidaaNativeInputArt;
          var raw = null;
          if (artMap) {
            raw = artMap[String(input.sourceId)];
            if (raw == null) {
              var port = text(input.name).toLowerCase();
              if (port) raw = artMap[port];
            }
            if (raw == null) {
              var display = text(this.sourceName(input)).toLowerCase();
              if (display) raw = artMap[display];
            }
          }
          if (raw != null) return raw;
          // Background art is config-only. The bundled silhouettes are tile art
          // and must not be painted as a full-screen backdrop (they were, on
          // 2026-11-10: a 24px icon stretched across 1080p reads as nothing).
          return "";
        },
        deviceArtName: function (name) {
          var table = root.AlvidaaNativeDeviceArt;
          var label = text(name).toLowerCase();
          if (!label) return "";
          var rules = (table && table.rules) || [];
          for (var i = 0; i < rules.length; i++) {
            var pattern = null;
            try { pattern = new RegExp(rules[i][0], "i"); } catch (_) { pattern = null; }
            if (pattern && pattern.test(label)) return rules[i][1];
          }
          return (table && table.fallback) || "";
        },
        syncArt: function () {
          var artMap = root.AlvidaaNativeInputArt;
          if (!artMap) {
            this.activeArt = "";
            this.activeArtId = null;
            this.outgoingArt = "";
            this.outgoingArtId = null;
            this.artIncomingOpacity = 1;
            this.outgoingArtOpacity = 1;
            return;
          }
          var items = this.dockItems();
          var focusInput = items[this.dock];
          var rawArt = this.inputArtFor(focusInput);
          var targetArt = allowedInputArt(rawArt);
          var targetId = focusInput ? String(focusInput.sourceId) : null;

          if (targetId === this.activeArtId && targetArt === this.activeArt) return;

          if (this.activeArt && this.activeArt !== targetArt) {
            this.outgoingArt = this.activeArt;
            this.outgoingArtId = this.activeArtId;
            this.outgoingArtOpacity = 1;
            this.activeArt = targetArt;
            this.activeArtId = targetId;
            this.artIncomingOpacity = targetArt ? 0 : 1;
            if (this._artTickTimer) clearTimeout(this._artTickTimer);
            if (this._artTimer) clearTimeout(this._artTimer);
            var vm = this;
            if (typeof setTimeout === "function") {
              // With art on both sides the tick starts the incoming fade; with
              // an empty target it instead fades the outgoing layer out, so
              // the wallpaper arrives as a cross-fade instead of a cut.
              this._artTickTimer = setTimeout(function () {
                if (targetArt) vm.artIncomingOpacity = 1;
                else vm.outgoingArtOpacity = 0;
                vm._artTickTimer = null;
              }, 16);
            }
            if (typeof setTimeout === "function") {
              this._artTimer = setTimeout(function () {
                vm.outgoingArt = "";
                vm.outgoingArtId = null;
                vm.outgoingArtOpacity = 1;
                vm._artTimer = null;
              }, 300);
            }
          } else {
            this.activeArt = targetArt;
            this.activeArtId = targetId;
            this.artIncomingOpacity = 1;
          }
        },
        startAutoSwitch: function (input) {
          if (!input || input.sourceId == null) return;
          this.autoSwitchId = input.sourceId;
          this.autoSwitchName = this.sourceName(input);
          this.autoSwitchAt = Date.now() + 3500;
          var vm = this;
          if (typeof setTimeout === "function") {
            this._autoSwitchTimer = setTimeout(function () {
              vm.triggerAutoSwitch();
            }, 3500);
          }
        },
        triggerAutoSwitch: function () {
          if (!this.autoSwitchAt || this.autoSwitchId == null) return;
          var sid = this.autoSwitchId;
          this.autoSwitchAt = 0;
          this.autoSwitchId = null;
          this.autoSwitchName = "";
          if (this._autoSwitchTimer) {
            clearTimeout(this._autoSwitchTimer);
            this._autoSwitchTimer = null;
          }
          var vm = this;
          this.run(function () { return vm._platform.changeSource(sid); });
        },
        cancelAutoSwitch: function () {
          if (this.autoSwitchAt) {
            this.autoSwitchAt = 0;
            this.autoSwitchId = null;
            this.autoSwitchName = "";
            if (this._autoSwitchTimer) {
              clearTimeout(this._autoSwitchTimer);
              this._autoSwitchTimer = null;
            }
            this.showToast("auto-switch cancelled");
          }
        },
        // --- idle screen (issue #58) -----------------------------------------
        //
        // One deadline (idleAt), armed by anything that proves presence — a
        // key, a source change, a launch, arriving at the Home — and checked
        // by the clock interval that already runs every second, so there is
        // no second interval. While the idle layer is up, handleKey consumes
        // every key: the wake key must only wake, never also activate what it
        // lands on.
        armIdle: function () {
          var minutes = this.prefs ? Number(this.prefs.idleMinutes) || 0 : 0;
          this.idleAt = minutes > 0 ? Date.now() + minutes * 60000 : 0;
          return this.idleAt;
        },
        enterIdle: function () {
          if (this.idle || !this.idleAt) return;
          this.idle = true;
          this.idleAt = 0;
          this.idleFade = 0;
          var vm = this;
          if (typeof setTimeout === "function") {
            // Same trick as the art cross-fade: paint at opacity 0, then flip
            // on a tick so the transition actually runs.
            this._idleFadeTimer = setTimeout(function () {
              vm.idleFade = 1;
              vm._idleFadeTimer = null;
            }, 16);
          } else {
            this.idleFade = 1;
          }
        },
        cancelIdle: function () {
          // The wake path and the source-change path both come through here:
          // drop the layer and re-arm the window with the current setting.
          if (this._idleFadeTimer) {
            clearTimeout(this._idleFadeTimer);
            this._idleFadeTimer = null;
          }
          this.idle = false;
          this.idleFade = 1;
          return this.armIdle();
        },
        cycleIdle: function (dir) {
          var at = IDLE_STEPS.indexOf(Number(this.prefs.idleMinutes) || 0);
          if (at < 0) at = 0;
          writePref("alvidaa_idle_minutes",
            IDLE_STEPS[(at + (dir < 0 ? IDLE_STEPS.length - 1 : 1)) % IDLE_STEPS.length]);
          this.readPrefs();
          // Re-arm with the new value; stepping to off wakes the screen.
          return this.cancelIdle();
        },
        run: function (action) {
          var vm = this;
          try {
            var result = action();
            if (result && typeof result.then === "function") {
              result.catch(function (error) { vm.showToast("Action failed: " + error.message); });
            }
          } catch (error) { this.showToast("Action failed: " + error.message); }
        },
        openOverlay: function () {
          if (!this.apps.length) { this.showToast("No apps reported"); return; }
          this.overlay = true;
          this.overlayIndex = 0;
        },
        closeOverlay: function () { this.overlay = false; },
        openLauncherSettings: function () {
          this.settings = true;
          this.settingsPage = "root";
          this.settingsIndex = 0;
          this.nameDraft = "";
          this.nameIndex = 0;
          this.nameSourceId = null;
        },
        closeSettings: function () {
          this.settings = false;
          this.settingsPage = "root";
          this.settingsIndex = 0;
          this.nameDraft = "";
          this.nameIndex = 0;
          this.nameSourceId = null;
        },
        // Every valid reported app, unfiltered by preferences: the settings
        // list must show hidden apps or there would be no way to unhide them.
        allApps: function () {
          var raw = this._lastData && this._lastData.apps;
          return (raw || []).filter(function (app) {
            if (!app || app.appId == null || !text(app.appName)) return false;
            var aid = String(app.appId);
            return aid !== "vidaa-home" && aid !== "206";
          });
        },
        appVisible: function (app) {
          var only = this.prefs && this.prefs.onlyApps;
          var hidden = this.prefs && this.prefs.hiddenApps;
          if (Array.isArray(only) && only.length) return inAppList(only, app);
          if (Array.isArray(hidden) && hidden.length) return !inAppList(hidden, app);
          return true;
        },
        // The focused page's rows, rebuilt on every read so the labels follow
        // the preferences. Rows carry `speak` when the spoken form should be
        // richer than the label.
        settingsRows: function () {
          var vm = this, rows = [];
          if (this.settingsPage === "name") return rows;
          if (this.settingsPage === "apps") {
            var favs = (this.prefs && this.prefs.favorites) || [];
            this.allApps().forEach(function (app) {
              var visible = vm.appVisible(app);
              var pinned = inAppList(favs, app);
              rows.push({
                kind: "app", app: app,
                label: (pinned ? "\u2605 " : "") + app.appName,
                value: visible ? "shown" : "hidden",
                speak: app.appName + ", " + (visible ? "shown" : "hidden") +
                  (pinned ? ", pinned" : "")
              });
            });
            return rows;
          }
          if (this.settingsPage === "inputs") {
            this.sources.forEach(function (input) {
              if (!input || input.sourceId == null) return;
              var custom = vm.prefs && vm.prefs.customNames &&
                text(vm.prefs.customNames[String(input.sourceId)]);
              rows.push({
                kind: "input", input: input,
                label: vm.sourceName(input),
                value: custom ? "custom" : "",
                sub: String(input.sourceId),
                speak: vm.sourceName(input) + (custom ? ", custom name" : "")
              });
              // Reset only makes sense where a custom name can be undone.
              if (custom) {
                rows.push({
                  kind: "reset-name", input: input,
                  label: "Reset name", sub: "clears the custom name",
                  speak: "Reset name for " + vm.sourceName(input)
                });
              }
            });
            return rows;
          }
          var total = this.allApps().length, customCount = 0;
          this.sources.forEach(function (input) {
            if (vm.prefs && vm.prefs.customNames &&
                text(vm.prefs.customNames[String(input.sourceId)])) customCount++;
          });
          rows.push({
            kind: "autoswitch", label: "Auto-switch on boot",
            value: this.prefs.autoSwitch ? "on" : "off",
            speak: "Auto-switch on boot, " + (this.prefs.autoSwitch ? "on" : "off")
          });
          rows.push({
            kind: "open-apps", label: "Apps",
            sub: this.apps.length + " shown, " + (total - this.apps.length) + " hidden"
          });
          rows.push({
            kind: "open-inputs", label: "Input names",
            sub: this.sources.length + " inputs" +
              (customCount ? " \u00b7 " + customCount + " renamed" : "")
          });
          var only = this.prefs && this.prefs.onlyApps;
          if (Array.isArray(only) && only.length) {
            rows.push({
              kind: "only-list", label: "Only-list active",
              sub: "overrides hidden apps \u00b7 OK clears it",
              speak: "Only-list active, overrides hidden apps"
            });
          }
          rows.push({
            kind: "idle", label: "Idle screen",
            value: this.prefs.idleMinutes > 0 ? this.prefs.idleMinutes + " min" : "off",
            speak: "Idle screen, " +
              (this.prefs.idleMinutes > 0 ? this.prefs.idleMinutes + " minutes" : "off")
          });
          rows.push({
            kind: "recent", label: "Recently-used order",
            sub: "sorts the apps overlay by launch time",
            value: this.prefs.recentOrder ? "on" : "off",
            speak: "Recently used order, " + (this.prefs.recentOrder ? "on" : "off")
          });
          return rows;
        },
        toggleAutoSwitch: function () {
          writePref("alvidaa_auto_switch", !this.prefs.autoSwitch);
          this.readPrefs();
        },
        // Every launchApp goes through here first: stamp alvidaa_recent so the
        // overlay can order by it, pruning to the newest RECENT_MAX entries.
        // With the ordering toggled off the feature is off entirely — nothing
        // is recorded either, so re-enabling starts from vendor order instead
        // of replaying launches made while it was off.
        recordLaunch: function (appId) {
          if (appId == null || !this.prefs.recentOrder) return;
          var recent = readPref("alvidaa_recent", {});
          if (!recent || typeof recent !== "object" || Array.isArray(recent)) recent = {};
          recent[String(appId)] = Date.now();
          var ids = Object.keys(recent);
          if (ids.length > RECENT_MAX) {
            ids.sort(function (a, b) { return recent[a] - recent[b]; });
            while (ids.length > RECENT_MAX) delete recent[ids.shift()];
          }
          writePref("alvidaa_recent", recent);
          this.prefs.recent = recent;
          // Re-rank the list in place rather than going through readPrefs():
          // a launch record changes no visibility, and re-filtering from the
          // last payload here would reset the overlay list mid-launch.
          this.apps = this.sortRecent(this.apps);
        },
        toggleRecentOrder: function () {
          writePref("alvidaa_recent_order", !this.prefs.recentOrder);
          this.readPrefs();
        },
        toggleAppVisible: function (app) {
          if (!app || app.appId == null) return;
          var only = this.prefs && this.prefs.onlyApps;
          if (Array.isArray(only) && only.length && !inAppList(only, app)) {
            // Writing the hidden list would be a silent no-op while the
            // only-list governs visibility; say so instead of pretending.
            this.showToast("the only-list overrides visibility");
            return;
          }
          var hidden = Array.isArray(this.prefs.hiddenApps) ? this.prefs.hiddenApps.slice() : [];
          var id = String(app.appId).toLowerCase();
          var name = (app.appName || "").trim().toLowerCase();
          var keep = [];
          for (var i = 0; i < hidden.length; i++) {
            var entry = String(hidden[i]).trim().toLowerCase();
            if (entry === id || (name && entry === name)) continue;
            keep.push(hidden[i]);
          }
          if (this.appVisible(app)) keep.push(String(app.appId));
          writePref("alvidaa_hidden_apps", keep);
          this.readPrefs();
        },
        togglePin: function (app) {
          if (!app || app.appId == null) return;
          var favs = Array.isArray(this.prefs.favorites) ? this.prefs.favorites.slice() : [];
          var id = String(app.appId);
          var at = -1;
          for (var i = 0; i < favs.length; i++) {
            if (String(favs[i]) === id) { at = i; break; }
          }
          if (at >= 0) favs.splice(at, 1);
          else {
            // Refuse loudly rather than silently dropping the pin.
            if (favs.length >= 5) { this.showToast("favorites are full"); return; }
            favs.push(id);
          }
          writePref("alvidaa_favorites", favs);
          this.readPrefs();
        },
        clearOnlyList: function () {
          writePref("alvidaa_only_apps", []);
          this.readPrefs();
        },
        openNameEditor: function (input) {
          if (!input || input.sourceId == null) return;
          this.settingsPage = "name";
          this.nameSourceId = input.sourceId;
          var custom = this.prefs && this.prefs.customNames;
          var seed = custom ? text(custom[String(input.sourceId)]) : "";
          this.nameDraft = seed || "";
          this.nameIndex = 0;
        },
        closeNameEditor: function () {
          this.settingsPage = "inputs";
          this.nameDraft = "";
          this.nameIndex = 0;
          this.nameSourceId = null;
          this.clamp();
        },
        commitNameDraft: function () {
          var sid = this.nameSourceId;
          if (sid == null) { this.closeNameEditor(); return; }
          var trimmed = String(this.nameDraft || "").trim();
          var names = readPref("alvidaa_custom_names", {});
          if (!names || typeof names !== "object" || Array.isArray(names)) names = {};
          // A blank draft means "back to the vendor name": delete the key,
          // never store an empty string.
          if (trimmed) names[String(sid)] = trimmed;
          else delete names[String(sid)];
          writePref("alvidaa_custom_names", names);
          this.settingsPage = "inputs";
          this.nameDraft = "";
          this.nameIndex = 0;
          this.nameSourceId = null;
          this.readPrefs();
        },
        resetName: function (input) {
          if (!input || input.sourceId == null) return;
          var names = readPref("alvidaa_custom_names", {});
          if (names && typeof names === "object" && !Array.isArray(names)) {
            delete names[String(input.sourceId)];
            writePref("alvidaa_custom_names", names);
          }
          this.readPrefs();
        },
        kbPress: function () {
          var cell = KB_CELLS[this.nameIndex];
          if (!cell) return;
          if (cell === "DONE") { this.commitNameDraft(); return; }
          if (cell === "BACKSPACE") { this.nameDraft = this.nameDraft.slice(0, -1); return; }
          if (cell === "CLEAR") { this.nameDraft = ""; return; }
          if (this.nameDraft.length >= NAME_MAX) {
            this.showToast(NAME_MAX + " characters max");
            return;
          }
          this.nameDraft += cell === "SPACE" ? " " : cell;
        },
        activateSettingsRow: function () {
          var row = this.settingsRows()[this.settingsIndex];
          if (!row) return;
          if (row.kind === "autoswitch") this.toggleAutoSwitch();
          else if (row.kind === "recent") this.toggleRecentOrder();
          else if (row.kind === "idle") this.cycleIdle(1);
          else if (row.kind === "open-apps") { this.settingsPage = "apps"; this.settingsIndex = 0; this.clamp(); }
          else if (row.kind === "open-inputs") { this.settingsPage = "inputs"; this.settingsIndex = 0; this.clamp(); }
          else if (row.kind === "only-list") this.clearOnlyList();
          else if (row.kind === "app") this.toggleAppVisible(row.app);
          else if (row.kind === "input") this.openNameEditor(row.input);
          else if (row.kind === "reset-name") this.resetName(row.input);
        },
        nudgeSettingsRow: function (dir) {
          var row = this.settingsRows()[this.settingsIndex];
          if (!row) return;
          // Left/Right change a value: the auto-switch and recently-used
          // toggles, the pin, and the idle timeout, which steps through
          // off / 1 / 5 / 15 in the direction pressed.
          if (row.kind === "autoswitch") this.toggleAutoSwitch();
          else if (row.kind === "recent") this.toggleRecentOrder();
          else if (row.kind === "app") this.togglePin(row.app);
          else if (row.kind === "idle") this.cycleIdle(dir);
        },
        handleSettingsKey: function (code) {
          if (this.settingsPage === "name") {
            if (code === keys.BACK || code === keys.RETURN) { this.closeNameEditor(); return true; }
            if (code === keys.ENTER) { this.kbPress(); return true; }
            if (code === keys.LEFT) { this.nameIndex--; this.clamp(); return true; }
            if (code === keys.RIGHT) { this.nameIndex++; this.clamp(); return true; }
            if (code === keys.UP) { this.nameIndex -= KB_COLS; this.clamp(); return true; }
            if (code === keys.DOWN) { this.nameIndex += KB_COLS; this.clamp(); return true; }
            return false;
          }
          if (code === keys.BACK || code === keys.RETURN) {
            // Sub-pages hand Back to their parent; the root page closes the
            // layer. Back at the dock still belongs to the vendor.
            if (this.settingsPage !== "root") {
              this.settingsPage = "root";
              this.clamp();
              return true;
            }
            this.closeSettings();
            return true;
          }
          if (code === keys.ENTER) { this.activateSettingsRow(); return true; }
          if (code === keys.UP) { this.settingsIndex--; this.clamp(); return true; }
          if (code === keys.DOWN) { this.settingsIndex++; this.clamp(); return true; }
          if (code === keys.LEFT) { this.nudgeSettingsRow(-1); return true; }
          if (code === keys.RIGHT) { this.nudgeSettingsRow(1); return true; }
          // Unhandled keys (digits included) pass through, same contract as
          // the apps overlay.
          return false;
        },
        activate: function () {
          var vm = this;
          // A launch or switch cancels the idle screen even on the paths that
          // bypass the key handler (the tiles' click handlers).
          this.cancelIdle();
          if (this.zone === "dock") {
            var input = this.dockItems()[this.dock];
            if (!input) return;
            if (this.prefs) this.prefs.lastUsed = input.sourceId;
            writePref("alvidaa_last_used", input.sourceId);
            this.showToast("Switching to " + this.sourceName(input) + "…");
            this.run(function () { return vm._platform.changeSource(input.sourceId); });
            return;
          }
          var item = this.appItems()[this.app];
          if (!item) return;
          if (item.kind === "favorite") {
            this.showToast("Opening " + (item.label || "app") + "…");
            this.recordLaunch(item.appId);
            this.run(function () { return vm._platform.launchApp(item.appId); });
          } else if (item.kind === "apps") {
            this.openOverlay();
          } else if (item.kind === "launcher") {
            this.openLauncherSettings();
          } else {
            this.showToast("Opening " + item.label + "…");
            this.run(function () { return vm._platform.openSettings(); });
          }
        },
        launchFocused: function () {
          var vm = this, app = this.overlayList()[this.overlayIndex];
          if (!app) return;
          this.cancelIdle();
          this.showToast("Opening " + (app.appName || "app") + "…");
          this.recordLaunch(app.appId);
          this.run(function () { return vm._platform.launchApp(app.appId); });
          this.closeOverlay();
        },
        announce: function () {
          if (!sdk.tts || !sdk.tts.isEnable() || !sdk.router.isCurrentPathEqualTo("/Launcher")) return;
          var label;
          if (this.settings) {
            if (this.settingsPage === "name") {
              label = KB_CELLS[this.nameIndex];
            } else {
              var row = this.settingsRows()[this.settingsIndex];
              label = row && (row.speak || row.label);
            }
          } else if (this.overlay) {
            var app = this.overlayList()[this.overlayIndex];
            label = app && app.appName;
          } else if (this.zone === "dock") {
            var input = this.dockItems()[this.dock];
            label = input && this.sourceName(input);
          } else {
            var item = this.appItems()[this.app];
            label = item && item.label;
          }
          if (label) sdk.tts.speak(label);
        },
        handleKey: function (code) {
          if (this.idle) {
            // The wake key must only wake. Consume it: change nothing, launch
            // nothing — a wake that also activates whatever it landed on is
            // worse than no idle screen. Every keypress, digits included,
            // comes through here while the layer is up.
            this.cancelIdle();
            return true;
          }
          // Presence: any key restarts the idle window, handled or not.
          this.armIdle();
          if (this.settings) {
            var handled = this.handleSettingsKey(code);
            // A key consumed by the settings layer still proves the user is
            // present, so the boot countdown must not fire mid-navigation.
            if (handled && this.autoSwitchAt) this.cancelAutoSwitch();
            return handled;
          }
          if (this.overlay) {
            if (code === keys.BACK || code === keys.RETURN) { this.closeOverlay(); return true; }
            if (code === keys.ENTER) { this.launchFocused(); return true; }
            var spans = this.overlaySpans();
            if (spans) {
              // Grouped navigation (issue #57): still one focus path over the
              // flattened groups. Left/Right step within the group and stop at
              // its ends; Up/Down step between groups, landing on the same
              // offset clamped to the target group's length. Every key here is
              // consumed, even when it cannot move.
              var group = 0, offset = 0;
              for (var s = 0; s < spans.length; s++) {
                if (this.overlayIndex < spans[s].start + spans[s].count) {
                  group = s;
                  offset = this.overlayIndex - spans[s].start;
                  break;
                }
              }
              if (code === keys.LEFT) { if (offset > 0) this.overlayIndex--; }
              else if (code === keys.RIGHT) { if (offset < spans[group].count - 1) this.overlayIndex++; }
              else if (code === keys.UP) {
                if (group > 0) {
                  var up = spans[group - 1];
                  this.overlayIndex = up.start + Math.min(offset, up.count - 1);
                }
              }
              else if (code === keys.DOWN) {
                if (group < spans.length - 1) {
                  var down = spans[group + 1];
                  this.overlayIndex = down.start + Math.min(offset, down.count - 1);
                }
              }
              else return false;
              this.clamp();
              return true;
            }
            if (code === keys.LEFT) this.overlayIndex--;
            else if (code === keys.RIGHT) this.overlayIndex++;
            else if (code === keys.UP) this.overlayIndex -= OVERLAY_COLS;
            else if (code === keys.DOWN) this.overlayIndex += OVERLAY_COLS;
            else return false;
            this.clamp();
            return true;
          }
          var isNum = Object.prototype.hasOwnProperty.call(numKeys, code);
          var isNav = (code === keys.ENTER || code === keys.DOWN || code === keys.UP ||
            code === keys.LEFT || code === keys.RIGHT || code === keys.BACK || code === keys.RETURN);
          if (this.autoSwitchAt && (isNum || isNav)) {
            this.cancelAutoSwitch();
            return true;
          }
          if (Object.prototype.hasOwnProperty.call(numKeys, code)) {
            var digit = numKeys[code];
            if (this.zone === "dock") {
              var dock = this.dockItems();
              if (digit === 0) {
                if (dock.length > 0) {
                  this.dock = 0;
                  this.clamp();
                  this.syncArt();
                  return true;
                }
                return false;
              }
              var idx = digit - 1;
              if (idx < dock.length) {
                this.dock = idx;
                this.clamp();
                this.syncArt();
                this.activate();
                return true;
              }
              return false;
            }
          }
          if (code === keys.BACK || code === keys.RETURN) {
            // Back closes our own layers, then belongs to the vendor again.
            if (this.zone === "apps") { this.zone = "dock"; return true; }
            return false;
          }
          if (code === keys.ENTER) { this.activate(); return true; }
          if (code === keys.DOWN) { this.zone = "apps"; this.app = 0; return true; }
          if (code === keys.UP) {
            if (this.zone === "apps") { this.zone = "dock"; return true; }
            return false;
          }
          if (code === keys.LEFT) {
            if (this.zone === "dock") this.dock--;
            else this.app--;
          } else if (code === keys.RIGHT) {
            if (this.zone === "dock") this.dock++;
            else this.app++;
          } else return false;
          this.clamp();
          if (this.zone === "dock") this.syncArt();
          return true;
        }
      },
      render: function (h) {
        var vm = this;
        var scale = (this.width || 1920) / 1920;
        var days = ["SUNDAY", "MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY"];
        var months = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY",
          "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];
        var dateText = days[this.now.getDay()] + " \u00b7 " + months[this.now.getMonth()] + " " + this.now.getDate();

        function box(x, y, w, height, more) {
          var style = { position: "absolute", left: x * scale + "px", top: y * scale + "px" };
          if (w != null) style.width = w * scale + "px";
          if (height != null) style.height = height * scale + "px";
          Object.keys(more || {}).forEach(function (key) {
            style[key] = typeof more[key] === "number" ? more[key] * scale + "px" : more[key];
          });
          return style;
        }
        function label(x, y, size, value, color, weight) {
          return h("div", { style: box(x, y, null, null, {
            fontSize: size, lineHeight: size + 4, color: color, fontWeight: String(weight || 500)
          }) }, [value]);
        }

        // ---- the idle layer (issue #58) -------------------------------------
        // The whole tree while it is up: wallpaper, a large clock, the date —
        // no dock, no chrome, no HUD. State underneath is untouched, so wake
        // puts back exactly what was there. The fade-in paints at opacity 0
        // over the near-black root, then flips on a tick so the transition
        // runs. Shapes and text only: this engine paints neither SVG data
        // URIs nor the vendor icon font outside its own components (findings
        // 13 section 8), so beyond the build-time wallpaper this is divs.
        if (this.idle) {
          var idleWallpaper = root.AlvidaaNativeWallpaper;
          return h("div", {
            attrs: { id: "alvidaa-native", "data-idle-screen": "true",
              "aria-label": "Idle screen" },
            style: {
              position: "absolute", left: "0", top: "0", width: "100%",
              height: "100%", overflow: "hidden", backgroundColor: "#07080c",
              color: "#f8fafc", opacity: this.idleFade,
              transition: "opacity 500ms ease-out",
              fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
            }
          }, [
            idleWallpaper ? h("div", { style: {
              position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
              backgroundImage: "url(" + JSON.stringify(idleWallpaper) + ")",
              backgroundSize: "cover", backgroundPosition: "center"
            } }) : h("div", { style: {
              position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
              pointerEvents: "none",
              backgroundImage: "linear-gradient(180deg, rgba(56,189,248,0.06), rgba(99,102,241,0.02) 40%, rgba(7,8,12,0) 70%)"
            } }),
            h("div", { style: {
              position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
              pointerEvents: "none", backgroundColor: "rgba(6,8,12,0.55)"
            } }),
            h("div", { style: box(0, 380, 1920, null, {
              textAlign: "center", fontSize: 224, lineHeight: 232,
              fontWeight: "300", letterSpacing: "-4px"
            }) }, [
              h("span", { style: { color: "#ffffff" } }, [p2(this.now.getHours())]),
              h("span", { style: { color: "rgba(255,255,255,0.35)" } }, [":"]),
              h("span", { style: { color: "rgba(255,255,255,0.92)" } }, [p2(this.now.getMinutes())])
            ]),
            h("div", { style: box(0, 660, 1920, null, {
              textAlign: "center", fontSize: 30, lineHeight: 38,
              color: "#8e9ab0", fontWeight: "600", letterSpacing: "2px"
            }) }, [dateText])
          ]);
        }

        // Device icons drawn as divs. This engine does not paint SVG data URIs
        // in an <img> or a background-image, and the vendor icon-font class does
        // not paint outside the vendor's own components (all three measured
        // 2026-11-10/11 against the reference TV). What does paint is a div with
        // a border or a background, which is how the fallback icon has always
        // worked — so the silhouettes are shapes, not images.
        function deviceShapes(icon, focused, size) {
          var ink = focused ? "rgba(255,255,255,0.92)" : "rgba(148,163,184,0.75)";
          var w = 3; // stroke, in 1920-space px
          var out = [];
          function rect(x, y, rw, rh, more) {
            var style = { position: "absolute", left: x + "px", top: y + "px",
              width: rw + "px", height: rh + "px", border: w + "px solid " + ink,
              borderRadius: (more && more.r) || 3 + "px", boxSizing: "border-box" };
            if (more && more.fill) { style.border = "none"; style.backgroundColor = ink; }
            return style;
          }
          function bar(x, y, rw, rh) {
            return { position: "absolute", left: x + "px", top: y + "px",
              width: rw + "px", height: rh + "px", backgroundColor: ink, borderRadius: 2 + "px" };
          }
          var cx = size / 2;
          if (icon === "gamepad-2") {
            out.push({ position: "absolute", left: cx - 21 + "px", top: 16 + "px",
              width: 42 + "px", height: 22 + "px", border: w + "px solid " + ink,
              borderRadius: 11 + "px", boxSizing: "border-box" });
            out.push(bar(cx - 13, 25, 8, 2));
            out.push(bar(cx - 10, 22, 2, 8));
            out.push({ position: "absolute", left: cx + 8 + "px", top: 24 + "px",
              width: 5 + "px", height: 5 + "px", borderRadius: "50%", backgroundColor: ink });
            out.push({ position: "absolute", left: cx + 14 + "px", top: 28 + "px",
              width: 5 + "px", height: 5 + "px", borderRadius: "50%", backgroundColor: ink });
          } else if (icon === "cast") {
            out.push(rect(cx - 20, 14, 40, 27, { r: 4 + "px" }));
            out.push({ position: "absolute", left: cx - 20 + "px", top: 30 + "px",
              width: 9 + "px", height: 9 + "px", backgroundColor: ink, borderRadius: 2 + "px" });
          } else if (icon === "tv") {
            out.push(rect(cx - 20, 14, 40, 26, { r: 4 + "px" }));
            out.push(bar(cx - 2, 40, 4, 7));
            out.push(bar(cx - 11, 47, 22, 3));
          } else if (icon === "monitor") {
            out.push(rect(cx - 20, 13, 40, 24, { r: 3 + "px" }));
            out.push(bar(cx - 2, 37, 4, 8));
            out.push(bar(cx - 12, 45, 24, 3));
          } else if (icon === "disc") {
            out.push({ position: "absolute", left: cx - 17 + "px", top: 11 + "px",
              width: 34 + "px", height: 34 + "px", border: w + "px solid " + ink,
              borderRadius: "50%", boxSizing: "border-box" });
            out.push({ position: "absolute", left: cx - 5 + "px", top: 23 + "px",
              width: 10 + "px", height: 10 + "px", border: w + "px solid " + ink,
              borderRadius: "50%", boxSizing: "border-box" });
          } else if (icon === "usb") {
            out.push(rect(cx - 8, 20, 16, 24, { r: 3 + "px" }));
            out.push({ position: "absolute", left: cx - 4 + "px", top: 13 + "px",
              width: 8 + "px", height: 7 + "px", backgroundColor: ink, borderRadius: 2 + "px" });
            out.push(bar(cx - 4, 29, 8, 2));
          } else if (icon === "cpu") {
            out.push(rect(cx - 15, 15, 30, 26, { r: 3 + "px" }));
            out.push(rect(cx - 7, 23, 14, 10, { r: 2 + "px" }));
          } else {
            out.push(rect(cx - 15, 16, 30, 24, { r: 4 + "px" }));
            out.push(bar(cx - 15, 26, 30, 2));
          }
          return out.map(function (style) { return h("div", { style: style }); });
        }

        // One overlay cell builder for both layouts: the flat grid and, when
        // alvidaa_groups is configured, the grouped sections. Same tile, same
        // icon policy, same click behaviour; only the position and the focused
        // index differ per call site.
        //
        // Focus treatment (visual pass): the tile reads as NEARER, not
        // outlined. The old 2px white ring was the loudest thing on screen and
        // it was not the content; what replaced it is the dock's own language —
        // a 1.03 lift on the same 140ms ease-out, a hairline at low alpha, a
        // soft shadow, and a low-alpha inner sheen that sits over the tile
        // background but under the icon and label. Every state change is
        // plain CSS on one node, so both directions of the transition are
        // free. (x, y) is the tile's true origin: the gutter is real space
        // between tiles now, not an inset trick.
        function overlayCell(app, selected, index, x, y, cellW) {
          var icon = vm.appIcon(app);
          var tileH = OVERLAY_CELL - 24;
          var cell = [
            h("div", { style: box(0, 0, cellW, tileH, {
              backgroundColor: selected ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0)"
            }) })
          ];
          if (icon) {
            // backgroundImage, not an img node: the img path did not paint
            // cached icons on the Cobalt builds this was tested against.
            cell.push(h("div", { style: box(0, 16, cellW, ICON, {
              backgroundImage: "url(" + JSON.stringify(icon) + ")",
              backgroundSize: "contain", backgroundPosition: "center",
              backgroundRepeat: "no-repeat"
            }) }));
          } else {
            var badge = brand(app.appName);
            cell.push(h("div", { style: box((cellW - ICON) / 2, 16, ICON, ICON, {
              borderRadius: 20, backgroundColor: badge, overflow: "hidden"
            }) }, [
              h("div", { style: box(0, 0, ICON, 2, { backgroundColor: "rgba(255,255,255,0.35)" }) }),
              h("div", { style: box(0, 0, ICON, ICON, {
                fontSize: 38, lineHeight: ICON, textAlign: "center",
                fontWeight: "700", color: "#ffffff"
              }) }, [String(app.appName || "?").charAt(0).toUpperCase()])
            ]));
          }
          var name = String(app.appName || "");
          if (name.length > 20) name = name.slice(0, 19) + "\u2026";
          cell.push(h("div", { style: box(0, 96, cellW, 34, {
            fontSize: 22, lineHeight: 34, textAlign: "center",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            color: selected ? "#f8fafc" : "#94a3b8"
          }) }, [name]));
          return h("div", {
            attrs: { role: "button", "aria-label": String(app.appName || ""), tabindex: selected ? "0" : "-1" },
            style: box(x, y, cellW, tileH, {
              borderRadius: 24,
              backgroundColor: selected ? "rgba(255,255,255,0.07)" : "rgba(255,255,255,0.03)",
              border: selected ? "1px solid rgba(255,255,255,0.22)" : "1px solid rgba(255,255,255,0.05)",
              boxShadow: selected ? "0 12px 28px rgba(0,0,0,0.5)" : "0 0 0 rgba(0,0,0,0)",
              transform: selected ? "scale(1.03)" : "scale(1)",
              transition: "transform 140ms ease-out, border-color 140ms ease-out, background-color 140ms ease-out",
              overflow: "hidden"
            }),
            on: { click: function (i) {
              return function () { vm.overlayIndex = i; vm.launchFocused(); };
            }(index) }
          }, cell);
        }

        var nodes = [];

        // ---- view 1: clock, big label, inputs dock -------------------------
        nodes.push(h("div", { style: box(112, 56, null, null, {
          fontSize: 116, lineHeight: 120, fontWeight: "300", letterSpacing: "-2px"
        }) }, [
          h("span", { style: { color: "#ffffff" } }, [p2(this.now.getHours())]),
          h("span", { style: { color: "rgba(255,255,255,0.35)" } }, [":"]),
          h("span", { style: { color: "rgba(255,255,255,0.92)" } }, [p2(this.now.getMinutes())])
        ]));
        nodes.push(label(114, 196, 22, dateText, "#8e9ab0", 600));

        if (this.zone === "dock") {
          var focus = this.dockItems()[this.dock];
          if (focus) {
            var live = signalOf(focus);
            nodes.push(label(112, 660, 84, this.sourceName(focus), live ? "#f8fafc" : "#64748b", 700));
            nodes.push(label(114, 752, 26, live ? "connected" : "no signal",
              live ? "#34d399" : "#475569", 500));
          }
        }

        nodes.push(label(112, 812, 22, "INPUTS & SOURCES", "#64748b", 600));
        var dock = this.dockItems(), start = this.dockStart();
        var end = Math.min(dock.length, start + DOCK_PAGE);
        if (!dock.length && !this._payloadReceived) {
          // First frame (issue #54): the dock paints before the platform
          // payload lands, so the tiles would pop from nothing once inputs
          // arrive. The real shape is matched from the reported name, which
          // only exists after the payload — but the fallback silhouette is
          // knowable now, so paint it inside placeholders at the exact tile
          // geometry and let the real tiles swap in without a layout shift.
          // Only pre-payload: after a payload that reports zero inputs the
          // verdict below is the truth, and a re-activated instance still
          // holds its sources, so placeholders never replace real tiles.
          var artTable = root.AlvidaaNativeDeviceArt;
          var fallbackShape = (artTable && artTable.fallback) || "";
          for (var ph = 0; ph < DOCK_PAGE; ph++) {
            var ghost = [];
            if (fallbackShape) {
              ghost.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 40, 56, 56, {
                opacity: 0.85
              }) }, deviceShapes(fallbackShape, false, 56)));
            } else {
              // No silhouette table baked in: the minimal hardware icon is
              // what a nameless tile would draw, so that is the placeholder.
              var ghostInk = "rgba(148,163,184,0.6)";
              ghost.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 46, 56, 34, {
                border: "3px solid " + ghostInk, borderRadius: 6
              }) }));
              ghost.push(h("div", { style: box(DOCK_SIZE / 2 + 2, 80, 4, 8, { backgroundColor: ghostInk }) }));
              ghost.push(h("div", { style: box(DOCK_SIZE / 2 - 12, 88, 24, 3, { backgroundColor: ghostInk }) }));
            }
            nodes.push(h("div", {
              attrs: { "data-dock-placeholder": "true", "aria-hidden": "true" },
              style: box(112 + ph * (DOCK_SIZE + DOCK_GAP), 848, DOCK_SIZE, DOCK_HEIGHT, {
                borderRadius: 28,
                backgroundImage: "linear-gradient(180deg, #161b24, #0d1017)",
                border: "1px solid rgba(255,255,255,0.12)",
                overflow: "hidden"
              })
            }, ghost));
          }
        } else if (!dock.length) {
          nodes.push(label(112, 888, 28, "no inputs reported", "#475569", 500));
        }
        for (var i = start; i < end; i++) {
          var input = dock[i];
          var focused = this.zone === "dock" && this.dock === i;
          var liveInput = signalOf(input);
          var x = 112 + (i - start) * (DOCK_SIZE + DOCK_GAP);
          var tile = [
            h("div", { style: box(16, 16, liveInput ? 96 : 124, 34, {
              borderRadius: 17,
              backgroundColor: liveInput ? "rgba(16,185,129,0.16)" : "rgba(255,255,255,0.04)",
              border: "1px solid " + (liveInput ? "rgba(16,185,129,0.35)" : "rgba(255,255,255,0.08)")
            }) }, [
              h("div", { style: box(14, 14, 6, 6, {
                borderRadius: 3, backgroundColor: liveInput ? "#10b981" : "#64748b"
              }) }),
              h("div", { style: box(28, 0, 68, 34, {
                fontSize: 18, lineHeight: 34, fontWeight: "600",
                color: liveInput ? (focused ? "#6ee7b7" : "#34d399") : "#64748b"
              }) }, [liveInput ? "LIVE" : "STANDBY"])
            ])
          ];
          if (i < 9) {
            tile.push(h("div", { style: box(DOCK_SIZE - 48, 16, 32, 32, {
              borderRadius: 8,
              backgroundColor: focused ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.05)",
              border: "1px solid " + (focused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.08)"),
              fontSize: 18, lineHeight: 32, textAlign: "center", fontWeight: "600",
              color: focused ? "#ffffff" : "rgba(148,163,184,0.7)"
            }) }, [String(i + 1)]));
          }
          // Shapes, not images. Measured on the reference TV (2026-11-10/11):
          // an SVG data URI does not paint in an <img> or a background-image,
          // and the vendor icon-font class does not paint outside the vendor's
          // own components. A div with a border or a background does paint, so
          // the device icons are drawn. See deviceShapes().
          var shapeName = this.deviceArtName(this.sourceName(input));
          if (shapeName) {
            tile.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 40, 56, 56, {
              opacity: focused ? 1 : 0.85
            }) }, deviceShapes(shapeName, focused, 56)));
          } else if (text(input.glyph)) {
            tile.push(h("div", { style: box(0, 42, DOCK_SIZE, 60, {
              fontSize: 52, lineHeight: 60, textAlign: "center",
              color: focused ? "#ffffff" : "#cbd5e1"
            }) }, [text(input.glyph)]));
          } else {
            // Minimal hardware display icon, same as the canvas fallback.
            var ink = focused ? "rgba(255,255,255,0.9)" : "rgba(148,163,184,0.6)";
            tile.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 46, 56, 34, {
              border: "3px solid " + ink, borderRadius: 6
            }) }));
            tile.push(h("div", { style: box(DOCK_SIZE / 2 + 2, 80, 4, 8, { backgroundColor: ink }) }));
            tile.push(h("div", { style: box(DOCK_SIZE / 2 - 12, 88, 24, 3, { backgroundColor: ink }) }));
          }
          tile.push(h("div", { style: box(0, DOCK_HEIGHT - 54, DOCK_SIZE, 40, {
            fontSize: 26, lineHeight: 40, textAlign: "center",
            color: focused ? "#ffffff" : "#94a3b8"
          }) }, [this.sourceName(input)]));
          nodes.push(h("div", {
            attrs: { role: "button", "aria-label": this.sourceName(input), tabindex: focused ? "0" : "-1" },
            style: box(x, 848, DOCK_SIZE, DOCK_HEIGHT, {
              borderRadius: 28,
              backgroundImage: focused ?
                "linear-gradient(180deg, #232a36, #141822)" :
                "linear-gradient(180deg, #161b24, #0d1017)",
              border: "1px solid " + (focused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)"),
              overflow: "hidden",
              transition: "transform 140ms ease-out, border-color 140ms ease-out",
              transform: focused ? "scale(1.03)" : "scale(1)"
            }),
            on: { click: function (index) {
              return function () { vm.zone = "dock"; vm.dock = index; vm.activate(); };
            }(i) }
          }, tile));
        }

        // ---- view 2: the apps row -----------------------------------------
        var rowY = 1080;
        nodes.push(label(112, rowY + 168, 22, "APPS", "#64748b", 600));
        nodes.push(h("div", { style: box(112, rowY + 168, 1696, 24, {
          fontSize: 18, lineHeight: 24, textAlign: "right", color: "#475569"
        }) }, ["OK to open \u00b7 BACK to return"]));
        this.appItems().forEach(function (item, index) {
          var focused = vm.zone === "apps" && vm.app === index;
          var tileX = 112 + index * (DOCK_SIZE + DOCK_GAP);
          var children = [];
          if (item.icon) {
            // Favorites carry their app's real icon; same 80px box the dock
            // and overlay use, contained so odd aspect ratios stay inside it.
            children.push(h("img", {
              attrs: { src: item.icon, alt: item.label || "" },
              style: box((DOCK_SIZE - ICON) / 2, 24, ICON, ICON, { objectFit: "contain" })
            }));
          } else {
            children.push(h("div", { style: box(0, 42, DOCK_SIZE, 60, {
              fontSize: 52, lineHeight: 60, textAlign: "center",
              color: item.accent || (focused ? "#ffffff" : "#cbd5e1")
            }) }, [item.glyph]));
          }
          children.push(h("div", { style: box(0, 108, DOCK_SIZE, 40, {
            fontSize: 26, lineHeight: 40, textAlign: "center",
            color: focused ? "#ffffff" : "#94a3b8"
          }) }, [item.label]));
          if (item.sub) {
            children.push(h("div", { style: box(0, 144, DOCK_SIZE, 26, {
              fontSize: 18, lineHeight: 26, textAlign: "center", color: "#64748b"
            }) }, [item.sub]));
          }
          nodes.push(h("div", {
            attrs: { role: "button", "aria-label": item.label, tabindex: focused ? "0" : "-1" },
            style: box(tileX, rowY + 208, DOCK_SIZE, DOCK_HEIGHT, {
              borderRadius: 28,
              backgroundImage: focused ?
                "linear-gradient(180deg, #232a36, #141822)" :
                "linear-gradient(180deg, #161b24, #0d1017)",
              border: "1px solid " + (focused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.12)"),
              overflow: "hidden",
              transition: "transform 140ms ease-out, border-color 140ms ease-out",
              transform: focused ? "scale(1.03)" : "scale(1)"
            }),
            on: { click: function () { vm.zone = "apps"; vm.app = index; vm.activate(); } }
          }, children));
        });

        var stage = h("div", { style: {
          position: "absolute", left: "0", top: "0", width: "100%",
          height: 2160 * scale + "px",
          transform: "translateY(" + (this.zone === "apps" ? -1080 * scale : 0) + "px)",
          transition: "transform 350ms ease-out"
        } }, nodes);

        var wallpaper = root.AlvidaaNativeWallpaper;
        var artMap = root.AlvidaaNativeInputArt;

        var artLayers = [];
        if (artMap) {
          if (this.outgoingArt) {
            artLayers.push(h("div", {
              attrs: { "data-input-art": String(this.outgoingArtId), "data-art-layer": "outgoing" },
              style: {
                position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
                pointerEvents: "none",
                backgroundImage: "url(" + JSON.stringify(this.outgoingArt) + ")",
                backgroundSize: "cover", backgroundPosition: "center",
                opacity: this.outgoingArtOpacity,
                transition: "opacity 300ms ease-out"
              }
            }));
          }
          if (this.activeArt) {
            artLayers.push(h("div", {
              attrs: { "data-input-art": String(this.activeArtId), "data-art-layer": "incoming" },
              style: {
                position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
                pointerEvents: "none",
                backgroundImage: "url(" + JSON.stringify(this.activeArt) + ")",
                backgroundSize: "cover", backgroundPosition: "center",
                opacity: this.artIncomingOpacity,
                transition: "opacity 300ms ease-out"
              }
            }));
          }
        }

        var layers = [
          wallpaper ? h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            backgroundImage: "url(" + JSON.stringify(wallpaper) + ")",
            backgroundSize: "cover", backgroundPosition: "center"
          } }) : h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            pointerEvents: "none",
            backgroundImage: "linear-gradient(180deg, rgba(56,189,248,0.06), rgba(99,102,241,0.02) 40%, rgba(7,8,12,0) 70%)"
          } })
        ].concat(artLayers).concat([
          // Contrast wash so text and tiles stay readable over the wallpaper.
          h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            pointerEvents: "none",
            backgroundColor: "rgba(6,8,12,0.55)"
          } })
        ]).concat((function () {
          // Per-app tint (issue #56): only when the build baked a colour map.
          // The layer is always mounted at opacity 0, so fading toward the
          // focused app's colour — and back — is one CSS transition. The
          // opacity ceiling plus the luminance cap keep it a tint, never a
          // wash-out; the colour is last-won while fading out, so the hue
          // dissolves instead of cutting.
          var colourMap = root.AlvidaaNativeAppColours;
          if (!colourMap || typeof colourMap !== "object") return [];
          return [h("div", {
            attrs: { "data-app-tint": "true" },
            style: {
              position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
              pointerEvents: "none",
              backgroundColor: vm.tintColour || "rgba(6,8,12,0)",
              opacity: vm.tintOpacity * TINT_MAX_OPACITY,
              transition: "opacity 350ms ease-out, background-color 350ms ease-out"
            }
          })];
        })()).concat([
          stage,
          (function () {
            var nowMs = Date.now();
            var isAutoSwitch = Boolean(vm.autoSwitchAt && vm.autoSwitchAt > nowMs && vm.autoSwitchId != null);
            var isToast = Boolean(vm.toast && nowMs < vm.toastUntil);
            var hudVisible = isAutoSwitch || isToast;
            var text = "";
            if (isAutoSwitch) {
              var rem = Math.max(1, Math.ceil((vm.autoSwitchAt - nowMs) / 1000));
              text = "Switching to " + vm.autoSwitchName + " in " + rem + "s - press any key to stay";
            } else if (isToast) {
              text = vm.toast;
            }
            return h("div", {
              attrs: { role: "status", "aria-live": "polite" },
              style: {
                position: "absolute",
                left: "50%",
                bottom: 28 * scale + "px",
                transform: "translateX(-50%)" + (hudVisible ? " translateY(0)" : " translateY(8px)"),
                opacity: hudVisible ? 1 : 0,
                visibility: hudVisible ? "visible" : "hidden",
                transition: "opacity 180ms ease-out, transform 180ms ease-out",
                pointerEvents: "none",
                padding: (8 * scale) + "px " + (22 * scale) + "px",
                borderRadius: (20 * scale) + "px",
                backgroundColor: "rgba(15, 23, 42, 0.88)",
                border: "1px solid rgba(255, 255, 255, 0.16)",
                boxShadow: "0 8px 24px rgba(0, 0, 0, 0.5)",
                fontSize: (18 * scale) + "px",
                lineHeight: (24 * scale) + "px",
                fontWeight: "500",
                color: "#f8fafc",
                whiteSpace: "nowrap"
              }
            }, [text]);
          }())
        ]);

        // ---- the app list overlay -----------------------------------------
        if (this.overlay) {
          // Children below are positioned relative to the PANEL, not the screen:
  // box() always emits position:absolute, so the panel is their containing
  // block. Adding panelX/panelY to a child double-counts the offset and pushes
  // the grid right and down — the app list sat off-centre with its last row at
  // y=1056 on a 1080 screen (2026-11-10). The settings layer already uses
  // panel-relative coordinates, which is why it never showed this.
  //
  // Rhythm (visual pass): every offset is on the 8px grid and the cell width
  // is DERIVED from the panel width, so the grid stays centred — with 7
  // columns the one 8px-grid solution is gutters equal to the padding (56),
  // and the formula below makes that derivation visible instead of hardcoding
  // 192. Header 32, hint 64, list 96; tiles 192x136 inside 160-tall slots,
  // 24 of which is the gap between rows.
  var panelX = 64, panelY = 144, panelW = 1792, panelH = 800;
          var pad = OVERLAY_PAD, gutter = OVERLAY_GUTTER;
          var tileW = (panelW - 2 * pad - (OVERLAY_COLS - 1) * gutter) / OVERLAY_COLS;
          var tileH = OVERLAY_CELL - 24;
          var listY = 96;
          var rows = Math.max(1, Math.floor((panelH - listY - pad) / OVERLAY_CELL));
          var layout = this.overlayLayout();
          // Real header: what is focused names the section when folders are in
          // use, the count rides after it in a quieter weight, and the hint
          // sits under the title on the same left edge instead of floating at
          // the right side of the panel.
          var spans = this.overlaySpans();
          var groupName = null;
          if (spans) {
            for (var gs = 0; gs < spans.length; gs++) {
              if (this.overlayIndex >= spans[gs].start &&
                  this.overlayIndex < spans[gs].start + spans[gs].count) {
                groupName = spans[gs].name;
                break;
              }
            }
          }
          var shown = this.overlayList().length;
          var panel = [
            h("div", { style: box(pad, 32, panelW - 2 * pad, 26, {
              fontSize: 22, lineHeight: 26, fontWeight: "600", color: "#94a3b8"
            }) }, [
              groupName || "APPS",
              h("span", { style: { fontSize: "18px", fontWeight: "400", color: "#475569" } },
                [" \u00b7 " + shown + (shown === 1 ? " app" : " apps")])
            ]),
            h("div", { style: box(pad, 64, panelW - 2 * pad, 20, {
              fontSize: 16, lineHeight: 20, fontWeight: "400", color: "#475569"
            }) }, ["OK to open \u00b7 BACK to close"])
          ];
          if (!this.apps.length) {
            panel.push(h("div", { style: box(pad, 112, null, null, {
              fontSize: 28, lineHeight: 32, color: "#475569"
            }) }, ["no apps reported"]));
          } else if (!layout) {
            // Unset config (issue #57): the flat grid.
            var firstRow = Math.max(0, Math.floor(this.overlayIndex / OVERLAY_COLS) - rows + 1);
            var first = firstRow * OVERLAY_COLS;
            for (var a = first; a < this.apps.length; a++) {
              var row = Math.floor((a - first) / OVERLAY_COLS), col = a % OVERLAY_COLS;
              if (row >= rows) break;
              panel.push(overlayCell(this.apps[a], this.overlayIndex === a, a,
                pad + col * (tileW + gutter), listY + row * OVERLAY_CELL, tileW));
            }
          } else {
            // Configured groups (issue #57): one focus path over the flattened
            // list, windowed on the focused slot. A group heading gets MORE
            // air above it (40) than the rows get between them (24), so the
            // eye reads groups without a box around them — the band is
            // 40 + text 24 + 16 below = 80, all on the grid. The slot window
            // stays count-based because worst case (two headings, two rows)
            // totals 480px, well inside the 704 the panel offers.
            var focusedSlot = 0;
            for (var lr = 0; lr < layout.length; lr++) {
              if (layout[lr].cells && this.overlayIndex >= layout[lr].start &&
                  this.overlayIndex < layout[lr].start + layout[lr].cells.length) {
                focusedSlot = lr;
                break;
              }
            }
            var gFirst = Math.max(0, focusedSlot - rows + 1);
            var y = listY;
            for (var vr = gFirst; vr < layout.length && vr < gFirst + rows; vr++) {
              var slot = layout[vr];
              if (slot.header) {
                panel.push(h("div", { style: box(pad, y + 40, panelW - 2 * pad, 24, {
                  fontSize: 16, lineHeight: 24, fontWeight: "600",
                  letterSpacing: "1px", color: "#7c8aa0"
                }) }, [slot.header]));
                y += 80;
              } else {
                for (var cc = 0; cc < slot.cells.length; cc++) {
                  panel.push(overlayCell(slot.cells[cc], this.overlayIndex === slot.start + cc,
                    slot.start + cc, pad + cc * (tileW + gutter), y, tileW));
                }
                y += OVERLAY_CELL;
              }
            }
          }
          layers.push(h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(3,5,9,0.86)"
          } }, [
            h("div", { style: box(panelX, panelY, panelW, panelH, {
              borderRadius: 48, backgroundColor: "rgba(14,18,26,0.97)",
              border: "1px solid rgba(255,255,255,0.10)", overflow: "hidden"
            }) }, panel)
          ]));
        }

        // ---- the launcher settings layer ----------------------------------
        if (this.settings) {
          var spX = 460, spY = 180, spW = 1000, spH = 840;
          var spPanel = [];
          var spTitles = { root: "HOME SETTINGS", apps: "APPS",
            inputs: "INPUT NAMES", name: "RENAME INPUT" };
          var spHints = {
            root: "OK select \u00b7 < > change \u00b7 BACK close",
            apps: "OK show/hide \u00b7 < > pin \u00b7 BACK back",
            inputs: "OK rename \u00b7 BACK back",
            name: "OK key \u00b7 BACK cancel"
          };
          // Panel children are positioned relative to the panel box, like the
          // dock tiles are.
          spPanel.push(label(56, 40, 22, spTitles[this.settingsPage] || "HOME SETTINGS", "#64748b", 600));
          spPanel.push(h("div", { style: box(56, 40, spW - 112, 24, {
            fontSize: 18, lineHeight: 24, textAlign: "right", color: "#475569"
          }) }, [spHints[this.settingsPage] || ""]));
          if (this.settingsPage === "name") {
            // Draft line with a caret and a character budget.
            spPanel.push(h("div", { style: box(56, 96, spW - 112, 88, {
              borderRadius: 20, backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.14)"
            }) }, [
              h("div", { style: box(24, 0, spW - 112 - 130, 88, {
                fontSize: 34, lineHeight: 88, color: "#f8fafc",
                whiteSpace: "nowrap", overflow: "hidden"
              }) }, [this.nameDraft,
                h("span", { style: { color: "#38bdf8" } }, ["\u258c"])]),
              h("div", { style: box(spW - 112 - 104, 0, 80, 88, {
                fontSize: 20, lineHeight: 88, textAlign: "right", color: "#475569"
              }) }, [this.nameDraft.length + "/" + NAME_MAX])
            ]));
            var kbCellW = (spW - 112) / KB_COLS, kbCellH = 76, kbGridY = 216;
            for (var kb = 0; kb < KB_CELLS.length; kb++) {
              var kbFocused = this.nameIndex === kb;
              var kbAction = kb >= KB_CELLS.length - 4;
              spPanel.push(h("div", {
                attrs: { role: "button", "aria-label": KB_CELLS[kb], tabindex: kbFocused ? "0" : "-1" },
                style: box(56 + (kb % KB_COLS) * kbCellW,
                  kbGridY + Math.floor(kb / KB_COLS) * (kbCellH + 8),
                  kbCellW - 8, kbCellH, {
                  borderRadius: 14,
                  backgroundColor: kbFocused ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                  border: kbFocused ? "2px solid #ffffff" : "2px solid rgba(255,255,255,0)",
                  fontSize: kbAction ? 16 : 26, lineHeight: kbCellH,
                  textAlign: "center", fontWeight: "600",
                  color: kbFocused ? "#f8fafc" : "#94a3b8",
                  overflow: "hidden"
                })
              }, [KB_CELLS[kb]]));
            }
          } else {
            var spRows = this.settingsRows();
            var spListY = 96, spRowH = 84;
            var spVisible = Math.max(1, Math.floor((spH - spListY - 56) / spRowH));
            var spFirst = Math.max(0, Math.min(this.settingsIndex - spVisible + 1,
              Math.max(0, spRows.length - spVisible)));
            if (!spRows.length) {
              spPanel.push(label(56, spListY + 8, 24,
                this.settingsPage === "inputs" ? "no inputs reported" : "no apps reported",
                "#475569", 500));
            }
            for (var ri = spFirst; ri < spRows.length && ri < spFirst + spVisible; ri++) {
              var spRow = spRows[ri];
              var spFocused = this.settingsIndex === ri;
              var spRowY = spListY + (ri - spFirst) * spRowH;
              var spInner = [];
              var spMainH = spRow.sub ? 34 : spRowH - 12;
              spInner.push(h("div", { style: box(24, spRow.sub ? 10 : 0, spW - 96 - 240, spMainH, {
                fontSize: 24, lineHeight: spMainH, fontWeight: "600",
                color: spFocused ? "#f8fafc" : "#cbd5e1",
                whiteSpace: "nowrap", overflow: "hidden"
              }) }, [spRow.label]));
              if (spRow.sub) {
                spInner.push(h("div", { style: box(24, 46, spW - 96 - 240, 24, {
                  fontSize: 17, lineHeight: 24, color: "#64748b"
                }) }, [spRow.sub]));
              }
              if (spRow.value) {
                spInner.push(h("div", { style: box(spW - 96 - 200, 0, 176, spRowH - 12, {
                  fontSize: 22, lineHeight: spRowH - 12, textAlign: "right",
                  fontWeight: "600",
                  color: spRow.value === "on" || spRow.value === "shown" || spRow.value === "custom" ?
                    "#34d399" : "#64748b"
                }) }, [spRow.value]));
              }
              spPanel.push(h("div", {
                attrs: { role: "button", "aria-label": spRow.speak || spRow.label, tabindex: spFocused ? "0" : "-1" },
                style: box(48, spRowY, spW - 96, spRowH - 12, {
                  borderRadius: 18,
                  backgroundColor: spFocused ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                  border: spFocused ? "2px solid #ffffff" : "2px solid rgba(255,255,255,0)",
                  overflow: "hidden"
                })
              }, spInner));
            }
            var spOnly = this.prefs && this.prefs.onlyApps;
            if (this.settingsPage === "apps" && Array.isArray(spOnly) && spOnly.length) {
              spPanel.push(label(56, spH - 52, 17,
                "the only-list overrides hidden apps", "#94a3b8", 500));
            }
          }
          layers.push(h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(3,5,9,0.86)"
          } }, [
            h("div", { style: box(spX, spY, spW, spH, {
              borderRadius: 48, backgroundColor: "rgba(14,18,26,0.97)",
              border: "1px solid rgba(255,255,255,0.10)", overflow: "hidden"
            }) }, spPanel)
          ]));
        }

        return h("div", {
          attrs: { id: "alvidaa-native" },
          style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            overflow: "hidden", backgroundColor: "#07080c", color: "#f8fafc",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
          }
        }, layers);
      }
    };
  }

  root.AlvidaaNativeHome = create;
  // native-entry.js picks the variant from here. One component per build.
  root.AlvidaaNativeComponent = create;
}(typeof self !== "undefined" ? self : this));
