import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { run } from '../src/cli.js';
import { encodePng } from '../src/png.js';
import { aseFile, cel, frame, layer, tags } from './build.js';

describe('encodePng', () => {
  it('writes valid chunks with the right CRCs', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 255, 0, 1, 2, 3, 4]);
    const png = encodePng(2, 2, rgba, (d) => deflateSync(d));
    const view = new DataView(png.buffer, png.byteOffset);
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(view.getUint32(16)).toBe(2);
    expect(view.getUint32(20)).toBe(2);
    // IEND always ends with the same CRC.
    expect(view.getUint32(png.length - 4)).toBe(0xae426082);
    // IDAT holds each row prefixed by filter 0.
    const idatLength = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLength));
    expect(Array.from(raw)).toEqual([0, ...rgba.subarray(0, 8), 0, ...rgba.subarray(8)]);
  });
});

describe('cli', () => {
  it('exports a sheet, its JSON and one GIF per tag', async () => {
    const out = mkdtempSync(join(tmpdir(), 'aseview-'));
    const lines: string[] = [];
    const demo = fileURLToPath(new URL('../public/demo.aseprite', import.meta.url));
    expect(
      await run([demo, '-o', out, '--columns', '3', '--gif', '--hide', 'shadow'], (s) =>
        lines.push(s),
      ),
    ).toBe(0);
    expect(lines[0]).toMatch(/6 frames -> demo\.png, demo\.json, demo-idle\.gif, demo-jump\.gif$/);
    const json = JSON.parse(readFileSync(join(out, 'demo.json'), 'utf8'));
    expect(json.meta.size).toEqual({ w: 96, h: 64 });
    expect(readFileSync(join(out, 'demo-jump.gif')).subarray(0, 6).toString()).toBe('GIF89a');
  });

  it('scales the sheet, the JSON and the GIFs for pixel art', async () => {
    const out = mkdtempSync(join(tmpdir(), 'aseview-'));
    const demo = fileURLToPath(new URL('../public/demo.aseprite', import.meta.url));
    expect(await run([demo, '-o', out, '--columns', '3', '--scale', '3', '--gif'], () => {})).toBe(
      0,
    );
    const json = JSON.parse(readFileSync(join(out, 'demo.json'), 'utf8'));
    expect(json.meta.size).toEqual({ w: 288, h: 192 });
    expect(json.meta.scale).toBe('3');
    expect(json.frames[4].frame).toEqual({ x: 96, y: 96, w: 96, h: 96 });

    const png = readFileSync(join(out, 'demo.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([288, 192]);
    const gif = readFileSync(join(out, 'demo-idle.gif'));
    expect([gif.readUInt16LE(6), gif.readUInt16LE(8)]).toEqual([96, 96]);

    expect(await run([demo, '--scale', '1.5'], () => {})).toBe(2);
  });

  it('writes one sheet per layer with --split-layers', async () => {
    const out = mkdtempSync(join(tmpdir(), 'aseview-'));
    const lines: string[] = [];
    const demo = fileURLToPath(new URL('../public/demo.aseprite', import.meta.url));
    expect(
      await run([demo, '-o', out, '--split-layers', '--hide', 'eyes'], (s) => lines.push(s)),
    ).toBe(0);
    expect(lines[0]).toMatch(
      /-> demo\.png, demo\.json, demo-shadow\.png, demo-shadow\.json, demo-body\.png, demo-body\.json$/,
    );
    const body = JSON.parse(readFileSync(join(out, 'demo-body.json'), 'utf8'));
    expect(body.meta.image).toBe('demo-body.png');
  });

  it('keeps GIFs named after tags inside the output folder', async () => {
    const root = mkdtempSync(join(tmpdir(), 'aseview-'));
    const file = join(root, 'tags.aseprite');
    writeFileSync(
      file,
      aseFile(1, 1, [
        frame([
          layer('a'),
          cel(0, [255, 0, 0, 255]),
          tags([
            { name: 'x/../../escaped', from: 0, to: 0 },
            { name: 'a:b', from: 1, to: 1 },
            { name: 'walk/run', from: 0, to: 1 },
          ]),
        ]),
        frame([cel(0, [0, 255, 0, 255])]),
      ]),
    );
    const out = join(root, 'a', 'b');
    expect(await run([file, '-o', out, '--gif'], () => {})).toBe(0);
    expect(readdirSync(out).sort()).toEqual([
      'tags-a_b.gif',
      'tags-walk_run.gif',
      'tags-x_.._.._escaped.gif',
      'tags.json',
      'tags.png',
    ]);
    expect(readdirSync(root).sort()).toEqual(['a', 'tags.aseprite']);
  });

  it('reports files it cannot read and bad options', async () => {
    const lines: string[] = [];
    expect(await run(['does-not-exist.aseprite'], (s) => lines.push(s))).toBe(1);
    expect(await run(['x', '--columns', '0'], (s) => lines.push(s))).toBe(2);
    expect(await run(['x', '--columns', '2.5'], (s) => lines.push(s))).toBe(2);
    expect(await run([], (s) => lines.push(s))).toBe(2);
  });
});
