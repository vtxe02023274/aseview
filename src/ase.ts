/**
 * Reader for Aseprite files (.ase / .aseprite), following the public spec:
 * https://github.com/aseprite/aseprite/blob/main/docs/ase-file-specs.md
 *
 * Image data is zlib compressed. The caller passes an inflate function so the
 * same code runs in the browser (DecompressionStream) and in Node (zlib).
 */

export type Inflate = (data: Uint8Array) => Promise<Uint8Array>;

export const enum LayerType {
  Image = 0,
  Group = 1,
  Tilemap = 2,
}

export interface Layer {
  name: string;
  type: LayerType;
  childLevel: number;
  visible: boolean;
  background: boolean;
  reference: boolean;
  blendMode: number;
  opacity: number;
  tilesetIndex: number;
  /** Index of the enclosing group layer, -1 at the top level. */
  parent: number;
}

export interface Cel {
  layer: number;
  x: number;
  y: number;
  opacity: number;
  zIndex: number;
  width: number;
  height: number;
  /** Raw pixels in the sprite's color mode, row by row. Empty for tilemap cels. */
  pixels: Uint8Array;
  /** Tile references for tilemap cels, row by row. */
  tiles?: Uint32Array;
  tileMasks?: { id: number; xFlip: number; yFlip: number; diagonal: number };
}

export interface Frame {
  duration: number;
  /** Cels by layer index. Linked cels are resolved to the cel they point to. */
  cels: Map<number, Cel>;
}

export interface Tag {
  name: string;
  from: number;
  to: number;
  direction: 'forward' | 'reverse' | 'pingpong' | 'pingpong-reverse';
  repeat: number;
  color: [number, number, number];
}

export interface Tileset {
  id: number;
  name: string;
  tileWidth: number;
  tileHeight: number;
  tileCount: number;
  /** Tiles stacked vertically, in the sprite's color mode. Empty when external. */
  pixels: Uint8Array;
}

export interface Slice {
  name: string;
  keys: { frame: number; x: number; y: number; width: number; height: number }[];
}

export interface Sprite {
  width: number;
  height: number;
  /** Bits per pixel: 32 RGBA, 16 grayscale, 8 indexed. */
  depth: 8 | 16 | 32;
  transparentIndex: number;
  /** Whether layer opacity values in the file are meaningful. */
  layerOpacity: boolean;
  /** RGBA, 4 bytes per entry. */
  palette: Uint8Array;
  layers: Layer[];
  frames: Frame[];
  tags: Tag[];
  tilesets: Tileset[];
  slices: Slice[];
}

export class AseError extends Error {}

const DIRECTIONS = ['forward', 'reverse', 'pingpong', 'pingpong-reverse'] as const;

class Reader {
  private readonly view: DataView;
  pos = 0;

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }

  need(n: number): void {
    if (this.pos + n > this.bytes.length) {
      throw new AseError(`unexpected end of file at offset ${this.pos}`);
    }
  }
  u8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }
  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }
  bytesOf(n: number): Uint8Array {
    this.need(n);
    const out = this.bytes.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  string(): string {
    return new TextDecoder().decode(this.bytesOf(this.u16()));
  }
}

