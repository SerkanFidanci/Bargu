import type { FilterKey } from './filters';

/**
 * What the user put on a photo (docs/ADR/0035 Ek 3), in the coordinates of the photo as shown
 * (display pixels, the top left of the photo at 0, 0); compose.ts scales it to the photo itself.
 */

/** Words or an emoji laid on the photo, moved, turned and sized by hand. */
export interface Overlay {
  id: string;
  kind: 'text' | 'sticker';
  text: string;
  color: string;
  /** Words on a box of their colour, written in black or white over it. */
  boxed: boolean;
  /** Its centre. */
  x: number;
  y: number;
  scale: number;
  /** Radians, clockwise. */
  rotation: number;
}

/** A line drawn by hand: an SVG path in display pixels. */
export interface Stroke {
  path: string;
  color: string;
  width: number;
}

export interface Edit {
  filter: FilterKey;
  overlays: Overlay[];
  strokes: Stroke[];
}

export const NO_EDIT: Edit = { filter: 'none', overlays: [], strokes: [] };

/**
 * The colours for words and lines: the photo's own content, not the app's theme. White and black
 * first, then bright ones that read on most photos.
 */
export const INK = [
  '#FFFFFF',
  '#000000',
  '#F5D90A',
  '#FF8A00',
  '#FF3B30',
  '#FF2D92',
  '#AF52DE',
  '#0A84FF',
  '#30D158',
] as const;

/** Line widths (display pixels): thin, medium, thick. */
export const PEN_WIDTHS = [4, 8, 16] as const;

/** Words' and stickers' size before any pinch (display pixels). */
export const TEXT_SIZE = 30;
export const STICKER_SIZE = 72;
/** How far a pinch may make them. */
export const SCALE_RANGE = { min: 0.3, max: 6 } as const;

/** Emojis to put on a photo. Nothing that tells where the photo was taken (no place sticker). */
export const STICKERS = [
  '😍',
  '😂',
  '🥰',
  '😎',
  '🤩',
  '🥳',
  '😭',
  '😱',
  '🤔',
  '😴',
  '🙈',
  '💀',
  '❤️',
  '🔥',
  '✨',
  '💯',
  '👍',
  '👏',
  '🙌',
  '🤝',
  '💪',
  '🎉',
  '🎂',
  '🎁',
  '☕',
  '🍕',
  '🍔',
  '🍦',
  '🌞',
  '🌙',
  '⭐',
  '🌈',
  '☔',
  '❄️',
  '🌸',
  '🍀',
  '⚽',
  '🏀',
  '🎮',
  '🎧',
  '📚',
  '✈️',
  '🚗',
  '🏖️',
  '🐶',
  '🐱',
  '🦋',
  '💤',
] as const;

/** The photo shown whole in a box: its size there (display pixels) and where it starts. */
export function fit(
  photo: { w: number; h: number },
  box: { width: number; height: number },
): { width: number; height: number; left: number; top: number } {
  const scale = Math.min(box.width / photo.w, box.height / photo.h);
  const width = photo.w * scale;
  const height = photo.h * scale;
  return { width, height, left: (box.width - width) / 2, top: (box.height - height) / 2 };
}

/** Words written on a box are black or white, whichever reads on it. */
export function inkOn(color: string): '#000000' | '#FFFFFF' {
  const value = Number.parseInt(color.slice(1), 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#000000' : '#FFFFFF';
}

export function withOverlay(edit: Edit, overlay: Overlay): Edit {
  const others = edit.overlays.filter((each) => each.id !== overlay.id);
  return { ...edit, overlays: [...others, overlay] };
}

export function withoutOverlay(edit: Edit, id: string): Edit {
  return { ...edit, overlays: edit.overlays.filter((each) => each.id !== id) };
}

/** A moved, turned or sized overlay; it comes to the front. */
export function withPlaced(
  edit: Edit,
  id: string,
  place: Pick<Overlay, 'x' | 'y' | 'scale' | 'rotation'>,
): Edit {
  const found = edit.overlays.find((each) => each.id === id);
  return found === undefined ? edit : withOverlay(edit, { ...found, ...place });
}

export function withStroke(edit: Edit, stroke: Stroke): Edit {
  return { ...edit, strokes: [...edit.strokes, stroke] };
}

/** The last line taken back. */
export function withoutLastStroke(edit: Edit): Edit {
  return { ...edit, strokes: edit.strokes.slice(0, -1) };
}

/** Whether anything was done to the photo (else it goes as it was taken, untouched). */
export function isEdited(edit: Edit): boolean {
  return edit.filter !== 'none' || edit.overlays.length > 0 || edit.strokes.length > 0;
}
