import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { deflateSync, inflateSync } from 'node:zlib';
import { AseError, readAse } from './ase.js';
import { compositeFrame } from './composite.js';
import { encodeGif, GifError } from './gif.js';
import { encodePng } from './png.js';
import { layoutSheet, sheetJson, tagSequence } from './sheet.js';

const HELP = `usage: aseview [options] <file.aseprite>...

Exports Aseprite sprites without Aseprite: a sprite sheet PNG plus the same
JSON Aseprite writes (Array format), or an animated GIF per tag.

options:
  -o, --out <dir>      output folder (default: next to each file)
  --columns <n>        frames per row in the sheet (default: all in one row)
  --gif                also write one GIF per tag, or one for all frames
  --hide <layer>       leave a layer out by name, can be repeated
  -h, --help           show this help`;

export async function run(argv: string[], log: (s: string) => void = console.log): Promise<number> {
  let args;
  try {
    args = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string', short: 'o' },
        columns: { type: 'string' },
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
  if (columns !== undefined && !(columns >= 1)) {
    log('--columns must be a positive number');
    return 2;
  }

  let failed = 0;
  for (const file of positionals) {
    const name = basename(file, extname(file));
    const dir = values.out ?? join(file, '..');
    try {
      const sprite = await readAse(
        new Uint8Array(readFileSync(file)),
        async (d) => new Uint8Array(inflateSync(d)),
      );
      const hidden = new Set(
        sprite.layers.flatMap((l, i) => ((values.hide ?? []).includes(l.name) ? [i] : [])),
      );
      mkdirSync(dir, { recursive: true });

      const layout = layoutSheet(sprite, columns);
      const sheet = new Uint8Array(layout.width * layout.height * 4);
      sprite.frames.forEach((_, i) => {
        const px = compositeFrame(sprite, i, { hidden });
        const { x, y } = layout.positions[i]!;
        for (let row = 0; row < sprite.height; row++) {
          sheet.set(
            px.subarray(row * sprite.width * 4, (row + 1) * sprite.width * 4),
            ((y + row) * layout.width + x) * 4,
          );
        }
      });
      const png = `${name}.png`;
      writeFileSync(
        join(dir, png),
        encodePng(layout.width, layout.height, sheet, (d) => deflateSync(d)),
      );
      writeFileSync(
        join(dir, `${name}.json`),
        JSON.stringify(sheetJson(sprite, layout, png), null, 1) + '\n',
      );
      const written = [png, `${name}.json`];

      if (values.gif) {
        const groups = sprite.tags.length
          ? sprite.tags.map((t) => ({
              suffix: `-${t.name}`,
              order: tagSequence(t.from, t.to, t.direction),
            }))
          : [{ suffix: '', order: sprite.frames.map((_, i) => i) }];
        for (const { suffix, order } of groups) {
          const gif = encodeGif(
            sprite.width,
            sprite.height,
            order.map((i) => ({
              pixels: compositeFrame(sprite, i, { hidden }),
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