export async function readAse(bytes: Uint8Array, inflate: Inflate): Promise<Sprite> {
  const r = new Reader(bytes);
  r.need(128);
  r.u32(); // file size
  if (r.u16() !== 0xa5e0) throw new AseError('not an Aseprite file (bad magic number)');
  const frameCount = r.u16();
  const width = r.u16();
  const height = r.u16();
  const depth = r.u16();
  if (depth !== 8 && depth !== 16 && depth !== 32)
    throw new AseError(`unknown color depth ${depth}`);
  const flags = r.u32();
  r.u16(); // deprecated speed
  r.skip(8);
  const transparentIndex = r.u8();
  r.skip(3);
  r.pos = 128;

  const sprite: Sprite = {
    width,
    height,
    depth,
    transparentIndex,
    layerOpacity: (flags & 1) !== 0,
    palette: defaultPalette(),
    layers: [],
    frames: [],
    tags: [],
    tilesets: [],
    slices: [],
  };
  const hasUuid = (flags & 4) !== 0;
  const links: { frame: number; layer: number; source: number }[] = [];
  let hasNewPalette = false;

  for (let f = 0; f < frameCount; f++) {
    const frameStart = r.pos;
    const frameSize = r.u32();
    if (r.u16() !== 0xf1fa) throw new AseError(`frame ${f}: bad magic number`);
    const oldCount = r.u16();
    const duration = r.u16();
    r.skip(2);
    const newCount = r.u32();
    const chunkCount = newCount !== 0 ? newCount : oldCount;
    const frame: Frame = { duration, cels: new Map() };
    sprite.frames.push(frame);

    for (let c = 0; c < chunkCount; c++) {
      const chunkStart = r.pos;
      const size = r.u32();
      const type = r.u16();
      if (size < 6) throw new AseError(`frame ${f}: chunk ${c} has invalid size ${size}`);
      const end = chunkStart + size;
      r.need(size - 6);

      switch (type) {
        case 0x0004:
        case 0x0011:
          if (!hasNewPalette) readOldPalette(r, sprite.palette, type === 0x0011);
          break;
        case 0x2004:
          sprite.layers.push(readLayer(r, sprite.layers, hasUuid));
          break;
        case 0x2005: {
          const cel = await readCel(r, end, sprite.depth, inflate);
          if ('link' in cel) links.push({ frame: f, layer: cel.layer, source: cel.link });
          else frame.cels.set(cel.layer, cel);
          break;
        }
        case 0x2018:
          sprite.tags.push(...readTags(r));
          break;
        case 0x2019:
          hasNewPalette = true;
          readPalette(r, sprite);
          break;
        case 0x2022:
          sprite.slices.push(readSlice(r));
          break;
        case 0x2023:
          sprite.tilesets.push(await readTileset(r, sprite, inflate));
          break;
        default:
          // Color profile, user data, external files, masks and anything newer
          // do not affect how the sprite looks here.
          break;
      }
      r.pos = end;
    }
    r.pos = frameStart + frameSize;
  }

  for (const { frame, layer, source } of links) {
    const cel = sprite.frames[source]?.cels.get(layer);
    if (cel) sprite.frames[frame]!.cels.set(layer, cel);
  }
  return sprite;
}

/** Palette used by sprites that never store one: grayscale ramp. */
function defaultPalette(): Uint8Array {
  const p = new Uint8Array(256 * 4);
  for (let i = 0; i < 256; i++) p.set([i, i, i, 255], i * 4);
  return p;
}

function readOldPalette(r: Reader, palette: Uint8Array, sixBit: boolean): void {
  const packets = r.u16();
  let index = 0;
  for (let p = 0; p < packets; p++) {
    index += r.u8();
    let count = r.u8();
    if (count === 0) count = 256;
    for (let i = 0; i < count; i++, index++) {
      const scale = (v: number) => (sixBit ? (v << 2) | (v >> 4) : v);
      const rgb = [scale(r.u8()), scale(r.u8()), scale(r.u8())];
      if (index < 256) palette.set([...rgb, 255], index * 4);
    }
  }
}

function readPalette(r: Reader, sprite: Sprite): void {
  const size = r.u32();
  const from = r.u32();
  const to = r.u32();
  r.skip(8);
  if (size * 4 > sprite.palette.length) {
    const bigger = new Uint8Array(size * 4);
    bigger.set(sprite.palette);
    sprite.palette = bigger;
  }
  for (let i = from; i <= to; i++) {
    const flags = r.u16();
    const rgba = [r.u8(), r.u8(), r.u8(), r.u8()];
    if (flags & 1) r.string();
    if (i < sprite.palette.length / 4) sprite.palette.set(rgba, i * 4);
  }
}

function readLayer(r: Reader, layers: Layer[], hasUuid: boolean): Layer {
  const flags = r.u16();
  const type = r.u16() as LayerType;
  const childLevel = r.u16();
  r.skip(4);
  const blendMode = r.u16();
  const opacity = r.u8();
  r.skip(3);
  const name = r.string();
  const tilesetIndex = type === LayerType.Tilemap ? r.u32() : -1;
  if (hasUuid) r.skip(16);

  // The parent is the closest earlier layer one level up (spec NOTE.1).
  let parent = -1;
  for (let i = layers.length - 1; i >= 0 && childLevel > 0; i--) {
    if (layers[i]!.childLevel === childLevel - 1) {
      parent = i;
      break;
    }
  }
  return {
    name,
    type,
    childLevel,
    visible: (flags & 1) !== 0,
    background: (flags & 8) !== 0,
    reference: (flags & 64) !== 0,
    blendMode,
    opacity,
    tilesetIndex,
    parent,
  };
}

