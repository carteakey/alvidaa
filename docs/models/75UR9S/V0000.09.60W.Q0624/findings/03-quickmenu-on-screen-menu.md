# 03 — Quick Menu (Live TV on-screen menu): architecture, item registry, storage, and localization

> Reference findings, 2026-11-13/14. TV at `192.168.1.20` (75U8SE/75UR9S,
> `V0000.09.60W.Q0624`). Root SSH lane per [README](../README.md).
>
> **Scope:** how the Live TV on-screen menu (a.k.a. Quick Menu) works on this
> firmware — where it lives, how its item list is built, where the layout is
> persisted, and where every display string comes from. The investigation was
> triggered by a real bug (three items missing from the menu, §9) and the fix
> is recorded there as an appendix.

## 1. What the "Quick Menu" is

Per the e-manual (`LearnabouttheOnScreenMenu-EManual-20.html`): in **Live TV**,
MENU opens the **on-screen menu** — a bar of items along the bottom of the
screen. Item 1 is **All Settings**; the last item is **Edit**, which opens the
edit dialog (two rows: **"More"** on top, **"Displayed Items"** below; D-pad
moves items between/within rows). So:

**Quick Menu == the Live TV on-screen menu.** It is *not* the home-screen nav
bar and *not* the static `/basic/webui/quickMenu` panel (3 fixed webui items,
irrelevant).

## 2. Architecture — the "native" menu is a web app

The on-screen menu is **not a native binary**. It is the `setting` web app
inside the **system-ui** package, rendered by the **SystemUI** cobalt/starboard
engine:

```
/opt/hisenseUI/bin/SystemUI  --url=file:///hisenseUI/index.html
  (launched by /opt/hisenseUI/startgui.sh; refuses to start if already running;
   PPID 1, no init.d entry — nothing auto-restarts it if killed)
  └─ engine origin: file:///hisenseUI/index.html
     └─ /opt/pkgs/tv.vidaa.app.ui/            (package tv.vidaa.app.ui)
        ├─ hisenseUI/                          home-screen app (+ its own language/)
        └─ system-ui/                          ← the on-screen menu lives here
           ├─ language/                        i18n bundle (see §6)
           └─ apps/  acr, ai-pq, air-play, app-page, coretv-service, dlna,
                     e-manual, fte, fvp, hotel-mode, karaoke, lock-screen,
                     miracast, mixbar, multiview, playfi, professional-mode,
                     sdk, setting, store-mode, usb, volume-bar
```

The menu page is **`system-ui/apps/setting/js/99.js`** (webpack chunk 99,
module `iv2l`), route `/setting/quickSetting?vk=T` — pushed by the MENU-key
handler in `setting/js/app.js` (module `tT4w` → `s.wQ.push("/setting/quickSetting")`).

Component tree (all in 99.js):

- **quickSetting page** — loads the two persisted item lists (§5/§7), renders
  either `normalMode` or `editMode`.
- **normalMode** — the bar:
  `settingList = [EQ-mode item] + qsShowData.filter(visible) + [Edit item]`.
  Voice-announces "Quick Setting. N items." on mount.
- **editMode** — top row = `bakList` (label **"More"**, i18n `LA0033`),
  bottom row = `editList` (label **"Displayed Items"**, i18n `SE6458`), plus
  the fixed **Edit** item (id `"Edit"`, i18n `SE0397`) appended last.
  UP/DOWN moves an item between rows, LEFT/RIGHT reorders within a row.
  The EQ-mode item (`MenuTree_SOU_0602`) is special-cased: always kept in the
  displayed row, spliced to the position of `MenuTree_SOU_0101`.

## 3. Item registry and providers

A **global item registry** — webpack module `j19t`, export `K`, a
`Map(id → item object)` — is populated by `registSettingItems` (module
`AbMP.t` in `setting/js/app.js`), which also merges title/description
overrides from a `settingchange.json` cloud file.

Item object shape:

```js
{ id, focusName, settingItemTitle (i18n key — or a GETTER, see §6.4),
  icon, type (singleItem|modeItem|switchItem|doubleItem|pageModeItem|EditManager),
  get isShow() → "visible"|"disabled"|"invisible",
  enterHandler / qsEnterHandler, modeList, ... }
```

Enter routing: web items run their JS handler with `{from:"quickSetting"}`;
native ids are routed by the setting app (`!id.startsWith("MenuTree_QS")` →
routed to the settings page for that id).

**Providers** (who registers what):

