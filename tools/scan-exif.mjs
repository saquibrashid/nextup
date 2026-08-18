/**
 * A structural EXIF/GPS probe for files about to enter a PUBLIC repository.
 *
 * ⚠ This does NOT search for tag bytes as a substring. Lane E measured the
 * naive approach on a real 1.8 MB HEIC: the two bytes of tag `0x8825`
 * (GPSInfo) occurred 33 times little-endian and 38 times big-endian purely by
 * coincidence. A substring hit is not evidence, and — worse — a substring MISS
 * is not evidence of absence either. So this walks the TIFF/IFD structure and
 * only reports a tag it has actually parsed.
 *
 * Usage: node tools/scan-exif.mjs [--strip] <file>...
 *
 * Without --strip this only reports. Exit code 1 if any file still carries a
 * real location or a device identity.
 *
 * --strip overwrites, IN PLACE and WITHOUT CHANGING ANY OFFSET OR LENGTH, the
 * GPS entry values and the Make/Model/Software/DateTime strings. Nothing is
 * removed and no entry count changes, because deleting an IFD entry would
 * require rewriting every offset after it — the container, the raster and the
 * rest of the EXIF layout stay byte-identical to what the device wrote.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const GPS_IFD = 0x8825;
const EXIF_IFD = 0x8769;
const MAKE = 0x010f;
const MODEL = 0x0110;
const DATETIME = 0x0132;
const SOFTWARE = 0x0131;

const NAMES = {
  [MAKE]: 'Make',
  [MODEL]: 'Model',
  [DATETIME]: 'DateTime',
  [SOFTWARE]: 'Software',
};

/** Locate candidate TIFF headers and keep only those that parse as one. */
function tiffCandidates(buf) {
  const out = [];
  for (const marker of ['II\x2a\x00', 'MM\x00\x2a']) {
    const pat = Buffer.from(marker, 'latin1');
    let i = 0;
    while ((i = buf.indexOf(pat, i)) !== -1) {
      out.push(i);
      i += 1;
    }
  }
  return out.filter((t) => plausible(buf, t));
}

