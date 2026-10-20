import type { Sprite } from './ase.js';
import { BLEND_MODES } from './composite.js';

export interface SheetLayout {
  columns: number;
  rows: number;
  width: number;
  height: number;
  /** Top left of each frame in the sheet. */
  positions: { x: number; y: number }[];
}

/** Lays frames out left to right, wrapping after `columns` frames. */
export function layoutSheet(sprite: Sprite, columns = sprite.frames.length): SheetLayout {
  const count = sprite.frames.length;
  const cols = Math.max(1, Math.min(columns, count));
  const rows = Math.ceil(count / cols);
  return {
    columns: cols,
    rows,
    width: cols * sprite.width,
    height: rows * sprite.height,
    positions: sprite.frames.map((_, i) => ({
      x: (i % cols) * sprite.width,
      y: Math.floor(i / cols) * sprite.height,
    })),
  };
}

/**
 * Sprite sheet data in the same "array" JSON format Aseprite exports, which
 * Phaser, PixiJS and most engines can load directly.
 */
export function sheetJson(sprite: Sprite, layout: SheetLayout, image: string, scale = 1) {
  const w = sprite.width;
  const h = sprite.height;
  return {
    frames: sprite.frames.map((frame, i) => ({
      // Plain frame numbers, which is what Phaser's createFromAseprite looks up.
      filename: String(i),
      frame: { ...layout.positions[i]!, w, h },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w, h },
      sourceSize: { w, h },
      duration: frame.duration,
    })),
    meta: {
      app: 'https://github.com/vtxe02023274/aseview',
      version: '0.1.0',
      image,
      format: 'RGBA8888',
      size: { w: layout.width, h: layout.height },
      scale: String(scale),
      frameTags: sprite.tags.map((t) => ({
        name: t.name,
        from: t.from,
        to: t.to,
        direction: t.direction,
        ...(t.repeat ? { repeat: String(t.repeat) } : {}),
      })),
      layers: sprite.layers.map((l) => ({
        name: l.name,
        opacity: l.opacity,
        blendMode: BLEND_MODES[l.blendMode] ?? 'normal',
      })),
      slices: sprite.slices.map((s) => ({
        name: s.name,
        keys: s.keys.map((k) => ({
          frame: k.frame,
          bounds: { x: k.x, y: k.y, w: k.width, h: k.height },
        })),
      })),
    },
  };
}

/** Frame order for playing a tag, including the ping-pong directions. */
export function tagSequence(from: number, to: number, direction: string): number[] {
  const forward: number[] = [];
  for (let i = from; i <= to; i++) forward.push(i);
  const reverse = [...forward].reverse();
  switch (direction) {
    case 'reverse':
      return reverse;
    case 'pingpong':
      return [...forward, ...reverse.slice(1, -1)];
    case 'pingpong-reverse':
      return [...reverse, ...forward.slice(1, -1)];
    default:
      return forward;
  }
}
