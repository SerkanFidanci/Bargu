import {
  COSMETIC_PACKS,
  type CosmeticPack,
  type FrameStyle,
  type RingPattern,
} from '@bargu/schemas';

/**
 * What a person looks like on the map pin: a pattern on its ring and a frame around it, each only
 * as far as their pass holds (docs/ADR/0025 and its addendum of 2026-10-21). Plain when neither.
 */
export interface Look {
  ring?: RingPattern | undefined;
  frame?: FrameStyle | undefined;
  /** The pass's end (Unix ms): after it, the plain look. */
  until: number;
}

/** What someone chose (null: the plain one), as they send it. */
export interface LookChoice {
  ring: string | null;
  frame: string | null;
}

export const PLAIN_CHOICE: LookChoice = { ring: null, frame: null };

export const RING_PATTERNS: readonly RingPattern[] = COSMETIC_PACKS.rings;
export const FRAME_STYLES: readonly FrameStyle[] = COSMETIC_PACKS.frames;

export const isRingPattern = (id: string | null): id is RingPattern =>
  id !== null && (RING_PATTERNS as readonly string[]).includes(id);
export const isFrameStyle = (id: string | null): id is FrameStyle =>
  id !== null && (FRAME_STYLES as readonly string[]).includes(id);

/** The styles that move (calm mode, Reduce Motion and the battery stop them: pin-look.tsx). */
const MOVING_RINGS: readonly RingPattern[] = ['sparkle'];
const MOVING_FRAMES: readonly FrameStyle[] = ['holo', 'neon'];

/** Whether a look has a style that moves. */
export function isMoving(look: Pick<Look, 'ring' | 'frame'>): boolean {
  return (
    (look.ring !== undefined && MOVING_RINGS.includes(look.ring)) ||
    (look.frame !== undefined && MOVING_FRAMES.includes(look.frame))
  );
}

/** One pack costs this much, in lira (PM, 2026-10-21: the same for both). */
export const PACK_PRICE = 29.99;
export const PACKS: readonly CosmeticPack[] = ['rings', 'frames'];

/** The colours of the styles that bring their own (the others use the theme's). */
export const lookColors = {
  holo: ['#FF6AD5', '#FFD86B', '#6BFFC5', '#6BC8FF', '#B58CFF', '#FF6AD5'],
  gold: ['#FBE38A', '#C9961A', '#F6D55C', '#A9780F'],
  goldRim: '#7A5A0C',
  neon: '#00F0FF',
  sparkle: '#FFFFFF',
} as const;

/** A circle's path as a stroke dash: `count` equal dashes and gaps around a ring of this radius. */
export function evenDashes(radius: number, count: number): { dash: number; gap: number } {
  const share = (2 * Math.PI * radius) / count;
  return { dash: share / 2, gap: share / 2 };
}

/** Dots around a ring: a dash so short that only its round cap shows, a gap of one share. */
export function dotDashes(radius: number, count: number): { dash: number; gap: number } {
  return { dash: 0.01, gap: (2 * Math.PI * radius) / count };
}

/** Where `count` things sit around a circle, starting at the top. */
export function around(
  center: number,
  radius: number,
  count: number,
): readonly { x: number; y: number }[] {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * 2 * Math.PI - Math.PI / 2;
    return { x: center + radius * Math.cos(angle), y: center + radius * Math.sin(angle) };
  });
}

/** A four-pointed star centred on (x, y), `reach` from the centre to a point. */
export function starPath(x: number, y: number, reach: number): string {
  const waist = reach * 0.3;
  const points: readonly (readonly [number, number])[] = [
    [0, -reach],
    [waist, -waist],
    [reach, 0],
    [waist, waist],
    [0, reach],
    [-waist, waist],
    [-reach, 0],
    [-waist, -waist],
  ];
  return `${points
    .map(
      ([dx, dy], index) =>
        `${index === 0 ? 'M' : 'L'}${(x + dx).toFixed(2)} ${(y + dy).toFixed(2)}`,
    )
    .join(' ')} Z`;
}
