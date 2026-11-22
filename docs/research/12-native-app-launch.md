# Native app launch and UI state on VIDAA 9 — `appId`, `storeType`, and the boot race

> Scope: VIDAA 9.0 / MTK9602 (`65A51HEVS`, `V0000.09.09C.P0930`, EU_A), MQTT
> remote-app lane. Everything below was measured on that one unit; tooling
> differences on other builds are possible. Claims are labelled per
> [DISCLOSURE.md](../DISCLOSURE.md#verification-labels).

## 1. The `launchapp` payload

The remote-app lane publishes to
`/remoteapp/tv/ui_service/<clientId>/actions/launchapp` with a JSON body:

```json
{"name":"Netflix","urlType":37,"storeType":98,"url":"netflix","appId":"1"}
```

| Field | Observed meaning | Label |
| --- | --- | --- |
| `name` | display name; also used for the state echo | verified |
| `urlType` | `37` in every working call | verified |
| `storeType` | `0` launcher/web page, `98`/`99` for store and native apps | verified |
| `url` | `netflix`/`amazon`/`youtube` for native, `https://…` for web apps | verified |
| `appId` | the numeric app id the TV itself uses; **required for native apps** | verified |

A web page launched as the home screen uses `storeType:0` and an `http://`
URL; no `appId` is needed.

## 2. `appId` is not optional for native apps

Without `appId`, the TV still starts the process, but it reports the app as
unknown and the app comes up in a degraded state:

```text
launchapp {"name":"Netflix","urlType":37,"storeType":98,"url":"netflix"}
state     {"statetype":"app","name":"netflix","url":"netflix","appId":"-1"}
```

Netflix then shows **error 105** ("no internet") although the network and TLS
to `www.netflix.com`, `api-global.netflix.com` and `nrdp.prod.ftl.netflix.com`
are fine. The same app started from the stock launcher, or through the MQTT
lane *with* an `appId`, runs normally.

Values measured on this build:

| App | `url` | `appId` | Evidence |
| --- | --- | --- | --- |
| Netflix | `netflix` | `1` | state echo `appId:"1"`; owner confirmed playback |
| Prime Video | `amazon` | `2` | state echo `appId:"2"`; captured from the stock launcher's own launch |
| YouTube | `youtube` | `3` | state echo `appId:"3"` |

The `appId` values were confirmed two ways: by pressing OK on the stock home
tile while subscribed to the state topic, and by replaying the launch with the
value in the payload. The id set is small and numeric
(`1`, `2`, `3`, …), not a package name.

## 3. The state topic only reports transitions

`/remoteapp/mobile/broadcast/ui_service/state` publishes when the foreground
changes:

```json
{"statetype":"remote_launcher"}
{"statetype":"app","name":"netflix","url":"netflix","appId":"1"}
```

Consequences:

- The stock home appears as `remote_launcher` **once**, when it becomes the
  foreground. Pressing HOME again while it is already visible produces no
  message at all.
- After a cold boot the TV is already on `remote_launcher`, so an automation
  that only reacts to that message never sees it.
- A client that reconnects gets the current state once, which is enough to
  resynchronise — but only if the TV is willing to publish it at that moment.

## 4. The boot race: the UI service accepts `launchapp` late

On this unit the state publisher and the launch handler are not ready when the
MQTT broker comes up. Measured sequence after `reboot -f` and Power-on:

```text
uptime  27s  launchapp -> ignored (no state, no page fetch)
uptime  32s  launchapp -> ignored
...
uptime  47s  launchapp -> ignored
uptime  52s  launchapp -> accepted, state app launcher, page fetched
```

Nothing is logged by the TV when the call is ignored. A one-shot launch at boot
therefore fails silently and the stock home stays up. Two mechanisms fixed it:

1. **Retry until the page is really there.** A page served by the same host can
   send a heartbeat (`GET /api/alive` every 3 s). Retry the launch every 2 s
   until a heartbeat arrives, for up to ~5 minutes.
2. **Stop on real competition.** If a state arrives with
   `statetype:"app"` (a native app is running), stop retrying.

## 5. Launching a native app from another app: the HOME race

Native apps are ignored while another app (for example a web launcher page) is
in the foreground. The working sequence is:

1. publish `KEY_HOME` (the stock home becomes visible),
2. wait ~1.2 s,
3. publish `launchapp` with `storeType` and `appId`.

The TV answers the `KEY_HOME` with `state remote_launcher`. That message must
**not** trigger the "home screen takeover" that normally runs on
`remote_launcher`, otherwise the takeover immediately replaces the app that is
about to start. The naive fix — suppress all home events for N seconds — loses
the user's own HOME press if it happens inside that window, and the stock home
then stays up with no further events.

State-driven suppression works:

```text
pending = launch received
on state app:            pending = null          // the app really started
on state remote_launcher:
    if pending:  ignore once, and after 5 s without "app" treat the launch as
                 failed and take over the home screen again
    else:        take over immediately
```

With this, the round trip "open Netflix → HOME" returns to the custom home page
within ~1.5 s (measured), including the browser switch.

## 6. Minimal client

```js
// launch a native app
home();                                  // KEY_HOME
setTimeout(() => publishLaunch({ name, url, storeType: 98, appId }), 1200);
pending = appId;

onState(s => {
  if (s.statetype === 'app') { pending = null; return; }
  if (s.statetype === 'remote_launcher') {
    if (pending) return scheduleFallback(5000);
    showHome();
  }
});
```

## Open items

- Is `appId` stable across firmware updates, or is it assigned by the store
  database? Re-read it from a stock-launcher launch after every update.
- Are `98` and `99` both "store app" with a different install source? Both were
  observed working for `https://` apps on this build.
- Do other SoC families (MTK9618/9655/9900) accept the same payload? The lane
  exists on those builds; the id values are model-specific.
