# 03 — Quick Menu (Live TV on-screen menu): reference & HowTo

> Complete reference and HowTo for the **Quick Menu** on **75UR9S /
> V0000.09.60W.Q0624** (MT9655), measured over the root SSH lane (TV
> `192.168.1.20`; the lane itself is in [README](../README.md)). This is the
> final, consolidated picture — what the Quick Menu is, where it lives, how it
> works, the item registry, the factory default, the storage format, the known
> bugs, the fix that is on this TV, and the exact procedures (with tools) to
> inspect, reset, patch and recover it. Reversible; verified boot stays green.
>
> Companion to [04 — overriding menu localization](04-localization-override-guide.md)
> and [05 — string inventory](05-localization-string-inventory.md). The
> **tools** live in `tools/ur9s/scripts/` (`qs_inspect.sh`, `qs_reset.sh`,
> `qs_storage.py`, `qs_factory_preset.json`).

## 1. TL;DR

- The **Quick Menu is the Live TV on-screen menu** — the bar of items along the
  bottom of the screen, opened with MENU in Live TV. It is a **web app**
  (`system-ui/apps/setting/js/99.js`), not a native binary (§2, §3).
- Its layout is **two rows** — "Displayed Items" (bottom) and "More" (top) —
  persisted as **two JSON arrays of item ids** in the SystemUI starboard
  storage: `setting.qsEditList` and `setting.qsBakList` (§8).
- **Known bugs (both fixed on this TV):** two splice bugs in the edit-mode
  move code that silently **delete an item** when the EQ item is moved
  (§9.2, §9.3). The fix is a small local patch to the shadow `99.js` (§10.1).
  Plus one **trap for root-lane work**: the storage file must stay owned by
  uid 311 — left `root:root`, the menu silently reverts to factory and no
  edit sticks (§9.4).
- **Tools** (`tools/ur9s/scripts/`):
  - `qs_inspect.sh` — read-only report of the current layout + integrity.
  - `qs_reset.sh` — reset the menu to its **factory default** (reversible).
  - `qs_storage.py` — the starboard storage core (parse / report / factory / drop / set / add).
  - `qs_factory_preset.json` — the 39 factory-preset item ids (§5).
- **Reversible:** every procedure in §11 has a backup and a rollback.

## 2. What the "Quick Menu" is

Per the e-manual (`LearnabouttheOnScreenMenu-EManual-20.html`): in **Live TV**,
MENU opens the **on-screen menu** — a bar of items along the bottom of the
screen. Item 1 is **All Settings**; the last item is **Edit**, which opens the
edit dialog (two rows: **"More"** on top, **"Displayed Items"** below; D-pad
moves items between/within rows). So:

**Quick Menu == the Live TV on-screen menu.** It is *not* the home-screen nav
bar and *not* the static `/basic/webui/quickMenu` panel (3 fixed webui items,
irrelevant).

## 3. Where it lives — the "native" menu is a web app

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
           ├─ language/                        i18n bundle (see §7)
           └─ apps/  acr, ai-pq, air-play, app-page, coretv-service, dlna,
                     e-manual, fte, fvp, hotel-mode, karaoke, lock-screen,
                     miracast, mixbar, multiview, playfi, professional-mode,
                     sdk, setting, store-mode, usb, volume-bar
