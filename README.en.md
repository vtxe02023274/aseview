# aseview

[中文](README.md)

Open Aseprite files (.ase / .aseprite) in the browser, look through layers, frames and tag animations, and export a frame or a sprite sheet. Files are read in the browser and never uploaded.

Use it online: https://vtxe02023274.github.io/aseview/

![screenshot](docs/screenshot.png)

## Features

- RGBA, grayscale and indexed sprites; the transparent index only applies to non-background layers
- Layer toggles, groups, layer and cel opacity, cel z-index ordering
- Tilemap layers, including X, Y and diagonal flips
- Playback with per-frame durations, by tag, in forward, reverse and ping-pong
- 2.5D sprite stacking preview: layers or frames become slices from bottom to top, drag to turn and set the slice height; "Stack demo" shows an example
- Export the current frame as PNG, the selected tag as an animated GIF, or the whole sprite sheet as PNG plus JSON

GIFs keep the exact colors of the sprite (up to 255) with no dithering; sprites with more colors get a message to use the sprite sheet instead. The encoder is written from scratch and checked pixel by pixel against Chrome's own GIF decoder.

The JSON uses Aseprite's "Array" format with frame numbers as names, so Phaser loads it directly:

```js
this.load.aseprite('slime', 'demo.png', 'demo.json');
this.anims.createFromAseprite('slime'); // creates the idle and jump animations
```

PixiJS and other engines that read TexturePacker or Aseprite JSON work too.

## Phaser loader

`aseview/phaser` loads `.aseprite` files straight into Phaser 3 (3.80 or later) or Phaser 4, with no export step. Phaser is an optional peer dependency; the command line does not need it.

```sh
npm install aseview phaser
```

```js
import * as Phaser from 'phaser';
import { AsepritePlugin } from 'aseview/phaser';

new Phaser.Game({
  pixelArt: true,
  plugins: { global: [{ key: 'AsepritePlugin', plugin: AsepritePlugin, start: true }] },
  scene: {
    preload() {
      this.load.aseprite('hero', 'hero.aseprite');
    },
    create() {
      this.add.sprite(100, 100, 'hero').play('hero.walk'); // the "walk" tag
    },
  },
});
```

- The texture `hero` has one frame per Aseprite frame, numbered from 0 and the size of the sprite, so `this.add.image(x, y, 'hero', 3)` works too. Frames are drawn from the visible layers, the same as an Aseprite export.
- Each tag becomes an animation named `<texture>.<tag>` with the frame durations from the file, in forward, reverse, ping-pong or ping-pong reverse order, and the tag's repeat count (0 loops forever). A sprite without tags gets one animation named after the texture that loops every frame.
- `this.load.aseprite('hero', 'hero.png', 'hero.json')` still goes to Phaser's own loader, so exported sheets keep working.

## Command line

Batch export without Aseprite installed, with Node.js 20 or later, which fits a build pipeline:

```sh
npx aseview hero.aseprite -o build/sprites --columns 8 --gif
# hero.png, hero.json (Aseprite Array format) and one GIF per tag
```

| Option            | Effect                                                                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `-o, --out <dir>` | output folder, defaults to next to the file                                                                                              |
| `--columns <n>`   | frames per row in the sheet, default one row                                                                                             |
| `--scale <n>`     | enlarge every pixel n times (nearest neighbor, for pixel art), the JSON follows                                                          |
| `--split-layers`  | also write a sheet and JSON for each layer on its own (stacked they give the full sheet), named after the layer with -2 added on clashes |
| `--gif`           | also write one GIF per tag                                                                                                               |
| `--hide <layer>`  | leave a layer out by name, can be repeated                                                                                               |

## Limits

Tested with the sprites in the Aseprite source tests (indexed, grayscale, tilemaps, groups, z-order, tags, slices, properties) and LibreSprite's splash.ase (54 layers), all of which read and composite correctly.

Blend modes normal, multiply, screen, darken, lighten, difference, addition and subtract are supported; others are drawn as normal and marked in the layer list. Reference layers are not drawn, same as an Aseprite export. External tilesets and palettes are not loaded.

## Demo file

`public/demo.aseprite` (a slime, 3 layers, 6 frames, 2 tags) and `public/stack-demo.aseprite` (a tree, 14 slices) are both drawn in code by `tools/make-demo.mjs`, with no third party art.

## Development

```sh
npm install
npm run build   # writes site/
npm test
npm run lint
```

`src/ase.ts` reads files, `src/composite.ts` flattens frames and `src/sheet.ts` lays out sheets. None of them need a browser, so they work in Node too (pass `zlib.inflateSync` as the inflate function); `import { readAse, compositeFrame } from 'aseview'` gives the same functions from the package. `src/phaser.ts` is the Phaser loader and `src/anims.ts` turns tags into its animations.

## License

MIT. Aseprite is software by Igara Studio; this project is not affiliated with it and only reads the publicly documented file format.
