/**
 * Phaser 3 and 4 loader for .aseprite files. Install it as a global plugin and
 * `this.load.aseprite('hero', 'hero.aseprite')` gives a texture with one frame
 * per Aseprite frame plus an animation per tag, without exporting a sheet.
 */
import * as Phaser from 'phaser';
import { readAse, type Sprite } from './ase.js';
import { animationConfigs } from './anims.js';
import { compositeFrame } from './composite.js';
import { inflate } from './inflate.js';
import { layoutSheet } from './sheet.js';

export { animationConfigs, type AnimationConfig } from './anims.js';

/** URLs this loader reads itself; anything else goes to Phaser's own Aseprite loader. */
const ASEPRITE_URL = /\.ase(prite)?([?#]|$)/i;

export interface AsepriteFileConfig {
  key: string;
  url: string;
  xhrSettings?: Phaser.Types.Loader.XHRSettingsObject;
}

/** Loads an .aseprite file and adds it as a texture and animations once read. */
export class AsepriteFile extends Phaser.Loader.File {
  /** The parsed file, there once the file has been processed. */
  sprite?: Sprite;

  constructor(
    loader: Phaser.Loader.LoaderPlugin,
    key: string,
    url: string,
    xhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
  ) {
    // Phaser reads `cache` from the file config though its typings leave it out.
    const config = {
      type: 'aseprite',
      cache: loader.textureManager,
      extension: 'aseprite',
      responseType: 'arraybuffer' as XMLHttpRequestResponseType,
      key,
      url,
      xhrSettings,
    };
    super(loader, config);
  }

  override onProcess(): void {
    this.state = Phaser.Loader.FILE_PROCESSING;
    const bytes = new Uint8Array(this.xhrLoader!.response as ArrayBuffer);
    readAse(bytes, inflate).then(
      (sprite) => {
        this.sprite = sprite;
        this.onProcessComplete();
      },
      (err) => {
        console.error(`aseview: could not read ${String(this.src)}:`, err);
        this.onProcessError();
      },
    );
  }

  override addToCache(): void {
    const sprite = this.sprite!;
    const { width: w, height: h } = sprite;
    // Square-ish, so long animations stay under the GPU's texture size limit.
    const layout = layoutSheet(sprite, Math.ceil(Math.sqrt(sprite.frames.length)));
    const canvas = document.createElement('canvas');
    canvas.width = layout.width;
    canvas.height = layout.height;
    const ctx = canvas.getContext('2d')!;
    for (let i = 0; i < sprite.frames.length; i++) {
      const { x, y } = layout.positions[i]!;
      ctx.putImageData(new ImageData(compositeFrame(sprite, i) as ImageDataArray, w, h), x, y);
    }

    const texture = this.loader.textureManager.addCanvas(this.key, canvas);
    if (!texture) return;
    layout.positions.forEach(({ x, y }, i) => texture.add(i, 0, x, y, w, h));
    const anims = this.loader.systems.anims;
    for (const config of animationConfigs(sprite, this.key)) anims.create(config);
  }
}

/** Stands in for `this.load.aseprite`, keeping Phaser's PNG plus JSON form working. */
function aseprite(
  this: Phaser.Loader.LoaderPlugin,
  key: string | AsepriteFileConfig | Phaser.Types.Loader.FileTypes.AtlasJSONFileConfig | object[],
  url?: string | string[],
  atlasURL?: object | string,
  textureXhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
  atlasXhrSettings?: Phaser.Types.Loader.XHRSettingsObject,
): Phaser.Loader.LoaderPlugin {
  for (const entry of Array.isArray(key) ? key : [key]) {
    if (typeof entry === 'string') {
      if (typeof url === 'string' && atlasURL === undefined && ASEPRITE_URL.test(url)) {
        this.addFile(new AsepriteFile(this, entry, url, textureXhrSettings));
        continue;
      }
    } else if ('url' in entry && typeof entry.url === 'string' && ASEPRITE_URL.test(entry.url)) {
      const config = entry as AsepriteFileConfig;
      this.addFile(new AsepriteFile(this, config.key, config.url, config.xhrSettings));
      continue;
    }
    const file = new Phaser.Loader.FileTypes.AsepriteFile(
      this,
      entry as string | Phaser.Types.Loader.FileTypes.AtlasJSONFileConfig,
      url,
      atlasURL,
      textureXhrSettings,
      atlasXhrSettings,
    );
    this.addFile(file.files);
  }
  return this;
}

/**
 * Global plugin that makes `this.load.aseprite(key, 'file.aseprite')` read
 * Aseprite files directly:
 *
 *     plugins: { global: [{ key: 'AsepritePlugin', plugin: AsepritePlugin, start: true }] }
 */
export class AsepritePlugin extends Phaser.Plugins.BasePlugin {
  constructor(pluginManager: Phaser.Plugins.PluginManager) {
    super(pluginManager);
    pluginManager.registerFileType('aseprite', aseprite);
  }
}
