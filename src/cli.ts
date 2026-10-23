import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import { AseError, LayerType, readAse } from './ase.js';
import { compositeFrame, layerShown, scalePixels, scaleSprite } from './composite.js';
import { encodeGif, GifError } from './gif.js';
import { encodePng } from './png.js';
import { layoutSheet, sheetJson, tagSequence } from './sheet.js';

const HELP = `usage: aseview [options] <file.aseprite>...

Exports Aseprite sprites without Aseprite: a sprite sheet PNG plus the same
JSON Aseprite writes (Array format), or an animated GIF per tag.

options:
  -o, --out <dir>      output folder (default: next to each file)
  --columns <n>        frames per row in the sheet (default: all in one row)
  --scale <n>          enlarge every pixel n times, for pixel art (default: 1)
  --split-layers       also write a sheet for each layer on its own
  --gif                also write one GIF per tag, or one for all frames
  --hide <layer>       leave a layer out by name, can be repeated
  -h, --help           show this help`;

/**
 * Layer and tag names as part of a file name. Only characters that file
 * names cannot hold on Windows, macOS or Linux are replaced, so names in any
 * script survive, and path separators cannot leave the folder.
 */
function namePart(name: string): string {
  // Control characters are not allowed in Windows file names either.
  // eslint-disable-next-line no-control-regex
  return name.replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/^[ .]+|[ .]+$/g, '') || '_';
}

/** Hands out names, adding -2, -3, ... to ones already taken, ignoring case like Windows does. */
function uniqueNames(): (name: string) => string {
  const taken = new Set<string>();
  return (name) => {
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name}-${n}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}

export async function run(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        columns: { type: 'string' },
        scale: { type: 'string' },
        'split-layers': { type: 'boolean' },
        gif: { type: 'boolean' },
        hide: { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (err) {
    log(`${(err as Error).message}\n\n${HELP}`);
    return 2;
  }
  const { values, positionals } = args;
  if (values.help || !positionals.length) {
    log(HELP);
    return values.help ? 0 : 2;
  }
  const columns = values.columns === undefined ? undefined : Number(values.columns);
  if (columns !== undefined && !(Number.isInteger(columns) && columns >= 1)) {
    log('--columns must be a whole number of 1 or more');
    return 2;
  }
  const scale = values.scale === undefined ? 1 : Number(values.scale);
  if (!Number.isInteger(scale) || scale < 1 || scale > 32) {
    log('--scale must be a whole number from 1 to 32');
    return 2;
  }

  let failed = 0;
  const namesPerDir = new Map<string, (name: string) => string>();
  for (const file of positionals) {
    const dir = values.out ?? join(file, '..');
    const dirKey = resolve(dir).toLowerCase();
    if (!namesPerDir.has(dirKey)) namesPerDir.set(dirKey, uniqueNames());
    const name = namesPerDir.get(dirKey)!(basename(file, extname(file)));
    try {
      const sprite = await readAse(
        new Uint8Array(readFileSync(file)),
        async (d) => new Uint8Array(inflateSync(d)),
      );
      const hidden = new Set(
        sprite.layers.flatMap((l, i) => ((values.hide ?? []).includes(l.name) ? [i] : [])),
      );
      mkdirSync(dir, { recursive: true });

      // Everything after compositing works on the scaled sprite.
      const scaled = scaleSprite(sprite, scale);
      const frame = (i: number) =>
        scalePixels(compositeFrame(sprite, i, { hidden }), sprite.width, sprite.height, scale);

      const layout = layoutSheet(scaled, columns);
      const writeSheet = (base: string, pixels: (i: number) => Uint8ClampedArray) => {
        const sheet = new Uint8Array(layout.width * layout.height * 4);
        sprite.frames.forEach((_, i) => {
          const px = pixels(i);
          const { x, y } = layout.positions[i]!;
          for (let row = 0; row < scaled.height; row++) {
            sheet.set(
              px.subarray(row * scaled.width * 4, (row + 1) * scaled.width * 4),
              ((y + row) * layout.width + x) * 4,
            );
          }
        });
        const png = `${base}.png`;
        writeFileSync(
          join(dir, png),
          encodePng(layout.width, layout.height, sheet, (d) => deflateSync(d)),
        );
        writeFileSync(
          join(dir, `${base}.json`),
          JSON.stringify(sheetJson(scaled, layout, png, scale), null, 1) + '\n',
        );
        return [png, `${base}.json`];
      };
      const written = writeSheet(name, frame);

      if (values['split-layers']) {
        const layerName = uniqueNames();
        sprite.layers.forEach((layer, index) => {
          if (layer.type === LayerType.Group || !layerShown(sprite, index, { hidden })) return;
          written.push(
            ...writeSheet(`${name}-${layerName(namePart(layer.name))}`, (i) =>
              scalePixels(
                compositeFrame(sprite, i, { hidden, only: index }),
                sprite.width,
                sprite.height,
                scale,
              ),
            ),
          );
        });
      }

      if (values.gif) {
        const tagName = uniqueNames();
        const groups = sprite.tags.length
          ? sprite.tags.map((t) => ({
              suffix: `-${tagName(namePart(t.name))}`,
              order: tagSequence(t.from, t.to, t.direction),
            }))
          : [{ suffix: '', order: sprite.frames.map((_, i) => i) }];
        for (const { suffix, order } of groups) {
          const gif = encodeGif(
            scaled.width,
            scaled.height,
            order.map((i) => ({
              pixels: frame(i),
              delay: sprite.frames[i]!.duration,
            })),
          );
          writeFileSync(join(dir, `${name}${suffix}.gif`), gif);
          written.push(`${name}${suffix}.gif`);
        }
      }
      log(`${file}: ${sprite.frames.length} frames -> ${written.join(', ')}`);
    } catch (err) {
      if (!(
        err instanceof AseError ||
        err instanceof GifError ||
        (err as NodeJS.ErrnoException).code
      ))
        throw err;
      log(`${file}: ${(err as Error).message}`);
      failed++;
    }
  }
  return failed ? 1 : 0;
}
