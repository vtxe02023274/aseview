import type { Sprite, Tag } from './ase.js';
import { tagSequence } from './sheet.js';

/** One animation in the shape Phaser's `anims.create` takes. */
export interface AnimationConfig {
  key: string;
  frames: { key: string; frame: number; duration: number }[];
  /** Times to play again after the first time, -1 for forever. */
  repeat: number;
}

/**
 * Animations for a sprite loaded as a texture whose frames are numbered from 0:
 * one per tag, keyed `<texture>.<tag>`, or one keyed `<texture>` with every
 * frame when the sprite has no tags.
 */
export function animationConfigs(sprite: Sprite, textureKey: string): AnimationConfig[] {
  const animation = (key: string, sequence: number[], repeat: number): AnimationConfig => ({
    key,
    frames: sequence.map((frame) => ({
      key: textureKey,
      frame,
      duration: sprite.frames[frame]!.duration,
    })),
    repeat,
  });

  if (!sprite.frames.length) return [];
  if (!sprite.tags.length) {
    return [animation(textureKey, tagSequence(0, sprite.frames.length - 1, 'forward'), -1)];
  }
  return sprite.tags.map((tag) => {
    const key = `${textureKey}.${tag.name}`;
    const pingpong = tag.direction === 'pingpong' || tag.direction === 'pingpong-reverse';
    // Repeat 0 in Aseprite means forever. A ping-pong tag counts each way as one time.
    if (!tag.repeat || !pingpong || tag.from === tag.to) {
      return animation(key, tagSequence(tag.from, tag.to, tag.direction), tag.repeat - 1);
    }
    return animation(key, pingpongPasses(tag), 0);
  });
}

/** Frame order of a ping-pong tag played back and forth `repeat` times in all. */
function pingpongPasses(tag: Tag): number[] {
  const forward = tagSequence(tag.from, tag.to, 'forward');
  const reverse = tagSequence(tag.from, tag.to, 'reverse');
  const order = tag.direction === 'pingpong' ? [forward, reverse] : [reverse, forward];
  const frames = [...order[0]!];
  // Every later pass starts on the frame the previous one ended on.
  for (let i = 1; i < tag.repeat; i++) frames.push(...order[i % 2]!.slice(1));
  return frames;
}
