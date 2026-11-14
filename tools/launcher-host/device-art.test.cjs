'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { artForName, dataUriFor, ART_DIR, FALLBACK } = require('./device-art.cjs');

const ICONS = fs.readdirSync(ART_DIR).filter(f => f.endsWith('.svg'));

test('every vendored icon parses as SVG and carries the ISC notice', () => {
  assert.ok(ICONS.length >= 8, 'the documented icon set is vendored, found: ' + ICONS.join(', '));
  for (const file of ICONS) {
    const svg = fs.readFileSync(path.join(ART_DIR, file), 'utf8');
    const first = svg.split('\n')[0];
    assert.match(first, /^<!-- @license lucide-static v\d+\.\d+\.\d+ - ISC -->$/,
      file + ': the vendored licence comment must be the first line, verbatim');
    // Structural parse: the licence comment, then one svg element with the
    // Lucide geometry attributes, balanced, no unresolvable colour in it.
    assert.match(svg, /^<!-- @license[\s\S]*<svg[\s\S]*<\/svg>\n?$/, file + ': not an svg document');
    assert.match(svg, /xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, file + ': missing xmlns');
    assert.match(svg, /viewBox="0 0 24 24"/, file + ': missing the 24x24 viewBox');
    assert.doesNotMatch(svg, /currentColor/, file + ': currentColor does not resolve in an <img>');
    assert.match(svg, /stroke="#94a3b8"/, file + ': the baked slate stroke is missing');
    assert.doesNotMatch(svg, /<script/i, file + ': an icon must not carry script');
  }
});

test('artForName maps each documented keyword group to the right silhouette', () => {
  const cases = [
    ['Nintendo Switch', 'gamepad-2'], ['switch', 'gamepad-2'],
    ['PlayStation 5', 'gamepad-2'], ['PS5', 'gamepad-2'], ['PS4', 'gamepad-2'],
    ['Xbox Series X', 'gamepad-2'], ['Wireless Controller', 'gamepad-2'],
    ['Apple TV', 'cast'], ['appletv', 'cast'], ['Chromecast', 'cast'],
    ['Fire TV Stick', 'cast'], ['roku', 'cast'], ['Streaming Stick', 'cast'],
    ['Steam Machine', 'cpu'], ['steam link', 'cpu'], ['Mini PC', 'cpu'],
    ['Desktop', 'cpu'], ['Home Computer', 'cpu'], ['PC', 'cpu'],
    ['Blu-ray Player', 'disc'], ['bluray', 'disc'], ['DVD', 'disc'],
    ['Disc Reader', 'disc'], ['media player', 'disc'],
    ['USB Drive', 'usb'], ['tv stick', 'usb'], ['dongle', 'usb'],
    ['Monitor', 'monitor'], ['Second Display', 'monitor'],
    ['TV', 'tv'], ['Television', 'tv'], ['Antenna', 'tv'], ['Cable box', 'tv'],
    ['Satellite', 'tv'], ['Tuner', 'tv']
  ];
  for (const [name, icon] of cases) {
    assert.equal(artForName(name).icon, icon,
      JSON.stringify(name) + ' must map to ' + icon);
  }
  // Matching is case-insensitive on the name exactly as reported.
  assert.equal(artForName('  PlayStation 5  ').icon, 'gamepad-2', 'trimmed');
  assert.equal(artForName('PLAYSTATION 5').icon, 'gamepad-2', 'upper-cased input');
});

test('"fire tv" and "apple tv" hit cast before the bare tv keyword', () => {
  // These two are the ones that will break when someone reorders the rules.
  assert.equal(artForName('fire tv').icon, 'cast');
  assert.equal(artForName('apple tv').icon, 'cast');
  assert.notEqual(artForName('fire tv').icon, 'tv');
  assert.notEqual(artForName('apple tv').icon, 'tv');
  // ...while the tuner itself still gets the tv silhouette, and the cast
  // group owns "fire stick" before the usb group's bare "stick" could.
  assert.equal(artForName('tv').icon, 'tv');
  assert.equal(artForName('cable').icon, 'tv');
  assert.equal(artForName('Fire Stick').icon, 'cast');
});

test('an unknown name falls back to box; an empty name is null', () => {
  assert.equal(artForName('HDMI-7??').icon, FALLBACK);
  assert.equal(artForName('something unheard of').icon, 'box');
  assert.ok(artForName('something unheard of').svg.length > 0);
  for (const empty of ['', '   ', null, undefined]) {
    assert.equal(artForName(empty), null, JSON.stringify(String(empty)));
  }
});

test('dataUriFor produces a base64 SVG data URI that round-trips, coloured, script-free', () => {
  const uri = dataUriFor('PlayStation 5');
  assert.match(uri, /^data:image\/svg\+xml;base64,[A-Za-z0-9+/=]+$/,
    'the allowlist only accepts the base64 form');
  const decoded = Buffer.from(uri.split(',')[1], 'base64').toString('utf8');
  assert.equal(decoded, artForName('PlayStation 5').svg, 'decodes back to the same SVG');
  assert.match(decoded, /stroke="#94a3b8"/, 'a literal colour is baked in');
  assert.doesNotMatch(decoded, /currentColor/, 'currentColor never reaches the img');
  assert.doesNotMatch(decoded, /<script/i, 'no script can ride in an icon');
  assert.equal(dataUriFor(''), null, 'an empty name has no URI, like artForName');
});