| provider | location | items |
|---|---|---|
| **setting app** | `system-ui/apps/setting/js/app.js` (1 MB) | **426** `MenuTree_*` items — the whole settings tree, incl. the quick-menu natives (Picture Mode, Sleep Timer, Sound Mode, HDMI Format, Game Mode/Menu, Aspect Ratio, …) |
| **live-tv app** | operationui, `apps/live-tv` | 12 channel items (Channel Search, Subtitle, Caption, Audio Language, MTS, SAP, Ginga List, Edit Channel List, Teletext, Channel List, Info, HbbTV) |
| **epg app** | operationui, `apps/epg` | **Guide** (`MenuTree_QS_Channel_0001`) |
| **pvr / pvr-media** | operationui | PVR/Recording, Timeshift, **Recording List** |
| **vidaa-tv** | operationui | User Guide (`QS_2009`), Multiview |
| **multiview app** | `system-ui/apps/multiview` | MultiView (`MenuTree_QS_0002`) |
| **karaoke app** | `system-ui/apps/karaoke` | Karaoke (`MenuTree_Karaoke_0836_01`) |

operationui apps register through the VIDAA SDK native bridge
(`live-tv/js/app.js`, module `pv0T`):

```js
const a = new self._V_SDK_.vre.SDK("live-tv", {storagePrefix: "LiveTV"});
registSettingItems: function (e) { a.d.Setting.invoke("registSettingItems", e) }
```

`grep -rl registSettingItems` over `operationui/current/apps/` hits exactly
five apps: `live-tv`, `epg`, `pvr`, `pvr-media`, `vidaa-tv`.

## 4. Complete default item list (the factory preset)

The factory layout is an **embedded JSON literal** (webpack module `1aHo`,
`JSON.parse('…')` inside `setting/js/app.js`). Structure:

```json
{ "preset":   { "commonHead": [4], "livetv": [9], "other": [3], "common": [13] },
  "userEdit": { "livetv": [8], "common": [2], "other": [] } }
```

`preset.*` → the default **Displayed Items** row (`qsDefList`);
`userEdit.*` → the default **More** row (`qsDefBakList`). Entries are
`{id, name}` — the `name` is a hardcoded English label; the on-screen title
is resolved from the registry entry's i18n key (§6).

### 4.1 `preset.commonHead` (4) — head of the bar

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_QS_0001` | All Settings | `SE6442` | setting | — |
| `MenuTree_QS_0002` | MultiView | — | multiview app | — |
| `MenuTree_Projector_0001` | Auto Keystone Correction | `SE6237` | setting | singleItem |
| `MenuTree_Projector_0004` | Auto Focus | `LTV0082` | setting | singleItem |

### 4.2 `preset.livetv` (9) — Live-TV-only items

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_QS_Channel_0001` | **Guide** | `TV0123` | epg | — |
| `MenuTree_QS_Channel_0002` | Channel Search | `SE0402` | live-tv | EditManager |
| `MenuTree_QS_Channel_0003` | Subtitle | `SE0381` | live-tv | — |
| `MenuTree_QS_Channel_0004` | Caption Control | `SE0742` | live-tv | — |
| `MenuTree_QS_Channel_0005` | Audio Language | **dynamic** (DTV standard, §6.4) | live-tv | getter |
| `MenuTree_QS_Channel_0005_01` | Audio Track (MTS) | — | live-tv | — |
| `MenuTree_QS_Channel_0005_02` | SAP | — | live-tv | — |
| `MenuTree_QS_Channel_0006` | Recording List | **dynamic** (model variant, §6.4) | pvr-media | — |
| `MenuTree_QS_Channel_0007` | Ginga Application List | `SE3554` | live-tv | — |

### 4.3 `preset.other` (3) — non-livetv sources

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_SYS_0802` | HDMI Format | `SE5005` | setting | pageModeItem |
| `MenuTree_PIC_0401` | Game Mode | `SE1919` | setting | switchItem |
| `MenuTree_QS_0003` | Game Menu | `SE6047` | setting | singleItem |

### 4.4 `preset.common` (13) — all sources

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_QS_1001` | Store Mode Settings | `OT0498` | setting | singleItem |
| `MenuTree_QS_1002` | Rotate TV | `SE6588` | setting | doubleItem |
| `MenuTree_SYS_0996_1` | Light | `IOT0027` | setting | switchItem |
| `MenuTree_PIC_0101` | **Picture Mode** | `SE0003` | setting | pageModeItem |
| `MenuTree_SOU_0101` | Sound Mode | — | setting | modeItem |
| `MenuTree_SOU_0701` | Audio Output | `SE3517` | setting | modeItem |
| `MenuTree_Karaoke_0836_01` | Karaoke | — | karaoke app | — |
| `MenuTree_SOU_0403` | Headphone Volume | `SE0064` | setting | doubleItem |
| `MenuTree_QS_1008` | Energy Saving Setup | `ACF1148` | setting | — |
| `MenuTree_SYS_0202` | **Sleep Timer** | `SE0679` | setting | modeItem |
| `MenuTree_QS_1006` | Audio Only | `SE0834` | setting | singleItem |
| `MenuTree_QS_1007` | Ethernet / Wireless | — | setting | — |
| `MenuTree_NET_0502` | Bluetooth | `SE0183` | setting | switchItem |

