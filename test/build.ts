// Builds small Aseprite files in memory for tests, following the public spec.
import { deflateSync } from 'node:zlib';

const u8 = (v: number) => Buffer.from([v]);
const u16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(v);
  return b;
};
const i16 = (v: number) => {
  const b = Buffer.alloc(2);
  b.writeInt16LE(v);
  return b;
};
const u32 = (v: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(v);
  return b;
};
const str = (text: string) => {
  const b = Buffer.from(text, 'utf8');
  return Buffer.concat([u16(b.length), b]);
};

function chunk(type: number, data: Buffer): Buffer {
  return Buffer.concat([u32(data.length + 6), u16(type), data]);
}

export function layer(name: string, { type = 0, level = 0, opacity = 255 } = {}): Buffer {
  return chunk(
    0x2004,
    Buffer.concat([
      u16(3), // visible, editable
      u16(type),
      u16(level),
      u16(0),
      u16(0),
      u16(0), // normal blend
      u8(opacity),
      Buffer.alloc(3),
      str(name),
    ]),
  );
}

/** A compressed RGBA image cel filled with one color. */
export function cel(
  layerIndex: number,
  rgba: number[],
  { x = 0, y = 0, w = 1, h = 1, opacity = 255, z = 0 } = {},
): Buffer {
  const pixels = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) pixels.set(rgba, i * 4);
  return chunk(
    0x2005,
    Buffer.concat([
      u16(layerIndex),
      i16(x),
      i16(y),
      u8(opacity),
      u16(2),
      i16(z),
      Buffer.alloc(5),
      u16(w),
      u16(h),
      deflateSync(pixels),
    ]),
  );
}

/** A linked cel pointing at the cel of the same layer in another frame. */
export function link(
  layerIndex: number,
  frame: number,
  { x = 0, y = 0, opacity = 255, z = 0 } = {},
): Buffer {
  return chunk(
    0x2005,
    Buffer.concat([
      u16(layerIndex),
      i16(x),
      i16(y),
      u8(opacity),
      u16(1),
      i16(z),
      Buffer.alloc(5),
      u16(frame),
    ]),
  );
}

export function tags(list: { name: string; from: number; to: number }[]): Buffer {
  return chunk(
    0x2018,
    Buffer.concat([
      u16(list.length),
      Buffer.alloc(8),
      ...list.map((t) =>
        Buffer.concat([u16(t.from), u16(t.to), u8(0), u16(0), Buffer.alloc(10), str(t.name)]),
      ),
    ]),
  );
}

export function frame(chunks: Buffer[], duration = 100): Buffer {
  const data = Buffer.concat(chunks);
  return Buffer.concat([
    u32(16 + data.length),
    u16(0xf1fa),
    u16(chunks.length),
    u16(duration),
    Buffer.alloc(2),
    u32(chunks.length),
    data,
  ]);
}

/** A 32 bit RGBA sprite with valid layer opacity. */
export function aseFile(width: number, height: number, frames: Buffer[]): Uint8Array {
  const body = Buffer.concat(frames);
  const header = Buffer.alloc(128);
  header.writeUInt32LE(128 + body.length, 0);
  header.writeUInt16LE(0xa5e0, 4);
  header.writeUInt16LE(frames.length, 6);
  header.writeUInt16LE(width, 8);
  header.writeUInt16LE(height, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(1, 14);
  header.writeUInt16LE(100, 18);
  header.writeUInt8(1, 34); // pixel width
  header.writeUInt8(1, 35); // pixel height
  return new Uint8Array(Buffer.concat([header, body]));
}
