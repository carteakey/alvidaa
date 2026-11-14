'use strict';
/* app-colours.test.cjs — the host-side per-app colour extractor (issue #56).
 *
 * PNGs are synthesized here (zlib + hand-built chunks, CRC fields zeroed
 * because the decoder does not verify them), so every decoder branch —
 * filters, palette packing, alpha skipping — is exercised by bytes this test
 * constructed on purpose, not by fixtures that could silently rot.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { baseName, dominantColour, colourMapFromBuffers, capLuminanceHex, luminance } = require('./app-colours.cjs');

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); // zeroed: the decoder does not verify CRCs
  return Buffer.concat([len, Buffer.from(type, 'ascii'), data, crc]);
}

// Build a PNG from explicit scanlines (each already prefixed with its filter byte).
function png(w, h, rows, colourType, depth, palette, interlace) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth; ihdr[9] = colourType; ihdr[10] = 0; ihdr[11] = 0;
  ihdr[12] = interlace || 0;
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  if (palette) parts.push(chunk('PLTE', palette));
  parts.push(chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))));
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

const rgba = (r, g, b, a) => Buffer.from([r, g, b, a == null ? 255 : a]);
const rowOf = (...pixels) => Buffer.concat([Buffer.from([0]), ...pixels]); // filter 0: None

test('a solid colour survives round-trip; RGB, grey and palette all decode', () => {
  assert.equal(dominantColour(png(2, 1, [rowOf(rgba(254, 0, 0), rgba(254, 0, 0))], 6, 8)), '#fe0000');
  // Dark enough to pass the luminance cap untouched.
  assert.equal(dominantColour(png(2, 1, [rowOf(rgba(10, 120, 30), rgba(10, 120, 30))], 6, 8)), '#0a781e');
  // Grey (colourType 0): one sample per pixel.
  assert.equal(dominantColour(png(2, 1, [Buffer.concat([Buffer.from([0]), Buffer.from([40, 40])])], 0, 8)), '#282828');
  // Grey + alpha (colourType 4): the alpha byte is honoured.
  assert.equal(dominantColour(png(2, 1, [Buffer.concat([Buffer.from([0]), Buffer.from([40, 255, 40, 255])])], 4, 8)), '#282828');
  assert.equal(dominantColour(png(2, 1, [Buffer.concat([Buffer.from([0]), Buffer.from([40, 0, 40, 0])])], 4, 8)), null,
    'fully transparent leaves nothing to sample');
  // Palette (colourType 3), 8-bit indices, with a clear winner.
  const palette = Buffer.from([200, 0, 0, 0, 0, 200]);
  const eight = Buffer.concat([Buffer.from([0]), Buffer.from([0, 0, 0, 0, 0, 0, 1, 1])]);
  assert.equal(dominantColour(png(8, 1, [eight], 3, 8, palette)), '#c80000');
  // Palette with packed 1-bit indices: 6 blue, 2 red -> blue wins.
  const packed = Buffer.concat([Buffer.from([0]), Buffer.from([0b10101010]), Buffer.from([0b10101010])]);
  assert.equal(dominantColour(png(16, 1, [packed], 3, 1, palette)), '#0000c8');
});

test('the dominant bucket wins and is averaged, not the first pixel', () => {
  // 3/4 red-ish, 1/4 blue: red wins, and the reported colour is the bucket's
  // average, not a quantized corner.
  const row = rowOf(rgba(200, 10, 10), rgba(198, 12, 10), rgba(202, 8, 12), rgba(0, 0, 220));
  assert.equal(dominantColour(png(4, 1, [row], 6, 8)), '#c80a0b');
});

test('transparent pixels are skipped, so a badge on clear ground reads as the badge', () => {
  const row = rowOf(rgba(200, 0, 0, 0), rgba(200, 0, 0, 0), rgba(0, 0, 200, 255), rgba(0, 0, 200, 255));
  assert.equal(dominantColour(png(4, 1, [row], 6, 8)), '#0000c8');
});

test('luminance is capped: a white icon cannot wash the screen out', () => {
  assert.equal(dominantColour(png(2, 1, [rowOf(rgba(255, 255, 255), rgba(255, 255, 255))], 6, 8)), '#7f7f7f');
  assert.ok(luminance(127, 127, 127) <= 0.5);
  assert.equal(capLuminanceHex('#ffffff'), '#7f7f7f');
  assert.equal(capLuminanceHex('#b20710'), '#b20710', 'a dark brand colour passes untouched');
  assert.equal(capLuminanceHex('#B20710'), '#b20710', 'and comes back lowercase');
  // The cap preserves hue: the red channel stays dominant.
  const capped = capLuminanceHex('#ffc0cb'); // pink, L ≈ 0.8
  assert.ok(capped.startsWith('#'), capped);
  assert.ok(parseInt(capped.slice(1, 3), 16) > parseInt(capped.slice(3, 5), 16),
    'red still dominates after the cap');
});

test('unsupported and broken input returns null instead of a guessed colour', () => {
  assert.equal(dominantColour(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])), null, 'JPEG magic');
  assert.equal(dominantColour(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13])), null, 'truncated');
  assert.equal(dominantColour(Buffer.alloc(0)), null, 'empty');
  assert.equal(dominantColour(png(2, 1, [rowOf(rgba(1, 2, 3), rgba(1, 2, 3))], 6, 16)), null, '16-bit');
  assert.equal(dominantColour(png(2, 1, [rowOf(rgba(1, 2, 3), rgba(1, 2, 3))], 5, 8)), null, 'unknown colour type');
  assert.equal(dominantColour(png(2, 1, [rowOf(rgba(1, 2, 3), rgba(1, 2, 3))], 6, 8, null, 1)), null, 'interlaced');
});

test('colourMapFromBuffers keys by icon basename and skips what it cannot read', () => {
  const red = png(2, 1, [rowOf(rgba(254, 0, 0), rgba(254, 0, 0))], 6, 8);
  const { map, skipped } = colourMapFromBuffers({
    'var/local/storeAppIcon/netflix.png': red,
    'https://img.vidaahub.com/plex.png': 'data:image/png;base64,' + red.toString('base64'),
    'white.png': png(2, 1, [rowOf(rgba(255, 255, 255), rgba(255, 255, 255))], 6, 8),
    'broken.png': Buffer.from([0xff, 0xd8]),
    'data:image/jpeg;base64,AAAA': Buffer.alloc(0),
    '/with/path/nested.png': 'data:image/jpeg;base64,AAAA'
  });
  assert.deepEqual(map, {
    'netflix.png': '#fe0000',
    'plex.png': '#fe0000',
    'white.png': '#7f7f7f'
  });
  assert.deepEqual(skipped.sort(), ['/with/path/nested.png', 'broken.png', 'data:image/jpeg;base64,AAAA'].sort(),
    'non-PNG payloads and paths are skipped under their entry name, not guessed');
});

test('the CLI turns icon files into the JSON map the installer bakes', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-colours-'));
  const icon = path.join(dir, 'netflix.png');
  fs.writeFileSync(icon, png(2, 1, [rowOf(rgba(254, 0, 0), rgba(254, 0, 0))], 6, 8));
  const junk = path.join(dir, 'junk.png');
  fs.writeFileSync(junk, Buffer.from([0xff, 0xd8, 0xff]));
  const out = cp.execFileSync(process.execPath,
    [path.join(__dirname, 'app-colours.cjs'), icon, junk], { encoding: 'utf8' });
  assert.deepEqual(JSON.parse(out), { 'netflix.png': '#fe0000' });
  fs.rmSync(dir, { recursive: true, force: true });
});

test('baseName reduces icon paths and URLs to the lookup key', () => {
  assert.equal(baseName('var/local/storeAppIcon/netflix.png'), 'netflix.png');
  assert.equal(baseName('file:///hisenseUI/var/local/storeAppIcon/netflix.png'), 'netflix.png');
  assert.equal(baseName('https://img.vidaahub.com/a/plex.png?w=80'), 'plex.png');
  assert.equal(baseName('C:\\cache\\hulu.png'), 'hulu.png', 'windows separators too');
  assert.equal(baseName('   '), '');
  assert.equal(baseName(null), '');
});
