/* alvidaa native Home: premium minimal dark-glass launcher as a Vue component.
 *
 * This is the alvidaa variant in lane 3, not a second product. It reuses the
 * shared scaffold: native-entry.js does the route swap, native-platform.js
 * supplies apps and inputs through the vendor SDK, and native-home.cjs
 * installs and restores. Only the design lives here.
 *
 * Design:
 *   - quiet top-right clock & date; calm studio negative space
 *   - focused input hero title + connected/standby status + OK action cue
 *   - sculptural inputs dock at the bottom edge (5 cards per page, 320x248)
 *     carrying Cobalt-safe build-time raster PNG hardware renders per connected
 *     device class (with scaled div-shape fallback when no PNGs are baked)
 *   - view 2 pans smoothly to pinned favorites + studio-icon Apps, TV Settings
 *     and Home Settings doors (horizontally paged so nothing clips off-screen)
 *   - 7-column grouped Apps overlay + dark-glass Home Settings surface
 *   - burn-in-safe drifting Idle clock layer
 *
 * No canvas, no iframe, no SVG rendering, no global CSS, no XHR. Every icon
 * and hardware render paints via background-image PNG data URIs or allowlisted
 * local/vendor paths (findings 13 section 8).
 */
(function (root) {
  "use strict";
  // 5 sculptural cards at 1920px: 112 + 5*320 + 4*24 = 1808 (symmetric 112px margins).
  var DOCK_SIZE = 320, DOCK_HEIGHT = 248, DOCK_GAP = 24, DOCK_PAGE = 5;
  // The overlay sits on an 8px grid (1792-wide panel, 7 columns, 56px padding
  // and 56px gutters -> 192x144 dark-glass app tiles inside 168px slots).
  var OVERLAY_COLS = 7, OVERLAY_CELL = 168, OVERLAY_PAD = 56, OVERLAY_GUTTER = 56;
  var ICON = 82;
  // Gentle periodic source refresh while idle-awake on Home so delayed HDMI-CEC
  // OSD names (e.g. HDMI1 -> "PlayStation 5") update titles & device art live.
  var REFRESH_INTERVAL_SEC = 10;
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
      var h = 0, str = String(value || "");
      for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360;
      return h;
    }
    function brand(name) {
      var str = String(name || "");
      for (var i = 0; i < BRANDS.length; i++) {
        if (BRANDS[i][0].test(str)) return BRANDS[i][1];
      }
      return "hsl(" + hue(str) + ", 45%, 38%)";
    }
    function brandGlow(name, alpha) {
      var c = brand(name);
      var a = alpha != null ? alpha : 0.16;
      if (c && c.charAt(0) === "#" && c.length === 7) {
        var r = parseInt(c.slice(1, 3), 16);
        var g = parseInt(c.slice(3, 5), 16);
        var b = parseInt(c.slice(5, 7), 16);
        return "rgba(" + r + "," + g + "," + b + "," + a + ")";
      }
      return "rgba(56,189,248," + a + ")";
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
    function allowedRaster(value) {
      if (typeof value !== "string" || !value) return "";
      if (/^data:image\/(png|jpeg|webp);base64,/i.test(value)) return value;
      return "";
    }
    function allowedInputArt(value) {
      if (typeof value !== "string" || !value) return "";
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
    function inInputList(list, input) {
      if (!Array.isArray(list) || !list.length || !input || input.sourceId == null) return false;
      var id = String(input.sourceId).trim().toLowerCase();
      var name = text(input.name).toLowerCase();
      var rename = text(input.rename).toLowerCase();
      for (var i = 0; i < list.length; i++) {
        var item = String(list[i]).trim().toLowerCase();
        if (!item) continue;
        if (item === id || (name && item === name) || (rename && item === rename)) return true;
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
            hiddenApps: [], onlyApps: [], hiddenInputs: [], inputOrder: [],
            customNames: {}, lastUsed: null,
            autoSwitch: false, recentOrder: true, recent: {}, favorites: [],
            idleMinutes: 0, clock12h: false, wallpaper: "fjord", groups: []
          }
        };
      },
      mounted: function () { this.start(); },
      activated: function () {
        this.readPrefs();
        var wasRunning = this._running;
        this.start();
        this.routeFocus();
        if (wasRunning && this._platform && this._platform.refresh) {
          this._platform.refresh();
        }
      },
      deactivated: function () { this.stop(); },
      beforeDestroy: function () { this.stop(); },
      watch: {
        "$route": function () {
          this.routeFocus();
          if (this._platform && this._platform.refresh) this._platform.refresh();
        },
        dock: function () { this.syncArt(); },
        app: function () { this.syncTint(); },
        zone: function () { this.syncTint(); }
      },
      methods: {
        readPrefs: function () {
          var savedWall = readPref("alvidaa_wallpaper", "fjord");
          this.prefs = {
            hiddenApps: readPref("alvidaa_hidden_apps", []),
            onlyApps: readPref("alvidaa_only_apps", []),
            hiddenInputs: readPref("alvidaa_hidden_inputs", []),
            inputOrder: readPref("alvidaa_input_order", []),
            customNames: readPref("alvidaa_custom_names", {}),
            lastUsed: readPref("alvidaa_last_used", null),
            autoSwitch: isTruthy(readPref("alvidaa_auto_switch", false)),
            recentOrder: isTruthy(readPref("alvidaa_recent_order", true)),
            recent: readPref("alvidaa_recent", {}),
            favorites: readPref("alvidaa_favorites", []),
            idleMinutes: Number(readPref("alvidaa_idle_minutes", 0)) || 0,
            clock12h: isTruthy(readPref("alvidaa_clock_12h", false)),
            wallpaper: typeof savedWall === "string" && savedWall.trim() ? savedWall.trim() : "fjord",
            groups: readPref("alvidaa_groups", [])
          };
          if (this._lastData && this._lastData.apps) {
            this.apps = this.sortRecent(this.filterApps(this._lastData.apps));
          }
          if (this._lastData && this._lastData.sources &&
              (!this._managedSources || this.sources === this._managedSources)) {
            this.sources = this.sortInputs(this.filterInputs(this._lastData.sources));
            this._managedSources = this.sources;
          }
          this.clamp();
          this.syncArt();
          this.syncTint();
        },
        filterInputs: function (sources) {
          var vm = this;
          return (sources || []).filter(function (input) {
            if (!input || input.sourceId == null) return false;
            return vm.inputVisible(input);
          });
        },
        sortInputs: function (sources) {
          var list = (sources || []).filter(function (input) {
            return input && input.sourceId != null;
          });
          var order = this.prefs && this.prefs.inputOrder;
          if (!Array.isArray(order) || !order.length) return list;
          var pos = {};
          for (var i = 0; i < order.length; i++) {
            var key = String(order[i]).trim().toLowerCase();
            if (key && pos[key] == null) pos[key] = i;
          }
          var ranked = [];
          for (var j = 0; j < list.length; j++) {
            var sid = String(list[j].sourceId).trim().toLowerCase();
            ranked.push({
              input: list[j],
              rank: pos[sid] != null ? pos[sid] : order.length + j,
              index: j
            });
          }
          ranked.sort(function (a, b) {
            if (a.rank !== b.rank) return a.rank - b.rank;
            return a.index - b.index;
          });
          var out = [];
          for (var k = 0; k < ranked.length; k++) out.push(ranked[k].input);
          return out;
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
            if (a.at !== b.at) return b.at - a.at;
            return a.index - b.index;
          });
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
            vm.sources = vm.sortInputs(vm.filterInputs(data.sources));
            vm._managedSources = vm.sources;
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
          this._refreshTick = 0;
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
            vm._refreshTick = (vm._refreshTick || 0) + 1;
            if (vm._refreshTick >= REFRESH_INTERVAL_SEC) {
              vm._refreshTick = 0;
              if (!vm.idle && !vm.overlay && !vm.settings &&
                  vm._platform && typeof vm._platform.refresh === "function") {
                vm._platform.refresh();
              }
            }
          }, 1000);
          this._resize = function () { vm.width = (root && root.innerWidth) || 1920; };
          if (root.addEventListener) root.addEventListener("resize", this._resize);
          this.routeFocus();
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
          this.zone = "dock";
          this.overlay = false;
          this.closeSettings();
          this.dock = this.smartIndex();
          this.app = 0;
          this.syncArt();
          this.syncTint();
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
          var custom = this.prefs && this.prefs.customNames;
          if (custom && typeof custom === "object") {
            var sid = input.sourceId != null ? String(input.sourceId) : "";
            if (sid && text(custom[sid])) return text(custom[sid]);
            var lookupKeys = [input.name, input.deviceName, input.displayname2, input.rename];
            for (var k = 0; k < lookupKeys.length; k++) {
              var val = text(lookupKeys[k]);
              if (!val) continue;
              if (text(custom[val.toLowerCase()])) return text(custom[val.toLowerCase()]);
              if (text(custom[val])) return text(custom[val]);
            }
          }
          var resolved = text(input.deviceName) || text(input.displayname2) ||
            text(input.rename) || text(input.name) || String(input.sourceId);
          if (/^[A-Z]{2,4}[0-9]{4,}$/.test(resolved) && sdk.i18n && sdk.i18n.t) {
            try {
              var translated = sdk.i18n.t(resolved);
              if (translated && translated !== resolved) return translated;
            } catch (_) { return text(input.name) || resolved; }
            return text(input.name) || resolved;
          }
          return resolved;
        },
        // Clean display title: strips trailing vendor arrow symbols like "TV Channels▶"
        // only visually in hero/cards while keeping sourceName() exact for contracts.
        cleanDisplayName: function (raw) {
          return String(raw || "").replace(/[\u25b6\u25ba\u25b8]+$/g, "").trim() || String(raw || "");
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
        appColourFor: function (icon) {
          var map = root.AlvidaaNativeAppColours;
          if (!map || typeof map !== "object" || !icon) return "";
          var value = String(icon);
          var base = value.slice(value.lastIndexOf("/") + 1);
          var colour = map[base] != null ? map[base] : map[value];
          if (typeof colour !== "string" || !/^#[0-9a-fA-F]{6}$/.test(colour)) return "";
          return clampTint(colour);
        },
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
        appStart: function () {
          var n = this.appItems().length;
          if (n <= DOCK_PAGE) return 0;
          return Math.max(0, Math.min(this.app - 2, n - DOCK_PAGE));
        },
        // --- groups in the apps overlay (issue #57) ---------------------------
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
              if (app && !claimed[String(app.appId)]) {
                claimed[String(app.appId)] = true;
                apps.push(app);
              }
            }
            if (apps.length) lists.push({ name: text(entry.name), apps: apps });
          }
          var rest = [];
          for (var k = 0; k < this.apps.length; k++) {
            if (!claimed[String(this.apps[k].appId)]) rest.push(this.apps[k]);
          }
          if (rest.length) lists.push({ name: "Other apps", apps: rest });
          return lists.length ? lists : null;
        },
        overlayList: function () {
          var groups = this.overlayGroups();
          if (!groups) return this.apps;
          var out = this.apps.slice(0, 0);
          for (var i = 0; i < groups.length; i++) out = out.concat(groups[i].apps);
          return out;
        },
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
        showToast: function (msg, ms) {
          if (!msg) return;
          this.toast = String(msg);
          this.toastUntil = Date.now() + (typeof ms === "number" ? ms : 2500);
        },
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
        // Cobalt-safe raster PNG hardware render lookup (never SVG — findings 13 §8).
        deviceArtPng: function (name) {
          var table = root.AlvidaaNativeDeviceArt;
          if (!table || !table.pngs || typeof table.pngs !== "object") return "";
          var label = text(name).toLowerCase();
          var asset = "";
          if (label) {
            var rules = table.pngRules || [];
            for (var i = 0; i < rules.length; i++) {
              var pattern = null;
              try { pattern = new RegExp(rules[i][0], "i"); } catch (_) { pattern = null; }
              if (pattern && pattern.test(label)) { asset = rules[i][1]; break; }
            }
          }
          if (!asset) asset = table.pngFallback || "";
          return asset ? allowedRaster(table.pngs[asset]) : "";
        },
        doorArtPng: function (kind) {
          var table = root.AlvidaaNativeDeviceArt;
          if (!table || !table.doors || typeof table.doors !== "object") return "";
          return allowedRaster(table.doors[kind]);
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
            this._idleFadeTimer = setTimeout(function () {
              vm.idleFade = 1;
              vm._idleFadeTimer = null;
            }, 16);
          } else {
            this.idleFade = 1;
          }
        },
        cancelIdle: function () {
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
          return this.cancelIdle();
        },
        toggleClock12h: function () {
          writePref("alvidaa_clock_12h", !this.prefs.clock12h);
          this.readPrefs();
        },
        wallpaperChoices: function () {
          var pack = root.AlvidaaNativeWallpapers;
          if (pack && Array.isArray(pack.order) && pack.order.length) {
            return pack.order.concat(["minimal"]);
          }
          return ["fjord", "minimal"];
        },
        wallpaperLabel: function (id) {
          var key = id || (this.prefs && this.prefs.wallpaper) || "fjord";
          if (key === "minimal") return "Minimal Dark";
          var pack = root.AlvidaaNativeWallpapers;
          if (pack && pack.labels && pack.labels[key]) return pack.labels[key];
          if (key === "waves") return "Obsidian Waves";
          return "Nordic Fjord";
        },
        activeWallpaper: function () {
          var key = (this.prefs && this.prefs.wallpaper) || "fjord";
          if (key === "minimal") return "";
          var pack = root.AlvidaaNativeWallpapers;
          if (pack && pack.items && typeof pack.items === "object") {
            if (pack.items[key]) return pack.items[key];
            if (pack.default && pack.items[pack.default]) return pack.items[pack.default];
          }
          return root.AlvidaaNativeWallpaper || "";
        },
        cycleWallpaper: function (dir) {
          var choices = this.wallpaperChoices();
          var cur = (this.prefs && this.prefs.wallpaper) || choices[0];
          var at = choices.indexOf(cur);
          if (at < 0) at = 0;
          var next = choices[(at + (dir < 0 ? choices.length - 1 : 1)) % choices.length];
          writePref("alvidaa_wallpaper", next);
          this.readPrefs();
        },
        isFavorite: function (app) {
          return Boolean(app && inAppList((this.prefs && this.prefs.favorites) || [], app));
        },
        clockParts: function () {
          var hrs = this.now.getHours();
          var mins = p2(this.now.getMinutes());
          if (this.prefs && this.prefs.clock12h) {
            return { h: String(hrs % 12 || 12), m: mins, ampm: hrs >= 12 ? "PM" : "AM" };
          }
          return { h: p2(hrs), m: mins, ampm: "" };
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
        allInputs: function () {
          var raw = (this._lastData && this._lastData.sources) || this.sources;
          return this.sortInputs(raw);
        },
        inputVisible: function (input) {
          var hidden = this.prefs && this.prefs.hiddenInputs;
          if (Array.isArray(hidden) && hidden.length) return !inInputList(hidden, input);
          return true;
        },
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
            var hasOrder = Array.isArray(this.prefs && this.prefs.inputOrder) &&
              this.prefs.inputOrder.length > 0;
            this.allInputs().forEach(function (input) {
              if (!input || input.sourceId == null) return;
              var visible = vm.inputVisible(input);
              var custom = vm.prefs && vm.prefs.customNames &&
                text(vm.prefs.customNames[String(input.sourceId)]);
              rows.push({
                kind: "input", input: input,
                label: vm.sourceName(input),
                value: !visible ? "hidden" : (custom ? "custom" : ""),
                sub: String(input.sourceId) + (!visible && custom ? " \u00b7 custom" : ""),
                speak: vm.sourceName(input) +
                  (custom ? ", custom name" : "") +
                  (!visible ? ", hidden" : "")
              });
              if (custom) {
                rows.push({
                  kind: "reset-name", input: input,
                  label: "Reset name", sub: "clears the custom name",
                  speak: "Reset name for " + vm.sourceName(input)
                });
              }
            });
            if (this.allInputs().length > 1) {
              rows.push({
                kind: "open-input-order",
                label: "Reorder inputs",
                sub: hasOrder ? "custom order active" : "change dock order",
                speak: "Reorder inputs"
              });
            }
            return rows;
          }
          if (this.settingsPage === "input-order") {
            this.allInputs().forEach(function (input, idx) {
              if (!input || input.sourceId == null) return;
              var visible = vm.inputVisible(input);
              var live = signalOf(input);
              rows.push({
                kind: "input-order-item", input: input,
                label: (idx + 1) + ". " + vm.sourceName(input),
                sub: String(input.sourceId) + (live ? " \u00b7 connected" : ""),
                value: visible ? "\u2039  #" + (idx + 1) + "  \u203a" : "hidden",
                speak: vm.sourceName(input) + ", position " + (idx + 1) +
                  (visible ? "" : ", hidden")
              });
            });
            var order = this.prefs && this.prefs.inputOrder;
            if (Array.isArray(order) && order.length) {
              rows.push({
                kind: "reset-input-order",
                label: "Reset order",
                sub: "restores the TV's default input order",
                speak: "Reset input order"
              });
            }
            return rows;
          }
          var total = this.allApps().length, customCount = 0;
          var allIn = this.allInputs();
          var hiddenInCount = Math.max(0, allIn.length - this.sources.length);
          var hasInputOrder = Array.isArray(this.prefs && this.prefs.inputOrder) &&
            this.prefs.inputOrder.length > 0;
          allIn.forEach(function (input) {
            if (vm.prefs && vm.prefs.customNames &&
                text(vm.prefs.customNames[String(input.sourceId)])) customCount++;
          });
          rows.push({
            kind: "autoswitch", label: "Auto-switch on boot",
            sub: "jumps straight to the sole live input",
            value: this.prefs.autoSwitch ? "on" : "off",
            speak: "Auto-switch on boot, " + (this.prefs.autoSwitch ? "on" : "off")
          });
          rows.push({
            kind: "open-apps", label: "Apps",
            sub: this.apps.length + " shown, " + (total - this.apps.length) + " hidden"
          });
          rows.push({
            kind: "open-inputs", label: "Inputs",
            sub: (hiddenInCount ?
              (this.sources.length + " shown, " + hiddenInCount + " hidden") :
              (allIn.length + " inputs")) +
              (customCount ? " \u00b7 " + customCount + " renamed" : "") +
              (hasInputOrder ? " \u00b7 custom order" : "")
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
            sub: "ambient drifting clock after inactivity",
            value: this.prefs.idleMinutes > 0 ? this.prefs.idleMinutes + " min" : "off",
            speak: "Idle screen, " +
              (this.prefs.idleMinutes > 0 ? this.prefs.idleMinutes + " minutes" : "off")
          });
          rows.push({
            kind: "clock12h", label: "Clock format",
            sub: "12-hour or 24-hour display",
            value: this.prefs.clock12h ? "12-hour" : "24-hour",
            speak: "Clock format, " + (this.prefs.clock12h ? "12 hour" : "24 hour")
          });
          rows.push({
            kind: "wallpaper", label: "Backdrop",
            sub: "gallery artwork or minimal obsidian",
            value: this.wallpaperLabel(),
            speak: "Backdrop, " + this.wallpaperLabel()
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
        toggleInputVisible: function (input) {
          if (!input || input.sourceId == null) return;
          var visible = this.inputVisible(input);
          if (visible && this.sources.length <= 1) {
            this.showToast("keep at least one input");
            return;
          }
          var hidden = Array.isArray(this.prefs.hiddenInputs) ? this.prefs.hiddenInputs.slice() : [];
          var id = String(input.sourceId).trim().toLowerCase();
          var name = text(input.name).toLowerCase();
          var rename = text(input.rename).toLowerCase();
          var keep = [];
          for (var i = 0; i < hidden.length; i++) {
            var entry = String(hidden[i]).trim().toLowerCase();
            if (entry === id || (name && entry === name) || (rename && entry === rename)) continue;
            keep.push(hidden[i]);
          }
          if (visible) keep.push(String(input.sourceId));
          writePref("alvidaa_hidden_inputs", keep);
          this.readPrefs();
        },
        moveInput: function (input, dir) {
          if (!input || input.sourceId == null || !dir) return;
          var all = this.allInputs();
          var order = [];
          var at = -1;
          var targetId = String(input.sourceId);
          for (var i = 0; i < all.length; i++) {
            var sid = String(all[i].sourceId);
            order.push(sid);
            if (sid === targetId) at = i;
          }
          var next = at + (dir < 0 ? -1 : 1);
          if (at < 0 || next < 0 || next >= order.length) return;
          var tmp = order[at];
          order[at] = order[next];
          order[next] = tmp;
          writePref("alvidaa_input_order", order);
          this.readPrefs();
          if (this.settings && this.settingsPage === "input-order") {
            this.settingsIndex = next;
            this.clamp();
          }
        },
        resetInputOrder: function () {
          writePref("alvidaa_input_order", []);
          this.readPrefs();
          if (this.settings && this.settingsPage === "input-order") {
            this.settingsIndex = 0;
            this.clamp();
          }
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
          else if (row.kind === "clock12h") this.toggleClock12h();
          else if (row.kind === "wallpaper") this.cycleWallpaper(1);
          else if (row.kind === "idle") this.cycleIdle(1);
          else if (row.kind === "open-apps") { this.settingsPage = "apps"; this.settingsIndex = 0; this.clamp(); }
          else if (row.kind === "open-inputs") { this.settingsPage = "inputs"; this.settingsIndex = 0; this.clamp(); }
          else if (row.kind === "open-input-order") { this.settingsPage = "input-order"; this.settingsIndex = 0; this.clamp(); }
          else if (row.kind === "only-list") this.clearOnlyList();
          else if (row.kind === "app") this.toggleAppVisible(row.app);
          else if (row.kind === "input") this.openNameEditor(row.input);
          else if (row.kind === "reset-name") this.resetName(row.input);
          else if (row.kind === "reset-input-order") this.resetInputOrder();
        },
        nudgeSettingsRow: function (dir) {
          var row = this.settingsRows()[this.settingsIndex];
          if (!row) return;
          if (row.kind === "autoswitch") this.toggleAutoSwitch();
          else if (row.kind === "recent") this.toggleRecentOrder();
          else if (row.kind === "clock12h") this.toggleClock12h();
          else if (row.kind === "wallpaper") this.cycleWallpaper(dir);
          else if (row.kind === "app") this.togglePin(row.app);
          else if (row.kind === "input") this.toggleInputVisible(row.input);
          else if (row.kind === "input-order-item") this.moveInput(row.input, dir);
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
            if (this.settingsPage === "input-order") {
              this.settingsPage = "inputs";
              this.settingsIndex = 0;
              this.clamp();
              return true;
            }
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
          return false;
        },
        activate: function () {
          var vm = this;
          this.cancelIdle();
          if (this.zone === "dock") {
            var input = this.dockItems()[this.dock];
            if (!input) return;
            if (this.prefs) this.prefs.lastUsed = input.sourceId;
            writePref("alvidaa_last_used", input.sourceId);
            this.showToast("Switching to " + this.sourceName(input) + "\u2026");
            this.run(function () { return vm._platform.changeSource(input.sourceId); });
            return;
          }
          var item = this.appItems()[this.app];
          if (!item) return;
          if (item.kind === "favorite") {
            this.showToast("Opening " + (item.label || "app") + "\u2026");
            this.recordLaunch(item.appId);
            this.run(function () { return vm._platform.launchApp(item.appId); });
          } else if (item.kind === "apps") {
            this.openOverlay();
          } else if (item.kind === "launcher") {
            this.openLauncherSettings();
          } else {
            this.showToast("Opening " + item.label + "\u2026");
            this.run(function () { return vm._platform.openSettings(); });
          }
        },
        launchFocused: function () {
          var vm = this, app = this.overlayList()[this.overlayIndex];
          if (!app) return;
          this.cancelIdle();
          this.showToast("Opening " + (app.appName || "app") + "\u2026");
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
            this.cancelIdle();
            return true;
          }
          this.armIdle();
          if (this.settings) {
            var handled = this.handleSettingsKey(code);
            if (handled && this.autoSwitchAt) this.cancelAutoSwitch();
            return handled;
          }
          if (this.overlay) {
            if (code === keys.BACK || code === keys.RETURN) { this.closeOverlay(); return true; }
            if (code === keys.ENTER) { this.launchFocused(); return true; }
            var spans = this.overlaySpans();
            if (spans) {
              // Grouped navigation (issue #57): Left/Right step within a group
              // and stop at its ends; Up/Down step row-by-row inside multi-row
              // groups and smoothly cross into adjacent groups at the edges.
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
                if (offset >= OVERLAY_COLS) {
                  this.overlayIndex -= OVERLAY_COLS;
                } else if (group > 0) {
                  var up = spans[group - 1];
                  var lastRowStart = Math.floor((up.count - 1) / OVERLAY_COLS) * OVERLAY_COLS;
                  var upCol = offset % OVERLAY_COLS;
                  this.overlayIndex = up.start + Math.min(lastRowStart + upCol, up.count - 1);
                }
              }
              else if (code === keys.DOWN) {
                var groupRows = Math.ceil(spans[group].count / OVERLAY_COLS);
                var curRow = Math.floor(offset / OVERLAY_COLS);
                if (curRow < groupRows - 1) {
                  this.overlayIndex = spans[group].start +
                    Math.min(offset + OVERLAY_COLS, spans[group].count - 1);
                } else if (group < spans.length - 1) {
                  var down = spans[group + 1];
                  var downCol = offset % OVERLAY_COLS;
                  this.overlayIndex = down.start + Math.min(downCol, down.count - 1);
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
            if (this.zone === "apps") { this.zone = "dock"; return true; }
            return false;
          }
          if (code === keys.ENTER) { this.activate(); return true; }
          if (code === keys.DOWN) { this.zone = "apps"; this.app = 0; this.syncTint(); return true; }
          if (code === keys.UP) {
            if (this.zone === "apps") { this.zone = "dock"; this.syncTint(); return true; }
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
          else this.syncTint();
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
        var clock = this.clockParts();

        function s(n) { return n * scale + "px"; }
        function box(x, y, w, height, more) {
          var style = { position: "absolute", left: x * scale + "px", top: y * scale + "px" };
          if (w != null) style.width = w * scale + "px";
          if (height != null) style.height = height * scale + "px";
          Object.keys(more || {}).forEach(function (key) {
            style[key] = typeof more[key] === "number" ? more[key] * scale + "px" : more[key];
          });
          return style;
        }
        function label(x, y, size, value, color, weight, more) {
          var opts = {
            fontSize: size, lineHeight: size + 4, color: color, fontWeight: String(weight || 500)
          };
          if (more) {
            Object.keys(more).forEach(function (k) { opts[k] = more[k]; });
          }
          return h("div", { style: box(x, y, null, null, opts) }, [value]);
        }
        // Subtle 1px specular glass edge along the top of elevated cards & panels.
        function specularEdge(w, inset, alpha) {
          var padX = inset != null ? inset : 28;
          var a = alpha != null ? alpha : 0.48;
          return h("div", { style: box(padX, 0, w - padX * 2, 1, {
            pointerEvents: "none",
            backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0), rgba(255,255,255," + a + "), rgba(255,255,255,0))"
          }) });
        }
        // Subtle vertical scrollbar track + thumb when a modal list overflows.
        function scrollIndicator(x, y, height, firstIdx, visibleCount, totalCount) {
          if (totalCount <= visibleCount || visibleCount <= 0) return null;
          var ratio = Math.max(0.14, visibleCount / totalCount);
          var thumbH = Math.max(36, Math.round(height * ratio));
          var maxTop = height - thumbH;
          var progress = Math.min(1, Math.max(0, firstIdx / Math.max(1, totalCount - visibleCount)));
          var thumbY = Math.round(maxTop * progress);
          return h("div", { style: box(x, y, 4, height, {
            borderRadius: 2, backgroundColor: "rgba(255,255,255,0.06)", pointerEvents: "none"
          }) }, [
            h("div", { style: box(0, thumbY, 4, thumbH, {
              borderRadius: 2, backgroundColor: "rgba(255,255,255,0.28)"
            }) })
          ]);
        }

        // ---- the idle layer (issue #58) -------------------------------------
        // Subtle deterministic OLED pixel-shift per minute protects static panels
        // while keeping the layout serene: wallpaper, clock, date — nothing else.
        if (this.idle) {
          var idleWallpaper = this.activeWallpaper();
          var driftTick = this.now.getHours() * 60 + this.now.getMinutes();
          var driftX = Math.round(Math.sin(driftTick * 0.47) * 44);
          var driftY = Math.round(Math.cos(driftTick * 0.31) * 24);
          var idleClockNodes = [
            h("span", { style: { color: "rgba(255,255,255,0.92)" } }, [clock.h]),
            h("span", { style: { color: "rgba(255,255,255,0.28)" } }, [":"]),
            h("span", { style: { color: "rgba(255,255,255,0.82)" } }, [clock.m])
          ];
          if (clock.ampm) {
            idleClockNodes.push(h("span", { style: {
              fontSize: s(52), fontWeight: "400", letterSpacing: s(2),
              color: "rgba(255,255,255,0.42)", marginLeft: s(16)
            } }, [clock.ampm]));
          }
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
              pointerEvents: "none", backgroundColor: "rgba(6,8,12,0.58)"
            } }),
            h("div", { style: box(driftX, 376 + driftY, 1920, null, {
              textAlign: "center", fontSize: 220, lineHeight: 228,
              fontWeight: "300", letterSpacing: s(-4)
            }) }, idleClockNodes),
            h("div", { style: box(driftX, 646 + driftY, 1920, null, {
              textAlign: "center", fontSize: 28, lineHeight: 36,
              color: "rgba(148,163,184,0.75)", fontWeight: "600", letterSpacing: s(3)
            }) }, [dateText])
          ]);
        }

        // Scaled div-shape fallback when raster PNGs are not baked into the build.
        // Every coordinate and stroke multiplies by `scale` so 720p/1280px previews
        // stay aligned with the 1080p layout.
        function deviceShapes(icon, focused, size) {
          var ink = focused ? "rgba(255,255,255,0.92)" : "rgba(148,163,184,0.75)";
          var sw = Math.max(1, Math.round(3 * scale * 10) / 10);
          var out = [];
          function rect(x, y, rw, rh, more) {
            var r = more && more.r != null ? more.r : 3;
            var style = {
              position: "absolute", left: s(x), top: s(y),
              width: s(rw), height: s(rh), border: sw + "px solid " + ink,
              borderRadius: typeof r === "number" ? s(r) : r, boxSizing: "border-box"
            };
            if (more && more.fill) { style.border = "none"; style.backgroundColor = ink; }
            return style;
          }
          function bar(x, y, rw, rh) {
            return {
              position: "absolute", left: s(x), top: s(y),
              width: s(rw), height: s(rh), backgroundColor: ink, borderRadius: s(2)
            };
          }
          var cx = size / 2;
          if (icon === "gamepad-2") {
            out.push({
              position: "absolute", left: s(cx - 21), top: s(16),
              width: s(42), height: s(22), border: sw + "px solid " + ink,
              borderRadius: s(11), boxSizing: "border-box"
            });
            out.push(bar(cx - 13, 25, 8, 2));
            out.push(bar(cx - 10, 22, 2, 8));
            out.push({
              position: "absolute", left: s(cx + 8), top: s(24),
              width: s(5), height: s(5), borderRadius: "50%", backgroundColor: ink
            });
            out.push({
              position: "absolute", left: s(cx + 14), top: s(28),
              width: s(5), height: s(5), borderRadius: "50%", backgroundColor: ink
            });
          } else if (icon === "cast") {
            out.push(rect(cx - 20, 14, 40, 27, { r: 4 }));
            out.push({
              position: "absolute", left: s(cx - 20), top: s(30),
              width: s(9), height: s(9), backgroundColor: ink, borderRadius: s(2)
            });
          } else if (icon === "tv") {
            out.push(rect(cx - 20, 14, 40, 26, { r: 4 }));
            out.push(bar(cx - 2, 40, 4, 7));
            out.push(bar(cx - 11, 47, 22, 3));
          } else if (icon === "monitor") {
            out.push(rect(cx - 20, 13, 40, 24, { r: 3 }));
            out.push(bar(cx - 2, 37, 4, 8));
            out.push(bar(cx - 12, 45, 24, 3));
          } else if (icon === "disc") {
            out.push({
              position: "absolute", left: s(cx - 17), top: s(11),
              width: s(34), height: s(34), border: sw + "px solid " + ink,
              borderRadius: "50%", boxSizing: "border-box"
            });
            out.push({
              position: "absolute", left: s(cx - 5), top: s(23),
              width: s(10), height: s(10), border: sw + "px solid " + ink,
              borderRadius: "50%", boxSizing: "border-box"
            });
          } else if (icon === "usb") {
            out.push(rect(cx - 8, 20, 16, 24, { r: 3 }));
            out.push({
              position: "absolute", left: s(cx - 4), top: s(13),
              width: s(8), height: s(7), backgroundColor: ink, borderRadius: s(2)
            });
            out.push(bar(cx - 4, 29, 8, 2));
          } else if (icon === "cpu") {
            out.push(rect(cx - 15, 15, 30, 26, { r: 3 }));
            out.push(rect(cx - 7, 23, 14, 10, { r: 2 }));
          } else {
            out.push(rect(cx - 15, 16, 30, 24, { r: 4 }));
            out.push(bar(cx - 15, 26, 30, 2));
          }
          return out.map(function (style) { return h("div", { style: style }); });
        }

        // Brand monogram badge shared by the Apps overlay and View 2 favorites
        // when no allowlisted icon file is present.
        function brandBadge(appName, x, y, size, radius) {
          var badge = brand(appName);
          return h("div", { style: box(x, y, size, size, {
            borderRadius: radius, backgroundColor: badge, overflow: "hidden",
            backgroundImage: "linear-gradient(160deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 56%, rgba(0,0,0,0.20))",
            border: "1px solid rgba(255,255,255,0.18)",
            boxShadow: "0 10px 24px rgba(0,0,0,0.44)"
          }) }, [
            h("div", { style: box(0, 0, size, 2, { backgroundColor: "rgba(255,255,255,0.36)" }) }),
            h("div", { style: box(0, 0, size, size, {
              fontSize: Math.round(size * 0.46), lineHeight: size, textAlign: "center",
              fontWeight: "700", color: "#ffffff"
            }) }, [String(appName || "?").charAt(0).toUpperCase()])
          ]);
        }

        // Shared sculptural dark-glass card styling for View 1 & View 2.
        function cardStyle(x, y, focused) {
          return box(x, y, DOCK_SIZE, DOCK_HEIGHT, {
            borderRadius: 28,
            backgroundColor: focused ? "rgba(32,42,60,0.92)" : "rgba(14,18,28,0.78)",
            backgroundImage: focused ?
              "linear-gradient(180deg, rgba(255,255,255,0.20), rgba(255,255,255,0.06))" :
              "linear-gradient(180deg, rgba(255,255,255,0.05), rgba(255,255,255,0.01))",
            border: "1px solid " + (focused ? "rgba(255,255,255,0.40)" : "rgba(255,255,255,0.09)"),
            boxShadow: focused ? "0 24px 52px rgba(0,0,0,0.62)" : "0 10px 24px rgba(0,0,0,0.34)",
            overflow: "hidden",
            transition: "transform 150ms ease-out, border-color 150ms ease-out, background-color 150ms ease-out",
            transform: focused ? "scale(1.03)" : "scale(1)"
          });
        }

        function overlayCell(app, selected, index, x, y, cellW) {
          var icon = vm.appIcon(app);
          var pinned = vm.isFavorite(app);
          var tileH = OVERLAY_CELL - 24;
          var cell = [];
          if (selected) {
            cell.push(specularEdge(cellW, 22, 0.56));
            cell.push(h("div", { style: box(0, 0, cellW, tileH, {
              pointerEvents: "none",
              backgroundImage: "radial-gradient(circle at 50% 38%, " +
                brandGlow(app.appName, 0.24) + ", rgba(255,255,255,0.05) 42%, rgba(0,0,0,0) 76%)"
            }) }));
          }
          if (pinned) {
            cell.push(h("div", { style: box(cellW - 28, 10, 18, 18, {
              fontSize: 13, lineHeight: 18, textAlign: "right",
              color: selected ? "rgba(251,191,36,0.95)" : "rgba(251,191,36,0.52)"
            }) }, ["\u2605"]));
          }
          var iconX = (cellW - ICON) / 2;
          if (icon) {
            cell.push(h("div", { style: box(iconX, 16, ICON, ICON, {
              borderRadius: 20, overflow: "hidden",
              backgroundColor: "rgba(9,13,22,0.56)",
              border: "1px solid " + (selected ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.09)"),
              boxShadow: selected ? "0 10px 24px rgba(0,0,0,0.48)" : "0 6px 14px rgba(0,0,0,0.28)"
            }) }, [
              h("div", { style: box(6, 6, ICON - 12, ICON - 12, {
                backgroundImage: "url(" + JSON.stringify(icon) + ")",
                backgroundSize: "contain", backgroundPosition: "center",
                backgroundRepeat: "no-repeat"
              }) })
            ]));
          } else {
            cell.push(brandBadge(app.appName, iconX, 16, ICON, 20));
          }
          var name = String(app.appName || "");
          if (name.length > 20) name = name.slice(0, 19) + "\u2026";
          cell.push(h("div", { style: box(12, 104, cellW - 24, 30, {
            fontSize: 20, lineHeight: 30, textAlign: "center",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            fontWeight: selected ? "600" : "500",
            color: selected ? "#ffffff" : "#9fb0c9"
          }) }, [name]));
          return h("div", {
            attrs: { role: "button", "aria-label": String(app.appName || ""), tabindex: selected ? "0" : "-1" },
            style: box(x, y, cellW, tileH, {
              borderRadius: 24,
              backgroundColor: selected ? "rgba(38,48,70,0.95)" : "rgba(20,26,38,0.74)",
              backgroundImage: selected ?
                "linear-gradient(180deg, rgba(255,255,255,0.16), rgba(255,255,255,0.04))" :
                "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.01))",
              border: selected ? "1px solid rgba(255,255,255,0.44)" : "1px solid rgba(255,255,255,0.08)",
              boxShadow: selected ? "0 18px 40px rgba(0,0,0,0.62)" : "0 8px 20px rgba(0,0,0,0.32)",
              transform: selected ? "scale(1.05)" : "scale(1)",
              transition: "transform 140ms ease-out, border-color 140ms ease-out, background-color 140ms ease-out",
              overflow: "hidden"
            }),
            on: { click: function (i) {
              return function () { vm.overlayIndex = i; vm.launchFocused(); };
            }(index) }
          }, cell);
        }

        // Inline keycap + action cue rendered below hero titles in View 1 & View 2.
        function okCue(x, y, dotColor, statusText, statusColor, portTag, actionVerb) {
          var parts = [];
          if (dotColor) {
            parts.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              width: s(9), height: s(9), borderRadius: s(5),
              backgroundColor: dotColor,
              boxShadow: dotColor === "#10b981" ? "0 0 10px rgba(16,185,129,0.75)" : "none",
              marginRight: s(10)
            } }));
          }
          parts.push(h("span", { style: {
            display: "inline-block", verticalAlign: "middle",
            color: statusColor, fontWeight: "500"
          } }, [statusText]));
          if (portTag) {
            parts.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              color: "rgba(148,163,184,0.45)", marginLeft: s(14), marginRight: s(14)
            } }, ["\u00b7"]));
            parts.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              color: "rgba(148,163,184,0.72)", fontSize: s(20), fontWeight: "500",
              letterSpacing: s(0.5)
            } }, [portTag]));
          }
          if (actionVerb) {
            parts.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              color: "rgba(148,163,184,0.4)", marginLeft: s(16), marginRight: s(14)
            } }, ["\u00b7"]));
            parts.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              color: "rgba(203,213,225,0.72)", fontSize: s(21), fontWeight: "400"
            } }, ["Press "]));
            parts.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              marginLeft: s(6), marginRight: s(6),
              padding: s(2) + " " + s(10),
              borderRadius: s(8),
              backgroundColor: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.28)",
              color: "#f8fafc", fontSize: s(15), lineHeight: s(20),
              fontWeight: "600", letterSpacing: s(0.8)
            } }, ["OK"]));
            parts.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              color: "rgba(203,213,225,0.72)", fontSize: s(21), fontWeight: "400"
            } }, [" " + actionVerb]));
          }
          return h("div", { style: box(x, y, 1696, 36, {
            fontSize: 23, lineHeight: 34, whiteSpace: "nowrap", overflow: "hidden"
          }) }, parts);
        }

        // ---- fixed top bar (quiet context left, refined clock right) --------
        var liveCount = 0;
        for (var lc = 0; lc < this.sources.length; lc++) {
          if (signalOf(this.sources[lc])) liveCount++;
        }
        var topLeftNodes = [
          h("span", { style: {
            display: "inline-block", verticalAlign: "middle",
            color: "rgba(248,250,252,0.42)", fontWeight: "600",
            letterSpacing: s(3.2)
          } }, ["ALVIDAA"])
        ];
        if (liveCount > 0) {
          topLeftNodes.push(h("span", { style: {
            display: "inline-block", verticalAlign: "middle",
            width: s(6), height: s(6), borderRadius: s(3),
            backgroundColor: "#10b981", marginLeft: s(18), marginRight: s(8)
          } }));
          topLeftNodes.push(h("span", { style: {
            display: "inline-block", verticalAlign: "middle",
            color: "rgba(148,163,184,0.65)", fontWeight: "500",
            letterSpacing: s(0.6)
          } }, [liveCount + " live"]));
        }
        var clockChildren = [
          h("span", { style: { color: "#f8fafc" } }, [clock.h]),
          h("span", { style: { color: "rgba(255,255,255,0.34)" } }, [":"]),
          h("span", { style: { color: "rgba(255,255,255,0.90)" } }, [clock.m])
        ];
        if (clock.ampm) {
          clockChildren.push(h("span", { style: {
            fontSize: s(22), fontWeight: "500", letterSpacing: s(1.5),
            color: "rgba(148,163,184,0.75)", marginLeft: s(8)
          } }, [clock.ampm]));
        }
        var headerBar = h("div", {
          attrs: { "data-header-bar": "true" },
          style: {
            position: "absolute", left: "0", top: "0", width: "100%",
            height: s(180), pointerEvents: "none"
          }
        }, [
          h("div", { style: box(112, 66, 600, 28, {
            fontSize: 15, lineHeight: 24
          }) }, topLeftNodes),
          h("div", {
            attrs: { "data-clock": "true" },
            style: box(1280, 50, 528, 72, {
              textAlign: "right", fontSize: 64, lineHeight: 68,
              fontWeight: "300", letterSpacing: s(-1.5)
            })
          }, clockChildren),
          h("div", { style: box(1280, 122, 528, 24, {
            textAlign: "right", fontSize: 16, lineHeight: 22,
            color: "#7c8aa3", fontWeight: "600", letterSpacing: s(2)
          }) }, [dateText])
        ]);

        var nodes = [];

        // ---- view 1: hero title + sculptural inputs dock --------------------
        if (this.zone === "dock") {
          var focus = this.dockItems()[this.dock];
          if (focus) {
            var live = signalOf(focus);
            var rawName = this.sourceName(focus);
            var heroTitle = this.cleanDisplayName(rawName);
            var portLabel = text(focus.name);
            var showPort = portLabel && portLabel.toLowerCase() !== heroTitle.toLowerCase() ? portLabel : "";
            var verb = /tv|channel|antenna|tuner/i.test(heroTitle) ? "to watch" : "to switch";
            nodes.push(h("div", { style: box(112, 488, 1560, 96, {
              fontSize: 84, lineHeight: 92, fontWeight: "600",
              letterSpacing: s(-2),
              color: live ? "#f8fafc" : "#dce4f2",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
            }) }, [heroTitle]));
            nodes.push(okCue(114, 594, live ? "#10b981" : "#64748b",
              live ? "connected" : "no signal",
              live ? "#34d399" : "#8392ab",
              showPort, verb));
          }
        }

        var dock = this.dockItems(), start = this.dockStart();
        var end = Math.min(dock.length, start + DOCK_PAGE);
        nodes.push(label(112, 676, 16, "INPUTS & SOURCES", "rgba(148,163,184,0.62)", 600, {
          letterSpacing: s(2.4), lineHeight: 20
        }));
        if (dock.length > DOCK_PAGE) {
          nodes.push(h("div", { style: box(1408, 676, 400, 20, {
            fontSize: 15, lineHeight: 20, textAlign: "right",
            color: "rgba(148,163,184,0.58)", fontWeight: "500"
          }) }, [(start + 1) + "\u2013" + end + " of " + dock.length]));
        }

        if (!dock.length && !this._payloadReceived) {
          var artTable = root.AlvidaaNativeDeviceArt;
          var fallbackPng = (artTable && artTable.pngs && artTable.pngFallback) ?
            allowedRaster(artTable.pngs[artTable.pngFallback]) : "";
          var fallbackShape = (artTable && artTable.fallback) || "";
          for (var ph = 0; ph < DOCK_PAGE; ph++) {
            var ghost = [];
            if (fallbackPng) {
              ghost.push(h("div", { style: box(30, 32, 260, 148, {
                backgroundImage: "url(" + JSON.stringify(fallbackPng) + ")",
                backgroundSize: "contain", backgroundPosition: "center",
                backgroundRepeat: "no-repeat", opacity: 0.35
              }) }));
            } else if (fallbackShape) {
              ghost.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 72, 56, 56, {
                opacity: 0.65
              }) }, deviceShapes(fallbackShape, false, 56)));
            } else {
              var ghostInk = "rgba(148,163,184,0.5)";
              ghost.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 78, 56, 34, {
                border: Math.max(1, Math.round(3 * scale)) + "px solid " + ghostInk, borderRadius: 6
              }) }));
              ghost.push(h("div", { style: box(DOCK_SIZE / 2 - 2, 112, 4, 8, { backgroundColor: ghostInk }) }));
              ghost.push(h("div", { style: box(DOCK_SIZE / 2 - 12, 120, 24, 3, { backgroundColor: ghostInk }) }));
            }
            nodes.push(h("div", {
              attrs: { "data-dock-placeholder": "true", "aria-hidden": "true" },
              style: cardStyle(112 + ph * (DOCK_SIZE + DOCK_GAP), 714, false)
            }, ghost));
          }
        } else if (!dock.length) {
          nodes.push(label(112, 764, 28, "no inputs reported", "#475569", 500));
        }

        for (var i = start; i < end; i++) {
          var input = dock[i];
          var focused = this.zone === "dock" && this.dock === i;
          var liveInput = signalOf(input);
          var x = 112 + (i - start) * (DOCK_SIZE + DOCK_GAP);
          var fullName = this.sourceName(input);
          var displayName = this.cleanDisplayName(fullName);
          var tile = [];
          if (focused) {
            tile.push(specularEdge(DOCK_SIZE, 28, 0.55));
            tile.push(h("div", { style: box(0, 0, DOCK_SIZE, 196, {
              pointerEvents: "none",
              backgroundImage: "radial-gradient(circle at 50% 48%, rgba(255,255,255,0.12), rgba(255,255,255,0) 70%)"
            }) }));
          }
          // Ultra-minimal top-left status dot (quiet emerald glow when live, subtle dim dot on standby).
          if (liveInput) {
            tile.push(h("div", { style: box(20, 19, 8, 8, {
              borderRadius: 4, backgroundColor: "#10b981",
              boxShadow: "0 0 10px rgba(16,185,129,0.8)"
            }) }));
            tile.push(h("div", { style: box(34, 14, 56, 18, {
              fontSize: 12, lineHeight: 18, fontWeight: "700",
              letterSpacing: s(1.4),
              color: focused ? "#6ee7b7" : "#34d399"
            }) }, ["LIVE"]));
          } else {
            tile.push(h("div", { style: box(20, 20, 6, 6, {
              borderRadius: 3, backgroundColor: focused ? "rgba(148,163,184,0.52)" : "rgba(148,163,184,0.22)"
            }) }));
          }
          // Whisper-quiet remote hotkey numeral in top-right.
          if (i < 9) {
            tile.push(h("div", { style: box(DOCK_SIZE - 42, 13, 24, 22, {
              fontSize: 15, lineHeight: 22, textAlign: "right", fontWeight: "600",
              color: focused ? "rgba(255,255,255,0.72)" : "rgba(148,163,184,0.28)"
            }) }, [String(i + 1)]));
          }
          // Hardware asset: Cobalt-safe PNG data URI via background-image first,
          // falling back cleanly to scaled div shapes when no PNGs are baked.
          var pngUri = this.deviceArtPng(fullName);
          var shapeName = pngUri ? "" : this.deviceArtName(fullName);
          if (pngUri) {
            tile.push(h("div", {
              attrs: { "data-device-art": "png" },
              style: box(30, 32, 260, 148, {
                backgroundImage: "url(" + JSON.stringify(pngUri) + ")",
                backgroundSize: "contain", backgroundPosition: "center",
                backgroundRepeat: "no-repeat",
                opacity: focused ? 1 : 0.78,
                transition: "opacity 160ms ease-out"
              })
            }));
          } else if (shapeName) {
            tile.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 74, 56, 56, {
              opacity: focused ? 1 : 0.82
            }) }, deviceShapes(shapeName, focused, 56)));
          } else if (text(input.glyph)) {
            tile.push(h("div", { style: box(0, 72, DOCK_SIZE, 60, {
              fontSize: 52, lineHeight: 60, textAlign: "center",
              color: focused ? "#ffffff" : "#cbd5e1"
            }) }, [text(input.glyph)]));
          } else {
            var ink = focused ? "rgba(255,255,255,0.9)" : "rgba(148,163,184,0.6)";
            tile.push(h("div", { style: box((DOCK_SIZE - 56) / 2, 78, 56, 34, {
              border: Math.max(1, Math.round(3 * scale)) + "px solid " + ink, borderRadius: 6
            }) }));
            tile.push(h("div", { style: box(DOCK_SIZE / 2 - 2, 112, 4, 8, { backgroundColor: ink }) }));
            tile.push(h("div", { style: box(DOCK_SIZE / 2 - 12, 120, 24, 3, { backgroundColor: ink }) }));
          }
          tile.push(h("div", { style: box(24, DOCK_HEIGHT - 54, DOCK_SIZE - 48, 34, {
            fontSize: 23, lineHeight: 34, textAlign: "left",
            fontWeight: focused ? "600" : "500",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            color: focused ? "#ffffff" : "#a5b4cc"
          }) }, [displayName]));
          nodes.push(h("div", {
            attrs: {
              role: "button", "data-dock-tile": "true",
              "aria-label": fullName, tabindex: focused ? "0" : "-1"
            },
            style: cardStyle(x, 714, focused),
            on: { click: function (index) {
              return function () { vm.zone = "dock"; vm.dock = index; vm.activate(); };
            }(i) }
          }, tile));
        }

        // Whisper-quiet bottom cue that pressing Down opens Favorites, Apps & Settings.
        nodes.push(h("div", { style: box(0, 1014, 1920, 24, {
          textAlign: "center", fontSize: 15, lineHeight: 24, fontWeight: "500",
          letterSpacing: s(1.4), color: "rgba(148,163,184,0.42)",
          pointerEvents: "none"
        }) }, ["APPS & SETTINGS  \u25be"]));

        // ---- view 2: favorites, apps & settings row -------------------------
        var rowY = 1080;
        nodes.push(h("div", { style: box(0, rowY + 56, 1920, 24, {
          textAlign: "center", fontSize: 15, lineHeight: 24, fontWeight: "500",
          letterSpacing: s(1.4), color: "rgba(148,163,184,0.42)",
          pointerEvents: "none"
        }) }, ["\u25b4  INPUTS & SOURCES"]));

        var appItems = this.appItems();
        var appStartIdx = this.appStart();
        var appEndIdx = Math.min(appItems.length, appStartIdx + DOCK_PAGE);

        if (this.zone === "apps") {
          var focusedItem = appItems[this.app];
          if (focusedItem) {
            var v2Title = focusedItem.kind === "apps" ? "All Apps" :
              focusedItem.kind === "settings" ? "TV Settings" :
              focusedItem.kind === "launcher" ? "Home Settings" : focusedItem.label;
            var v2Sub = focusedItem.kind === "favorite" ? "Pinned favorite" :
              focusedItem.kind === "apps" ? (this.apps.length ? this.apps.length + " installed apps" : "App drawer") :
              focusedItem.kind === "settings" ? "Picture, audio & system" :
              "Inputs, apps, clock & idle";
            var v2Dot = focusedItem.kind === "launcher" ? "#38bdf8" :
              focusedItem.kind === "favorite" ? "#fbbf24" : "#94a3b8";
            nodes.push(h("div", { style: box(112, rowY + 488, 1560, 96, {
              fontSize: 80, lineHeight: 88, fontWeight: "600",
              letterSpacing: s(-2), color: "#f8fafc",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
            }) }, [v2Title]));
            nodes.push(okCue(114, rowY + 594, v2Dot, v2Sub, "#94a3b8", "", "to open"));
          }
        }

        nodes.push(label(112, rowY + 676, 16, "APPS", "rgba(148,163,184,0.62)", 600, {
          letterSpacing: s(2.4), lineHeight: 20
        }));
        var v2Meta = appItems.length > DOCK_PAGE ?
          (appStartIdx + 1) + "\u2013" + appEndIdx + " of " + appItems.length + "  \u00b7  OK to open \u00b7 BACK to return" :
          "OK to open \u00b7 BACK to return";
        nodes.push(h("div", { style: box(908, rowY + 676, 900, 20, {
          fontSize: 15, lineHeight: 20, textAlign: "right", color: "rgba(148,163,184,0.55)"
        }) }, [v2Meta]));

        for (var ai = appStartIdx; ai < appEndIdx; ai++) {
          var item = appItems[ai];
          var appFocused = vm.zone === "apps" && vm.app === ai;
          var tileX = 112 + (ai - appStartIdx) * (DOCK_SIZE + DOCK_GAP);
          var children = [];
          if (appFocused) {
            children.push(specularEdge(DOCK_SIZE, 28, 0.55));
            children.push(h("div", { style: box(0, 0, DOCK_SIZE, 196, {
              pointerEvents: "none",
              backgroundImage: item.kind === "favorite" ?
                "radial-gradient(circle at 50% 44%, " + brandGlow(item.label, 0.24) + ", rgba(255,255,255,0.04) 44%, rgba(255,255,255,0) 72%)" :
                "radial-gradient(circle at 50% 46%, rgba(255,255,255,0.12), rgba(255,255,255,0) 70%)"
            }) }));
          }
          if (item.kind === "favorite") {
            // Subtle pin star top-left.
            children.push(h("div", { style: box(20, 15, 22, 22, {
              fontSize: 15, lineHeight: 22,
              color: appFocused ? "rgba(251,191,36,0.9)" : "rgba(251,191,36,0.42)"
            }) }, ["\u2605"]));
            if (item.icon) {
              // backgroundImage, never <img> — Cobalt fails to paint cached icons on <img>.
              children.push(h("div", {
                style: box((DOCK_SIZE - 108) / 2, 40, 108, 108, {
                  borderRadius: 26, overflow: "hidden",
                  backgroundColor: "rgba(9,13,22,0.56)",
                  border: "1px solid " + (appFocused ? "rgba(255,255,255,0.24)" : "rgba(255,255,255,0.10)"),
                  boxShadow: appFocused ? "0 12px 28px rgba(0,0,0,0.48)" : "0 8px 18px rgba(0,0,0,0.32)"
                })
              }, [
                h("div", {
                  attrs: { "data-favorite-icon": "true", "aria-label": item.label || "" },
                  style: box(8, 8, 92, 92, {
                    backgroundImage: "url(" + JSON.stringify(item.icon) + ")",
                    backgroundSize: "contain", backgroundPosition: "center",
                    backgroundRepeat: "no-repeat",
                    opacity: appFocused ? 1 : 0.88
                  })
                })
              ]));
            } else {
              children.push(brandBadge(item.label, (DOCK_SIZE - 104) / 2, 42, 104, 24));
            }
          } else {
            var doorPng = vm.doorArtPng(item.kind);
            if (doorPng) {
              children.push(h("div", {
                attrs: { "data-door-art": item.kind },
                style: box(30, 24, 260, 144, {
                  backgroundImage: "url(" + JSON.stringify(doorPng) + ")",
                  backgroundSize: "contain", backgroundPosition: "center",
                  backgroundRepeat: "no-repeat",
                  opacity: appFocused ? 1 : 0.80,
                  transition: "opacity 160ms ease-out"
                })
              }));
            } else {
              children.push(h("div", { style: box(0, 62, DOCK_SIZE, 66, {
                fontSize: 56, lineHeight: 66, textAlign: "center",
                color: item.accent || (appFocused ? "#ffffff" : "#cbd5e1")
              }) }, [item.glyph]));
            }
          }
          children.push(h("div", { style: box(24, DOCK_HEIGHT - 70, DOCK_SIZE - 48, 32, {
            fontSize: 22, lineHeight: 32, textAlign: "left",
            fontWeight: appFocused ? "600" : "500",
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
            color: appFocused ? "#ffffff" : "#b4c1d8"
          }) }, [item.label]));
          if (item.sub) {
            children.push(h("div", { style: box(24, DOCK_HEIGHT - 38, DOCK_SIZE - 48, 22, {
              fontSize: 15, lineHeight: 22, textAlign: "left",
              whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
              color: item.kind === "launcher" && appFocused ? "#7dd3fc" : "#64748b"
            }) }, [item.sub]));
          }
          if (item.kind === "launcher") {
            children.push(h("div", { style: box(24, DOCK_HEIGHT - 6, appFocused ? 40 : 20, 3, {
              borderRadius: 2, backgroundColor: appFocused ? "#38bdf8" : "rgba(56,189,248,0.42)",
              transition: "width 160ms ease-out, background-color 160ms ease-out"
            }) }));
          }
          nodes.push(h("div", {
            attrs: { role: "button", "aria-label": item.label, tabindex: appFocused ? "0" : "-1" },
            style: cardStyle(tileX, rowY + 714, appFocused),
            on: { click: function (index) {
              return function () { vm.zone = "apps"; vm.app = index; vm.activate(); };
            }(ai) }
          }, children));
        }

        var stage = h("div", { style: {
          position: "absolute", left: "0", top: "0", width: "100%",
          height: 2160 * scale + "px",
          transform: "translateY(" + (this.zone === "apps" ? -1080 * scale : 0) + "px)",
          transition: "transform 350ms ease-out"
        } }, nodes);

        var wallpaper = this.activeWallpaper();
        var artMap = root.AlvidaaNativeInputArt;
        var hasCustomArt = Boolean(artMap && (this.activeArt || this.outgoingArt));

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
            backgroundImage: "linear-gradient(180deg, rgba(56,189,248,0.08), rgba(99,102,241,0.03) 45%, rgba(7,8,12,0) 75%)"
          } })
        ].concat(artLayers).concat([
          // Bottom-weighted vignette keeps the upper gallery artwork luminous
          // while guaranteeing high contrast beneath the hero title & dock.
          h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            pointerEvents: "none",
            backgroundImage: hasCustomArt ?
              "linear-gradient(180deg, rgba(6,8,14,0.34) 0%, rgba(6,8,14,0.46) 50%, rgba(6,8,14,0.78) 100%)" :
              "linear-gradient(180deg, rgba(5,7,12,0.06) 0%, rgba(5,7,12,0.16) 46%, rgba(5,7,12,0.72) 100%)"
          } })
        ]).concat((function () {
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
          headerBar,
          (function () {
            var nowMs = Date.now();
            var isAutoSwitch = Boolean(vm.autoSwitchAt && vm.autoSwitchAt > nowMs && vm.autoSwitchId != null);
            var isToast = Boolean(vm.toast && nowMs < vm.toastUntil);
            var hudVisible = isAutoSwitch || isToast;
            var msg = "";
            if (isAutoSwitch) {
              var rem = Math.max(1, Math.ceil((vm.autoSwitchAt - nowMs) / 1000));
              msg = "Switching to " + vm.autoSwitchName + " in " + rem + "s - press any key to stay";
            } else if (isToast) {
              msg = vm.toast;
            }
            return h("div", {
              attrs: { role: "status", "aria-live": "polite" },
              style: {
                position: "absolute",
                left: "50%",
                bottom: 24 * scale + "px",
                transform: "translateX(-50%)" + (hudVisible ? " translateY(0)" : " translateY(8px)"),
                opacity: hudVisible ? 1 : 0,
                visibility: hudVisible ? "visible" : "hidden",
                transition: "opacity 180ms ease-out, transform 180ms ease-out",
                pointerEvents: "none",
                padding: (9 * scale) + "px " + (24 * scale) + "px",
                borderRadius: (22 * scale) + "px",
                backgroundColor: "rgba(15, 23, 42, 0.92)",
                border: "1px solid rgba(255, 255, 255, 0.20)",
                boxShadow: "0 12px 32px rgba(0, 0, 0, 0.58)",
                fontSize: (18 * scale) + "px",
                lineHeight: (24 * scale) + "px",
                fontWeight: "500",
                color: "#f8fafc",
                whiteSpace: "nowrap"
              }
            }, [msg]);
          }())
        ]);

        // ---- the app list overlay (polished gallery drawer) ----------------
        if (this.overlay) {
          var panelX = 64, panelY = 92, panelW = 1792, panelH = 896;
          var pad = OVERLAY_PAD, gutter = OVERLAY_GUTTER;
          var tileW = (panelW - 2 * pad - (OVERLAY_COLS - 1) * gutter) / OVERLAY_COLS;
          var listY = 128;
          var headerH = 58;
          var rows = Math.max(1, Math.floor((panelH - listY - pad) / OVERLAY_CELL));
          var layout = this.overlayLayout();
          var spans = this.overlaySpans();
          var flatList = this.overlayList();
          var focusedApp = flatList[this.overlayIndex] || null;
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
          var shown = flatList.length;
          var focusAccent = focusedApp ? brand(focusedApp.appName) : "#38bdf8";
          var focusAura = focusedApp ? brandGlow(focusedApp.appName, 0.16) : "rgba(56,189,248,0.12)";
          var metaChildren = [
            h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              padding: s(2) + " " + s(10), borderRadius: s(8),
              backgroundColor: "rgba(255,255,255,0.06)",
              border: "1px solid rgba(255,255,255,0.10)",
              fontSize: s(13), lineHeight: s(18), fontWeight: "600",
              letterSpacing: s(1.4), textTransform: "uppercase",
              color: "#cbd5e1", marginRight: s(12)
            } }, [groupName || "APPS"]),
            h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              fontSize: s(16), fontWeight: "500", color: "#64748b"
            } }, [shown ? ((this.overlayIndex + 1) + " of " + shown + (shown === 1 ? " app" : " apps")) : "0 apps"])
          ];
          if (focusedApp && this.isFavorite(focusedApp)) {
            metaChildren.push(h("span", { style: {
              display: "inline-block", verticalAlign: "middle",
              marginLeft: s(12), padding: s(2) + " " + s(10), borderRadius: s(8),
              backgroundColor: "rgba(251,191,36,0.14)",
              border: "1px solid rgba(251,191,36,0.32)",
              fontSize: s(12), lineHeight: s(18), fontWeight: "600",
              letterSpacing: s(1), color: "#fbbf24"
            } }, ["\u2605 PINNED"]));
          }
          var panel = [
            // Subtle focused-app ambient studio spotlight in the upper-left corner.
            h("div", { style: box(0, 0, panelW, 320, {
              pointerEvents: "none",
              backgroundImage: "radial-gradient(ellipse at 18% 0%, " + focusAura + ", rgba(0,0,0,0) 64%)"
            }) }),
            specularEdge(panelW, 44, 0.44),
            h("div", { style: box(pad, 32, 4, 52, {
              borderRadius: 2, backgroundColor: focusAccent
            }) }),
            h("div", { style: box(pad + 20, 26, panelW - 2 * pad - 380, 36, {
              fontSize: 30, lineHeight: 36, fontWeight: "600", color: "#f8fafc",
              letterSpacing: s(-0.4), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
            }) }, [focusedApp ? String(focusedApp.appName || "APPS") : "APPS"]),
            h("div", { style: box(pad + 20, 68, panelW - 2 * pad - 380, 24, {
              lineHeight: 24, whiteSpace: "nowrap", overflow: "hidden"
            }) }, metaChildren),
            h("div", { style: box(panelW - pad - 310, 40, 310, 36, {
              borderRadius: 18,
              backgroundColor: "rgba(255,255,255,0.045)",
              border: "1px solid rgba(255,255,255,0.10)",
              fontSize: 15, lineHeight: 34, textAlign: "center",
              fontWeight: "500", color: "#94a3b8"
            }) }, ["OK to open \u00b7 BACK to close"]),
            h("div", { style: box(pad, 108, panelW - 2 * pad, 1, {
              pointerEvents: "none",
              backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.14), rgba(255,255,255,0.04) 65%, rgba(255,255,255,0))"
            }) })
          ];
          var ovScroll = null;
          if (!this.apps.length) {
            panel.push(h("div", { style: box(pad, listY + 16, null, null, {
              fontSize: 28, lineHeight: 32, color: "#475569"
            }) }, ["no apps reported"]));
          } else if (!layout) {
            var totalFlatRows = Math.ceil(this.apps.length / OVERLAY_COLS);
            var firstRow = Math.max(0, Math.floor(this.overlayIndex / OVERLAY_COLS) - rows + 1);
            var first = firstRow * OVERLAY_COLS;
            for (var a = first; a < this.apps.length; a++) {
              var row = Math.floor((a - first) / OVERLAY_COLS), col = a % OVERLAY_COLS;
              if (row >= rows) break;
              panel.push(overlayCell(this.apps[a], this.overlayIndex === a, a,
                pad + col * (tileW + gutter), listY + row * OVERLAY_CELL, tileW));
            }
            ovScroll = scrollIndicator(panelW - 24, listY, panelH - listY - pad, firstRow, rows, totalFlatRows);
          } else {
            var focusedSlot = 0;
            for (var lr = 0; lr < layout.length; lr++) {
              if (layout[lr].cells && this.overlayIndex >= layout[lr].start &&
                  this.overlayIndex < layout[lr].start + layout[lr].cells.length) {
                focusedSlot = lr;
                break;
              }
            }
            var groupCounts = {};
            if (spans) {
              for (var gc = 0; gc < spans.length; gc++) groupCounts[spans[gc].name] = spans[gc].count;
            }
            // Pixel-budget windowing so compact group headers don't leave a
            // blank lower quarter of the panel when more rows fit cleanly.
            var maxBottom = panelH - pad;
            var gFirst = 0;
            var needH = function (slotObj) { return slotObj.header ? headerH : OVERLAY_CELL; };
            var sumUpTo = function (fromIdx, toIdx) {
              var total = listY;
              for (var k = fromIdx; k <= toIdx; k++) {
                total += (k === toIdx && !layout[k].header) ? (OVERLAY_CELL - 24) : needH(layout[k]);
              }
              return total;
            };
            while (gFirst < focusedSlot && sumUpTo(gFirst, focusedSlot) > maxBottom) gFirst++;
            var y = listY, shownSlots = 0;
            for (var vr = gFirst; vr < layout.length; vr++) {
              var slot = layout[vr];
              var req = slot.header ? headerH : (OVERLAY_CELL - 24);
              if (y + req > maxBottom) break;
              if (slot.header) {
                // Do not render an orphan group heading at the bottom edge if its first row won't fit.
                if (vr + 1 < layout.length && y + headerH + (OVERLAY_CELL - 24) > maxBottom) break;
                var cnt = groupCounts[slot.header];
                panel.push(h("div", { style: box(pad, y + 18, panelW - 2 * pad, 24, {
                  fontSize: 14, lineHeight: 24, fontWeight: "600",
                  letterSpacing: s(2.2), textTransform: "uppercase", color: "#94a3b8"
                }) }, [
                  slot.header,
                  cnt != null ? h("span", { style: {
                    marginLeft: s(10), fontSize: s(13), fontWeight: "500",
                    letterSpacing: "0", textTransform: "none", color: "#64748b"
                  } }, [String(cnt)]) : ""
                ]));
                panel.push(h("div", { style: box(pad, y + 46, panelW - 2 * pad, 1, {
                  pointerEvents: "none",
                  backgroundImage: "linear-gradient(90deg, rgba(255,255,255,0.09), rgba(255,255,255,0) 55%)"
                }) }));
                y += headerH;
              } else {
                for (var cc = 0; cc < slot.cells.length; cc++) {
                  panel.push(overlayCell(slot.cells[cc], this.overlayIndex === slot.start + cc,
                    slot.start + cc, pad + cc * (tileW + gutter), y, tileW));
                }
                y += OVERLAY_CELL;
              }
              shownSlots++;
            }
            ovScroll = scrollIndicator(panelW - 24, listY, panelH - listY - pad, gFirst, Math.max(1, shownSlots), layout.length);
          }
          if (ovScroll) panel.push(ovScroll);
          layers.push(h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(3,5,10,0.78)"
          } }, [
            h("div", {
              attrs: { "data-overlay-panel": "true" },
              style: box(panelX, panelY, panelW, panelH, {
                borderRadius: 44, backgroundColor: "rgba(11,15,24,0.95)",
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 36px 96px rgba(0,0,0,0.78)",
                overflow: "hidden"
              })
            }, panel)
          ]));
        }

        // ---- the launcher settings layer (unified dark-glass treatment) ----
        if (this.settings) {
          var spX = 440, spY = 120, spW = 1040, spH = 840;
          var spPanel = [specularEdge(spW, 44, 0.35)];
          var spTitles = { root: "HOME SETTINGS", apps: "APPS",
            inputs: "INPUTS", "input-order": "REORDER INPUTS", name: "RENAME INPUT" };
          var spHints = {
            root: "OK select \u00b7 \u2039 \u203a change \u00b7 BACK close",
            apps: "OK show/hide \u00b7 \u2039 \u203a pin \u00b7 BACK back",
            inputs: "OK select \u00b7 \u2039 \u203a show/hide \u00b7 BACK back",
            "input-order": "\u2039 \u203a reorder \u00b7 BACK back",
            name: "OK key \u00b7 BACK cancel"
          };
          spPanel.push(h("div", { style: box(56, 36, spW - 112, 26, {
            fontSize: 22, lineHeight: 26, fontWeight: "600",
            color: "#cbd5e1", letterSpacing: s(1)
          }) }, [spTitles[this.settingsPage] || "HOME SETTINGS"]));
          spPanel.push(h("div", { style: box(56, 68, spW - 112, 20, {
            fontSize: 16, lineHeight: 20, fontWeight: "400", color: "#64748b"
          }) }, [spHints[this.settingsPage] || ""]));

          if (this.settingsPage === "name") {
            spPanel.push(h("div", { style: box(56, 112, spW - 112, 84, {
              borderRadius: 20, backgroundColor: "rgba(255,255,255,0.05)",
              border: "1px solid rgba(255,255,255,0.16)"
            }) }, [
              h("div", { style: box(24, 0, spW - 112 - 130, 84, {
                fontSize: 34, lineHeight: 84, color: "#f8fafc",
                whiteSpace: "nowrap", overflow: "hidden"
              }) }, [this.nameDraft,
                h("span", { style: { color: "#38bdf8" } }, ["\u258c"])]),
              h("div", { style: box(spW - 112 - 104, 0, 80, 84, {
                fontSize: 18, lineHeight: 84, textAlign: "right", color: "#64748b"
              }) }, [this.nameDraft.length + "/" + NAME_MAX])
            ]));
            var kbCellW = (spW - 112) / KB_COLS, kbCellH = 74, kbGridY = 220;
            for (var kb = 0; kb < KB_CELLS.length; kb++) {
              var kbFocused = this.nameIndex === kb;
              var kbAction = kb >= KB_CELLS.length - 4;
              var isDone = KB_CELLS[kb] === "DONE";
              spPanel.push(h("div", {
                attrs: { role: "button", "aria-label": KB_CELLS[kb], tabindex: kbFocused ? "0" : "-1" },
                style: box(56 + (kb % KB_COLS) * kbCellW,
                  kbGridY + Math.floor(kb / KB_COLS) * (kbCellH + 8),
                  kbCellW - 8, kbCellH, {
                  borderRadius: 14,
                  backgroundColor: kbFocused ?
                    (isDone ? "rgba(56,189,248,0.28)" : "rgba(255,255,255,0.14)") :
                    (isDone ? "rgba(56,189,248,0.10)" : "rgba(255,255,255,0.04)"),
                  border: "1px solid " + (kbFocused ?
                    (isDone ? "rgba(125,211,252,0.75)" : "rgba(255,255,255,0.38)") :
                    (isDone ? "rgba(56,189,248,0.25)" : "rgba(255,255,255,0.06)")),
                  boxShadow: kbFocused ? "0 8px 20px rgba(0,0,0,0.42)" : "0 0 0 rgba(0,0,0,0)",
                  transform: kbFocused ? "scale(1.03)" : "scale(1)",
                  transition: "transform 120ms ease-out, border-color 120ms ease-out, background-color 120ms ease-out",
                  fontSize: kbAction ? 15 : 25, lineHeight: kbCellH,
                  textAlign: "center", fontWeight: "600",
                  letterSpacing: kbAction ? s(0.8) : "0",
                  color: kbFocused ? "#ffffff" : (isDone ? "#7dd3fc" : "#94a3b8"),
                  overflow: "hidden"
                })
              }, [KB_CELLS[kb]]));
            }
          } else {
            var spRows = this.settingsRows();
            var spListY = 110, spRowH = 88;
            var spVisible = Math.max(1, Math.floor((spH - spListY - 56) / spRowH));
            var spFirst = Math.max(0, Math.min(this.settingsIndex - spVisible + 1,
              Math.max(0, spRows.length - spVisible)));
            if (!spRows.length) {
              spPanel.push(label(56, spListY + 8, 24,
                (this.settingsPage === "inputs" || this.settingsPage === "input-order") ?
                  "no inputs reported" : "no apps reported",
                "#475569", 500));
            }
            for (var ri = spFirst; ri < spRows.length && ri < spFirst + spVisible; ri++) {
              var spRow = spRows[ri];
              var spFocused = this.settingsIndex === ri;
              var spRowY = spListY + (ri - spFirst) * spRowH;
              var rowCardH = spRowH - 12;
              var spInner = [];
              if (spFocused) {
                spInner.push(h("div", { style: box(0, 14, 3, rowCardH - 28, {
                  borderRadius: 2, backgroundColor: "#38bdf8"
                }) }));
              }
              var spMainH = spRow.sub ? 32 : rowCardH;
              spInner.push(h("div", { style: box(24, spRow.sub ? 12 : 0, spW - 112 - 240, spMainH, {
                fontSize: 23, lineHeight: spMainH, fontWeight: "600",
                color: spFocused ? "#ffffff" : "#cbd5e1",
                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
              }) }, [spRow.label]));
              if (spRow.sub) {
                spInner.push(h("div", { style: box(24, 46, spW - 112 - 240, 22, {
                  fontSize: 16, lineHeight: 22, color: "#64748b",
                  whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                }) }, [spRow.sub]));
              }
              if (spRow.value) {
                var valPositive = spRow.value === "on" || spRow.value === "shown" || spRow.value === "custom";
                var valAccent = spRow.value === "12-hour" || /min$/.test(spRow.value) ||
                  (spRow.kind === "wallpaper" && spRow.value !== "Minimal Dark") ||
                  (spRow.kind === "input-order-item" && spRow.value !== "hidden");
                spInner.push(h("div", { style: box(spW - 112 - 200, (rowCardH - 36) / 2, 176, 36, {
                  borderRadius: 18,
                  backgroundColor: valPositive ? "rgba(16,185,129,0.16)" :
                    valAccent ? "rgba(56,189,248,0.14)" : "rgba(255,255,255,0.05)",
                  border: "1px solid " + (valPositive ? "rgba(52,211,153,0.34)" :
                    valAccent ? "rgba(56,189,248,0.32)" : "rgba(255,255,255,0.09)"),
                  fontSize: 17, lineHeight: 34, textAlign: "center",
                  fontWeight: "600",
                  color: valPositive ? "#34d399" : valAccent ? "#7dd3fc" : "#94a3b8"
                }) }, [spRow.value]));
              } else {
                spInner.push(h("div", { style: box(spW - 112 - 52, 0, 28, rowCardH, {
                  fontSize: 28, lineHeight: rowCardH, textAlign: "right", fontWeight: "300",
                  color: spFocused ? "rgba(255,255,255,0.75)" : "rgba(148,163,184,0.35)"
                }) }, ["\u203a"]));
              }
              spPanel.push(h("div", {
                attrs: { role: "button", "aria-label": spRow.speak || spRow.label, tabindex: spFocused ? "0" : "-1" },
                style: box(56, spRowY, spW - 112, rowCardH, {
                  borderRadius: 18,
                  backgroundColor: spFocused ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.035)",
                  border: "1px solid " + (spFocused ? "rgba(255,255,255,0.28)" : "rgba(255,255,255,0.05)"),
                  boxShadow: spFocused ? "0 10px 26px rgba(0,0,0,0.44)" : "0 0 0 rgba(0,0,0,0)",
                  transition: "border-color 140ms ease-out, background-color 140ms ease-out",
                  overflow: "hidden"
                })
              }, spInner));
            }
            var spScroll = scrollIndicator(spW - 24, spListY, spH - spListY - 56, spFirst, spVisible, spRows.length);
            if (spScroll) spPanel.push(spScroll);
            var spOnly = this.prefs && this.prefs.onlyApps;
            if (this.settingsPage === "apps" && Array.isArray(spOnly) && spOnly.length) {
              spPanel.push(label(56, spH - 48, 17,
                "the only-list overrides hidden apps", "#94a3b8", 500));
            }
          }
          layers.push(h("div", { style: {
            position: "absolute", left: "0", top: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(3,5,9,0.86)"
          } }, [
            h("div", { style: box(spX, spY, spW, spH, {
              borderRadius: 40, backgroundColor: "rgba(14,18,26,0.97)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 32px 80px rgba(0,0,0,0.72)",
              overflow: "hidden"
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