function plausible(buf, t) {
  try {
    const le = buf[t] === 0x49;
    const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
    const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
    const ifd0 = t + u32(t + 4);
    if (ifd0 + 2 > buf.length || ifd0 <= t) return false;
    const n = u16(ifd0);
    // A real IFD0 has a handful of entries, not thousands, and must fit.
    if (n === 0 || n > 256) return false;
    if (ifd0 + 2 + n * 12 + 4 > buf.length) return false;
    // Every entry's type must be one of the 12 legal TIFF types.
    for (let k = 0; k < n; k++) {
      const type = u16(ifd0 + 2 + k * 12 + 2);
      if (type < 1 || type > 12) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function readAscii(buf, t, le, entry) {
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const count = u32(entry + 4);
  const off = count > 4 ? t + u32(entry + 8) : entry + 8;
  if (off + count > buf.length) return null;
  return buf
    .subarray(off, off + count)
    .toString('latin1')
    .replace(/\0+$/, '');
}

function rational(buf, t, le, entry) {
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const count = u32(entry + 4);
  const off = t + u32(entry + 8);
  const vals = [];
  for (let j = 0; j < Math.min(count, 3); j++) {
    const n = u32(off + j * 8);
    const d = u32(off + j * 8 + 4);
    vals.push(d === 0 ? 0 : n / d);
  }
  return vals;
}

function walk(buf, t) {
  const le = buf[t] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const found = { gps: null, tags: {}, hasExifIfd: false };

  const ifd0 = t + u32(t + 4);
  const n = u16(ifd0);
  let gpsOff = null;
  for (let k = 0; k < n; k++) {
    const e = ifd0 + 2 + k * 12;
    const tag = u16(e);
    if (tag === GPS_IFD) gpsOff = t + u32(e + 8);
    if (tag === EXIF_IFD) found.hasExifIfd = true;
    if (NAMES[tag]) found.tags[NAMES[tag]] = readAscii(buf, t, le, e);
  }

  if (gpsOff !== null && gpsOff + 2 <= buf.length) {
    const gn = u16(gpsOff);
    if (gn > 0 && gn <= 64) {
      const gps = {};
      for (let k = 0; k < gn; k++) {
        const e = gpsOff + 2 + k * 12;
        const tag = u16(e);
        if (tag === 1 || tag === 3)
          gps[tag === 1 ? 'latRef' : 'lonRef'] = String.fromCharCode(buf[e + 8]);
        if (tag === 2 || tag === 4) {
          const v = rational(buf, t, le, e);
          gps[tag === 2 ? 'lat' : 'lon'] = v;
        }
      }
      const dms = (a) => (a && a.length === 3 ? a[0] + a[1] / 60 + a[2] / 3600 : null);
      found.gps = {
        tagCount: gn,
        lat: dms(gps.lat),
        latRef: gps.latRef ?? null,
        lon: dms(gps.lon),
        lonRef: gps.lonRef ?? null,
      };
    }
  }
  return found;
}

/**
 * Overwrite the identifying values in place. Offsets and lengths are preserved
 * exactly; only value bytes are touched.
 */
function strip(buf, t) {
  const le = buf[t] === 0x49;
  const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
  const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
  let changed = 0;

  const blankValue = (entry) => {
    const type = u16(entry + 2);
    const count = u32(entry + 4);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const off = size > 4 ? t + u32(entry + 8) : entry + 8;
    if (off < 0 || off + size > buf.length) return false;
    buf.fill(0, off, off + size);
    return true;
  };

  const ifd0 = t + u32(t + 4);
  const n = u16(ifd0);
  let gpsOff = null;
  for (let k = 0; k < n; k++) {
    const e = ifd0 + 2 + k * 12;
    const tag = u16(e);
    if (tag === GPS_IFD) gpsOff = t + u32(e + 8);
    if (NAMES[tag] && blankValue(e)) changed++;
  }

  if (gpsOff !== null && gpsOff + 2 <= buf.length) {
    const gn = u16(gpsOff);
    if (gn > 0 && gn <= 64) {
      for (let k = 0; k < gn; k++) {
        if (blankValue(gpsOff + 2 + k * 12)) changed++;
      }
    }
  }
  return changed;
}

const args = process.argv.slice(2);
const stripMode = args.includes('--strip');
const files = args.filter((a) => a !== '--strip');

let dirty = false;
for (const file of files) {
  const buf = readFileSync(file);
  const cands = tiffCandidates(buf);
  const name = path.basename(file);
  if (cands.length === 0) {
    console.log(`${name}: no parseable EXIF`);
    continue;
  }
  if (stripMode) {
    let changed = 0;
    for (const t of cands) changed += strip(buf, t);
    writeFileSync(file, buf);
    console.log(`${name}: stripped ${changed} identifying values`);
    continue;
  }
  for (const t of cands) {
    const r = walk(buf, t);
    const bits = [];
    for (const [k, v] of Object.entries(r.tags)) {
      if (v) {
        bits.push(`${k}="${v}"`);
        dirty = true;
      }
    }
    if (r.hasExifIfd) bits.push('ExifIFD');
    if (r.gps) {
      // A GPS IFD whose coordinates are zero carries no location. Only a real
      // position counts as dirty — otherwise a stripped file can never pass.
      const located = Boolean(r.gps.lat) || Boolean(r.gps.lon);
      if (located) dirty = true;
      bits.push(
        `${located ? '⚠ ' : ''}GPS ${r.gps.tagCount} tags lat=${r.gps.lat?.toFixed(5)}${r.gps.latRef ?? ''} lon=${r.gps.lon?.toFixed(5)}${r.gps.lonRef ?? ''}`,
      );
    }
    console.log(
      `${name} @0x${t.toString(16)}: ${bits.length ? bits.join(', ') : 'EXIF present, no notable tags'}`,
    );
  }
}
process.exit(dirty ? 1 : 0);
