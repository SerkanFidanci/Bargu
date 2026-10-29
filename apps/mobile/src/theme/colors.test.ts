import {
  avatarPalette,
  avatarText,
  type ColorName,
  darkColors,
  gradientAt,
  lightColors,
  mixColor,
} from './colors';
import { contrastRatio } from './contrast';

const BODY = 4.5;
const LARGE = 3;

/** Text/background pairs that components actually use, with the AA level each needs. */
const pairs: readonly (readonly [ColorName, ColorName, number])[] = [
  ['text', 'background', BODY],
  ['text', 'surface', BODY],
  ['text', 'surfaceRaised', BODY],
  ['textMuted', 'background', BODY],
  ['textMuted', 'surface', BODY],
  ['textMuted', 'surfaceRaised', BODY],
  ['onPrimary', 'primary', BODY],
  ['onAccent', 'accent', BODY],
  ['onSuccess', 'success', BODY],
  ['onDanger', 'danger', BODY],
  ['text', 'primarySoft', BODY],
  // Navy (light) and light blue (dark) are small text too: the dock's labels, ghost buttons (T8).
  ['primary', 'background', BODY],
  ['primary', 'surface', BODY],
  ['primary', 'surfaceRaised', BODY],
  // Error and success messages under form fields are small text.
  ['danger', 'background', BODY],
  ['success', 'background', BODY],
  ['danger', 'surface', LARGE],
  // Navy icons on their soft navy tiles (Me, guardians, circles) are graphics: 3:1 (QA 24 B-4).
  ['primary', 'primarySoft', LARGE],
  // An error message on a card is small text (QA 24 B-4).
  ['danger', 'surface', BODY],
  // Messages: others' words on their grey (one's own are on the sweep).
  ['text', 'bubble', BODY],
  ['textMuted', 'bubble', BODY],
  // A link or a failed item's words on the grey of a message (QA-40: 4.26 and 4.43 at night).
  ['primary', 'bubble', BODY],
  ['danger', 'bubble', BODY],
];

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
])('%s colours', (_, colors) => {
  it.each(pairs)('%s on %s reaches %s:1', (foreground, background, minimum) => {
    expect(contrastRatio(colors[foreground], colors[background])).toBeGreaterThanOrEqual(minimum);
  });
});

describe('avatar palette', () => {
  it.each(avatarPalette)('keeps white initials readable on %s (bold, large)', (color) => {
    expect(contrastRatio(avatarText, color)).toBeGreaterThanOrEqual(LARGE);
  });

  it('has distinct colours', () => {
    expect(new Set(avatarPalette).size).toBe(avatarPalette.length);
  });
});

/** HSL saturation of a #RRGGBB colour, 0 (grey) to 1. */
function saturation(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16) / 255);
  const max = Math.max(r ?? 0, g ?? 0, b ?? 0);
  const min = Math.min(r ?? 0, g ?? 0, b ?? 0);
  if (max === min) return 0;
  return (max - min) / (max + min > 1 ? 2 - max - min : max + min);
}

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
])("the brand's sweep, %s (the owner, 2026-10-29; ADR 0008 Ek 2026-10-29)", (_, colors) => {
  const steps = Array.from({ length: 41 }, (__, step) =>
    gradientAt(colors.brandGradient, step / 40),
  );

  it('goes from navy through red to orange, the logo order', () => {
    const [from, via, to] = colors.brandGradient;
    expect(gradientAt(colors.brandGradient, 0)).toBe(from);
    expect(gradientAt(colors.brandGradient, 0.5)).toBe(via);
    expect(gradientAt(colors.brandGradient, 1)).toBe(to);
    expect(gradientAt(colors.brandGradient, 2)).toBe(to);
  });

  it('keeps white words readable at every point of it (AA, body text)', () => {
    for (const color of steps) {
      expect(contrastRatio(colors.onBrand, color)).toBeGreaterThanOrEqual(BODY);
    }
  });

  it('does not turn muddy in the middle: the red keeps it in colour', () => {
    // Straight from navy to orange, part of the way is a grey brown (saturation 0.16).
    const [from, , to] = colors.brandGradient;
    const straight = Array.from({ length: 41 }, (__, step) =>
      saturation(mixColor(from, to, step / 40)),
    );
    expect(Math.min(...straight)).toBeLessThan(0.2);
    for (const color of steps) expect(saturation(color)).toBeGreaterThanOrEqual(0.28);
  });

  it('has no violet left (#5B34F2 and its kin are gone)', () => {
    const values = Object.values(colors).flat();
    for (const gone of ['#5B34F2', '#7A55F6', '#9333EA', '#4361EE', '#C92E68']) {
      expect(values).not.toContain(gone);
    }
  });
});

describe('mixing colours', () => {
  it('goes from one end to the other, and stops at the ends', () => {
    expect(mixColor('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    expect(mixColor('#000000', '#FFFFFF', 2)).toBe('#FFFFFF');
    expect(mixColor('#000000', '#FFFFFF', -1)).toBe('#000000');
  });
});

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
    expect(contrastRatio('#FFFFFF', '#FFFFFF')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#FFFFFF')).toBeCloseTo(4.48, 2);
  });

  it('rejects colours it cannot read', () => {
    expect(() => contrastRatio('red', '#FFFFFF')).toThrow();
  });
});
