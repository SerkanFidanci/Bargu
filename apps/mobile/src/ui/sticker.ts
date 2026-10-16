import { stickerFx } from '@/theme';

/**
 * A person's own tilt on the map (degrees): the same every time for the same id, never upright,
 * leaning either way, so stickers side by side do not all lean alike.
 */
export function stickerTilt(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619) >>> 0;
  }
  const { min, max } = stickerFx.tilt;
  const size = min + (((hash >>> 1) % 1000) / 1000) * (max - min);
  return hash % 2 === 0 ? size : -size;
}
