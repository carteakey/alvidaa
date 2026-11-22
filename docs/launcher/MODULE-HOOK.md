# Replacing the stock home module (the `_V_M_` hook)

> Status: **hypothesis, not applied.** The contract below was read out of the
> vendor bundles on `65A51HEVS / V0000.09.09C.P0930`; the component has not been
> mounted on a TV yet. Treat the recipe as a design note, not a tested path.
> Companion to [HOME-UI-INTERNALS.md](HOME-UI-INTERNALS.md), which describes the
> same chain on a different vendor lineage (`vendor-v09.01`, NA build).

## Why this exists

The stock home is a Vue module inside the Cobalt document, not a separate app.
The usual "launch a web page on HOME" approach (MQTT `launchapp`) therefore
always switches process and shows the stock home for a fraction of a second
before the custom page appears.

The module registry offers a way to avoid that switch entirely.

## The contract (observed in `operation-ui/ipk.js` and the bundles)

`ipk.js` builds the registry from lazily evaluated getters:

```js
(self._V_IPK_ = self._V_IPK_ || {})["operation-ui"] = {
  name: "operation-ui",
  get moduleConfig() {
    return {
      launcher: { canInit: true, entry: (self._V_M_ || {}).launcher, priority: 0 },
      "screen-saver": { canInit: true, entry: (self._V_M_ || {})["screen-saver"], priority: 0 },
      /* … 15 modules total … */
    };
  },
  load() { /* injects apps/<name>/js/app.js for every module */ }
};
```

Every module bundle ends with the same line:

```js
(self._V_M_ = self._V_M_ || {}).launcher = () => bundle("taIK").Z;
```

So `entry` is a **factory returning a component**. The host resolves it after
all bundles have run (`get moduleConfig` is a getter), then mounts the component
for the active route. Replacing `apps/launcher/js/app.js` with a file that
assigns `self._V_M_.launcher` is therefore enough to replace the home screen —
the rest of the UI (settings, EPG, notifications) is a sibling module and keeps
working.

Important: the whole UI is one document. Do **not** navigate it away
(`location.replace(...)`) — that tears down every other module, including
settings and EPG, until the host reloads.

## Candidate implementation

```js
// apps/launcher/js/app.js  (backup the stock file first)
(function () {
  var PAGE = 'http://127.0.0.1:8770/';
  (self._V_M_ = self._V_M_ || {}).launcher = function () {
    return {
      name: 'custom-home',
      render: function (h) {
        return h('div', { style: { position: 'fixed', inset: '0', background: '#000' } }, [
          h('iframe', {
            attrs: { src: PAGE, frameborder: '0' },
            style: { width: '1920px', height: '1080px', border: '0' },
            on: { load: function (e) { try { e.target.focus(); } catch (err) {} } }
          })
        ]);
      }
    };
  };
})();
```

Open questions that decide whether it works:

1. **Vue version of the host.** The vendor render functions use the Vue 2
   `render(h)` shape; `sdk.js` on the other lineage is described as Vue 3. If
   the host expects a Vue 3 component, `render` must use the `h(type, props)`
   signature instead. Check the host bundle before shipping.
2. **Mount container.** If the host mounts modules into a sized container rather
   than the full viewport, the iframe must use `100%` instead of `1920×1080`.
3. **Key focus.** Remote keys are dispatched as `key-down` DOM events on
   `document.body`. A cross-origin iframe only receives them while it has focus;
   the `load` handler above tries to focus it.
4. **Failure mode.** If the custom page is unreachable, the home screen shows the
   page's own error state. A minimal fallback message behind the iframe is
   advisable.

## Risk and rollback

- The only file touched is
  `/APPS/channelA/operation-ui/apps/launcher/js/app.js`, which lives on the
  plain ext4 `/APPS` partition (p41). It is **not** covered by dm-verity on this
  build, unlike `/opt`, `/application`, `/vendor/lib`, `/usr/local` and `/3rd`
  (see the model report's partition table).
- Keep `app.js.orig` next to it. Rollback is
  `mv app.js app.js.stub && mv app.js.orig app.js` followed by a UI restart.
- Test offline first: load `hisenseUI/index.html` plus the bundles in a desktop
  browser with a stubbed host to confirm the component shape, then deploy.

## What it would buy

- Home and cold boot land on the custom page with **no** process switch and no
  stock-home flash.
- The rest of the vendor UI stays available as sibling modules.

Until it is tested, the MQTT takeover described in
[research/12](../research/12-native-app-launch.md) remains the working path.
