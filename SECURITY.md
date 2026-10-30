# Security & disclosure

## Scope of this project

alvidaa is a custom home-screen launcher for Hisense VIDAA TVs. It uses the
same RemoteNow control channel as the official mobile app (MQTT/TLS on port
36669, the app's own client certificate, dynamic credentials and PIN pairing)
and VIDAA's own web-app installation APIs. It runs entirely on a TV you own,
on your LAN, and modifies nothing outside the TV's user-writable space.

## Vulnerability disclosure

During the research that produced this launcher, weaknesses in VIDAA
(2024+ firmware) were identified — most notably the TV browser exposing
privileged install/file APIs to arbitrary pages, and content-recognition /
telemetry endpoints reachable without meaningful authentication.

The researcher's position on publication: **a vulnerability report was sent to
VIDAA and Hisense Product Security (`VIDAASecurity@vidaa.com`,
`report@connectlife.io`) on 2026-10-29, and this repository is published in
parallel rather than waiting on a 90-day window.** If/when Hisense patches or
responds, findings and status will be annotated here.
The reasoning, stated openly so you can weigh it yourself:

- The documented MQTT control path requires LAN access and pairing. Separately,
  the browser can reach the unauthenticated localhost file bridge: if the TV
  loads attacker-controlled content, that content may be able to use the bridge
  without the attacker being on the LAN. The full remote attack path has not
  been independently verified; do not expose the TV browser to untrusted pages.
- No DRM or technical protection measure is circumvented; verified boot is
  untouched, and nothing here helps pirate content.
- The vendor has a history of not responding to VIDAA research reports.
- The defensive value (users can block telemetry, remove ads, control their
  own TVs) outweighs the marginal risk of LAN-local issues remaining
  unpatched on end-of-support-adjacent firmware.

If you are from Hisense and want to discuss any of this: open an issue here
or reach the repo owner — details will be updated, and findings will be
annotated as patched as firmware catches up.

## Reporting issues in this project

If you find a problem in alvidaa itself (not in VIDAA firmware), open a
GitHub issue. Please do not include tokens, certificates or captures of your
own TV's traffic in issues.

## Publication hygiene (for maintainers)

- `server/keys/` (client certs, `tokens.json`) and `server/iconcache/` are
  gitignored — never commit them.
- No LAN IPs, TV MACs, serials or tokens in committed code or docs; use
  placeholders (`<tv-ip>`) or env vars.
- Firmware dumps and extracted vendor binaries stay private — describe
  behavior, do not redistribute vendor code.
