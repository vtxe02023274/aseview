import { describe, expect, it } from 'vitest';
import { encodeGif, GifError } from '../src/gif.js';

/** Walks the GIF blocks and returns the frame delays, checking the structure on the way. */
function readDelays(gif: Uint8Array): number[] {
  const ascii = (o: number, n: number) => String.fromCharCode(...gif.subarray(o, o + n));
  expect(ascii(0, 6)).toBe('GIF89a');
  const flags = gif[10]!;
  let o = 13 + (flags & 0x80 ? 3 * (1 << ((flags & 7) + 1)) : 0);
  const delays: number[] = [];
  const skipSubBlocks = () => {
    while (gif[o]! !== 0) o += gif[o]! + 1;
    o++;
  };
  for (;;) {
    const block = gif[o++];
    if (block === 0x3b) return delays;
    if (block === 0x21) {
      const label = gif[o++];
      if (label === 0xf9) delays.push((gif[o + 2]! | (gif[o + 3]! << 8)) * 10);
      skipSubBlocks();
    } else if (block === 0x2c) {
      o += 9;
      o++; // LZW minimum code size
      skipSubBlocks();
    } else {
      throw new Error(`unexpected block 0x${block?.toString(16)} at ${o - 1}`);
    }
  }
}

const solid = (w: number, h: number, rgba: number[]) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set(rgba, i * 4);
  return px;
};

describe('encodeGif', () => {
  it('writes one image per frame with its delay and loops', () => {
    const gif = encodeGif(4, 3, [
      { pixels: solid(4, 3, [255, 0, 0, 255]), delay: 100 },
      { pixels: solid(4, 3, [0, 0, 0, 0]), delay: 254 },
    ]);
    expect(readDelays(gif)).toEqual([100, 250]);
    expect(new TextDecoder().decode(gif.subarray(0, 1000))).toContain('NETSCAPE2.0');
  });

  it('keeps every exact color in the global palette', () => {
    const px = new Uint8ClampedArray(3 * 4);
    px.set([10, 20, 30, 255, 40, 50, 60, 255, 0, 0, 0, 0]);
    const gif = encodeGif(3, 1, [{ pixels: px, delay: 50 }]);
    // Two colors plus transparent need a 4 entry palette; entry 0 is transparent.
    expect(gif[10]! & 7).toBe(1);
    expect(Array.from(gif.subarray(13 + 3, 13 + 9))).toEqual([10, 20, 30, 40, 50, 60]);
  });

  it('refuses more than 255 colors instead of dithering', () => {
    const px = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) px.set([i, 0, 0, 255], i * 4);
    expect(() => encodeGif(256, 1, [{ pixels: px, delay: 100 }])).toThrow(GifError);
  });
});
