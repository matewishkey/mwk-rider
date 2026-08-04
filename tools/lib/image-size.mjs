// image-size — intrinsic pixel dimensions from raw image bytes, no deps.
//
// Written from the PNG (RFC 2083 IHDR), JPEG (ITU-T T.81 SOF) and WebP (RIFF
// container: VP8 / VP8L / VP8X) format specs, not derived from any existing
// library — byte offsets are facts, not code.
//
// Used by the live check to verify a served og:image is a real card and not,
// say, a screenshot of a 404 page: status + content-type can't tell
// those apart, but the pixel size can. PNG and JPEG cover every OG card the
// baseline generator produces. WebP is what the *build* is made of — Astro's
// image service emits it by default, so `images: srcset:missing` can read the
// width of almost nothing without it.
//
// AVIF is deliberately not parsed: its dimensions live in an ISOBMFF `ispe` box
// several levels down, and no check here needs it badly enough to justify a box
// walker. Formats we don't parse return null — callers treat that as "can't
// verify", never a failure, so the cost is a missed finding, not a wrong one.

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
  return null;
}

const str = (b, at, len) => String.fromCharCode(...b.subarray(at, at + len));
