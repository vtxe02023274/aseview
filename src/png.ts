/** Minimal RGBA PNG writer, enough for sprite sheets. Works in Node and browsers. */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Encodes straight RGBA pixels. The caller passes a zlib deflate function
 * (Node's zlib.deflateSync, for example) so this stays dependency free.
 */
export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array | Uint8ClampedArray,
  deflate: (data: Uint8Array) => Uint8Array,
): Uint8Array {
  // Each row starts with filter type 0 (none).
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }

  const chunks: Uint8Array[] = [];
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    chunks.push(out);
  };

  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  chunk('IHDR', ihdr);
  chunk('IDAT', deflate(raw));
  chunk('IEND', new Uint8Array(0));

  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  const total = signature.length + chunks.reduce((n, c) => n + c.length, 0);
  const png = new Uint8Array(total);
  png.set(signature);
  let o = signature.length;
  for (const c of chunks) {
    png.set(c, o);
    o += c.length;
  }
  return png;
}