```

The menu page is **`system-ui/apps/setting/js/99.js`** (webpack chunk 99,
module `iv2l`), route `/setting/quickSetting?vk=T` — pushed by the MENU-key
handler in `setting/js/app.js` (module `tT4w` → `s.wQ.push("/setting/quickSetting")`).

**Shadow copy (what this TV actually loads).** `/opt` is read-only (erofs +
dm-verity). The live copy is the shadow package
`/APPS/pkgs/tv.vidaa.app.ui/…` — SystemUI's `HI_UI_HOME` points at it, so it
loads the shadow's `99.js` and bundles (mechanism in
[04 §5.2](04-localization-override-guide.md#52-read-only-bundles--shadow-package-system-ui-hisenseui--primary)).
All the fixes in §10 are applied to the **shadow** `99.js`.

Component tree (all in 99.js):

- **quickSetting page** — loads the two persisted item lists (§8), renders
  either `normalMode` or `editMode`.
- **normalMode** — the bar:
  `settingList = [EQ-mode item] + qsShowData.filter(visible) + [Edit item]`.
  Voice-announces "Quick Setting. N items." on mount.
- **editMode** — top row = `bakList` (label **"More"**, i18n `LA0033`),
  bottom row = `editList` (label **"Displayed Items"**, i18n `SE6458`), plus
  the fixed **Edit** item (id `"Edit"`, i18n `SE0397`) appended last.
  UP/DOWN moves an item between rows, LEFT/RIGHT reorders within a row.
  The EQ-mode item (`MenuTree_SOU_0602`) is special-cased: always kept in the
  displayed row, spliced to the position of `MenuTree_SOU_0101` (Sound Mode).

## 4. Item registry and providers

A **global item registry** — webpack module `j19t`, export `K`, a
`Map(id → item object)` — is populated by `registSettingItems` (module
`AbMP.t` in `setting/js/app.js`), which also merges title/description
overrides from a `settingchange.json` cloud file.

Item object shape:

```js
{ id, focusName, settingItemTitle (i18n key — or a GETTER, see §7.4),
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

## 5. The factory default item list (39 items)

The factory layout is an **embedded JSON literal** (webpack module `1aHo`,
`JSON.parse('…')` inside `setting/js/app.js`). Structure:

```json
{ "preset":   { "commonHead": [4], "livetv": [9], "other": [3], "common": [13] },
  "userEdit": { "livetv": [8], "common": [2], "other": [] } }
```

`preset.*` → the default **Displayed Items** row (`qsDefList`);
`userEdit.*` → the default **More** row (`qsDefBakList`). Entries are
`{id, name}` — the `name` is a hardcoded English label; the on-screen title
is resolved from the registry entry's i18n key (§7).

> **Machine-readable copy:** the 39 ids below are also in
> `tools/ur9s/scripts/qs_factory_preset.json` (feed it to `qs_inspect.sh
> --universe` to spot items absent from both saved rows — see §11.1 for the
> caveat that a custom layout or an unsupported item will show up there).

### 5.1 `preset.commonHead` (4) — head of the bar

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_QS_0001` | All Settings | `SE6442` | setting | — |
| `MenuTree_QS_0002` | MultiView | — | multiview app | — |
| `MenuTree_Projector_0001` | Auto Keystone Correction | `SE6237` | setting | singleItem |
| `MenuTree_Projector_0004` | Auto Focus | `LTV0082` | setting | singleItem |

### 5.2 `preset.livetv` (9) — Live-TV-only items

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_QS_Channel_0001` | **Guide** | `TV0123` | epg | — |
| `MenuTree_QS_Channel_0002` | Channel Search | `SE0402` | live-tv | EditManager |
| `MenuTree_QS_Channel_0003` | Subtitle | `SE0381` | live-tv | — |
| `MenuTree_QS_Channel_0004` | Caption Control | `SE0742` | live-tv | — |
| `MenuTree_QS_Channel_0005` | Audio Language | **dynamic** (DTV standard, §7.4) | live-tv | getter |
| `MenuTree_QS_Channel_0005_01` | Audio Track (MTS) | — | live-tv | — |
| `MenuTree_QS_Channel_0005_02` | SAP | — | live-tv | — |
| `MenuTree_QS_Channel_0006` | Recording List | **dynamic** (model variant, §7.4) | pvr-media | — |
| `MenuTree_QS_Channel_0007` | Ginga Application List | `SE3554` | live-tv | — |

### 5.3 `preset.other` (3) — non-livetv sources

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_SYS_0802` | HDMI Format | `SE5005` | setting | pageModeItem |
| `MenuTree_PIC_0401` | Game Mode | `SE1919` | setting | switchItem |
| `MenuTree_QS_0003` | Game Menu | `SE6047` | setting | singleItem |

### 5.4 `preset.common` (13) — all sources

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

### 5.5 `userEdit.livetv` (8) — default "More" row (livetv)

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_QS_2001` | Edit Channel List | `SE2139` | live-tv | EditManager |
| `MenuTree_QS_2002` | Teletext | `SE0946` | live-tv | switchItem |
| `MenuTree_QS_2003` | PVR / Recording | **dynamic** (model variant, §7.4) | pvr | — |
| `MenuTree_QS_2004` | Timeshift | `SE4584` | pvr | — |
| `MenuTree_QS_2005` | Channel List | `SE1535` | live-tv | — |
| `MenuTree_QS_2006` | Info | `DMP0030` | live-tv | — |
| `MenuTree_QS_2008` | HbbTV | `SE3316` | live-tv | switchItem |
| `MenuTree_QS_2009` | User Guide | `SE6441` | vidaa-tv | — |

### 5.6 `userEdit.common` (2) — default "More" row (all sources)

| id | English title | i18n key | provider | type |
|---|---|---|---|---|
| `MenuTree_PIC_0201` | Aspect Ratio | — | setting | pageModeItem |
| `MenuTree_SOU_0703` | Digital Audio Output Format | `SE6286` | setting | modeItem |

**39 items total.** At runtime each is filtered by `isNotSupport` (model
feature flags) and its `isShow` visibility getter (source-dependent: livetv
vs other, HDMI signal, laser-TV, store mode, game-menu flag, …). Not in the
preset but special-cased: the **EQ-mode item** (`MenuTree_SOU_0602`, unshifted
into the bar by normalMode) and the fixed **Edit** item.

## 6. How the menu is built at runtime (99.js)

```
page load
  └─ getSettingData()
       ├─ e = getQsEditList()            // tT4w._r() — storage read + clear-flag logic (§8.4)
       ├─ e ? qsShowData = orderData(e)  // saved list, mapped through the default universe
       └─ else qsShowData = getDefData().qsDefList   // ← factory preset (§5)
  └─ getBakData()                        // same for qsBakList / qsDefBakList

orderData(ids):
  universe = qsDefList ∪ qsDefBakList (by id, from preset ∩ registry)
  return ids.filter(in universe).map(to item)   // unknown ids DROPPED silently

normalMode render:
  [EQ item] + qsShowData.filter(isShow=="visible") + [Edit item]

editMode render:
  row 1 "More"            = bakList items
  row 2 "Displayed Items" = editList items + [Edit]
  (only items ALREADY IN THE SAVED LISTS are shown — §9.5)
```

`getDefData()` (module `kIBO`) builds the default universe from the preset
JSON (§5) mapped through the registry (§4): `preset.*` → `qsDefList`,
`userEdit.*` → `qsDefBakList`, filtered by `isNotSupport`.

**Consequence: the on-screen menu shows exactly
`saved list ∩ default universe ∩ registry ∩ visibility`.** An item that is
registered but absent from both saved lists is never shown — and the edit
dialog renders only the saved lists, so it offers **no way to add it back**
(§9.5). That is why the recovery path is to edit the storage directly (§11.2,
§11.3), not the UI.

## 7. Where the display strings come from (localization)

Each UI package ships its own `language/` directory; the on-screen menu's
strings come from the **system-ui** bundle. The full i18n mechanism (formats,
key scoping, override methods) is in [04 — localization](04-localization-override-guide.md);
only what the Quick Menu needs is summarized here.

### 7.1 The three bundles

| bundle | path | serves |
|---|---|---|
| hisenseUI | `/opt/pkgs/tv.vidaa.app.ui/hisenseUI/language/` | home screen |
| **system-ui** | `/opt/pkgs/tv.vidaa.app.ui/system-ui/language/` | on-screen menu, settings, system apps |
| operationui | `/APPS/pkgs/tv.vidaa.app.operationui/CHA/language/` | live-tv, epg, pvr, vidaa-tv, … |

### 7.2 Format: parallel arrays, not a map

`keys.json[i]` ↔ `language_<locale>.json[i]` — **index-aligned arrays**; the
locale file is just an array of strings, the keys live in the separate file
(system-ui: 3 052 keys). Variant subdirs (`NO-TV`, `VDA`, `VDA-NO-TV`) hold
per-product overrides. To look up a string, join `keys.json[i]` with
`language_<locale>.json[i]` — there is no key→value map on disk.

### 7.3 Key namespaces (observed prefixes)

An item's `settingItemTitle` key resolves **in the bundle of the app that
registered the item**:

| prefix | domain (observed) |
|---|---|
| `SE*` | setting (system-ui) — the bulk: `SE0003` Picture Mode, `SE6458` Displayed Items, `SE0679` Sleep Timer, `SE0397` Edit, `SE6443` Quick Setting |
| `TV*` | operationui TV/EPG: `TV0123` Guide, `TV0036` (PVR alt) |
| `LTV*` | live-tv: `LTV0082` Auto Focus |
| `DMP*` | display/DMP: `DMP0030` Info, `DMP0329` items |
| `LA*` | launcher/general: `LA0033` More |
| `OT*`, `IOT*`, `ACF*`, `MCF*`, `EU*`, `PV*` | store/OTA, IoT, ACR, DTMB-standard, EU-standard, PVR variants |

### 7.4 Titles can be dynamic getters

`settingItemTitle` is not always a plain key — several items compute it at
runtime (so the *displayed* title can legitimately differ by DTV standard,
region, or model variant — always via i18n keys, never hardcoded):

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

### 7.5 Retitling a single item without touching the bundle

Menu items can also be retitled via the per-item `settingchange.json` cloud
override (keyed by item **id**; merges `title`/`description`) — a separate,
id-scoped layer from the i18n bundle ([04 §5.6](04-localization-override-guide.md#56-alternative-for-menu-item-titles--settingchangejson)).

## 8. Storage — where the layout is persisted

### 8.1 Location

The layout lives in the **SystemUI engine's localStorage** (cobalt/starboard),
same origin as the home app:

```
/var/local/hisenseUI/cobalt_home/.starboard.ZmlsZTovLy9oaXNlbnNlVUkvaW5kZXuaHRtbA==.storage
```

(the base64 in the filename is `file:///hisenseUI/index.html`). Owned by
uid 311 (the SystemUI user), mode 600. **The engine rewrites the whole file
on every storage write** — edit it only while SystemUI is stopped. The
filename is origin-derived, so **glob it** (`.starboard.*.storage`) rather
than hardcoding the base64.

### 8.2 File format

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
not there.) `tools/ur9s/scripts/qs_storage.py` reads and writes this format,
preserving every untouched field byte-for-byte.

### 8.3 The menu keys

SDK storage module with prefix `"setting"` (the setting app constructs
`new SDK("setting", {storagePrefix:"setting"})`):

| key | value | meaning |
|---|---|---|
| `setting.qsEditList` | JSON array of item ids, in order | the **Displayed Items** row |
| `setting.qsBakList` | JSON array of item ids, in order | the **More** row |
| `setting.qsClearFlag` | `"U9.5"` | firmware-update reset flag (§8.4) |

### 8.4 Save & reset logic (module `tT4w` in `setting/js/app.js`)

```js
save:  editMode exit with changes
       → setQsEditList(ids) → tO.set("qsEditList", [...new Set(ids)])
       → setQsBakList(ids)  → tO.set("qsBakList",  [...new Set(ids)])
       → telemetry quickSettingEdit {oldversion, newversion}
reset: getQsEditList(): if tO.get("qsClearFlag") !== "U9.5"
         → clear BOTH lists, set flag to "U9.5", return null
           (i.e. first menu load after a firmware update → factory layout)
       kilby event listeners:
         "system.user.mode"           → clear BOTH lists
         "system.current.dtv.standard" → clear BOTH lists
```

Two facts about this logic matter for every procedure in §11:

- **`[...new Set(ids)]` dedups on save.** A duplicate id in a row is silently
  collapsed — which is what turned the §9.3 ordering bug's duplicate-then-delete
  into a clean single-item loss.
- **The saved lists are only ever replaced or cleared** — new preset items are
  never merged into an existing saved list, and `orderData()` (§6) silently
  drops any saved id the current firmware's universe doesn't know. So the
  cleanest "restore everything" is to **delete both keys** and let the factory
  preset take over (§11.2).

## 9. Known bugs

The Quick Menu's edit mode has **two distinct data-loss bugs** in the same
function (`moveDisplayItem` and its siblings in 99.js). Both are fixed on this
TV (§10). They share one root enabler: the EQ "phantom" item (§9.1).
Understanding them is what makes the §11 recovery procedures trustworthy.
(§9.4 is not a firmware bug but a **trap** for root-lane storage edits —
included because it looked like a third bug.)

### 9.1 The EQ "phantom" item (the root enabler)

The EQ-mode item (`MenuTree_SOU_0602`) is **not** in the quick-setting preset
universe — it is a real settings page, but not a quick-menu item (absent from
every `preset.*` / `userEdit.*` array, §5). In `editMode` (99.js), the
init/recover function `x()` injects it into the **rendered** row only:

```js
function x(){
  p.value = [...i.qsShowData];        // oriEditList  (backing array — SAVED)
  v.value = p.value.filter(T.z);      // editList     (rendered Displayed row)
  h.value = [...i.bakData];           // oriBakList   (backing array — SAVED)
  m.value = h.value.filter(T.z);      // bakList      (rendered More row)
  if ("visible" === o.visibility){    // o = the EQ item
    let e = v.value.findIndex(e => e.id === k);   // k = Sound Mode (SOU_0101)
    e > -1 ? v.value.splice(e, 1, o)              // EQ replaces Sound Mode IN v
           : (e = m.value.findIndex(e => e.id === k),
              e > -1 && m.value.splice(e, 1, o));  // …or in m
  }
}
```

When the EQ item is visible (EZPlay / soundbar active), it is spliced into the
rendered row (`v` or `m`) at the position of **Sound Mode** — but it is
**never added to the backing arrays `p`/`h`** that `saveData` (`w()`)
serializes. The EQ item is a *phantom*: on screen, but absent from the data
that gets saved. **This view/backing desync is by-design** (the EQ item is
render-only, intentionally never written) — but any code that assumes the
rendered row and the backing array are in sync **by id** misbehaves when the
EQ item is visible. Both splice bugs below are exactly that class of mistake.

### 9.2 Bug 1 — `splice(-1,1)` deletes the last item

All three move operations locate the moved item in the backing array **by id**,
then `splice` it out. For the phantom, `findIndex` returns `-1`, and
`Array.prototype.splice(-1, 1)` removes the **last element** of the array:

```js
// editToBak(e) — move a Displayed item to More
const t = v.value.splice(e, 1)[0];              // the moved item (the phantom)
m.value.unshift(t);
const i = p.value.findIndex(e => e.id === t.id); // -1 for the phantom
p.value.splice(i, 1);                            // splice(-1,1) → drops LAST of p!
h.value.unshift(t);
// bakToEdit(e)  — symmetric:  h.value.splice(-1,1) drops the LAST of h
// moveDisplayItem(dir, idx) — reorder:  p.value.splice(-1,1) drops the LAST of p
```

So **any** move of the EQ item (UP/DOWN between rows, or LEFT/RIGHT reorder)
silently deletes the last item of the affected backing array, which is then
written to storage by `w()` → the item is **permanently lost**. Two items are
lost per trigger: (1) the last item of the row (the `splice(-1,1)` victim — in
the factory layout that is **Bluetooth**, `MenuTree_NET_0502`), and (2) the EQ
item itself, whose id is leaked into the *opposite* saved list and dropped by
`orderData()` (§6) on the next load.

### 9.3 Bug 2 — insert-then-remove ordering (RIGHT reorder)

A **second, distinct** bug in the same `moveDisplayItem` function, in the
RIGHT reorder branch. It does **not** rely on `splice(-1,1)` — it is a pure
**ordering** bug that corrupts the backing array even when the moved item *is*
found. The two reorder branches were not symmetric:

```js
// LEFT branch (move toward index 0) — remove-then-insert (correct)
const s = p.value.findIndex(e => e.id === i.id);   // moved item in backing
const n = p.value.findIndex(t => t.id === e.id);   // swap partner in backing
p.value.splice(s, 1);          // remove first
p.value.splice(n, 0, i);       // insert second

// RIGHT branch (move toward the end) — insert-then-remove (buggy)
const s = p.value.findIndex(e => e.id === i.id);
const n = p.value.findIndex(t => t.id === e.id);
p.value.splice(n+1, 0, i);     // insert first  ← wrong order
p.value.splice(s, 1);          // remove second
```

When **both** indices are found (`0 ≤ s < n`), insert-then-remove happens to be
correct (the insert at `n+1` is after `s`, so `s` is still valid). The bug
only fires when the **swap partner is the EQ phantom** — present in the
rendered row but absent from the backing array (§9.1) — so `n = -1`:

```
p.splice(n+1, 0, i)  →  p.splice(0, 0, i)   // insert lands at index 0!
p.splice(s, 1)       →  p.splice(s, 1)      // s was computed BEFORE the insert;
                                             // the insert at 0 shifted everything,
                                             // so this removes the WRONG element
```

Net effect: **one real item deleted, the moved item duplicated.** The save
layer's `[...new Set(ids)]` (§8.4) then collapses the duplicate, so the
corruption is finalised as a clean single-item loss — indistinguishable from
Bug 1, which is why it survived a first fix that only added the `splice(-1,1)`
guards.

### 9.4 The storage-ownership trap (edits "reset after cold boot")

**Not a firmware bug** — a remnant of an early experiment: the storage file
was edited over the root lane before it was known that the file must be owned
by the SystemUI user, and it was left owned by **`root:root`** mode 600.
With that ownership the menu appeared to **reset to factory after every cold
boot**, even with the JS fix in place, because both directions broke:

- The starboard storage file is owned by the **SystemUI** user (uid 311), mode
  600 (§8.1).
- **read fails** → `getQsEditList()` returns null → **factory preset on every
  load**;
- **write fails** → edits are silently dropped → nothing persists across a
  reboot.
- Fix: `chown 311:311` (and `chmod 600`) on the storage file. After that,
  SystemUI reads/writes normally and edits persist.

> **Trap for any future work:** a root-lane edit of the starboard storage file
> **must** be followed by `chown 311:311 && chmod 600`, or the menu silently
> reverts to factory and no edit will stick. `qs_reset.sh` does this for you
> (§11.2); if you edit the file by hand, do it yourself.

### 9.5 Other ways items vanish (not the splice bugs)

1. **Stale saved list.** After a firmware update that adds preset items, the
   clear-flag reset (§8.4) restores defaults — but if the flag already matches
   (or the user re-saves before noticing), the old list persists and new items
   never appear. Items absent from *both* saved lists are invisible in the bar
   **and** in the edit dialog — unrecoverable through the UI (§6).
2. **Unknown-id drop.** `orderData()` (§6) filters saved ids through the
   current default universe; ids from other firmware versions/regions are
   dropped silently (no error, no telemetry).
3. **Visibility gating.** An item in the saved list can still be hidden by its
   `isShow` getter (source, signal, feature flags) — that's normal behavior,
   not a bug.
4. **Recovery paths** (all require the root lane or a factory reset) — the
   §11 procedures: delete both saved-list keys (cleanest), rewrite the keys
   with the desired id arrays, or trigger the reset logic (set
   `setting.qsClearFlag` to anything ≠ `"U9.5"` for one load).

## 10. The fix (applied to this TV)

### 10.1 The local patch (4 changes to the shadow `99.js`)

The fix on this TV is a small patch to the **shadow** `99.js`
(`/APPS/pkgs/tv.vidaa.app.ui/system-ui/apps/setting/js/99.js`, module `iv2l`),
all in the edit-mode backing-array maintenance. Four changes:

| function | original | patched | bug fixed |
|---|---|---|---|
| `bakToEdit` | `h.value.splice(i,1),p.value.unshift(t)` | `i>-1&&(h.value.splice(i,1),p.value.unshift(t))` | 1 |
| `editToBak` | `p.value.splice(i,1),h.value.unshift(t)` | `i>-1&&(p.value.splice(i,1),h.value.unshift(t))` | 1 |
| `moveDisplayItem` LEFT | `p.value.splice(s,1),p.value.splice(n,0,i)` | `s>-1&&n>-1&&(p.value.splice(s,1),p.value.splice(n,0,i))` | 1 |
| `moveDisplayItem` RIGHT | `p.value.splice(n+1,0,i),p.value.splice(s,1)` | `s>-1&&n>-1&&(p.value.splice(s,1),p.value.splice(n,0,i))` | **1+2** |

- **Bug 1** (§9.2) → every `findIndex` result is bounds-checked before use; an
  unknown id becomes a no-op instead of deleting the last element.
- **Bug 2** (§9.3) → the RIGHT branch is reordered to remove-then-insert
  (matching LEFT) **and** guarded, so a phantom swap partner (`n = -1`) skips
  the whole backing mutation instead of inserting at index 0.

The rendered-row splices (`v.value`/`m.value`) are left untouched — they
operate on the on-screen arrays and are safe. The patched file is owned
`305:909`, mode `640` (the shadow-file ownership requirement,
[04 §5.2](04-localization-override-guide.md#52-read-only-bundles--shadow-package-system-ui-hisenseui--primary)).

### 10.2 The upstream fix (needs Hisense)

The clean fix is to make the EQ item a **first-class member of the backing
arrays**, not a render-only phantom. Any of:

1. In `x()`, also splice the EQ item into `p`/`h` at the same position as
   `v`/`m`, so `findIndex` succeeds and no `splice(-1,1)` fires; **or**
2. In the three move functions, guard the backing-array splice (what the local
   patch does, §10.1) — an unknown id becomes a no-op; **or**
3. In `w()`, serialize from the rendered rows (`v`/`m`) reconciled with the
   backing arrays, so a phantom can never desync them.

Option 1 or 3 removes the underlying assumption; option 2 (the local patch)
contains it for the three known move paths.

### 10.3 Why the local patch is the steady state

The local patch + `chown 311:311` on the storage is the safe steady state on
this TV: it closes both splice bugs and keeps the storage file in the
ownership SystemUI needs (§9.4), and it is
boot-persistent (the shadow sits on writable `/APPS`, [04 §7.1](04-localization-override-guide.md#71-shadow-package-primary--native-persistence-no-re-arm)).
It does **not** remove the §9.1 desync — it contains it. Until Hisense ships
an upstream fix, keep the local patch; if one does ship, re-test against it and
retire the shadow patch (§12).

## 11. HowTo — inspect, reset, patch, recover

All procedures run from the PC over the root SSH lane (TV `192.168.1.20`,
dropbear port 8008, key `server/keys/tv_root_ed25519`). The tools live in
`tools/ur9s/scripts/`. **Every mutating procedure stops SystemUI first**
(the engine rewrites the storage on every write, §8.1) and leaves a backup.

### 11.1 Inspect the current layout (read-only)

```sh
tools/ur9s/scripts/qs_inspect.sh --tv 192.168.1.20
# optional: flag items absent from both saved rows (see the caveat below)
tools/ur9s/scripts/qs_inspect.sh --tv 192.168.1.20 \
    --universe tools/ur9s/scripts/qs_factory_preset.json
```

Pulls the storage and reports the two rows (`qsEditList` = "Displayed Items",
`qsBakList` = "More"), the `qsClearFlag`, and integrity (duplicates within a
row, overlap between rows). **Touch nothing.**

> **`--universe` caveat:** it flags ids in the given set but in *neither*
> saved row. That is a **sanity check, not a strict loss detector** — a custom
> layout, an item unsupported on the model (`isNotSupport`), and always-shown
> items (e.g. `MenuTree_QS_0001` "All Settings") all show up there. Use it to
> spot an *anomaly* (e.g. right after the §9 bugs), not to validate a layout.
> `qs_factory_preset.json` is the 39 factory-preset ids (§5).

The underlying core is `qs_storage.py` (run it on a pulled file directly):

```sh
qs_storage.py parse  <file> [--all]   # dump pairs (default: setting.*)
qs_storage.py report <file> [--universe <json>]
```

### 11.2 Reset to factory default

```sh
tools/ur9s/scripts/qs_reset.sh --tv 192.168.1.20 --dry-run   # preview
tools/ur9s/scripts/qs_reset.sh --tv 192.168.1.20             # do it
```

This is the clean recovery for "items missing from the Quick Menu" (§9.5): it
removes the two saved-list keys so the next load falls back to the embedded
factory preset (§5). The tool:

1. stops SystemUI, 2. pulls the storage, 3. backs it up to
   `/var/local/alvidaa/qs-reset-<ts>/storage.bak` on the TV, 4. strips the two
   keys (`qs_storage.py factory` — every other field byte-preserved), 5. pushes
   it back **`chown 311:311 && chmod 600`** (§9.4), 6. restarts SystemUI, 7.
   re-pulls and reports to verify.

**Rollback** (printed at the end): restore the backup with the correct owner,
SystemUI stopped, then restart SystemUI or reboot.

### 11.3 Restore a specific lost item

To put one item back without a full reset, edit the saved list directly with
`qs_storage.py` (SystemUI stopped; then push back `chown 311:311 && chmod 600`
and restart SystemUI — the same push/owner/restart tail as §11.2):

```sh
# pull the storage to ./storage first (see qs_inspect.sh for the path)
# add an id to the Displayed row (deduped, compact JSON):
qs_storage.py add   ./storage ./storage.new setting.qsEditList MenuTree_NET_0502
# …or set a row to an exact list of ids:
qs_storage.py set   ./storage ./storage.new \
    setting.qsEditList='["MenuTree_QS_Channel_0001","MenuTree_PIC_0101"]'
# …or drop just one key:
qs_storage.py drop  ./storage ./storage.new setting.qsBakList
```

Order in the array = display order. After pushing, verify with §11.1.

### 11.4 Apply the `99.js` fix (the §10.1 patch)

If the shadow `99.js` is ever restored to stock (e.g. a shadow rebuild),
re-apply the four changes from §10.1 to
`/APPS/pkgs/tv.vidaa.app.ui/system-ui/apps/setting/js/99.js`:

```sh
# 1. stop SystemUI
kill $(pidof SystemUI)
# 2. back up the current shadow 99.js, pull it, apply the 4 edits (§10.1), push back
# 3. restore the shadow-file owner (NOT 311:311 — that is the storage file):
chown 305:909 /APPS/pkgs/tv.vidaa.app.ui/system-ui/apps/setting/js/99.js
chmod 640     /APPS/pkgs/tv.vidaa.app.ui/system-ui/apps/setting/js/99.js
# 4. restart SystemUI
busybox setsid /bin/sh -c '/opt/hisenseUI/startgui.sh' >/dev/null 2>&1 </dev/null &
```

Note the **two different owners**: the shadow `99.js` is `305:909`/640 (a
package file, [04 §5.2](04-localization-override-guide.md#52-read-only-bundles--shadow-package-system-ui-hisenseui--primary));
the starboard **storage** file is `311:311`/600 (§9.4). Mixing them up is the
§9.4 trap.

### 11.5 Verify after any change

```sh
# storage: owner 311:311/600, the two rows present and sane
ssh -p 8008 -i server/keys/tv_root_ed25519 root@192.168.1.20 \
  'ls -l /var/local/hisenseUI/cobalt_home/.starboard.*.storage'
tools/ur9s/scripts/qs_inspect.sh --tv 192.168.1.20
# shadow 99.js: owner 305:909/640, md5 matches the patched build
ssh -p 8008 -i server/keys/tv_root_ed25519 root@192.168.1.20 \
  'ls -l /APPS/pkgs/tv.vidaa.app.ui/system-ui/apps/setting/js/99.js; md5sum /APPS/pkgs/tv.vidaa.app.ui/system-ui/apps/setting/js/99.js'
```

On the TV: Live TV → MENU shows the expected bar; the edit dialog shows both
rows; move an item (including past the EQ item) and confirm nothing disappears
and the edit **persists after a cold reboot** (the §9.4 check).

## 12. Reversibility / teardown

Everything here is reversible and writes nothing to the read-only partitions
(verified boot stays green):

- **Factory reset (§11.2):** restore the `qs-reset-<ts>/storage.bak` backup
  (SystemUI stopped), `chown 311:311 && chmod 600`, restart SystemUI or reboot.
- **Item restore (§11.3):** same — restore the pre-edit storage backup.
- **The `99.js` patch (§11.4):** restore the stock shadow `99.js` (or the whole
  shadow: `rm -r /APPS/pkgs/tv.vidaa.app.ui`, which makes `GET_PKG_DEST` fall
  back to `/opt` — [04 §8](04-localization-override-guide.md#8-reversibility--teardown)).
  The menu then behaves as stock (the §9 bugs return, but nothing is corrupted
  until the EQ item is moved).
- **No boot re-arm is involved** — the shadow and the storage both sit on
  writable `/APPS` and `/var/local`; a cold reboot preserves them.

## 13. Traps

- **Two different owners.** The shadow `99.js` is `305:909`/640 (package
  file); the starboard **storage** file is `311:311`/600. A root-lane edit of
  the storage that forgets `chown 311:311` makes the menu silently revert to
  factory and no edit sticks (§9.4).
- **Edit the storage only while SystemUI is stopped.** The engine rewrites the
  whole file on every write; a concurrent write can also make the file briefly
  disappear (temp+rename) — just retry the pull.
- **The storage filename contains `==`** (base64 origin) — quote/glob it; never
  hardcode the base64 (§8.1).
- **`[...new Set(ids)]` dedups on save** (§8.4) — a duplicate id is silently
  collapsed, which is what masked Bug 2 (§9.3) as Bug 1.
- **The edit dialog can't add items back** (§6) — once an id is out of both
  saved lists, only a storage edit (§11.2/§11.3) or a factory reset brings it
  back.
- **TV busybox is minimal**: no `tail`, `tr`, `readlink`, `python3`, `pkill`,
  or standalone `setsid`. Use `sed`, `cat /proc/…`, `kill $(pidof …)`, and
  `busybox setsid`.
- **Full-filesystem greps freeze the TV** — search the specific files, not `/`.
- **Webpack module ids collide across chunks** (`nSGW` meant three different
  things) — resolve the import alias *inside the importing module* before
  grepping for the definition.
- **The setting app's `app.js` (1 MB) holds all 426 item definitions and the
  embedded preset JSON** (§4, §5) — one file answers most quick-menu questions.
- **i18n has no key→value map on disk** — join `keys.json[i]` with
  `language_<locale>.json[i]` (§7.2).
- **One agent per TV** — check `/var/local` (backups in
  `/var/local/alvidaa/`) before overwriting; another session may be working the
  same TV.