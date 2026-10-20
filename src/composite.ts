import { LayerType, type Cel, type Layer, type Sprite } from './ase.js';

export interface CompositeOptions {
  /** Layers to leave out, on top of the ones hidden in the file. */
  hidden?: ReadonlySet<number>;
  /** Draw layers marked as reference layers. Aseprite hides them on export. */
  includeReference?: boolean;
}

/** Aseprite blend mode ids that are supported; the rest draw as normal. */
export const BLEND_MODES: Record<number, string> = {
  0: 'normal',
  1: 'multiply',
  2: 'screen',
  4: 'darken',
  5: 'lighten',
  10: 'difference',
  16: 'addition',
  17: 'subtract',
};

/**
 * Flattens one frame into straight (not premultiplied) RGBA pixels, the same
 * size as the sprite.
 */
export function compositeFrame(
  sprite: Sprite,
  frameIndex: number,
  options: CompositeOptions = {},
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(sprite.width * sprite.height * 4);
  const frame = sprite.frames[frameIndex];
  if (!frame) return out;

  // Order from the spec (NOTE.5): layer index plus the cel z-index, and on a
  // tie the cel with the lower z-index goes first.
  const order = [...frame.cels.values()]
    .filter((cel) => layerShown(sprite, cel.layer, options))
    .sort((a, b) => a.layer + a.zIndex - (b.layer + b.zIndex) || a.zIndex - b.zIndex);

  for (const cel of order) {
    const layer = sprite.layers[cel.layer]!;
    let opacity = cel.opacity / 255;
    if (sprite.layerOpacity) opacity *= effectiveOpacity(sprite, cel.layer);
    if (opacity <= 0) continue;
    if (layer.type === LayerType.Tilemap) drawTilemap(sprite, layer, cel, out, opacity);
    else drawCel(sprite, layer, cel, out, opacity);
  }
  return out;
}

function layerShown(sprite: Sprite, index: number, options: CompositeOptions): boolean {
  for (let i = index; i >= 0; i = sprite.layers[i]!.parent) {
    const layer = sprite.layers[i];
    if (!layer || !layer.visible || options.hidden?.has(i)) return false;
    if (layer.reference && !options.includeReference) return false;
  }
  return sprite.layers[index]?.type !== LayerType.Group;
}

function effectiveOpacity(sprite: Sprite, index: number): number {
  let opacity = sprite.layers[index]!.opacity / 255;
  // Group opacity only counts when the file says so; older files leave it at 0.
  if (sprite.groupOpacity) {
    for (let i = sprite.layers[index]!.parent; i >= 0; i = sprite.layers[i]!.parent) {
      opacity *= sprite.layers[i]!.opacity / 255;
    }
  }
  return opacity;
}

/** Reads one pixel of the sprite's color mode as straight RGBA. */
function pixelAt(sprite: Sprite, layer: Layer, data: Uint8Array, i: number, rgba: number[]): void {
  switch (sprite.depth) {
    case 32:
      rgba[0] = data[i * 4]!;
      rgba[1] = data[i * 4 + 1]!;
      rgba[2] = data[i * 4 + 2]!;
      rgba[3] = data[i * 4 + 3]!;
      break;
    case 16:
      rgba[0] = rgba[1] = rgba[2] = data[i * 2]!;
      rgba[3] = data[i * 2 + 1]!;
      break;
    case 8: {
      const index = data[i]!;
      // The transparent index only applies to non-background layers.
      if (index === sprite.transparentIndex && !layer.background) {
        rgba[3] = 0;
        return;
      }
      const p = sprite.palette;
      rgba[0] = p[index * 4] ?? 0;
      rgba[1] = p[index * 4 + 1] ?? 0;
      rgba[2] = p[index * 4 + 2] ?? 0;
      rgba[3] = p[index * 4 + 3] ?? 0;
      break;
    }
  }
}

const src = [0, 0, 0, 0];

function drawCel(
  sprite: Sprite,
  layer: Layer,
  cel: Cel,
  out: Uint8ClampedArray,
  opacity: number,
): void {
  for (let y = 0; y < cel.height; y++) {
    const sy = cel.y + y;
    if (sy < 0 || sy >= sprite.height) continue;
    for (let x = 0; x < cel.width; x++) {
      const sx = cel.x + x;
      if (sx < 0 || sx >= sprite.width) continue;
      pixelAt(sprite, layer, cel.pixels, y * cel.width + x, src);
      blend(out, (sy * sprite.width + sx) * 4, src, opacity, layer.blendMode);
    }
  }
}

function drawTilemap(
  sprite: Sprite,
  layer: Layer,
  cel: Cel,
  out: Uint8ClampedArray,
  opacity: number,
): void {
  const tileset = sprite.tilesets.find((t) => t.id === layer.tilesetIndex);
  if (!tileset || !cel.tiles || !cel.tileMasks || !tileset.pixels.length) return;
  const { tileWidth: tw, tileHeight: th } = tileset;
  const m = cel.tileMasks;

  for (let ty = 0; ty < cel.height; ty++) {
    for (let tx = 0; tx < cel.width; tx++) {
      const value = cel.tiles[ty * cel.width + tx]!;
      const id = value & m.id;
      if (id === 0 || id >= tileset.tileCount) continue;
      const xFlip = (value & m.xFlip) !== 0;
      const yFlip = (value & m.yFlip) !== 0;
      const diagonal = (value & m.diagonal) !== 0;

      for (let py = 0; py < th; py++) {
        for (let px = 0; px < tw; px++) {
          // Map the destination pixel back into the tile image.
          let u = diagonal ? py : px;
          let v = diagonal ? px : py;
          if (xFlip) u = tw - 1 - u;
          if (yFlip) v = th - 1 - v;
          const sx = cel.x + tx * tw + px;
          const sy = cel.y + ty * th + py;
          if (sx < 0 || sy < 0 || sx >= sprite.width || sy >= sprite.height) continue;
          pixelAt(sprite, layer, tileset.pixels, (id * th + v) * tw + u, src);
          blend(out, (sy * sprite.width + sx) * 4, src, opacity, layer.blendMode);
        }
      }
    }
  }
}

function mix(mode: number, b: number, s: number): number {
  switch (mode) {
    case 1:
      return (b * s) / 255;
    case 2:
      return b + s - (b * s) / 255;
    case 4:
      return Math.min(b, s);
    case 5:
      return Math.max(b, s);
    case 10:
      return Math.abs(b - s);
    case 16:
      return Math.min(255, b + s);
    case 17:
      return Math.max(0, b - s);
    default:
      return s;
  }
}

/** Source over with an optional separable blend mode, on straight alpha. */
function blend(
  out: Uint8ClampedArray,
  o: number,
  s: number[],
  opacity: number,
  mode: number,
): void {
  const sa = (s[3]! / 255) * opacity;
  if (sa <= 0) return;
  const ba = out[o + 3]! / 255;
  const ra = sa + ba * (1 - sa);
  for (let c = 0; c < 3; c++) {
    const b = out[o + c]!;
    // W3C compositing: the blend result only counts where the backdrop is opaque.
    const mixed = (1 - ba) * s[c]! + ba * mix(mode, b, s[c]!);
    const value = (mixed * sa + b * ba * (1 - sa)) / ra;
    out[o + c] = Math.round(value);
  }
  out[o + 3] = Math.round(ra * 255);
}
