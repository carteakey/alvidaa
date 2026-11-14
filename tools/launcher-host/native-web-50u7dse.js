/* 50U7DSE / V0000.09.62N.Q0923 adjustments for the shared Free My TV web port.
 *
 * Source-verified on the owned unit (2026-11-12, read-only SSH + vendor
 * package sources; no TV writes during verification):
 *   - the SystemUI engine loads file:///hisenseUI/ from the read-only UI
 *     package (/opt/pkgs/tv.vidaa.app.ui). Writable storage under that origin
 *     goes through the vendor symlink file:///hisenseUI/var/local/artCache/
 *     -> /APPS/hisenseUI_applications/UI/art/cache (ext4). Web assets and
 *     feed media stage there, namespaced under free-my-tv/.
 *   - the vendor file bridge (hiutils service, localhost:9009, uid 314) maps
 *     mode 6 to /APPS/ (services/hiutils/fileOperation.js pathList), so the
 *     shared runtime's free-my-tv/*.json IPC paths work unchanged.
 *   - app tiles carry https://img.vidaahub.com/ artwork, as on 75U8QTUK. The
 *     shared web TV adapter is local-only, so this part re-enables the same
 *     owner-approved vendor host through the icon-policy hook. Offline, tiles
 *     fall back to upstream's lettered placeholder treatment.
 *   - no EU modeljs timezone enumeration was found in this build's launcher
 *     bundle (only kilby.sl2.i32.basic.settings.tvset.location, whose value
 *     semantics are not established). The zone is a build constant until a
 *     measured native source exists; upstream's Home Settings city picker
 *     still overrides weather/city preferences per TV.
 */
(function (root) {
  "use strict";
  root.AlvidaaNativeWebZone = function () { return "Europe/Berlin"; };
  var VENDOR = /^https:\/\/img\.vidaahub\.com\/[A-Za-z0-9][A-Za-z0-9\u0080-\uffff/_.-]*$/;
  root.AlvidaaWebDirectImage = function (uri) { return typeof uri === "string" && VENDOR.test(uri); };
  /* The owner's curated shelf (2026-11-12): upstream's own config.properties
   * knobs (web/home.js pickShelf/hidden) — the five that matter, in the
   * order asked for; everything else stays installed and launchable on the
   * TV (VIDAA Home is untouched) but leaves this home's shelf and All Apps.
   * Entries match by id-or-title substring, so full titles only: bare brand
   * words like "max" would swallow the kept apps. */
  root.AlvidaaWebConfig = {
    shelfApps: ["netflix", "apple tv", "disney", "hbo max", "youtube"],
    hideApps: [
      "accuweather", "ads privacy", "amazon music", "app store", "art gallery",
      "chili", "crunchyroll", "dazn", "deezer", "e-manual",
      "haystack tv local + world news", "hd+ live tv", "joyn", "kids", "maxdome",
      "media", "nba", "o2 tv", "on demand", "paramount+",
      "plex", "plutotv", "prime video", "public value", "rakuten tv",
      "red bull tv", "richtlinien", "rtl tvnow", "smart life",
      "spotify : music & podcasts", "toongoggles", "triller tv.", "tv browser",
      "tv channels▶", "uefa.tv", "v home", "waipu.tv – live tv streaming",
      "wow", "xbox", "your home for tv & streaming apps", "zattoo", "zdf"
    ]
  };
  /* The repo's own curated tile wordmarks (web/icons on Samsung/webOS):
   * Simple Icons CC0, cropped and tinted for the tiles, for four brands;
   * the Disney+ wordmark is the official logo (Wikimedia Commons, a Disney
   * trademark — private use on the owner's TV, not for redistribution).
   * Rasterized to PNG and staged under the artCache lane: Cobalt decodes
   * PNG, not SVG. SHELF (web/home.js) supplies the brand gradients; the
   * wordmarks contain-fit over them (fitLogo). The platform resolves the
   * TV's own store icons first, so this policy curates the finished entry
   * (AlvidaaWebAppPolicy) instead of the artwork lane. */
  var CURATED_BASE = "file:///hisenseUI/var/local/artCache/free-my-tv/curated/";
  var CURATED_ICONS = {
    netflix: "netflix.png",
    youtube: "youtube.png",
    disney: "disneyplus.png",
    hbomax: "hbomax.png",
    appletv: "appletv.png"
  };
  function normalizedName(title) {
    return String(title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }
  root.AlvidaaWebAppPolicy = function (entry) {
    var curated = CURATED_ICONS[normalizedName(entry && entry.title)];
    return curated ? { icon: CURATED_BASE + curated } : null;
  };
  root.AlvidaaWebIconPolicy = function (app) {
    var candidates = [app.img, app.presetImg, app.icon, app.appIcon, app.httpIcon];
    for (var i = 0; i < candidates.length; i++) {
      var value = candidates[i];
      if (typeof value === "string" && VENDOR.test(value)) {
        return value;
      }
    }
    return "";
  };
}(typeof self !== "undefined" ? self : this));
