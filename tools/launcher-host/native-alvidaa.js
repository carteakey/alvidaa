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
  var OVERLAY_COLS = 6, OVERLAY_CELL = 176;
  var ICON = 80;
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
      if (/^(var\/local\/storeAppIcon\/|file:\/\/\/|\/(?!\/)|data:image\/(png|jpeg|webp);base64,)/i.test(value)) {
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

    return {
      name: "Launcher", // The shared shell's keep-alive list uses this name.
      data: function () {
        return {
          apps: [], sources: [],
          zone: "dock", dock: 0, app: 0,
          overlay: false, overlayIndex: 0,
          now: new Date(), width: (root && root.innerWidth) || 1920,
          toast: "", toastUntil: 0,
          autoSwitchId: null, autoSwitchName: "", autoSwitchAt: 0,
          activeArt: "", activeArtId: null,
          outgoingArt: "", outgoingArtId: null,
          artIncomingOpacity: 1,
          prefs: {
            hiddenApps: [], onlyApps: [], customNames: {}, lastUsed: null, autoSwitch: false, favorites: []
          }
        };
      },
      mounted: function () { this.start(); },
      activated: function () { this.readPrefs(); this.start(); this.routeFocus(); },
      deactivated: function () { this.stop(); },
      beforeDestroy: function () { this.stop(); },
      watch: {
        "$route": function () { this.routeFocus(); },
        dock: function () { this.syncArt(); }
      },
      methods: {
        readPrefs: function () {
          this.prefs = {
            hiddenApps: readPref("alvidaa_hidden_apps", []),
            onlyApps: readPref("alvidaa_only_apps", []),
            customNames: readPref("alvidaa_custom_names", {}),
            lastUsed: readPref("alvidaa_last_used", null),
            autoSwitch: isTruthy(readPref("alvidaa_auto_switch", false)),
            favorites: readPref("alvidaa_favorites", [])
          };
          if (this._lastData && this._lastData.apps) {
            this.apps = this.filterApps(this._lastData.apps);
          }
          this.clamp();
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
        start: function () {
          this.readPrefs();
          if (this._running) return;
          this._running = true;
          var vm = this;
          this._platform = root.AlvidaaNativePlatform(sdk, function (data) {
            var firstPayload = !vm._payloadReceived;
            vm._payloadReceived = true;
            vm._lastData = data;
            vm.apps = vm.filterApps(data.apps);
            vm.sources = data.sources.filter(function (input) {
              return input && input.sourceId != null;
            });
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
          this.autoSwitchAt = 0;
          this.autoSwitchId = null;
          this.autoSwitchName = "";
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
          this.dock = this.smartIndex();
          this.app = 0;
          this.syncArt();
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
            var keys = [input.name, input.displayname2, input.rename];
            for (var k = 0; k < keys.length; k++) {
              var val = text(keys[k]);
              if (!val) continue;
              if (text(custom[val.toLowerCase()])) return text(custom[val.toLowerCase()]);
              if (text(custom[val])) return text(custom[val]);
            }
          }
          // Same order as the bridge: the device the TV discovered on the port
          // beats the port label, and a translation id is resolved last.
          var label = text(input.displayname2) || text(input.rename) || text(input.name) ||
            String(input.sourceId);
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
                  glyph: app.glyph || "\u2605",
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
          return items;
        },
        dockStart: function () {
          var n = this.dockItems().length;
          if (n <= DOCK_PAGE) return 0;
          return Math.max(0, Math.min(this.dock - 2, n - DOCK_PAGE));
        },
        clamp: function () {
          var dockLen = this.dockItems().length;
          this.dock = dockLen > 0 ? Math.max(0, Math.min(this.dock, dockLen - 1)) : 0;
          var appLen = this.appItems().length;
          this.app = appLen > 0 ? Math.max(0, Math.min(this.app, appLen - 1)) : 0;
          var overlayLen = this.apps.length;
          this.overlayIndex = overlayLen > 0 ? Math.max(0, Math.min(this.overlayIndex, overlayLen - 1)) : 0;
        },
        showToast: function (text, ms) {
          if (!text) return;
          this.toast = String(text);
          this.toastUntil = Date.now() + (typeof ms === "number" ? ms : 2500);
        },
        syncArt: function () {
          var artMap = root.AlvidaaNativeInputArt;
          if (!artMap) {
            this.activeArt = "";
            this.activeArtId = null;
            this.outgoingArt = "";
            this.outgoingArtId = null;
            this.artIncomingOpacity = 1;
            return;
          }
          var items = this.dockItems();
          var focusInput = items[this.dock];
          var rawArt = focusInput && (artMap[focusInput.sourceId] || artMap[String(focusInput.sourceId)]);
          var targetArt = allowedInputArt(rawArt);
          var targetId = focusInput ? String(focusInput.sourceId) : null;

          if (targetId === this.activeArtId && targetArt === this.activeArt) return;

          if (this.activeArt && this.activeArt !== targetArt) {
            this.outgoingArt = this.activeArt;
            this.outgoingArtId = this.activeArtId;
            this.activeArt = targetArt;
            this.activeArtId = targetId;
            this.artIncomingOpacity = targetArt ? 0 : 1;
            if (this._artTickTimer) clearTimeout(this._artTickTimer);
            if (this._artTimer) clearTimeout(this._artTimer);
            var vm = this;
            if (targetArt && typeof setTimeout === "function") {
              this._artTickTimer = setTimeout(function () {
                vm.artIncomingOpacity = 1;
                vm._artTickTimer = null;
              }, 16);
            }
            if (typeof setTimeout === "function") {
              this._artTimer = setTimeout(function () {
                vm.outgoingArt = "";
                vm.outgoingArtId = null;
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
        activate: function () {
          var vm = this;
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
            this.run(function () { return vm._platform.launchApp(item.appId); });
          } else if (item.kind === "apps") {
            this.openOverlay();
          } else {
            this.showToast("Opening " + item.label + "…");
            this.run(function () { return vm._platform.openSettings(); });
          }
        },
        launchFocused: function () {
          var vm = this, app = this.apps[this.overlayIndex];
          if (!app) return;
          this.showToast("Opening " + (app.appName || "app") + "…");
          this.run(function () { return vm._platform.launchApp(app.appId); });
          this.closeOverlay();
        },
        announce: function () {
          if (!sdk.tts || !sdk.tts.isEnable() || !sdk.router.isCurrentPathEqualTo("/Launcher")) return;
          var label;
          if (this.overlay) {
            var app = this.apps[this.overlayIndex];
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
          if (this.overlay) {
            if (code === keys.BACK || code === keys.RETURN) { this.closeOverlay(); return true; }
            if (code === keys.ENTER) { this.launchFocused(); return true; }
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
        if (!dock.length) {
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
          if (text(input.glyph)) {
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
          var children = [
            h("div", { style: box(0, 42, DOCK_SIZE, 60, {
              fontSize: 52, lineHeight: 60, textAlign: "center",
              color: focused ? "#ffffff" : "#cbd5e1"
            }) }, [item.glyph]),
            h("div", { style: box(0, 108, DOCK_SIZE, 40, {
              fontSize: 26, lineHeight: 40, textAlign: "center",
              color: focused ? "#ffffff" : "#94a3b8"
            }) }, [item.label])
          ];
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
                opacity: 1,
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
          } }),
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
          var panelX = 64, panelY = 140, panelW = 1792, panelH = 800;
          var rows = Math.max(1, Math.floor((panelH - 96) / OVERLAY_CELL));
          var firstRow = Math.max(0, Math.floor(this.overlayIndex / OVERLAY_COLS) - rows + 1);
          var first = firstRow * OVERLAY_COLS;
          var cellW = (panelW - 112) / OVERLAY_COLS;
          var panel = [
            h("div", { style: box(panelX + 56, panelY + 40, null, null, {
              fontSize: 22, lineHeight: 24, fontWeight: "600", color: "#64748b"
            }) }, ["APPS"]),
            h("div", { style: box(panelX + 56, panelY + 40, panelW - 112, 24, {
              fontSize: 18, lineHeight: 24, textAlign: "right", color: "#475569"
            }) }, ["OK to open \u00b7 BACK to close"])
          ];
          if (!this.apps.length) {
            panel.push(h("div", { style: box(panelX + 56, panelY + 112, null, null, {
              fontSize: 28, lineHeight: 32, color: "#475569"
            }) }, ["no apps reported"]));
          }
          for (var a = first; a < this.apps.length; a++) {
            var row = Math.floor((a - first) / OVERLAY_COLS), col = a % OVERLAY_COLS;
            if (row >= rows) break;
            var app = this.apps[a];
            var selected = this.overlayIndex === a;
            var cellX = panelX + 56 + col * cellW;
            var cellY = panelY + 96 + row * OVERLAY_CELL;
            var icon = this.appIcon(app);
            var cell = [];
            if (icon) {
              // backgroundImage, not an img node: the img path did not paint
              // cached icons on the Cobalt builds this was tested against.
              cell.push(h("div", { style: box(0, 20, cellW - 16, ICON, {
                backgroundImage: "url(" + JSON.stringify(icon) + ")",
                backgroundSize: "contain", backgroundPosition: "center",
                backgroundRepeat: "no-repeat"
              }) }));
            } else {
              var badge = brand(app.appName);
              cell.push(h("div", { style: box((cellW - 16 - ICON) / 2, 20, ICON, ICON, {
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
            cell.push(h("div", { style: box(0, OVERLAY_CELL - 56, cellW - 16, 34, {
              fontSize: 22, lineHeight: 34, textAlign: "center",
              color: selected ? "#f8fafc" : "#94a3b8"
            }) }, [name]));
            panel.push(h("div", {
              attrs: { role: "button", "aria-label": String(app.appName || ""), tabindex: selected ? "0" : "-1" },
              style: box(cellX + 8, cellY + 8, cellW - 16, OVERLAY_CELL - 24, {
                borderRadius: 28,
                backgroundColor: selected ? "rgba(255,255,255,0.10)" : "rgba(255,255,255,0.04)",
                border: selected ? "2px solid #ffffff" : "2px solid rgba(255,255,255,0)",
                overflow: "hidden"
              }),
              on: { click: function (index) {
                return function () { vm.overlayIndex = index; vm.launchFocused(); };
              }(a) }
            }, cell));
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
