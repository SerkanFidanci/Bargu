/**
 * The looks a photo can take before it goes (docs/ADR/0035 Ek 3): a few colour matrices, swiped
 * through on the photo as in Instagram. Each is a 4×5 matrix (rows red, green, blue, alpha; the last
 * column added, in 0–1), applied on this phone before the photo is sealed.
 */
export const FILTERS = ['none', 'warm', 'cool', 'mono', 'vivid', 'fade'] as const;
export type FilterKey = (typeof FILTERS)[number];

/** Luminance weights (Rec. 709): what grey a colour is. */
const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

/** More (above 1) or less (below 1) colour, the light kept. */
function saturation(s: number): number[] {
  const r = LR * (1 - s);
  const g = LG * (1 - s);
  const b = LB * (1 - s);
  return [r + s, g, b, 0, 0, r, g + s, b, 0, 0, r, g, b + s, 0, 0, 0, 0, 0, 1, 0];
}

const MATRICES: Readonly<Record<Exclude<FilterKey, 'none'>, readonly number[]>> = {
  // A little more red, a little less blue.
  warm: [1.08, 0, 0, 0, 0.02, 0, 1.0, 0, 0, 0.01, 0, 0, 0.88, 0, 0, 0, 0, 0, 1, 0],
  // The other way.
  cool: [0.9, 0, 0, 0, 0, 0, 1.0, 0, 0, 0.01, 0, 0, 1.1, 0, 0.03, 0, 0, 0, 1, 0],
  mono: saturation(0),
  vivid: saturation(1.35),
  fade: faded(),
};

/** Less colour and contrast, the blacks lifted. */
function faded(): number[] {
  return saturation(0.7).map((value, index) => {
    if (index >= 15) return value;
    return index % 5 === 4 ? 0.08 : value * 0.86;
  });
}

/** The matrix of a filter, or null for the photo as it is. */
export function filterMatrix(key: FilterKey): readonly number[] | null {
  return key === 'none' ? null : MATRICES[key];
}

/** The next filter one way or the other, going round. */
export function nextFilter(key: FilterKey, step: 1 | -1): FilterKey {
  const index = FILTERS.indexOf(key);
  return FILTERS[(index + step + FILTERS.length) % FILTERS.length] ?? 'none';
}
