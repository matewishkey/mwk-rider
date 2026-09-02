// image-size — intrinsic pixel dimensions from raw image bytes, no deps.
//
// Written from the PNG (RFC 2083 IHDR), JPEG (ITU-T T.81 SOF), WebP (RIFF
// container: VP8 / VP8L / VP8X) and AVIF (ISO/IEC 14496-12 boxes, 23008-12
// `ispe`) format specs, not derived from any existing library — byte offsets
// are facts, not code.
//
// Used by the live check to verify a served og:image is a real card and not,
// say, a screenshot of a 404 page: status + content-type can't tell
// those apart, but the pixel size can. PNG and JPEG cover every OG card the
// baseline generator produces. WebP and AVIF are what the *build* is made of —
// Astro's image service emits webp by default and avif on request, and
// `images: srcset:missing` can read the width of almost nothing without them.
//
// Formats we don't parse return null — callers treat that as "can't verify",
// never a failure, so the cost is a missed finding, not a wrong one. That is
// the safe direction but it is silent, which is why AVIF stopped being
// acceptable to skip (issue #21): a site that builds to avif got a clean run
// out of a check that had read nothing.

export function imageSize(buf) {
  const b = new Uint8Array(buf);
  // PNG: 8-byte signature (\x89PNG…), then the IHDR chunk — width at offset 16,
  // height at 20, each a big-endian uint32.
  if (b.length >= 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return { w: dv.getUint32(16), h: dv.getUint32(20) };
  }
  // JPEG: walk segment markers to a Start-Of-Frame (0xFFC0–0xFFCF, minus the
  // non-SOF markers DHT/JPG/DAC at C4/C8/CC); height then width sit 5 and 7 bytes
  // into the SOF payload.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { h: (b[i + 5] << 8) | b[i + 6], w: (b[i + 7] << 8) | b[i + 8] };
      }
      const len = (b[i + 2] << 8) | b[i + 3];
      if (len <= 0) break;
      i += 2 + len;
    }
  }
  // WebP: a RIFF container ("RIFF" …size… "WEBP") whose first chunk says which
  // of the three bitstream shapes it is. Each stores the size somewhere else.
  if (b.length >= 30 && str(b, 0, 4) === 'RIFF' && str(b, 8, 4) === 'WEBP') {
    const chunk = str(b, 12, 4);
    // Lossy: after the 3-byte frame tag and the 3-byte start code, width and
    // height are 14-bit little-endian values (the top 2 bits are scale hints).
    if (chunk === 'VP8 ') {
      return { w: (b[26] | (b[27] << 8)) & 0x3fff, h: (b[28] | (b[29] << 8)) & 0x3fff };
    }
    // Lossless: a 0x2f signature byte, then a packed bitstream whose first 28
    // bits are (width-1, height-1), 14 bits each, little-endian.
    if (chunk === 'VP8L' && b[20] === 0x2f) {
      const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { w: (v & 0x3fff) + 1, h: ((v >>> 14) & 0x3fff) + 1 };
    }
    // Extended (alpha, animation, metadata): a canvas size as two 24-bit
    // little-endian values, each stored minus one.
    if (chunk === 'VP8X') {
      return {
        w: (b[24] | (b[25] << 8) | (b[26] << 16)) + 1,
        h: (b[27] | (b[28] << 8) | (b[29] << 16)) + 1,
      };
    }
  }
  // AVIF: an ISOBMFF file — a tree of length-prefixed boxes, signed by an
  // `ftyp` at the very front.
  if (b.length >= 12 && str(b, 4, 4) === 'ftyp') {
    const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    return avifSize(b, dv);
  }
  return null;
}

// AVIF ------------------------------------------------------------------------
//
// The pixel size is an `ispe` property (23008-12 § 6.5.3.2) sitting in the
// property container `meta/iprp/ipco`, and one file can hold several of them:
// an alpha plane, a thumbnail, a gain map. Which one describes the image a
// browser paints is not "the first" — it is whichever `ipma` associates with
// the item `pitm` names as primary. Taking the first would report a thumbnail's
// width on any file that ships one, and a wrong width is worse than none: it is
// what the srcset and og:image checks measure against.

const AVIF_BRANDS = new Set(['avif', 'avis']);