### 4.5 `userEdit.livetv` (8) — default "More" row (livetv)

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_QS_2001` | Edit Channel List | `SE2139` | live-tv | EditManager |
| `MenuTree_QS_2002` | Teletext | `SE0946` | live-tv | switchItem |
| `MenuTree_QS_2003` | PVR / Recording | **dynamic** (model variant, §6.4) | pvr | — |
| `MenuTree_QS_2004` | Timeshift | `SE4584` | pvr | — |
| `MenuTree_QS_2005` | Channel List | `SE1535` | live-tv | — |
| `MenuTree_QS_2006` | Info | `DMP0030` | live-tv | — |
| `MenuTree_QS_2008` | HbbTV | `SE3316` | live-tv | switchItem |
| `MenuTree_QS_2009` | User Guide | `SE6441` | vidaa-tv | — |

### 4.6 `userEdit.common` (2) — default "More" row (all sources)

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_PIC_0201` | Aspect Ratio | — | setting | pageModeItem |
| `MenuTree_SOU_0703` | Digital Audio Output Format | `SE6286` | setting | modeItem |

**39 items total.** At runtime each is filtered by `isNotSupport` (model
feature flags) and its `isShow` visibility getter (source-dependent: livetv
vs other, HDMI signal, laser-TV, store mode, game-menu flag, …). Not in the
preset but special-cased: the **EQ-mode item** (`MenuTree_SOU_0602`, unshifted
into the bar by normalMode) and the fixed **Edit** item.

## 5. How the menu is constructed at runtime (99.js)

```
page load
  └─ getSettingData()
       ├─ e = getQsEditList()            // tT4w._r() — storage read + clear-flag logic (§7)
       ├─ e ? qsShowData = orderData(e)  // saved list, mapped through the default universe
       └─ else qsShowData = getDefData().qsDefList   // ← factory preset (§4)
  └─ getBakData()                        // same for qsBakList / qsDefBakList

orderData(ids):
  universe = qsDefList ∪ qsDefBakList (by id, from preset ∩ registry)
  return ids.filter(in universe).map(to item)   // unknown ids DROPPED silently

normalMode render:
  [EQ item] + qsShowData.filter(isShow=="visible") + [Edit item]

editMode render:
  row 1 "More"            = bakList items
  row 2 "Displayed Items" = editList items + [Edit]
  (only items ALREADY IN THE SAVED LISTS are shown — §8)
```

`getDefData()` (module `kIBO`) builds the default universe from the preset
JSON (§4) mapped through the registry (§3): `preset.*` → `qsDefList`,
`userEdit.*` → `qsDefBakList`, filtered by `isNotSupport`.

**Consequence: the on-screen menu shows exactly
`saved list ∩ default universe ∩ registry ∩ visibility`.** An item that is
registered but absent from both saved lists is never shown — and the edit
dialog renders only the saved lists, so it offers **no way to add it back**
(§8).

## 6. Localization — where the display strings come from

### 6.1 Three independent i18n bundles

Each UI package ships its own `language/` directory with the same layout:

| bundle | path | serves |
|---|---|---|
| hisenseUI | `/opt/pkgs/tv.vidaa.app.ui/hisenseUI/language/` | home screen |
| **system-ui** | `/opt/pkgs/tv.vidaa.app.ui/system-ui/language/` | on-screen menu, settings, system apps |
| operationui | `/APPS/pkgs/tv.vidaa.app.operationui/CHA/language/` | live-tv, epg, pvr, vidaa-tv, … (+ `missing_language.json`) |

### 6.2 Bundle format: parallel arrays, not a map

```
language/
├─ keys.json              ["SE0003", "SE0381", …]   ← ordered key array
├─ language_eng.json      ["Picture Mode", "Subtitle", …]  ← parallel values
├─ language_alb.json      …
├─ language_<locale>.json …                          ← 77 locales per variant
├─ NO-TV/                 ← product-variant override, same layout (77 locales)
├─ VDA/                   ← product-variant override (77 locales)
└─ VDA-NO-TV/             ← product-variant override (77 locales)
```

