# input-art — bundled device silhouettes

Class silhouettes for HDMI inputs, vendored from
[Lucide](https://lucide.dev) (`lucide-static`) so the native Home can show a
line-art icon for an input the owner never configured art for. The TV reports
the device name on a port (`displayname2`: "PlayStation 5", "Apple TV", a
tuner) but never per-source art; `device-art.cjs` matches those names to these
icons and the installer bakes them into the candidate.

## Provenance

- Source: `https://unpkg.com/lucide-static@latest/icons/<name>.svg`
  (the `@latest` redirect resolved to **lucide-static 1.71.0** on 2026-11-10;
  the version comment inside every file records what was actually fetched).
- Files: `gamepad-2`, `tv`, `cast`, `usb`, `disc`, `cpu`, `monitor`, `box`
  (24×24, ~350–800 bytes each, `stroke-width="2"`, round caps/joins).
- Each file keeps Lucide's own licence comment as its first line.

## The baked colour

Lucide ships `stroke="currentColor"`, which does not resolve inside an `<img>`
or a `background-image` (it would inherit from nowhere and default to black).
Every file therefore carries a literal `stroke="#94a3b8"` (slate-400) instead.
Checked, not guessed — WCAG contrast against the two tile backgrounds the
native dock uses:

| background | tile | contrast |
| --- | --- | --- |
| `#161b24` | normal | 6.73:1 |
| `#232a36` | focused | 5.63:1 |

Both clear the 3:1 WCAG 1.4.11 non-text minimum with room, and `#94a3b8` is
already the dock's unfocused tile-label colour, so the silhouettes read as part
of the design rather than an overlay.

## Licence

Lucide is ISC; `cast`, `monitor` and `tv` are derived from the Feather project
(MIT, Cole Bemis). Both notices are reproduced verbatim below because three of
the eight vendored files fall under the second one.

Attribution line, for a credits page:

> Device silhouettes from [Lucide](https://lucide.dev) (lucide-static 1.71.0,
> ISC), `cast`/`monitor`/`tv` derived from [Feather](https://feathericons.com)
> (MIT).

```text
ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

---

The following Lucide icons are derived from the Feather project:

airplay, alert-circle, alert-octagon, alert-triangle, aperture, arrow-down-circle, arrow-down-left, arrow-down-right, arrow-down, arrow-left-circle, arrow-left, arrow-right-circle, arrow-right, arrow-up-circle, arrow-up-left, arrow-up-right, arrow-up, at-sign, calendar, cast, check, chevron-down, chevron-left, chevron-right, chevron-up, chevrons-down, chevrons-left, chevrons-right, chevrons-up, circle, clipboard, clock, code, columns, command, compass, corner-down-left, corner-down-right, corner-left-down, corner-left-up, corner-right-down, corner-right-up, corner-up-left, corner-up-right, crosshair, database, divide-circle, divide-square, dollar-sign, download, external-link, feather, frown, hash, headphones, help-circle, info, italic, key, layout, life-buoy, link-2, link, loader, lock, log-in, log-out, maximize, meh, minimize, minimize-2, minus-circle, minus-square, minus, monitor, moon, more-horizontal, more-vertical, move, music, navigation-2, navigation, octagon, pause-circle, percent, plus-circle, plus-square, plus, power, radio, rss, search, server, share, shopping-bag, sidebar, smartphone, smile, square, table-2, tablet, target, terminal, trash-2, trash, triangle, tv, type, upload, x-circle, x-octagon, x-square, x, zoom-in, zoom-out

The MIT License (MIT) (for the icons listed above)

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
