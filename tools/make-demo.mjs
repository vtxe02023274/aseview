// Writes public/demo.aseprite: a small bouncing slime drawn in code, so the
// demo ships no third party art. Run with `node tools/make-demo.mjs`.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const W = 32;
const H = 32;

function str(text) {
  const b = Buffer.from(text, 'utf8');
  const len = Buffer.alloc(2);
  len.writeUInt16LE(b.length);
  return Buffer.concat([len, b]);
}

function chunk(type, data) {
  const head = Buffer.alloc(6);
  head.writeUInt32LE(data.length + 6, 0);
  head.writeUInt16LE(type, 4);
  return Buffer.concat([head, data]);
}

function layer(name, opacity) {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(3, 0); // visible, editable
  b.writeUInt16LE(0, 2); // image layer
  b.writeUInt16LE(0, 4); // child level
  b.writeUInt16LE(0, 10); // normal blend
  b.writeUInt8(opacity, 12);
  return chunk(0x2004, Buffer.concat([b, str(name)]));
}

function cel(layerIndex, image) {
  const b = Buffer.alloc(20);
  b.writeUInt16LE(layerIndex, 0);
  b.writeUInt8(255, 6);
  b.writeUInt16LE(2, 7); // compressed image
  b.writeUInt16LE(W, 16);
  b.writeUInt16LE(H, 18);
  return chunk(0x2005, Buffer.concat([b, deflateSync(image)]));
}

function image(draw) {
  const px = Buffer.alloc(W * H * 4);
  const set = (x, y, [r, g, b, a = 255]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    px.set([r, g, b, a], (y * W + x) * 4);
  };
  draw(set);
  return px;
}

// Body squash and lift per frame: idle breathing, then a jump.
const poses = [
  { lift: 0, w: 11, h: 9 },
  { lift: 0, w: 12, h: 8 },
  { lift: 0, w: 13, h: 7 },
  { lift: 6, w: 10, h: 11 },
  { lift: 10, w: 10, h: 10 },
  { lift: 4, w: 11, h: 9 },
];
const durations = [300, 300, 100, 100, 120, 100];
const ground = 27;

const OUTLINE = [32, 76, 52];
const BODY = [96, 196, 112];
const LIGHT = [168, 232, 160];
const EYE = [24, 28, 36];

const frames = poses.map((pose, f) => {
  const cx = 16;
  const bottom = ground - pose.lift;
  const shadow = image((set) => {
    const rw = Math.max(4, 10 - pose.lift / 2);
    for (let x = -rw; x <= rw; x++)
      for (let y = -1; y <= 1; y++) {
        if ((x * x) / (rw * rw) + (y * y) / 2 <= 1) set(cx + x, ground + 1 + y, [0, 0, 0, 255]);
      }
  });
  const body = image((set) => {
    for (let y = -pose.h; y <= 0; y++) {
      for (let x = -pose.w; x <= pose.w; x++) {
        // Half ellipse with a flat bottom.
        const inside = (x * x) / (pose.w * pose.w) + (y * y) / (pose.h * pose.h) <= 1;
        if (!inside) continue;
        const edge = (x * x) / (pose.w - 1) ** 2 + (y * y) / (pose.h - 1) ** 2 > 1 || y === 0;
        set(cx + x, bottom + y, edge ? OUTLINE : BODY);
      }
    }
    set(cx - pose.w + 4, bottom - pose.h + 3, LIGHT);
    set(cx - pose.w + 5, bottom - pose.h + 3, LIGHT);
    set(cx - pose.w + 4, bottom - pose.h + 4, LIGHT);
  });
  const eyes = image((set) => {
    const ey = bottom - Math.round(pose.h / 2);
    const blink = f === 1;
    for (const ex of [cx - 4, cx + 3]) {
      set(ex, ey, EYE);
      set(ex + 1, ey, EYE);
      if (!blink) {
        set(ex, ey - 1, EYE);
        set(ex + 1, ey - 1, EYE);
      }
    }
  });
  return { shadow, body, eyes };
});

