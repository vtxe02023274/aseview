import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { AseError, readAse, type Sprite } from '../src/ase.js';
import { compositeFrame } from '../src/composite.js';
import { layoutSheet, sheetJson, tagSequence } from '../src/sheet.js';
import { stackSlices } from '../src/stack.js';
import * as build from './build.js';

const inflate = async (data: Uint8Array) => new Uint8Array(inflateSync(data));
const load = (name: string) =>
  readAse(new Uint8Array(readFileSync(new URL(name, import.meta.url))), inflate);

const pixel = (img: Uint8ClampedArray, sprite: Sprite, x: number, y: number) =>
  Array.from(img.subarray((y * sprite.width + x) * 4, (y * sprite.width + x) * 4 + 4));

describe('readAse', () => {
  it('reads every part of the sample file', async () => {
    const s = await load('./fixtures/sample.aseprite');
    expect(s).toMatchObject({ width: 8, height: 8, depth: 32 });
    expect(s.layers.map((l) => [l.name, l.type, l.parent])).toEqual([
      ['Background', 0, -1],
      ['Group', 1, -1],
      ['Child', 0, 1],
      ['Tiles', 2, -1],
    ]);
    expect(s.tags.map((t) => [t.name, t.from, t.to, t.direction, t.repeat])).toEqual([
      ['walk', 0, 1, 'pingpong', 0],
      ['idle', 1, 1, 'forward', 3],
    ]);
    expect(Array.from(s.palette.subarray(8, 16))).toEqual([0, 255, 0, 128, 0, 0, 255, 255]);
    expect(s.slices).toEqual([
      { name: 'button', keys: [{ frame: 0, x: 0, y: 0, width: 8, height: 8 }] },
    ]);
    expect(s.tilesets[0]).toMatchObject({ name: 'Ground', tileCount: 2, tileWidth: 4 });
    expect(s.frames.map((f) => f.duration)).toEqual([100, 150]);
  });

  it('resolves linked cels to the cel they point to', async () => {
    const s = await load('./fixtures/sample.aseprite');
    expect(s.frames[1]!.cels.get(0)).toEqual(s.frames[0]!.cels.get(0));
    expect(s.frames[1]!.cels.get(0)!.pixels).toBe(s.frames[0]!.cels.get(0)!.pixels);
  });

  it('keeps the position, opacity and z-index of the linked cel itself', async () => {
    const s = await readAse(
      build.aseFile(2, 1, [
        build.frame([
          build.layer('bottom'),
          build.layer('top'),
          build.cel(0, [255, 0, 0, 255]),
          build.cel(1, [0, 0, 255, 255]),
        ]),
        build.frame([
          build.link(0, 0, { x: 1, opacity: 128, z: 1 }),
          build.cel(1, [0, 0, 255, 255], { w: 2 }),
        ]),
      ]),
      inflate,
    );
    expect(s.frames[1]!.cels.get(0)).toMatchObject({ x: 1, y: 0, opacity: 128, zIndex: 1 });
    expect(s.frames[0]!.cels.get(0)).toMatchObject({ x: 0, opacity: 255, zIndex: 0 });
    // With z-index 1 the half transparent red cel now draws above the blue one.
    const img = compositeFrame(s, 1);
    expect(pixel(img, s, 0, 0)).toEqual([0, 0, 255, 255]);
    expect(pixel(img, s, 1, 0)).toEqual([128, 0, 127, 255]);
  });

  it('rejects files that are not Aseprite sprites', async () => {
    await expect(readAse(new Uint8Array(200), inflate)).rejects.toThrow(AseError);
    const bytes = new Uint8Array(
      readFileSync(new URL('./fixtures/sample.aseprite', import.meta.url)),
    );
    await expect(readAse(bytes.subarray(0, 300), inflate)).rejects.toThrow(/unexpected end/);
  });

  it('rejects sprites without frames and tags past the last frame', async () => {
    await expect(readAse(build.aseFile(4, 4, []), inflate)).rejects.toThrow(/no frames/);
    const tagged = build.aseFile(1, 1, [
      build.frame([
        build.layer('a'),
        build.cel(0, [255, 0, 0, 255]),
        build.tags([{ name: 'run', from: 0, to: 3 }]),
      ]),
    ]);
    await expect(readAse(tagged, inflate)).rejects.toThrow(
      new AseError('tag "run" goes past the last frame'),
    );
  });
});