function avifSize(b, dv) {
  const ftyp = boxes(b, dv, 0, b.length).find((x) => x.type === 'ftyp');
  if (!ftyp) return null;
  // ftyp is major_brand, minor_version, then compatible_brands[] — all 4 bytes
  // wide. Encoders disagree about the major brand (libavif says `avif`, some
  // muxers say `mif1` and list `avif` as compatible), so any slot counts. The
  // minor_version slot is a number, not a brand; it can't collide with an
  // ASCII brand name, so scanning over it is harmless.
  let isAvif = false;
  for (let i = ftyp.body; i + 4 <= ftyp.end; i += 4) {
    if (AVIF_BRANDS.has(str(b, i, 4))) { isAvif = true; break; }
  }
  if (!isAvif) return null;

  // meta is a FullBox: 4 bytes of version+flags before its children.
  const meta = boxes(b, dv, 0, b.length).find((x) => x.type === 'meta');
  if (!meta) return null;
  const metaKids = boxes(b, dv, meta.body + 4, meta.end);
  const iprp = metaKids.find((x) => x.type === 'iprp');
  if (!iprp) return null;
  const iprpKids = boxes(b, dv, iprp.body, iprp.end);
  const ipco = iprpKids.find((x) => x.type === 'ipco');
  if (!ipco) return null;

  // Properties are addressed by their 1-based position in ipco, so every child
  // takes a slot whether we understand it or not.
  const sizes = new Map();
  boxes(b, dv, ipco.body, ipco.end).forEach((prop, i) => {
    if (prop.type !== 'ispe' || prop.body + 12 > prop.end) return;
    sizes.set(i + 1, { w: dv.getUint32(prop.body + 4), h: dv.getUint32(prop.body + 8) });
  });
  if (sizes.size === 0) return null;

  const primary = primaryItemId(b, dv, metaKids);
  const ipma = iprpKids.find((x) => x.type === 'ipma');
  if (primary != null && ipma) {
    for (const index of associatedProperties(b, dv, ipma, primary)) {
      const size = sizes.get(index);
      if (size) return size;
    }
  }
  // Malformed or unreadable association table. The first ispe is a guess, but
  // it is the guess that errs small (a thumbnail rather than the full image),
  // and small means a missed finding rather than a fabricated one.
  return sizes.values().next().value;
}

// pitm — the item a viewer is meant to display (14496-12 § 8.11.4). Version 0
// numbers items in 16 bits, version 1 in 32.
function primaryItemId(b, dv, metaKids) {
  const pitm = metaKids.find((x) => x.type === 'pitm');
  if (!pitm) return null;
  const version = b[pitm.body];
  const at = pitm.body + 4;
  if (version === 0) return at + 2 <= pitm.end ? dv.getUint16(at) : null;
  return at + 4 <= pitm.end ? dv.getUint32(at) : null;
}

// ipma — which properties belong to which item (23008-12 § 6.5.3.1... the
// association table, not the properties themselves). Two encodings on each
// axis: item ids widen at version ≥ 1, property indices widen when flags bit 0
// is set (a file with more than 127 properties needs 15 bits to point at one).
function associatedProperties(b, dv, ipma, itemId) {
  const version = b[ipma.body];
  const wideIndex = (b[ipma.body + 3] & 1) === 1;
  let at = ipma.body + 4;
  if (at + 4 > ipma.end) return [];
  const entries = dv.getUint32(at);
  at += 4;
  for (let e = 0; e < entries; e++) {
    if (at + (version < 1 ? 3 : 5) > ipma.end) return [];
    const id = version < 1 ? dv.getUint16(at) : dv.getUint32(at);
    at += version < 1 ? 2 : 4;
    const count = b[at++];
    const width = wideIndex ? 2 : 1;
    if (at + count * width > ipma.end) return [];
    const indices = [];
    for (let a = 0; a < count; a++) {
      // Top bit of the first byte is the "essential" flag, not part of the index.
      indices.push(wideIndex ? ((b[at] & 0x7f) << 8) | b[at + 1] : b[at] & 0x7f);
      at += width;
    }
    if (id === itemId) return indices;
  }
  return [];
}

// One level of the box tree: {type, body, end} per child, where body skips the
// header a box's own size field describes. `size === 1` means the real size is
// a 64-bit value after the type; `size === 0` means "to the end of the parent".
// A size that can't hold its own header would loop forever, so it stops the walk.
function boxes(b, dv, start, end) {
  const out = [];
  let at = start;
  while (at + 8 <= end) {
    let size = dv.getUint32(at);
    let header = 8;
    if (size === 1) {
      if (at + 16 > end) break;
      const large = dv.getBigUint64(at + 8);
      if (large > BigInt(Number.MAX_SAFE_INTEGER)) break;
      size = Number(large);
      header = 16;
    } else if (size === 0) {
      size = end - at;
    }
    if (size < header || at + size > end) break;
    out.push({ type: str(b, at + 4, 4), body: at + header, end: at + size });
    at += size;
  }
  return out;
}

const str = (b, at, len) => String.fromCharCode(...b.subarray(at, at + len));