const parts = [];
frames.forEach((f, i) => {
  const chunks = [];
  if (i === 0) {
    chunks.push(layer('shadow', 80), layer('body', 255), layer('eyes', 255));
    const tags = Buffer.alloc(10);
    tags.writeUInt16LE(2, 0);
    const tag = (from, to, dir, name, rgb) => {
      const t = Buffer.alloc(17);
      t.writeUInt16LE(from, 0);
      t.writeUInt16LE(to, 2);
      t.writeUInt8(dir, 4);
      t.set(rgb, 13);
      return Buffer.concat([t, str(name)]);
    };
    chunks.push(
      chunk(
        0x2018,
        Buffer.concat([
          tags,
          tag(0, 1, 2, 'idle', [80, 160, 220]),
          tag(2, 5, 0, 'jump', [230, 140, 60]),
        ]),
      ),
    );
  }
  chunks.push(cel(0, f.shadow), cel(1, f.body), cel(2, f.eyes));
  const data = Buffer.concat(chunks);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(16 + data.length, 0);
  head.writeUInt16LE(0xf1fa, 4);
  head.writeUInt16LE(chunks.length, 6);
  head.writeUInt16LE(durations[i], 8);
  head.writeUInt32LE(chunks.length, 12);
  parts.push(head, data);
});

const body = Buffer.concat(parts);
const header = Buffer.alloc(128);
header.writeUInt32LE(128 + body.length, 0);
header.writeUInt16LE(0xa5e0, 4);
header.writeUInt16LE(frames.length, 6);
header.writeUInt16LE(W, 8);
header.writeUInt16LE(H, 10);
header.writeUInt16LE(32, 12);
header.writeUInt32LE(1, 14); // layer opacity is valid
header.writeUInt16LE(100, 18);
header.writeUInt8(1, 34); // pixel ratio 1:1
header.writeUInt8(1, 35);
header.writeUInt16LE(16, 40);
header.writeUInt16LE(16, 42);

writeFileSync(new URL('../public/demo.aseprite', import.meta.url), Buffer.concat([header, body]));
console.log(`public/demo.aseprite: ${128 + body.length} bytes, ${frames.length} frames`);

// A tree for sprite stacking: one layer per horizontal slice, bottom first.
function writeStack(file, size, slices) {
  const chunks = [];
  slices.forEach((_, i) => chunks.push(layer(`slice ${i}`, 255)));
  slices.forEach((draw, i) => {
    const px = Buffer.alloc(size * size * 4);
    draw((x, y, rgba) => {
      if (x >= 0 && y >= 0 && x < size && y < size) px.set([...rgba, 255], (y * size + x) * 4);
    });
    const b = Buffer.alloc(20);
    b.writeUInt16LE(i, 0);
    b.writeUInt8(255, 6);
    b.writeUInt16LE(2, 7);
    b.writeUInt16LE(size, 16);
    b.writeUInt16LE(size, 18);
    chunks.push(chunk(0x2005, Buffer.concat([b, deflateSync(px)])));
  });
  const data = Buffer.concat(chunks);
  const head = Buffer.alloc(16);
  head.writeUInt32LE(16 + data.length, 0);
  head.writeUInt16LE(0xf1fa, 4);
  head.writeUInt16LE(chunks.length, 6);
  head.writeUInt16LE(100, 8);
  head.writeUInt32LE(chunks.length, 12);
  const h = Buffer.alloc(128);
  h.writeUInt32LE(128 + 16 + data.length, 0);
  h.writeUInt16LE(0xa5e0, 4);
  h.writeUInt16LE(1, 6);
  h.writeUInt16LE(size, 8);
  h.writeUInt16LE(size, 10);
  h.writeUInt16LE(32, 12);
  h.writeUInt32LE(1, 14);
  h.writeUInt8(1, 34);
  h.writeUInt8(1, 35);
  writeFileSync(new URL(file, import.meta.url), Buffer.concat([h, head, data]));
  console.log(`${file.replace('../', '')}: ${slices.length} slices`);
}

const S = 16;
const c = S / 2 - 0.5;
const disc = (r, rgb, edge) => (set) => {
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const d = Math.hypot(x - c, y - c);
      if (d <= r) set(x, y, d > r - 1 ? edge : rgb);
    }
};
const trunk = (set) => {
  for (let y = 6; y < 10; y++)
    for (let x = 6; x < 10; x++) set(x, y, x === 6 || y === 9 ? [92, 60, 34] : [122, 82, 48]);
};
const leaves = [3.5, 5.5, 6.5, 7, 6.5, 6, 5, 3.5, 2];
writeStack('../public/stack-demo.aseprite', S, [
  disc(7.5, [70, 120, 52], [58, 100, 44]),
  trunk,
  trunk,
  trunk,
  trunk,
  ...leaves.map((r, i) => disc(r, i % 2 ? [86, 160, 70] : [74, 146, 62], [46, 96, 40])),
]);
