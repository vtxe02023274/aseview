import { AseError, LayerType, readAse, type Sprite } from './ase.js';
import { BLEND_MODES, compositeFrame } from './composite.js';
import { encodeGif, GifError } from './gif.js';
import { layoutSheet, sheetJson, tagSequence } from './sheet.js';
import { stackSlices, type StackSource } from './stack.js';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector<T>(sel)!;
const view = $<HTMLCanvasElement>('#view');
const ctx = view.getContext('2d')!;
const info = $<HTMLElement>('#info');
const layersEl = $<HTMLElement>('#layers');
const framesEl = $<HTMLElement>('#frames');
const tagSelect = $<HTMLSelectElement>('#tag');
const playButton = $<HTMLButtonElement>('#play');
const zoomInput = $<HTMLInputElement>('#zoom');
const columnsInput = $<HTMLInputElement>('#columns');
const message = $<HTMLElement>('#message');
const stackSelect = $<HTMLSelectElement>('#stack');
const spinInput = $<HTMLInputElement>('#spin');
const spacingInput = $<HTMLInputElement>('#spacing');

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  // "deflate" in DecompressionStream is the zlib format Aseprite uses.
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let sprite: Sprite | undefined;
let fileName = 'sprite';
let frame = 0;
let playing = false;
let sequence: number[] = [];
let step = 0;
let nextAt = 0;
const hidden = new Set<number>();
let cache = new Map<number, ImageBitmap>();
let stack: { key: string; bitmaps: ImageBitmap[] } | undefined;
let angle = 0;

async function open(bytes: Uint8Array, name: string): Promise<void> {
  try {
    sprite = await readAse(bytes, inflate);
  } catch (err) {
    message.textContent = err instanceof AseError ? `${name}: ${err.message}` : String(err);
    return;
  }
  message.textContent = '';
  fileName = name.replace(/\.(ase|aseprite)$/i, '');
  hidden.clear();
  cache = new Map();
  stack = undefined;
  frame = 0;
  showInfo();
  showLayers();
  showTags();
  await showFrames();
  setSequence();
  draw();
}

