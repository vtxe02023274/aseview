import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { readAse, type Sprite, type Tag } from '../src/ase.js';
import { animationConfigs } from '../src/anims.js';

const inflate = async (data: Uint8Array) => new Uint8Array(inflateSync(data));

/** A sprite with only the parts animationConfigs reads. */
function sprite(durations: number[], tags: Partial<Tag>[]): Sprite {
  return {
    frames: durations.map((duration) => ({ duration, cels: new Map() })),
    tags: tags.map((t) => ({
      name: 'tag',
      from: 0,
      to: 0,
      direction: 'forward',
      repeat: 0,
      color: [0, 0, 0],
      ...t,
    })),
  } as unknown as Sprite;
}

const order = (s: Sprite) =>
  animationConfigs(s, 'hero').map((a) => [a.frames.map((f) => f.frame), a.repeat]);

describe('animationConfigs', () => {
  it('builds one animation per tag of the demo file with frame durations', async () => {
    const bytes = readFileSync(new URL('../public/demo.aseprite', import.meta.url));
    const demo = await readAse(new Uint8Array(bytes), inflate);
    expect(animationConfigs(demo, 'slime')).toEqual([
      {
        key: 'slime.idle',
        frames: [
          { key: 'slime', frame: 0, duration: 300 },
          { key: 'slime', frame: 1, duration: 300 },
        ],
        repeat: -1,
      },
      {
        key: 'slime.jump',
        frames: [
          { key: 'slime', frame: 2, duration: 100 },
          { key: 'slime', frame: 3, duration: 100 },
          { key: 'slime', frame: 4, duration: 120 },
          { key: 'slime', frame: 5, duration: 100 },
        ],
        repeat: -1,
      },
    ]);
  });

  it('follows each tag direction', () => {
    const s = sprite(
      [10, 20, 30, 40],
      [
        { from: 1, to: 3, direction: 'forward' },
        { from: 1, to: 3, direction: 'reverse' },
        { from: 1, to: 3, direction: 'pingpong' },
        { from: 1, to: 3, direction: 'pingpong-reverse' },
      ],
    );
    expect(order(s)).toEqual([
      [[1, 2, 3], -1],
      [[3, 2, 1], -1],
      [[1, 2, 3, 2], -1],
      [[3, 2, 1, 2], -1],
    ]);
    expect(animationConfigs(s, 'hero')[1]!.frames.map((f) => f.duration)).toEqual([40, 30, 20]);
  });

  it('plays a tag with a repeat count that many times in all', () => {
    const s = sprite(
      [10, 20, 30, 40],
      [
        { from: 0, to: 1, direction: 'forward', repeat: 3 },
        { from: 0, to: 1, direction: 'reverse', repeat: 1 },
        // Ping-pong counts each way as one time, like Aseprite.
        { from: 1, to: 3, direction: 'pingpong', repeat: 1 },
        { from: 1, to: 3, direction: 'pingpong', repeat: 3 },
        { from: 1, to: 3, direction: 'pingpong-reverse', repeat: 2 },
        { from: 2, to: 2, direction: 'pingpong', repeat: 2 },
      ],
    );
    expect(order(s)).toEqual([
      [[0, 1], 2],
      [[1, 0], 0],
      [[1, 2, 3], 0],
      [[1, 2, 3, 2, 1, 2, 3], 0],
      [[3, 2, 1, 2, 3], 0],
      [[2], 1],
    ]);
  });

  it('keys animations by texture and tag name', () => {
    const s = sprite([10, 10], [{ name: 'run fast', from: 0, to: 1 }]);
    expect(animationConfigs(s, 'enemy.bat').map((a) => a.key)).toEqual(['enemy.bat.run fast']);
    expect(animationConfigs(s, 'enemy.bat')[0]!.frames[0]!.key).toBe('enemy.bat');
  });

  it('loops every frame under the texture key when there are no tags', () => {
    expect(animationConfigs(sprite([50, 60, 70], []), 'hero')).toEqual([
      {
        key: 'hero',
        frames: [
          { key: 'hero', frame: 0, duration: 50 },
          { key: 'hero', frame: 1, duration: 60 },
          { key: 'hero', frame: 2, duration: 70 },
        ],
        repeat: -1,
      },
    ]);
    expect(animationConfigs(sprite([], []), 'hero')).toEqual([]);
  });
});
