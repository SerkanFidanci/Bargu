import {
  avatarPalette,
  avatarText,
  type ColorTokens,
  darkColors,
  lightColors,
  mixColor,
} from './colors';
import { contrastRatio } from './contrast';

const BODY = 4.5;
const LARGE = 3;

/** Text/background pairs that components actually use, with the AA level each needs. */
const pairs: readonly (readonly [keyof ColorTokens, keyof ColorTokens, number])[] = [
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
  ['primary', 'background', LARGE],
  ['primary', 'surface', LARGE],
  // Error and success messages under form fields are small text.
  ['danger', 'background', BODY],
  ['success', 'background', BODY],
  ['danger', 'surface', LARGE],
  // Violet icons on their soft violet tiles (Me, guardians, circles) are graphics: 3:1 (QA 24 B-4).
  ['primary', 'primarySoft', LARGE],
  // An error message on a card is small text (QA 24 B-4).
  ['danger', 'surface', BODY],
  // The store button's words lie on a band from primary to promo: both ends (ADR 0025 Ek 2).
  ['onPromo', 'promo', BODY],
  ['onPromo', 'primary', BODY],
  // Messages: one's own words on either end of their colours, others' on their grey.
  ['onPrimary', 'bubbleFrom', BODY],
  ['onPrimary', 'bubbleTo', BODY],
  ['text', 'bubble', BODY],
  ['textMuted', 'bubble', BODY],
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

describe('one own message colours (the owner, 2026-10-28)', () => {
  it('mixes from one end to the other, and every step between still reads', () => {
    const { bubbleFrom, bubbleTo, onPrimary } = lightColors;
    expect(mixColor(bubbleTo, bubbleFrom, 0)).toBe(bubbleTo);
    expect(mixColor(bubbleTo, bubbleFrom, 1)).toBe(bubbleFrom);
    expect(mixColor(bubbleTo, bubbleFrom, 2)).toBe(bubbleFrom);
    expect(mixColor('#000000', '#FFFFFF', 0.5)).toBe('#808080');
    for (let step = 0; step <= 10; step += 1) {
      const color = mixColor(bubbleTo, bubbleFrom, step / 10);
      expect(contrastRatio(onPrimary, color)).toBeGreaterThanOrEqual(BODY);
    }
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