function showInfo(): void {
  const s = sprite!;
  const mode = { 32: 'RGBA', 16: 'Grayscale', 8: 'Indexed' }[s.depth];
  const total = s.frames.reduce((sum, f) => sum + f.duration, 0);
  info.textContent = [
    `${s.width} x ${s.height}, ${mode}`,
    `${s.frames.length} frames, ${total} ms`,
    `${s.layers.length} layers, ${s.tags.length} tags`,
    s.tilesets.length ? `${s.tilesets.length} tilesets` : '',
    s.slices.length ? `${s.slices.length} slices` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function showLayers(): void {
  const s = sprite!;
  // Aseprite lists the top layer first.
  const rows = s.layers.map((layer, i) => {
    const row = document.createElement('label');
    row.className = 'layer';
    row.style.paddingLeft = `${8 + layer.childLevel * 14}px`;
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = layer.visible;
    box.disabled = !layer.visible;
    box.addEventListener('change', async () => {
      if (box.checked) hidden.delete(i);
      else hidden.add(i);
      cache = new Map();
      await showFrames();
      draw();
    });
    const kind =
      layer.type === LayerType.Group
        ? ' (group)'
        : layer.type === LayerType.Tilemap
          ? ' (tilemap)'
          : '';
    const extra = [
      layer.opacity < 255 ? `${Math.round((layer.opacity / 255) * 100)}%` : '',
      layer.blendMode
        ? (BLEND_MODES[layer.blendMode] ?? `blend ${layer.blendMode}, drawn as normal`)
        : '',
      layer.reference ? 'reference' : '',
      layer.visible ? '' : 'hidden in file',
    ].filter(Boolean);
    row.append(box, ` ${layer.name}${kind}`);
    if (extra.length) {
      const note = document.createElement('span');
      note.className = 'note';
      note.textContent = ` ${extra.join(', ')}`;
      row.append(note);
    }
    return row;
  });
  layersEl.replaceChildren(...rows.reverse());
}

function showTags(): void {
  const s = sprite!;
  tagSelect.replaceChildren(
    new Option('All frames', '-1'),
    ...s.tags.map((t, i) => new Option(`${t.name} (${t.from}-${t.to}, ${t.direction})`, String(i))),
  );
}

async function frameImage(index: number): Promise<ImageBitmap> {
  let bitmap = cache.get(index);
  if (!bitmap) {
    const s = sprite!;
    const pixels = compositeFrame(s, index, { hidden });
    bitmap = await createImageBitmap(new ImageData(pixels as ImageDataArray, s.width, s.height));
    cache.set(index, bitmap);
  }
  return bitmap;
}

async function showFrames(): Promise<void> {
  const s = sprite!;
  const items = await Promise.all(
    s.frames.map(async (f, i) => {
      const button = document.createElement('button');
      button.className = 'frame';
      button.title = `frame ${i}, ${f.duration} ms`;
      const thumb = document.createElement('canvas');
      const scale = Math.max(1, Math.floor(48 / Math.max(s.width, s.height)));
      thumb.width = s.width * scale;
      thumb.height = s.height * scale;
      const t = thumb.getContext('2d')!;
      t.imageSmoothingEnabled = false;
      t.drawImage(await frameImage(i), 0, 0, thumb.width, thumb.height);
      const label = document.createElement('span');
      label.textContent = `${i}`;
      button.append(thumb, label);
      button.addEventListener('click', () => {
        playing = false;
        playButton.textContent = 'Play';
        frame = i;
        draw();
      });
      return button;
    }),
  );
  framesEl.replaceChildren(...items);
}

function setSequence(): void {
  const s = sprite!;
  const tag = s.tags[Number(tagSelect.value)];
  sequence = tag ? tagSequence(tag.from, tag.to, tag.direction) : s.frames.map((_, i) => i);
  step = 0;
  frame = sequence[0] ?? 0;
  nextAt = performance.now() + (s.frames[frame]?.duration ?? 100);
}

async function stackBitmaps(): Promise<ImageBitmap[]> {
  const s = sprite!;
  const source = stackSelect.value as StackSource;
  const key = `${source}:${source === 'layers' ? frame : ''}:${[...hidden].join(',')}`;
  if (stack?.key !== key) {
    const slices = stackSlices(s, source, frame, hidden);
    const bitmaps = await Promise.all(
      slices.map((px) => createImageBitmap(new ImageData(px as ImageDataArray, s.width, s.height))),
    );
    stack = { key, bitmaps };
  }
  return stack.bitmaps;
}

/** Draws each slice rotated, stacked upward, repeated to fill its height. */
async function drawStack(): Promise<void> {
  const s = sprite!;
  const zoom = Number(zoomInput.value);
  const spacing = Number(spacingInput.value);
  const bitmaps = await stackBitmaps();
  const diagonal = Math.ceil(Math.hypot(s.width, s.height)) * zoom;
  const lift = bitmaps.length * spacing * zoom;
  view.width = diagonal;
  view.height = diagonal + lift;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, view.width, view.height);
  const cx = diagonal / 2;
  const base = lift + diagonal / 2;
  bitmaps.forEach((bitmap, i) => {
    for (let k = 0; k < spacing; k++) {
      ctx.save();
      ctx.translate(cx, base - (i * spacing + k) * zoom);
      ctx.rotate(angle);
      ctx.drawImage(
        bitmap,
        (-s.width * zoom) / 2,
        (-s.height * zoom) / 2,
        s.width * zoom,
        s.height * zoom,
      );
      ctx.restore();
    }
  });
}

async function draw(): Promise<void> {
  if (!sprite) return;
  if (stackSelect.value !== 'off') {
    await drawStack();
    framesEl
      .querySelectorAll('.frame')
      .forEach((el, i) => el.classList.toggle('current', i === frame));
    return;
  }
  const zoom = Number(zoomInput.value);
  view.width = sprite.width * zoom;
  view.height = sprite.height * zoom;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, view.width, view.height);
  ctx.drawImage(await frameImage(frame), 0, 0, view.width, view.height);
  framesEl
    .querySelectorAll('.frame')
    .forEach((el, i) => el.classList.toggle('current', i === frame));
}

