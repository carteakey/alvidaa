/* Read-only Cobalt capability probe for 50U7DSE / V0000.09.62N.Q0923.
 *
 * Findings-15 pattern: a small component appended after the stock bundle via
 * native-entry.js, installed through switch-home-50u7dse.sh (rollback restores
 * the stock bundle byte-exactly), and removed once the answers are recorded.
 * Every result is rendered on screen and mirrored through the vendor file
 * bridge as /APPS/free-my-tv/probe-report.json (the bridge write is itself
 * one of the probes). XHR probes run last: the MTK9602 Cobalt deadlocked on
 * bridge preflights (findings 12 §3) and the 55A7KAU one did not (findings
 * 15) — this build must be measured, and a hang must leave the earlier
 * rows visible. No keys are consumed, no settings are written, no power
 * changes: the stock launcher's other routes keep working while it runs.
 *
 * Stage before installing (SSH, root):
 *   /APPS/hisenseUI_applications/UI/art/cache/free-my-tv/probe/t.png
 *   /APPS/hisenseUI_applications/UI/art/cache/free-my-tv/probe/f.ttf
 *   /APPS/free-my-tv/           (IPC dir, owned 314:314 like the 55A7KAU trial)
 */
(function (root) {
  "use strict";
  var PROBE_VERSION = 3;
  root.AlvidaaFreeMyTV = function (sdk) {
    var rows = [], named = {}, timers = [], requests = [], pending = 0, finished = false;
    var host = null;
    function later(fn, ms) { var t = root.setTimeout(fn, ms); timers.push(t); return t; }
    function rpc(api, args, done) {
      var xhr = new root.XMLHttpRequest(); requests.push(xhr);
      xhr.open("POST", "http://localhost:9009/service/hiutils", true);
      xhr.timeout = 4000;
      xhr.setRequestHeader("Content-Type", "application/json");
      function finish(value) {
        var i = requests.indexOf(xhr); if (i >= 0) requests.splice(i, 1);
        pending--; done(value);
      }
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        var value = null;
        try {
          if (xhr.status === 200 && xhr.responseText.length < 1048576) value = JSON.parse(xhr.responseText);
        } catch (_) { value = null; }
        finish(value);
      };
      xhr.onerror = function () { finish(null); };
      xhr.ontimeout = function () { finish(null); };
      pending++;
      try { xhr.send(JSON.stringify({ api: api, args: args })); }
      catch (error) { finish(null); }
    }
    function row(name, value) {
      try { rows.push([name, String(value)]); draw(name, value); } catch (_) { /* keep probing */ }
    }
    function draw(name, value) {
      if (!host) return;
      var node = named[name];
      if (!node) {
        node = root.document.createElement("div");
        node.style.margin = "0 0 10px 0";
        host.appendChild(node);
        named[name] = node;
      }
      node.textContent = name + ": " + value;
    }
    function guard(name, fn) {
      try { fn(); } catch (error) { row(name, "threw " + (error && error.message)); }
    }
    function image(name, url) {
      pending++;
      guard(name, function () {
        var img = new root.Image(), settled = false;
        function settle(text) {
          if (settled) return; settled = true;
          pending--;
          row(name, text);
        }
        img.onload = function () {
          var natural = typeof img.naturalWidth === "number" ? img.naturalWidth + "x" + img.naturalHeight : "absent";
          settle("loaded natural=" + natural);
        };
        img.onerror = function () { settle("error"); };
        later(function () { settle("timeout"); }, 8000);
        img.src = url;
      });
    }
    var ICON_URL = "file:///hisenseUI/var/local/storeAppIcon/2473F963-955D-AD5F-822C-EEC7CFDE8FEA";
    function tileProbe(name, attach) {
      pending++;
      guard(name, function () {
        var outer = root.document.createElement("div");
        outer.style.position = "relative";
        outer.style.width = "320px";
        outer.style.height = "180px";
        var node = root.document.createElement("div");
        node.setAttribute("data-fmtv-image", "true");
        node.style.position = "absolute";
        node.style.left = "50%";
        node.style.top = "50%";
        node.style.width = "70%";
        node.style.height = "50%";
        node.style.transform = "translate(-50%, -50%)";
        outer.appendChild(node);
        if (attach) host.appendChild(outer);
        var img = new root.Image(), settled = false;
        function settle(stage) {
          if (settled) return; settled = true; pending--;
          var natural = typeof img.naturalWidth === "number" ? img.naturalWidth + "x" + img.naturalHeight : "absent";
          var cs = root.getComputedStyle(node);
          var size = cs.getPropertyValue("width") + "x" + cs.getPropertyValue("height");
          node.style.backgroundImage = "url(\"" + ICON_URL + "\")";
          node.style.backgroundSize = "contain";
          var bg = root.getComputedStyle(node).getPropertyValue("background-image");
          row(name, stage + " natural=" + natural + " sizeAtOnload=" + size + " bg=" + String(bg).slice(0, 20));
        }
        img.onload = function () { settle("loaded"); };
        img.onerror = function () { settle("LOAD-ERROR"); };
        later(function () { settle("timeout"); }, 8000);
        img.src = ICON_URL;
      });
    }
    function synchronous() {
      row("probe-version", PROBE_VERSION);
      row("viewport", root.innerWidth + "x" + root.innerHeight);
      guard("engine-date", function () { row("engine-date", String(new Date()) + " offset=" + new Date().getTimezoneOffset()); });
      guard("modeljs", function () {
        if (typeof root.modeljs === "undefined" || !root.modeljs) { row("modeljs", "absent"); return; }
        try { row("modeljs.location", root.modeljs.getIntValue("kilby.sl2.i32.basic.settings.tvset.location")); }
        catch (error) { row("modeljs.location", "threw " + error.message); }
        try { row("modeljs.osd", root.modeljs.getIntValue("kilby.sl2.i32.language.osd")); }
        catch (error) { row("modeljs.osd", "threw " + error.message); }
      });
      guard("sdk.storage", function () {
        sdk.storage.set("alvidaa.probe", "ok");
        row("sdk.storage", "get=" + sdk.storage.get("alvidaa.probe"));
      });
      guard("keymap", function () {
        var k = sdk.key && sdk.key.KEYMAP || {};
        row("keymap", "BACK=" + k.BACK + " BACKSPACE=" + k.BACKSPACE + " RETURN=" + k.RETURN +
          " SOURCE=" + k.SOURCE + " KEYPAD_INPUT=" + k.KEYPAD_INPUT + " ENTER=" + k.ENTER);
      });
      guard("apc", function () { row("apc.CMDMETHOD", root.JSON.stringify(sdk.apc && sdk.apc.CMDMETHOD)); });
      row("localStorage", typeof root.localStorage);
      guard("dom-innerHTML", function () {
        var box = root.document.createElement("div");
        box.innerHTML = "<span id=\"alvidaa-probe-span\">ok</span>";
        var found = box.querySelector("#alvidaa-probe-span");
        row("dom-innerHTML", found && found.textContent === "ok" ? "ok" : "selector/innerHTML failed");
      });
      guard("css", function () {
        var probe = root.document.createElement("div");
        probe.style.borderTopLeftRadius = "20px";
        probe.style.boxShadow = "0 0 30px rgba(0,0,0,0.5)";
        probe.style.transform = "translateY(4px)";
        probe.style.opacity = "0.6";
        probe.style.backgroundImage = "linear-gradient(135deg,#111333,#333777)";
        probe.style.transitionProperty = "opacity";
        probe.style.transitionDuration = "0.2s";
        host.appendChild(probe);
        var cs = root.getComputedStyle(probe);
        row("css.radius", cs.getPropertyValue("border-top-left-radius") || "(empty)");
        row("css.shadow", cs.getPropertyValue("box-shadow") || "(empty)");
        row("css.transform", cs.getPropertyValue("transform") || "(empty)");
        row("css.opacity", cs.getPropertyValue("opacity") || "(empty)");
        row("css.gradient", cs.getPropertyValue("background-image") || "(empty)");
        row("css.transition", (cs.getPropertyValue("transition-property") || "(empty)") + " / " + (cs.getPropertyValue("transition-duration") || "(empty)"));
      });
    }
    function font() {
      pending++;
      guard("font", function () {
        var style = root.document.createElement("style");
        style.textContent = "@font-face{font-family:FMTVProbe;src:url(file:///hisenseUI/var/local/artCache/free-my-tv/probe/f.ttf);}";
        root.document.head.appendChild(style);
        var a = root.document.createElement("div"), b = root.document.createElement("div");
        a.style.font = "40px FMTVProbe"; b.style.font = "40px sans-serif";
        a.style.position = b.style.position = "absolute";
        a.style.visibility = b.style.visibility = "hidden";
        a.textContent = b.textContent = "MMMMWWWWiiii";
        host.appendChild(a); host.appendChild(b);
        later(function () {
          pending--;
          function width(node) {
            if (typeof node.offsetWidth === "number") return String(node.offsetWidth);
            try { return "cs:" + root.getComputedStyle(node).getPropertyValue("width"); } catch (_) { return "absent"; }
          }
          row("font.widths", "probe=" + width(a) + " fallback=" + width(b));
        }, 2500);
      });
    }
    function bridge() {
      guard("xhr-read", function () {
        // A bridge-written file is readable by the bridge uid (314); vendor
        // files owned 0640 UhisApp:909 are not (probed separately below).
        rpc("fileRead", { path: "free-my-tv/probe-report.json", mode: 6 }, function (value) {
          row("xhr-read", value && value.ret === true ? "ret=true len=" + String(value.msg || "").length
            : value ? "ret=" + value.ret + " msg=" + String(value.msg).slice(0, 40) : "no answer");
          guard("xhr-read-vendor", function () {
            rpc("fileRead", { path: "pkgs/tv.vidaa.app.operationui/CHA/packageinfo.json", mode: 6 }, function (vendor) {
              row("xhr-read-vendor", vendor && vendor.ret === true ? "ret=true len=" + String(vendor.msg || "").length
                : vendor ? "ret=false (permission boundary: 0640 UhisApp:909)" : "no answer");
              publish(false);
            });
          });
        });
      });
    }
    function publish(force) {
      if (finished) return;
      if (!force && pending > 0) { later(function () { publish(false); }, 1000); return; }
      finished = true;
      var report = root.JSON.stringify({ version: PROBE_VERSION, at: String(new Date()), results: rows.slice() });
      row("report-bytes", report.length);
      guard("xhr-write", function () {
        rpc("fileWrite", { path: "free-my-tv/probe-report.json", mode: 6, writedata: report }, function (value) {
          row("xhr-write", value && value.ret === true ? "ret=true" : value ? "ret=" + value.ret + " msg=" + String(value.msg).slice(0, 40) : "no answer");
          guard("xhr-readback", function () {
            rpc("fileRead", { path: "free-my-tv/probe-report.json", mode: 6 }, function (back) {
              row("xhr-readback", back && back.ret === true ? "ret=true len=" + String(back.msg || "").length : "ret=" + (back && back.ret));
            });
          });
        });
      });
    }
    function run(element) {
      host = element;
      host.style.overflow = "hidden";
      var title = root.document.createElement("div");
      title.style.font = "bold 30px sans-serif";
      title.style.margin = "0 0 24px 0";
      title.textContent = "alvidaa Cobalt probe — 50U7DSE / V0000.09.62N.Q0923";
      host.appendChild(title);
      synchronous();
      image("image.storeappicon", ICON_URL);
      tileProbe("tile.attached", true);
      tileProbe("tile.detached", false);
      image("image.artcache", "file:///hisenseUI/var/local/artCache/free-my-tv/probe/t.png");
      image("image.absolute", "file:///APPS/hisenseUI_applications/UI/art/cache/free-my-tv/probe/t.png");
      image("image.vendor", "https://img.vidaahub.com/vidaa/2024/3/202403190313577024.png");
      font();
      bridge();
      later(function () { publish(true); }, 14000);
    }
    return {
      name: "Launcher",
      mounted: function () { if (!this._probe) { this._probe = true; run(this.$el); } },
      activated: function () { if (!this._probe) { this._probe = true; run(this.$el); } },
      deactivated: function () { this.stop(); },
      beforeDestroy: function () { this.stop(); },
      methods: {
        stop: function () {
          timers.forEach(function (t) { root.clearTimeout(t); });
          timers = [];
          requests.splice(0).forEach(function (xhr) { try { xhr.abort(); } catch (_) { /* already settled */ } });
          host = null;
        }
      },
      render: function (h) {
        return h("div", { style: { position: "absolute", left: "0", top: "0", width: "1920px", height: "1080px", background: "#10131a", color: "#e8ecf4", padding: "40px", fontFamily: "sans-serif" } });
      }
    };
  };
}(self));
