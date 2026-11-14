#!/usr/bin/env node
'use strict';
/* Device-class silhouettes for inputs (issue #60).
 *
 * The TV reports the device on each port — displayname2 gives "PlayStation 5",
 * "Nintendo Switch", "Apple TV" — but never per-source art. This matcher maps
 * such names onto the vendored Lucide silhouettes in input-art/, and the
 * installer bakes the result into the candidate's input-art map for every
 * input the owner has not configured art for.
 *
 * Silhouettes, not brand renders, on purpose: vendor photography is not ours
 * to ship and per-device renders are a licensing minefield; the launcher is
 * minimal dark-glass line art, which a photographic render would fight; and a
 * silhouette per device class is reusable across brands. The icons are ISC
 * (three are Feather-derived, MIT) — see input-art/README.md.
 */
const fs = require('node:fs');
const path = require('node:path');

const ART_DIR = path.join(__dirname, 'input-art');

// Match order matters: "fire tv" and "apple tv" must reach `cast` before the
// bare `tv` keyword does, and the controller keywords come first so a
// "PlayStation 5" is never read as something else. Each group maps to one
// silhouette; the list is most specific intent first.
const RULES = [
  [/(nintendo|switch|playstation|ps4|ps5|xbox|gamepad|controller)/, 'gamepad-2'],
  [/(apple tv|appletv|chromecast|fire tv|fire stick|roku|streaming)/, 'cast'],
  [/(steam|mini pc|desktop|computer|pc)/, 'cpu'],
  [/(blu-?ray|dvd|disc|player)/, 'disc'],
  [/(usb|stick|dongle)/, 'usb'],
  [/(monitor|display)/, 'monitor'],
  [/(tv|television|antenna|cable|satellite|tuner)/, 'tv']
];
const FALLBACK = 'box';

// Icon name -> the baked SVG text, read once. A missing file is a build-time
// error, not a runtime one: the vendored set is part of the repo.
const CACHE = new Map();
function svgFor(icon) {
  if (!CACHE.has(icon)) {
    CACHE.set(icon, fs.readFileSync(path.join(ART_DIR, icon + '.svg'), 'utf8'));
  }
  return CACHE.get(icon);
}

// The matched icon for the name the TV reports, or null for an empty name.
// Never null for a non-empty name: the fallback silhouette is the point.
function artForName(name) {
  const text = String(name == null ? '' : name).trim().toLowerCase();
  if (!text) return null;
  for (const [rule, icon] of RULES) {
    if (rule.test(text)) return { icon, svg: svgFor(icon) };
  }
  return { icon: FALLBACK, svg: svgFor(FALLBACK) };
}

// The same match as an inline data URI the component's allowlist accepts
// (base64 SVG is in allowedInputArt(); see native-alvidaa.js). Null for an
// empty name, mirroring artForName.
function dataUriFor(name) {
  const art = artForName(name);
  if (!art) return null;
  return 'data:image/svg+xml;base64,' + Buffer.from(art.svg, 'utf8').toString('base64');
}

// The whole set as one build-time payload: the rules as regex sources and the
// icons as inline data URIs. This is what makes the silhouettes work with no
// configuration at all — the build does not need to know which inputs exist,
// because the component applies the rules to the name the TV reports.
function bundle() {
  const icons = {};
  const names = new Set(RULES.map(rule => rule[1]).concat([FALLBACK]));
  for (const icon of names) {
    icons[icon] = 'data:image/svg+xml;base64,' +
      Buffer.from(svgFor(icon), 'utf8').toString('base64');
  }
  return { rules: RULES.map(rule => [rule[0].source, rule[1]]), icons, fallback: FALLBACK };
}

module.exports = { artForName, dataUriFor, bundle, RULES, FALLBACK, ART_DIR };