let lastTick = performance.now();
function tick(now: number): void {
  const dt = now - lastTick;
  lastTick = now;
  if (sprite && stackSelect.value !== 'off' && spinInput.checked && !dragging) {
    angle += dt * 0.0012;
    draw();
  }
  if (playing && sprite && sequence.length && now >= nextAt) {
    step = (step + 1) % sequence.length;
    frame = sequence[step]!;
    nextAt = now + sprite.frames[frame]!.duration;
    draw();
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

playButton.addEventListener('click', () => {
  if (!sprite) return;
  playing = !playing;
  playButton.textContent = playing ? 'Pause' : 'Play';
  nextAt = performance.now() + sprite.frames[frame]!.duration;
});
tagSelect.addEventListener('change', () => {
  setSequence();
  draw();
});
zoomInput.addEventListener('input', () => draw());
stackSelect.addEventListener('change', () => {
  stack = undefined;
  draw();
});
spacingInput.addEventListener('input', () => draw());

let dragging: { x: number; angle: number } | undefined;
view.addEventListener('pointerdown', (e) => {
  if (stackSelect.value === 'off') return;
  view.setPointerCapture(e.pointerId);
  dragging = { x: e.clientX, angle };
});
view.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  angle = dragging.angle + (e.clientX - dragging.x) * 0.01;
  draw();
});
view.addEventListener('pointerup', () => (dragging = undefined));

function download(name: string, blob: Blob): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function sheetCanvas() {
  const s = sprite!;
  const layout = layoutSheet(s, Number(columnsInput.value) || s.frames.length);
  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;
  const c = canvas.getContext('2d')!;
  for (let i = 0; i < s.frames.length; i++) {
    const p = layout.positions[i]!;
    c.drawImage(await frameImage(i), p.x, p.y);
  }
  return { canvas, layout };
}

$('#export-frame').addEventListener('click', async () => {
  if (!sprite) return;
  const canvas = document.createElement('canvas');
  canvas.width = sprite.width;
  canvas.height = sprite.height;
  canvas.getContext('2d')!.drawImage(await frameImage(frame), 0, 0);
  canvas.toBlob((b) => b && download(`${fileName}-${frame}.png`, b), 'image/png');
});

$('#export-gif').addEventListener('click', () => {
  if (!sprite) return;
  const s = sprite;
  // Plays the selected tag, or every frame.
  const order = sequence.length ? sequence : s.frames.map((_, i) => i);
  try {
    const gif = encodeGif(
      s.width,
      s.height,
      order.map((i) => ({
        pixels: compositeFrame(s, i, { hidden }),
        delay: s.frames[i]!.duration,
      })),
    );
    const tag = s.tags[Number(tagSelect.value)];
    download(
      `${fileName}${tag ? `-${tag.name}` : ''}.gif`,
      new Blob([gif as BlobPart], { type: 'image/gif' }),
    );
  } catch (err) {
    message.textContent = err instanceof GifError ? err.message : String(err);
  }
});

$('#export-sheet').addEventListener('click', async () => {
  if (!sprite) return;
  const { canvas, layout } = await sheetCanvas();
  canvas.toBlob((b) => b && download(`${fileName}.png`, b), 'image/png');
  const json = sheetJson(sprite, layout, `${fileName}.png`);
  download(
    `${fileName}.json`,
    new Blob([JSON.stringify(json, null, 1)], { type: 'application/json' }),
  );
});

async function openFile(file: File): Promise<void> {
  await open(new Uint8Array(await file.arrayBuffer()), file.name);
}

$<HTMLInputElement>('#file').addEventListener('change', (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) openFile(file);
});
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files[0];
  if (file) openFile(file);
});
$('#demo').addEventListener('click', loadDemo);
$('#stack-demo').addEventListener('click', async () => {
  const res = await fetch('stack-demo.aseprite');
  stackSelect.value = 'layers';
  zoomInput.value = '12';
  await open(new Uint8Array(await res.arrayBuffer()), 'stack-demo.aseprite');
});

async function loadDemo(): Promise<void> {
  const res = await fetch('demo.aseprite');
  await open(new Uint8Array(await res.arrayBuffer()), 'demo.aseprite');
}
loadDemo();
