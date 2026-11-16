# 03 — Arc Home runtime quirks (verified on TV 2026-11-14)

Follow-on launcher work ("Arc Home", `free-my-tv-arc.js`) surfaced these SDK/runtime
facts. Read-only observations, useful for any lane-3 port on this build.

## Clock is UTC in the JS engine

The JS engine runs in UTC: `getTimezoneOffset()` is 0 and the system `date` reports
GMT (TZ unset), so `new Date().getHours()` is UTC, not local. Local time comes from
`self._V_SDK_.biz.date.getLocalDate(ms)`, which returns a Date shifted by the TV's
configured zone (`offset = result - ms`). The stock launcher reaches it via webpack
module `"jAHW"` (= `self._V_SDK_.biz`); epg/pvr use the same call. Arc's `wallClock()`
uses it, with a CET/CEST fallback when the helper is missing or returns offset 0.

## `box-sizing` is ignored

Padding (and borders) add to the set width, so a padded "border-box" row renders
wider than its container (visible as a menu highlight sticking out). Position a
child inside the element instead of using padding.

## Remote key: MENU = 409 `MENU_SRC`

The remote's MENU button arrives as key-down `409`, KEYMAP name `MENU_SRC` (not
`MENU`). The stock launcher does not handle it, so a replacement Home must. Arc maps
it to `setting.open("settings")`. "About" shows the last unhandled key code/name —
the fastest way to identify other keys.

## Hold-to-repeat

The remote auto-repeats key-down while a key is held. Swallow repeats until key-up
(or a quiet gap), or the repeat re-triggers whatever the hold just opened.

## Foreground-app detection (for a Recent row)

`self._V_SDK_.biz.source.getCurrentAppSource()` returns a JSON string naming the
foreground app (the pvr-media app reads `.sourceName` from it). It covers apps opened
any way — remote buttons, voice, other apps. The app manager also writes
`/var/local/current_source_app` (e.g. `"main:206"`). Arc polls it every 3 s
(deliberately slow, so accidental opens are skipped) and matches it to the app list
by appId or name. The poll must survive the launcher page's `stop()`/`deactivate`.
`biz.apmMessage` is **not** usable for this — its "AppAction" messages only cover
operationui's own pages, not every app. The stock launcher's "recent" row is cloud
content (FVP), not a list of locally opened apps.

## The launcher page can reach the internet (2026-11-14)

SystemUI is started as
`/opt/hisenseUI/bin/SystemUI --url=file:///hisenseUI/index.html --csp_mode=disable`,
so there is no content security policy in the way: an `XMLHttpRequest` from the
launcher page to an outside HTTPS API (Arc's optional weather, Open-Meteo, which
allows any origin) works. The stock launcher also calls its own cloud API from
page JS (`hubAxios`). Arc keeps weather off by default, so a fresh install makes
no requests.

## Embedded fonts and an icon font work (2026-11-14)

`@font-face` with base64 TTF data works. A small custom icon font (glyphs in the
Private Use Area, built from SVG outlines with fontTools) renders correctly and
takes `color` like text — a way to draw monochrome icons without depending on
how well Cobalt handles SVG.

## The TV settings and Quick Menu are a web app in the same page (2026-11-15)

Confirms EvzenP's finding for the 75UR9S ([PR 74](https://github.com/carteakey/alvidaa/pull/74)) on this model: the settings
overlay opened by MENU / `setting.open("settings")` is the `setting` web app in
package `tv.vidaa.app.ui`, not a native program. It lives under
`/opt/pkgs/tv.vidaa.app.ui/system-ui/apps/setting/` (`/opt` →
`/mnt/tvroot/opt`, **erofs read-only** — never written). SystemUI loads every app
into the one `index.html` document, and `setting/js/app.js` registers itself the
same way the launcher does:

```js
(self._V_M_=self._V_M_||{}).setting=()=>s("fA/v").Z
```

So code appended to the writable launcher bundle shares a document with the
settings app and could restyle it (injected CSS) or wrap `_V_M_.setting`, with
the launcher's normal rollback — not done yet. Other `system-ui` apps there:
`volume-bar`, `mixbar`, `lock-screen`, `multiview`, `karaoke`, `e-manual`, `usb`, …
