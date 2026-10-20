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
- Export the current frame as PNG, or the whole sprite sheet as PNG plus JSON

The JSON uses Aseprite's "Array" format with frame numbers as names, so Phaser loads it directly:

```js
this.load.aseprite('slime', 'demo.png', 'demo.json');
this.anims.createFromAseprite('slime'); // creates the idle and jump animations
```

PixiJS and other engines that read TexturePacker or Aseprite JSON work too.

## Limits

Blend modes normal, multiply, screen, darken, lighten, difference, addition and subtract are supported; others are drawn as normal and marked in the layer list. Reference layers are not drawn, same as an Aseprite export. External tilesets and palettes are not loaded.

## Demo file

`public/demo.aseprite` is a slime drawn in code by `tools/make-demo.mjs` (3 layers, 6 frames, 2 tags), with no third party art.

## Development

```sh
npm install
npm run build   # writes site/
npm test
npm run lint
```

`src/ase.ts` reads files, `src/composite.ts` flattens frames and `src/sheet.ts` lays out sheets. None of them need a browser, so they work in Node too (pass `zlib.inflateSync` as the inflate function).

## License

MIT. Aseprite is software by Igara Studio; this project is not affiliated with it and only reads the publicly documented file format.