- `keys.json[i]` ↔ `language_<locale>.json[i]` — **index-aligned arrays**;
  the locale file is just an array of strings, the keys live in the
  separate file. (system-ui: 3 052 keys.)
- The variant subdirs (`NO-TV`, `VDA`, `VDA-NO-TV`) each repeat the full
  77-locale set — per-product string overrides (exact selection logic not
  yet traced; the TV's variant is picked at package-install time).
- Apps resolve strings with Vue's `$t(key)`; the SDK loads the bundle for the
  current UI language (the menu language was set to **English** for this
  investigation).

### 6.3 Key namespaces (observed prefixes)

Keys are prefixed by originating domain — an item's `settingItemTitle` key
resolves in **the bundle of the app that registered the item**:

| prefix | domain (observed) |
|---|---|
| `SE*` | setting (system-ui) — the bulk: `SE0003` Picture Mode, `SE6458` Displayed Items, `SE0679` Sleep Timer, `SE0397` Edit, `SE6443` Quick Setting |
| `TV*` | operationui TV/EPG: `TV0123` Guide, `TV0036` (PVR alt) |
| `LTV*` | live-tv: `LTV0082` Auto Focus |
| `DMP*` | display/DMP: `DMP0030` Info, `DMP0329` items |
| `LA*` | launcher/general: `LA0033` More |
| `OT*`, `IOT*`, `ACF*`, `MCF*`, `EU*`, `PV*` | store/OTA, IoT, ACR, DTMB-standard, EU-standard, PVR variants |

### 6.4 Titles can be dynamic getters

`settingItemTitle` is not always a plain key — several items compute it at
runtime:

```js
// live-tv: Audio Language — key depends on the DTV standard
get settingItemTitle() {
  const e = h.system.getCurDTVStandardState().value;
  return u.Z.isDTMB() ? "MCF0003"
       : h.region.getCurrentArea() === "EU" ? "SE2709"
       : e === h.system.DTV_STANDARD_TYPE.ATSC ? "SE5042" : "SE2709";
}
// pvr: PVR item — key depends on model variant
id:"MenuTree_QS_2003", focusName:"PVR",
get settingItemTitle() { return y.UQ.isLwe() ? "SE1042" : "TV0036" }
// pvr-media: Recording List
settingItemTitle: i.UQ.isLwe() ? "PV0004" : "SE1470"
```

So the *displayed* title for a given item can legitimately differ by DTV
standard, region, or model variant — always via i18n keys, never hardcoded.

## 7. Storage — where the menu layout is persisted

### 7.1 Location

The layout lives in the **SystemUI engine's localStorage** (cobalt/starboard),
same origin as the home app:

```
/var/local/hisenseUI/cobalt_home/.starboard.ZmlsZTovLy9oaXNlbnNlVUkvaW5kZXguaHRtbA==.storage
```

(the base64 in the filename is `file:///hisenseUI/index.html`). Owned by
uid 311 (the SystemUI user), mode 600. **The engine rewrites the whole file
on every storage write** — edit it only while SystemUI is stopped.

### 7.2 File format

```
"SAV1" magic (4 bytes)
└─ one protobuf field-2 length-delimited record
   ├─ field 1: origin string ("file://")
   └─ repeated field 2: KV message { string key = 1; string value = 2 }
```

137 KV pairs on this TV (home-app + system-ui state: `Launcher.*`,
`AppService.*`, `LiveTV.*`, `Voice.*`, `ACR.*`, `setting.*`, …). Values are
JSON strings or plain strings. (The odin *browser* leveldb under
`/var/local/odin_home_browser/…` is a different store — the quick menu is
not there.)

### 7.3 The menu keys

SDK storage module with prefix `"setting"` (the setting app constructs
`new SDK("setting", {storagePrefix:"setting"})`):

| key | value | meaning |
|---|---|---|
| `setting.qsEditList` | JSON array of item ids, in order | the **Displayed Items** row |
| `setting.qsBakList` | JSON array of item ids, in order | the **More** row |
| `setting.qsClearFlag` | `"U9.5"` | firmware-update reset flag (§7.4) |

### 7.4 Save & reset logic (module `tT4w` in `setting/js/app.js`)

```js
save:  editMode exit with changes
       → setQsEditList(ids) → tO.set("qsEditList", [...new Set(ids)])
       → setQsBakList(ids)  → tO.set("qsBakList",  [...new Set(ids)])
       → telemetry quickSettingEdit {oldversion, newversion}
reset: getQsEditList(): if tO.get("qsClearFlag") !== "U9.5"
         → clear BOTH lists, set flag to "U9.5", return null
           (i.e. first menu load after a firmware update → factory layout)
       kilby event listeners:
         "system.user.mode"          → clear BOTH lists
         "system.current.dtv.standard" → clear BOTH lists
```

Note the asymmetry: the saved lists are **only ever replaced or cleared** —
new preset items are never merged into an existing saved list, and
`orderData()` silently drops any saved id the current firmware's universe
doesn't know (§5).

## 8. Failure modes (why items can vanish)

1. **Stale saved list.** After a firmware update that adds preset items, the
   clear-flag reset restores defaults — but if the flag already matches (or
   the user re-saves before noticing), the old list persists and new items
   never appear. Items absent from *both* saved lists are invisible in the
   bar **and** in the edit dialog — unrecoverable through the UI.
2. **Unknown-id drop.** `orderData()` filters saved ids through the current
   default universe; ids from other firmware versions/regions are dropped
   silently (no error, no telemetry).
3. **Visibility gating.** An item in the saved list can still be hidden by
   its `isShow` getter (source, signal, feature flags) — that's normal
   behavior, not a bug.
4. **Recovery paths** (all require the root lane or a factory reset):
   - delete both saved-list keys → next load falls back to the factory
     preset (§4) — cleanest;
   - rewrite the keys with the desired id arrays (deduped, order = display
     order);
   - trigger the reset logic: set `setting.qsClearFlag` to anything ≠
     `"U9.5"` (one load then re-sets it), or fire the kilby user-mode /
     DTV-standard events.

## 9. Appendix — the incident that triggered this (2026-11-13/14)

**Symptom (owner report):** Quick Menu missing **Timer**, **Picture Mode**,
**Programme Guide**; edit dialog offered no way to restore them.

**Diagnosis:** saved state had `qsEditList` = 17 ids + `qsBakList` = 10 ids;
`MenuTree_QS_Channel_0001` (Guide), `MenuTree_PIC_0101` (Picture Mode) and
`MenuTree_SYS_0202` (Sleep Timer) were in **neither** list → failure mode 1.

**Fix applied (2026-11-14 ~01:30 TV time, reversible):**

1. Backup: `cp .starboard.*.storage .starboard.storage.bak-20261114`
   (27 975 B) in `/var/local/hisenseUI/cobalt_home/`.
2. `kill $(pidof SystemUI)` (pid 1565) — nothing auto-restarts it.
3. Removed exactly the two saved-list records from the storage file
   (137 → 135 pairs, 27 975 → 27 324 B; all other pairs byte-identical,
   verified by re-parse; `qsClearFlag` = `"U9.5"` left intact). Pushed back
   via sftp, `chown 311:311`, `chmod 600`.
4. Result: `getQsEditList()` returns null → factory preset (§4) → all three
   items restored at their default positions.

**Verification (owner, 2026-11-14, after reboot): PASS** — Live TV → MENU
shows Guide, Picture Mode, Sleep Timer; edit mode shows the full default
"More" row. **Rollback:** restore the `.bak-20261114` file (SystemUI stopped)
+ reboot.

## 10. Tooling notes / traps

- **TV busybox is minimal**: no `tail`, `tr`, `readlink`, `python3`. Use
  `sed`, `cat /proc/PID/…`, `ls -l /proc/PID/exe`.
- **Full-filesystem greps freeze the TV** (header). Targeted greps only.
- `ps` truncates comm to 15 chars; enumerate via `/proc/*/comm`.
- sftp (port 8008, key `server/keys/tv_root_ed25519`) is the reliable file
  lane. Batch mode `-b -` with a heredoc silently fails in this terminal —
  write a batch file and use `-b file` (piping single commands works).
- The storage filename contains `==` — quote/glob carefully; starboard
  rewrites via temp+rename, so a concurrent write can make the file briefly
  disappear (hit this once — just retry).
- Webpack module ids **collide across chunks** (`nSGW` meant three different
  things) — resolve the import alias *inside the importing module* before
  grepping for the definition.
- The setting app's `app.js` (1 MB) contains **all 426 item definitions and
  the embedded preset JSON** — one file answers most quick-menu questions.
- i18n: to translate/look up a string, join `keys.json[i]` with
  `language_<locale>.json[i]` — there is no key→value map on disk.
- Old dead ends (kept for the record): odin browser leveldb
  (`AppDisplayConfig`), `/basic/webui/quickMenu`, the `hisenseUI/static/js/sdk.js`
  "Displayed" hit (a Vue grid component, false positive), and the operationui
  language tables for "Displayed Items" (it's a **system-ui** string).
