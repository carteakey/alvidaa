# alvidaa findings — operations

> Split from the original FINDINGS.md lab notebook. Canonical record; the blog and STORY.md draw from these.

## 8. Operations

- Run the server on an always-on host (the Pi here — the original
  vidaa-launcher author's launcher died every time his Mac slept).
- The page degrades gracefully: server down → clock keeps drawing, tiles show
  dead state, auto-reconnects (exponential backoff capped at 8s).
- `keys/` (certs, tokens.json) must never be committed.
- Preset apps (TV Channels, VIDAA Kids, APP STORE…) cannot be truly deleted
  via known APIs — this launcher hides them via `config.json` instead.

## 9. Open questions

- True deletion of preset apps (probably `preset.txt`/database territory —
  brick-adjacent, not attempted).
- Boot-time takeover is a 3s poll, not a real launcher. A cleaner hook would
  need the `Appinfo.json` "preset" slot — untested.
- Whether `HiUtils_createRequest` survives firmware updates (the installed
  app entry should survive regardless).