describe('compositeFrame', () => {
  it('stacks layers bottom to top with layer opacity', async () => {
    const s = await load('../public/demo.aseprite');
    const img = compositeFrame(s, 0);
    // Shadow is black at 80/255 opacity, nothing above it at the edge.
    expect(pixel(img, s, 16 - 9, 28)).toEqual([0, 0, 0, 80]);
    // Body is opaque over the shadow.
    expect(pixel(img, s, 16, 22)).toEqual([96, 196, 112, 255]);
    // Empty corner.
    expect(pixel(img, s, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it('hides layers on request', async () => {
    const s = await load('../public/demo.aseprite');
    const img = compositeFrame(s, 0, { hidden: new Set([1]) });
    expect(pixel(img, s, 16, 22)).toEqual([0, 0, 0, 0]);
  });

  it('only applies group opacity when the header says it is valid', async () => {
    const s = await load('./fixtures/sample.aseprite');
    // Layer 2 "Child" sits in group 1; its raw cel covers (1, 1).
    s.layers[1]!.opacity = 0;
    s.groupOpacity = false;
    expect(pixel(compositeFrame(s, 0, { hidden: new Set([0, 3]) }), s, 1, 1)[3]).toBeGreaterThan(0);
    s.groupOpacity = true;
    expect(pixel(compositeFrame(s, 0, { hidden: new Set([0, 3]) }), s, 1, 1)[3]).toBe(0);
  });

  it('draws tilemap cels from the tileset with flips', async () => {
    const s = await load('./fixtures/sample.aseprite');
    const img = compositeFrame(s, 0, { hidden: new Set([0, 2]) });
    // Tile 0 of an Aseprite tileset is the empty tile, so the map [1, 2, 1 x-flipped, 0]
    // draws the black tile, nothing (2 is out of range), black again and nothing.
    expect(pixel(img, s, 0, 0)).toEqual([0, 0, 0, 255]);
    expect(pixel(img, s, 4, 0)).toEqual([0, 0, 0, 0]);
    expect(pixel(img, s, 3, 7)).toEqual([0, 0, 0, 255]);
    expect(pixel(img, s, 4, 4)).toEqual([0, 0, 0, 0]);
  });
});

describe('sheet', () => {
  it('lays out frames and writes Aseprite style JSON', async () => {
    const s = await load('../public/demo.aseprite');
    const layout = layoutSheet(s, 4);
    expect(layout).toMatchObject({ columns: 4, rows: 2, width: 128, height: 64 });
    const json = sheetJson(s, layout, 'demo.png');
    expect(json.frames.map((f) => f.filename)).toEqual(['0', '1', '2', '3', '4', '5']);
    expect(json.frames[5]!.frame).toEqual({ x: 32, y: 32, w: 32, h: 32 });
    expect(json.frames.map((f) => f.duration)).toEqual([300, 300, 100, 100, 120, 100]);
    expect(json.meta.frameTags).toEqual([
      { name: 'idle', from: 0, to: 1, direction: 'pingpong' },
      { name: 'jump', from: 2, to: 5, direction: 'forward' },
    ]);
    // Part of a column rounds down instead of placing frames between cells.
    expect(layoutSheet(s, 2.5)).toMatchObject({ columns: 2, rows: 3, width: 64, height: 96 });
    expect(layoutSheet(s, 2.5).positions[1]).toEqual({ x: 32, y: 0 });
  });

  it('writes pingpong_reverse the way Aseprite does', async () => {
    const s = await load('../public/demo.aseprite');
    s.tags[0]!.direction = 'pingpong-reverse';
    const json = sheetJson(s, layoutSheet(s, 4), 'demo.png');
    expect(json.meta.frameTags[0]!.direction).toBe('pingpong_reverse');
  });

  it('plays tags in every direction', () => {
    expect(tagSequence(2, 5, 'forward')).toEqual([2, 3, 4, 5]);
    expect(tagSequence(2, 5, 'reverse')).toEqual([5, 4, 3, 2]);
    expect(tagSequence(2, 5, 'pingpong')).toEqual([2, 3, 4, 5, 4, 3]);
    expect(tagSequence(2, 5, 'pingpong-reverse')).toEqual([5, 4, 3, 2, 3, 4]);
    expect(tagSequence(1, 1, 'pingpong')).toEqual([1]);
  });
});

describe('stackSlices', () => {
  it('makes one slice per visible image layer, bottom first', async () => {
    const s = await load('../public/stack-demo.aseprite');
    const slices = stackSlices(s, 'layers', 0, new Set());
    expect(slices).toHaveLength(14);
    // Slice 1 is the trunk: the center is brown and the corner empty.
    expect(pixel(slices[1]!, s, 7, 7)).toEqual([122, 82, 48, 255]);
    expect(pixel(slices[1]!, s, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(stackSlices(s, 'layers', 0, new Set([1, 2]))).toHaveLength(12);
  });

  it('keeps layers that sit in groups', async () => {
    const s = await readAse(
      build.aseFile(1, 1, [
        build.frame([
          build.layer('ground'),
          build.layer('group', { type: 1 }),
          build.layer('trunk', { level: 1 }),
          build.layer('leaves', { level: 1 }),
          build.cel(0, [0, 255, 0, 255]),
          build.cel(2, [122, 82, 48, 255]),
          build.cel(3, [0, 128, 0, 255]),
        ]),
      ]),
      inflate,
    );
    const slices = stackSlices(s, 'layers', 0, new Set());
    expect(slices.map((p) => Array.from(p))).toEqual([
      [0, 255, 0, 255],
      [122, 82, 48, 255],
      [0, 128, 0, 255],
    ]);
    expect(stackSlices(s, 'layers', 0, new Set([1]))).toHaveLength(1);
  });

  it('uses frames as slices when asked', async () => {
    const s = await load('../public/demo.aseprite');
    expect(stackSlices(s, 'frames', 0, new Set())).toHaveLength(6);
  });
});
