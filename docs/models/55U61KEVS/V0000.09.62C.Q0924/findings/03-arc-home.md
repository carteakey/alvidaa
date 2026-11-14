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
