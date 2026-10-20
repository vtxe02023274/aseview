# aseview

[English](README.en.md)

在瀏覽器開 Aseprite 檔（.ase / .aseprite），看圖層、影格、標籤動畫，匯出單張 PNG 或 sprite sheet。檔案只在瀏覽器裡讀，不會上傳。

線上使用：https://vtxe02023274.github.io/aseview/

![畫面](docs/screenshot.png)

## 功能

- RGBA、灰階、索引色三種模式，索引色的透明色只套用在非背景圖層
- 圖層開關、群組、圖層與 cel 透明度、cel 的 z-index 排序
- 圖塊地圖圖層（tilemap），含水平、垂直、對角翻轉
- 照每格的時間播放，可以選標籤，支援 forward／reverse／ping-pong
- 匯出目前影格 PNG，或整張 sprite sheet PNG＋JSON

匯出的 JSON 跟 Aseprite 的「Array」格式一樣，影格名稱是編號，Phaser 可以直接用：

```js
this.load.aseprite('slime', 'demo.png', 'demo.json');
this.anims.createFromAseprite('slime'); // 會建出 idle、jump 兩個動畫
```

PixiJS 等讀 TexturePacker／Aseprite JSON 的引擎也能讀。

## 支援範圍

混合模式支援 normal、multiply、screen、darken、lighten、difference、addition、subtract，其他模式先當 normal 畫，圖層清單會標出來。參考圖層（reference layer）跟 Aseprite 匯出時一樣不畫。外部 tileset、外部調色盤不會讀。

## 示範檔

`public/demo.aseprite` 是 `tools/make-demo.mjs` 用程式畫的史萊姆（3 圖層、6 影格、2 個標籤），沒有用到第三方素材。

## 開發

```sh
npm install
npm run build   # 輸出到 site/
npm test
npm run lint
```

`src/ase.ts` 是讀檔，`src/composite.ts` 合成影格，`src/sheet.ts` 排 sprite sheet，都不依賴瀏覽器，可以在 Node 裡用（解壓縮傳 `zlib.inflateSync` 進去）。

## 授權

MIT。Aseprite 是 Igara Studio 的軟體，本專案跟它沒有關係，只依照公開的檔案格式規格讀檔。
