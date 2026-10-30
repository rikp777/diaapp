// Onafhankelijke hulpmiddelen voor de tests: JPG-metadata lezen en testfoto's
// met camera-metadata maken. Bewust los van de code in index.html, zodat de
// tests die code niet met zichzelf controleren.
const fs = require('fs');

/** Segmenten van een JPG tot aan de beeldgegevens (SOS). */
function segments(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('geen JPG');
  const out = [];
  let p = 2;
  while (p < buf.length && buf[p] === 0xff) {
    const marker = buf[p + 1];
    if (marker === 0xda) { out.push({ marker, start: p, end: buf.length }); break; }
    const len = buf.readUInt16BE(p + 2);
    out.push({ marker, start: p, end: p + 2 + len });
    p += 2 + len;
  }
  return out;
}

/** Alle bytes vanaf de beeldgegevens: moeten gelijk blijven na het aanpassen van metadata. */
function imageData(buf) {
  const sos = segments(buf).find((s) => s.marker === 0xda);
  return buf.subarray(sos.start);
}

function exifTiff(buf) {
  const seg = segments(buf).find((s) => s.marker === 0xe1 && buf.toString('latin1', s.start + 4, s.start + 10) === 'Exif\0\0');
  return seg ? buf.subarray(seg.start + 10, seg.end) : null;
}

function readIfd(tiff, at) {
  const le = tiff.toString('latin1', 0, 2) === 'II';
  const u16 = (o) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const size = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };
  const n = u16(at);
  const tags = new Map();
  for (let i = 0; i < n; i++) {
    const o = at + 2 + i * 12;
    const tag = u16(o), type = u16(o + 2), count = u32(o + 4);
    const bytes = (size[type] || 1) * count;
    const valAt = bytes <= 4 ? o + 8 : u32(o + 8);
    tags.set(tag, { type, count, raw: tiff.subarray(valAt, valAt + bytes), short: type === 3 ? u16(o + 8) : null, long: type === 4 ? u32(o + 8) : null });
  }
  return { tags, next: u32(at + 2 + n * 12), le, u32 };
}

/** Metadata lezen: titel (XPTitle), beschrijving, draaistand en wat andere tags. */
function readMeta(buf) {
  const tiff = exifTiff(buf);
  if (!tiff) return { xptitle: null, description: null, orientation: null, make: null, tags: [] };
  const le = tiff.toString('latin1', 0, 2) === 'II';
  const ifd0 = readIfd(tiff, le ? tiff.readUInt32LE(4) : tiff.readUInt32BE(4));
  const t = ifd0.tags;
  const str = (e) => (e ? e.raw.toString('latin1').replace(/\0+$/, '') : null);
  const out = {
    xptitle: t.has(0x9c9b) ? t.get(0x9c9b).raw.toString('utf16le').replace(/\0+$/, '') : null,
    description: str(t.get(0x010e)),
    orientation: t.has(0x0112) ? t.get(0x0112).short : null,
    make: str(t.get(0x010f)),
    tags: [...t.keys()],
    dateOriginal: null,
    gpsRef: null,
    thumbnail: null,
  };
  if (t.has(0x8769)) {
    const ex = readIfd(tiff, t.get(0x8769).long);
    out.dateOriginal = str(ex.tags.get(0x9003));
  }
  if (t.has(0x8825)) {
    const gps = readIfd(tiff, t.get(0x8825).long);
    out.gpsRef = str(gps.tags.get(0x0001));
  }
  if (ifd0.next) {
    const ifd1 = readIfd(tiff, ifd0.next);
    const off = ifd1.tags.get(0x0201), len = ifd1.tags.get(0x0202);
    if (off && len) out.thumbnail = tiff.subarray(off.long, off.long + len.long);
  }
  return out;
}

/**
 * Maakt een "camerafoto": de gegeven JPG met EXIF zoals camera's die schrijven.
 * le = Intel-volgorde met Orientation, datum (Exif-IFD) en GPS;
 * !le = Motorola-volgorde zonder Orientation, met voorbeeldafbeelding (IFD1).
 */
function withCameraExif(jpg, { le, thumbnail }) {
  const w16 = (b, o, v) => (le ? b.writeUInt16LE(v, o) : b.writeUInt16BE(v, o));
  const w32 = (b, o, v) => (le ? b.writeUInt32LE(v, o) : b.writeUInt32BE(v, o));
  // Eenvoudige IFD-bouwer: entries = [tag, type, count, Buffer]; data achter de IFD
  function ifd(entries, at, next) {
    const head = Buffer.alloc(2 + entries.length * 12 + 4);
    w16(head, 0, entries.length);
    let data = Buffer.alloc(0);
    const dataAt = at + head.length;
    entries.forEach(([tag, type, count, val], i) => {
      const o = 2 + i * 12;
      w16(head, o, tag); w16(head, o + 2, type); w32(head, o + 4, count);
      if (val.length <= 4) val.copy(head, o + 8);
      else {
        w32(head, o + 8, dataAt + data.length);
        data = Buffer.concat([data, val, Buffer.alloc(val.length & 1)]);
      }
    });
    w32(head, head.length - 4, next);
    return Buffer.concat([head, data]);
  }
  const s = (t) => Buffer.from(t + '\0', 'latin1');
  const short = (v) => { const b = Buffer.alloc(2); w16(b, 0, v); return b; };
  const long = (v) => { const b = Buffer.alloc(4); w32(b, 0, v); return b; };

  let tiff;
  if (le) {
    // IFD0 op 8, daarna Exif-IFD en GPS-IFD; offsets vooraf berekenen in twee rondes
    const build = (exifAt, gpsAt) => ifd([
      [0x010f, 2, 6, s('Canon')],
      [0x0110, 2, 14, s('Canon EOS 80D')],
      [0x0112, 3, 1, short(1)],
      [0x0132, 2, 20, s('2024:07:01 12:00:00')],
      [0x8769, 4, 1, long(exifAt)],
      [0x8825, 4, 1, long(gpsAt)],
    ], 8, 0);
    const len0 = build(0, 0).length;
    const exif = (at) => ifd([[0x9003, 2, 20, s('2024:07:01 11:59:58')]], at, 0);
    const exifAt = 8 + len0;
    const gpsAt = exifAt + exif(exifAt).length;
    const gps = ifd([[0x0001, 2, 2, s('N')]], gpsAt, 0);
    tiff = Buffer.concat([Buffer.from('II*\0', 'latin1'), long(8), build(exifAt, gpsAt), exif(exifAt), gps]);
  } else {
    const ifd0 = (next) => ifd([[0x010f, 2, 18, s('NIKON CORPORATION')]], 8, next);
    const ifd1At = 8 + ifd0(0).length;
    const ifd1 = (thumbAt) => ifd([[0x0201, 4, 1, long(thumbAt)], [0x0202, 4, 1, long(thumbnail.length)]], ifd1At, 0);
    const thumbAt = ifd1At + ifd1(0).length;
    tiff = Buffer.concat([Buffer.from('MM\0*', 'latin1'), long(8), ifd0(ifd1At), ifd1(thumbAt), thumbnail]);
  }
  const app1 = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const head = Buffer.from([0xff, 0xe1, (app1.length + 2) >> 8, (app1.length + 2) & 0xff]);
  return Buffer.concat([jpg.subarray(0, 2), head, app1, jpg.subarray(2)]);
}

module.exports = { readMeta, imageData, withCameraExif, readFile: (f) => fs.readFileSync(f) };
