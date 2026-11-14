#!/usr/bin/env node
'use strict';
/* Per-app dominant colour extraction (issue #56).
 *
 * The dark Home does not know what is on it; both audits (dumbtv's FocusColor,
 * CleanMyTV's tileTint) proposed tinting the background wash toward the
 * focused app's colour. Lane 3 cannot sample icons at runtime — canvas reads
 * on cross-origin images are blocked, and the vendor icon host is the only
 * network path we allow — so the colours are extracted HOST-SIDE, at build
 * time, from the allowlisted icons the pipeline has as files, and baked into
 * the candidate as `self.AlvidaaNativeAppColours` (keyed by icon basename, the
 * same way the component resolves icons). Same shape and contract as
 * AlvidaaNativeInputArt: a build-time global, absent when there is nothing to
 * bake, and the component treats a missing entry as "keep the plain wash".
 *
 * The extractor is deliberately dependency-free: PNG only (the vendor store
 * icon cache is PNG), decoded with node:zlib — inflate plus the five PNG
 * scanline filters. 8-bit grey, grey+alpha, RGB, RGBA and palette (1/2/4/8
 * bit) are handled; 16-bit, interlaced and non-PNG input return null and are
 * skipped rather than guessed at. JPEG/WebP are out of scope on purpose: a
 * decoder is a dependency, and a skipped icon costs nothing (no colour
 * recorded means the current background).
 *
 * Every colour is luminance-capped here, and the component clamps again —
 * the cap in the component is the guarantee, because a map can also be
 * hand-made; the cap here keeps the baked file honest.
 *
 * CLI:
 *   node app-colours.cjs <icon.png> [more.png ...]   -> JSON map on stdout
 */

const zlib = require('node:zlib');

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
// A colour brighter than this relative luminance is scaled back to it, so a
// white icon cannot wash the screen out.
const LUMINANCE_CAP = 0.5;
// Upper bound on pixels sampled from one icon; icons are small, this only
// bounds pathological input.
const MAX_PIXELS = 65536;

function baseName(name) {
  const base = String(name == null ? '' : name).split(/[\\/]/).pop().split('?')[0].trim();
  return base ? base : '';
}

function toHex(r, g, b) {
  const pair = n => (n < 16 ? '0' : '') + n.toString(16);
  return '#' + pair(r) + pair(g) + pair(b);
}

function luminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

function capLuminanceHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const l = luminance(r, g, b);
  if (!(l > LUMINANCE_CAP)) return hex.toLowerCase();
  const f = LUMINANCE_CAP / l;
  return toHex(Math.floor(r * f), Math.floor(g * f), Math.floor(b * f));
}

/* Decode a PNG into opaque pixel triples. Returns [r,g,b, r,g,b, ...] for
 * every pixel with alpha >= 128, or null when the file is not a PNG this
 * extractor handles. CRCs are not verified: the input is our own pull of the
 * vendor's icon cache, and zlib inflate is the real integrity check. */