async function readCel(
  r: Reader,
  end: number,
  depth: number,
  inflate: Inflate,
): Promise<Cel | { layer: number; link: number }> {
  const layer = r.u16();
  const x = r.i16();
  const y = r.i16();
  const opacity = r.u8();
  const type = r.u16();
  const zIndex = r.i16();
  r.skip(5);
  const bpp = depth / 8;

  switch (type) {
    case 0: {
      const width = r.u16();
      const height = r.u16();
      const pixels = r.bytesOf(width * height * bpp).slice();
      return { layer, x, y, opacity, zIndex, width, height, pixels };
    }
    case 1:
      return { layer, link: r.u16() };
    case 2: {
      const width = r.u16();
      const height = r.u16();
      const pixels = await inflate(r.bytesOf(end - r.pos));
      if (pixels.length < width * height * bpp) {
        throw new AseError(`cel on layer ${layer}: image data is too short`);
      }
      return { layer, x, y, opacity, zIndex, width, height, pixels };
    }
    case 3: {
      const width = r.u16();
      const height = r.u16();
      const bits = r.u16();
      const id = r.u32();
      const xFlip = r.u32();
      const yFlip = r.u32();
      const diagonal = r.u32();
      r.skip(10);
      const raw = await inflate(r.bytesOf(end - r.pos));
      const tiles = new Uint32Array(width * height);
      const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
      const step = bits / 8;
      for (let i = 0; i < tiles.length && (i + 1) * step <= raw.length; i++) {
        tiles[i] =
          step === 4
            ? view.getUint32(i * 4, true)
            : step === 2
              ? view.getUint16(i * 2, true)
              : raw[i]!;
      }
      return {
        layer,
        x,
        y,
        opacity,
        zIndex,
        width,
        height,
        pixels: new Uint8Array(0),
        tiles,
        tileMasks: { id, xFlip, yFlip, diagonal },
      };
    }
    default:
      throw new AseError(`cel on layer ${layer}: unknown cel type ${type}`);
  }
}

function readTags(r: Reader): Tag[] {
  const count = r.u16();
  r.skip(8);
  const tags: Tag[] = [];
  for (let i = 0; i < count; i++) {
    const from = r.u16();
    const to = r.u16();
    const direction = DIRECTIONS[r.u8()] ?? 'forward';
    const repeat = r.u16();
    r.skip(6);
    const color: [number, number, number] = [r.u8(), r.u8(), r.u8()];
    r.skip(1);
    tags.push({ name: r.string(), from, to, direction, repeat, color });
  }
  return tags;
}

function readSlice(r: Reader): Slice {
  const keyCount = r.u32();
  const flags = r.u32();
  r.skip(4);
  const name = r.string();
  const keys: Slice['keys'] = [];
  for (let i = 0; i < keyCount; i++) {
    keys.push({ frame: r.u32(), x: r.i32(), y: r.i32(), width: r.u32(), height: r.u32() });
    if (flags & 1) r.skip(16);
    if (flags & 2) r.skip(8);
  }
  return { name, keys };
}

async function readTileset(r: Reader, sprite: Sprite, inflate: Inflate): Promise<Tileset> {
  const id = r.u32();
  const flags = r.u32();
  const tileCount = r.u32();
  const tileWidth = r.u16();
  const tileHeight = r.u16();
  r.i16(); // base index, only for display
  r.skip(14);
  const name = r.string();
  if (flags & 1) r.skip(8);
  let pixels: Uint8Array = new Uint8Array(0);
  if (flags & 2) {
    const length = r.u32();
    pixels = await inflate(r.bytesOf(length));
    const expected = tileWidth * tileHeight * tileCount * (sprite.depth / 8);
    if (pixels.length < expected) throw new AseError(`tileset ${name}: image data is too short`);
  }
  return { id, name, tileWidth, tileHeight, tileCount, pixels };
}
