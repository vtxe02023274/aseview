import { LayerType, type Sprite } from './ase.js';
import { compositeFrame } from './composite.js';

export type StackSource = 'layers' | 'frames';

/**
 * Slices for a sprite stack, bottom first. With layers, each visible image
 * layer of the current frame is one slice; with frames, each frame is one.
 */
export function stackSlices(
  sprite: Sprite,
  source: StackSource,
  frame: number,
  hidden: ReadonlySet<number>,
): Uint8ClampedArray[] {
  if (source === 'frames')
    return sprite.frames.map((_, i) => compositeFrame(sprite, i, { hidden }));

  const slices: Uint8ClampedArray[] = [];
  sprite.layers.forEach((layer, index) => {
    if (layer.type === LayerType.Group || hidden.has(index)) return;
    const others = new Set(sprite.layers.map((_, i) => i).filter((i) => i !== index));
    for (const h of hidden) others.add(h);
    const pixels = compositeFrame(sprite, frame, { hidden: others });
    // Layers hidden in the file or by a hidden group come out empty; skip them.
    if (pixels.some((v, i) => i % 4 === 3 && v > 0)) slices.push(pixels);
  });
  return slices;
}
