/**
 * Minimal animated GIF89a encoder for pixel art. Frames are indexed against
 * one global palette built from the exact colors used; pixel art rarely has
 * more than 255, and when it does the encoder refuses instead of dithering.
 * Pixels with alpha below 128 become the transparent index.
 */

export interface GifFrame {
  /** Straight RGBA, width * height * 4 bytes. */
  pixels: Uint8ClampedArray;
  /** Milliseconds. GIF stores hundredths, so this is rounded. */
  delay: number;
}

export class GifError extends Error {}

export function encodeGif(
  width: number,
  height: number,
  frames: GifFrame[],
  loop = true,
): Uint8Array {
  if (!frames.length) throw new GifError('no frames');

  // Index 0 is transparent, colors start at 1.
  const colors = new Map<number, number>();
  const indexed = frames.map((f) => {
    const out = new Uint8Array(width * height);
    for (let i = 0; i < out.length; i++) {
      const p = f.pixels;
      if (p[i * 4 + 3]! < 128) continue;
      const rgb = (p[i * 4]! << 16) | (p[i * 4 + 1]! << 8) | p[i * 4 + 2]!;
      let index = colors.get(rgb);
      if (index === undefined) {
        index = colors.size + 1;
        if (index > 255) throw new GifError('more than 255 colors, GIF cannot hold them');
        colors.set(rgb, index);
      }
      out[i] = index;
    }
    return out;
  });

  // Palette size must be a power of two, at least 2 entries.
  let bits = 1;
  while (1 << bits < colors.size + 1) bits++;
  const paletteSize = 1 << bits;

  const out = new ByteWriter();
  out.ascii('GIF89a');
  out.u16(width);
  out.u16(height);
  out.u8(0x80 | ((bits - 1) << 4) | (bits - 1)); // global palette
  out.u8(0); // background index
  out.u8(0); // aspect ratio
  const palette = new Uint8Array(paletteSize * 3);
  for (const [rgb, index] of colors)
    palette.set([rgb >> 16, (rgb >> 8) & 255, rgb & 255], index * 3);
  out.bytes(palette);

  if (loop && frames.length > 1) {
    out.bytes([0x21, 0xff, 0x0b]);
    out.ascii('NETSCAPE2.0');
    out.bytes([0x03, 0x01, 0x00, 0x00, 0x00]); // loop forever
  }

  frames.forEach((frame, i) => {
    // Graphic control: restore to background so transparent pixels clear.
    out.bytes([0x21, 0xf9, 0x04, 0x09]);
    out.u16(Math.max(1, Math.round(frame.delay / 10)));
    out.u8(0); // transparent index
    out.u8(0);

    out.u8(0x2c);
    out.u16(0);
    out.u16(0);
    out.u16(width);
    out.u16(height);
    out.u8(0); // no local palette, not interlaced

    const minCode = Math.max(2, bits);
    out.u8(minCode);
    const data = lzw(indexed[i]!, minCode);
    for (let o = 0; o < data.length; o += 255) {
      const block = data.subarray(o, o + 255);
      out.u8(block.length);
      out.bytes(block);
    }
    out.u8(0);
  });

  out.u8(0x3b);
  return out.result();
}

/** GIF flavoured LZW: variable code size up to 12 bits, LSB first. */
function lzw(pixels: Uint8Array, minCode: number): Uint8Array {
  const clear = 1 << minCode;
  const end = clear + 1;
  const out = new ByteWriter();
  let bitBuffer = 0;
  let bitCount = 0;
  let codeSize = minCode + 1;

  const emit = (code: number) => {
    bitBuffer |= code << bitCount;
    bitCount += codeSize;
    while (bitCount >= 8) {
      out.u8(bitBuffer & 255);
      bitBuffer >>= 8;
      bitCount -= 8;
    }
  };

  let dict = new Map<number, number>();
  let next = end + 1;
  emit(clear);

  let prefix = pixels[0] ?? 0;
  for (let i = 1; i < pixels.length; i++) {
    const k = pixels[i]!;
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    emit(prefix);
    if (next < 4096) {
      dict.set(key, next++);
      // The decoder grows its code size one code later than we add entries.
      if (next > 1 << codeSize && codeSize < 12) codeSize++;
    } else {
      emit(clear);
      dict = new Map();
      next = end + 1;
      codeSize = minCode + 1;
    }
    prefix = k;
  }
  emit(prefix);
  emit(end);
  if (bitCount > 0) out.u8(bitBuffer & 255);
  return out.result();
}

class ByteWriter {
  private buf = new Uint8Array(1024);
  private len = 0;

  private grow(n: number): void {
    if (this.len + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.len + n) size *= 2;
    const bigger = new Uint8Array(size);
    bigger.set(this.buf.subarray(0, this.len));
    this.buf = bigger;
  }
  u8(v: number): void {
    this.grow(1);
    this.buf[this.len++] = v;
  }
  u16(v: number): void {
    this.u8(v & 255);
    this.u8(v >> 8);
  }
  bytes(b: ArrayLike<number>): void {
    this.grow(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
  }
  ascii(s: string): void {
    for (let i = 0; i < s.length; i++) this.u8(s.charCodeAt(i));
  }
  result(): Uint8Array {
    return this.buf.slice(0, this.len);
  }
}
