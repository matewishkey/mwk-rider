// image-size — intrinsic pixel dimensions from raw image bytes, no deps.
//
// Written from the PNG (RFC 2083 IHDR) and JPEG (ITU-T T.81 SOF) format specs,
// not derived from any existing library — byte offsets are facts, not code.
//
// Used by the live check to verify a served og:image is a real card and not,
// say, a screenshot of a 404 page (mergodon/td-rider#5): status + content-type can't tell
// those apart, but the pixel size can. PNG and JPEG cover every OG card the
// baseline generator produces. Formats we don't parse return null — callers
// treat that as "can't verify", never a failure.

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
  return null;
}