function pngPixels(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null;
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== PNG_SIGNATURE[i]) return null;
  }
  let pos = 8;
  let width = 0, height = 0, depth = 0, colourType = 0, interlace = 1;
  let palette = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.slice(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      colourType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (!width || !height || interlace !== 0) return null;
  const channels = colourType === 0 ? 1 : colourType === 2 ? 3 :
    colourType === 3 ? 1 : colourType === 4 ? 2 : colourType === 6 ? 4 : 0;
  if (!channels) return null;
  // Palette indices may be packed (1/2/4 bit); everything else must be 8-bit.
  if (colourType !== 3 && depth !== 8) return null;
  if (!palette && colourType === 3) return null;
  let raw;
  try {
    raw = zlib.inflateSync(Buffer.concat(idat));
  } catch {
    return null;
  }
  // Bytes per scanline and the filter unit: packed palette rows are 1-byte
  // units, unpacked rows are channels * 1 byte.
  const stride = colourType === 3 ?
    Math.ceil(width * depth / 8) : width * channels;
  const bpp = colourType === 3 ? 1 : channels;
  if (raw.length < (stride + 1) * height) return null;
  const rows = Buffer.alloc(stride * height);
  let inPos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[inPos++];
    const rowAt = y * stride;
    for (let x = 0; x < stride; x++) {
      const rawByte = raw[inPos + x];
      const a = x >= bpp ? rows[rowAt + x - bpp] : 0;
      const b = y > 0 ? rows[rowAt - stride + x] : 0;
      const c = (x >= bpp && y > 0) ? rows[rowAt - stride + x - bpp] : 0;
      let value;
      if (filter === 0) value = rawByte;
      else if (filter === 1) value = rawByte + a;
      else if (filter === 2) value = rawByte + b;
      else if (filter === 3) value = rawByte + Math.floor((a + b) / 2);
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        value = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
      } else return null;
      rows[rowAt + x] = value & 0xff;
    }
    inPos += stride;
  }
  const pixels = [];
  const opaque = v => v >= 128;
  for (let y = 0; y < height; y++) {
    const rowAt = y * stride;
    for (let x = 0; x < width; x++) {
      let r, g, b;
      if (colourType === 2) {
        r = rows[rowAt + x * 3]; g = rows[rowAt + x * 3 + 1]; b = rows[rowAt + x * 3 + 2];
      } else if (colourType === 6) {
        if (!opaque(rows[rowAt + x * 4 + 3])) continue;
        r = rows[rowAt + x * 4]; g = rows[rowAt + x * 4 + 1]; b = rows[rowAt + x * 4 + 2];
      } else if (colourType === 0) {
        r = g = b = rows[rowAt + x];
      } else if (colourType === 4) {
        if (!opaque(rows[rowAt + x * 2 + 1])) continue;
        r = g = b = rows[rowAt + x * 2];
      } else { // palette
        const bitPos = x * depth;
        const byte = rows[rowAt + (bitPos >> 3)];
        const shift = 8 - depth - (bitPos & 7);
        const idx = (byte >> shift) & ((1 << depth) - 1);
        if (idx * 3 + 2 >= palette.length) continue;
        r = palette[idx * 3]; g = palette[idx * 3 + 1]; b = palette[idx * 3 + 2];
      }
      pixels.push(r, g, b);
    }
  }
  return pixels;
}

/* The dominant colour of one PNG: quantize to 4 bits per channel, take the
 * fullest bucket, average the pixels in it, cap the luminance. Null when the
 * image cannot be read or has no opaque pixels. */
function dominantColour(buf) {
  const pixels = pngPixels(buf);
  if (!pixels || !pixels.length) return null;
  const step = Math.max(1, Math.ceil(pixels.length / 3 / MAX_PIXELS));
  const buckets = new Map();
  for (let i = 0; i < pixels.length; i += 3 * step) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    let bucket = buckets.get(key);
    if (!bucket) buckets.set(key, bucket = { count: 0, r: 0, g: 0, b: 0 });
    bucket.count++; bucket.r += r; bucket.g += g; bucket.b += b;
  }
  let best = null;
  for (const bucket of buckets.values()) {
    if (!best || bucket.count > best.count) best = bucket;
  }
  return capLuminanceHex(toHex(
    Math.round(best.r / best.count),
    Math.round(best.g / best.count),
    Math.round(best.b / best.count)));
}

/* { name: Buffer | png-data-URI } -> { map: { basename: '#rrggbb' }, skipped }.
 * Keys are reduced to basenames, because that is what the component looks up
 * from the icon value the TV reports. Anything unreadable is skipped and
 * named, never guessed. */
function colourMapFromBuffers(entries) {
  const map = {};
  const skipped = [];
  for (const name of Object.keys(entries || {})) {
    const key = baseName(name);
    if (!key) { skipped.push(String(name)); continue; }
    let buf = entries[name];
    if (typeof buf === 'string') {
      const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(buf);
      buf = m ? Buffer.from(m[1], 'base64') : null;
    }
    const colour = buf ? dominantColour(buf) : null;
    if (!colour) { skipped.push(String(name)); continue; }
    map[key] = colour;
  }
  return { map, skipped };
}

if (require.main === module) {
  const fs = require('node:fs');
  const entries = {};
  for (const file of process.argv.slice(2)) {
    try {
      entries[baseName(file)] = fs.readFileSync(file);
    } catch (error) {
      console.error('skipped ' + file + ': ' + error.message);
    }
  }
  const { map, skipped } = colourMapFromBuffers(entries);
  for (const name of skipped) console.error('skipped ' + name + ': not a readable PNG');
  console.log(JSON.stringify(map, null, 2));
}

module.exports = { baseName, dominantColour, colourMapFromBuffers, capLuminanceHex, luminance, LUMINANCE_CAP };
