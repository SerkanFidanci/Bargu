import { Platform, type TextStyle } from 'react-native';

/**
 * Embedded font faces (app.config.ts FONTS). Android registers each family with its weights and
 * picks the face from `fontWeight`; iOS is most reliable when addressed by PostScript name.
 */
const FACES = {
  Inter: {
    400: 'Inter-Regular',
    500: 'Inter-Medium',
    600: 'Inter-SemiBold',
    700: 'Inter-Bold',
  },
  'Bricolage Grotesque': {
    700: 'BricolageGrotesque-Bold',
    800: 'BricolageGrotesque-ExtraBold',
  },
} as const;

type Family = keyof typeof FACES;
type Weight<F extends Family> = keyof (typeof FACES)[F];

function font<F extends Family>(family: F, weight: Weight<F>): TextStyle {
  if (Platform.OS === 'ios') {
    return { fontFamily: (FACES[family] as Record<Weight<F>, string>)[weight] };
  }
  return { fontFamily: family, fontWeight: String(weight) as TextStyle['fontWeight'] };
}

interface Variant {
  style: TextStyle;
  /**
   * Upper bound for the system text size setting (Dynamic Type / font scale). Body text grows the
   * furthest; big display text less, so it still fits a small phone (iPhone SE) at the largest
   * accessibility sizes.
   */
  maxScale: number;
}

const variant = (style: TextStyle, maxScale: number): Variant => ({ style, maxScale });

/** Type scale (docs/DESIGN.md). Sizes and line heights in points, on a 4-point rhythm. */
export const typography = {
  display: variant({ ...font('Bricolage Grotesque', 800), fontSize: 34, lineHeight: 40 }, 1.4),
  title1: variant({ ...font('Bricolage Grotesque', 700), fontSize: 28, lineHeight: 34 }, 1.5),
  title2: variant({ ...font('Bricolage Grotesque', 700), fontSize: 22, lineHeight: 28 }, 1.6),
  headline: variant({ ...font('Inter', 600), fontSize: 17, lineHeight: 22 }, 2),
  body: variant({ ...font('Inter', 400), fontSize: 17, lineHeight: 24 }, 2),
  bodyStrong: variant({ ...font('Inter', 600), fontSize: 17, lineHeight: 24 }, 2),
  callout: variant({ ...font('Inter', 400), fontSize: 16, lineHeight: 22 }, 2),
  subhead: variant({ ...font('Inter', 500), fontSize: 15, lineHeight: 20 }, 2),
  footnote: variant({ ...font('Inter', 400), fontSize: 13, lineHeight: 18 }, 2),
  caption: variant({ ...font('Inter', 500), fontSize: 12, lineHeight: 16 }, 2),
  /** Login code digits: large, tabular. */
  code: variant(
    {
      ...font('Bricolage Grotesque', 700),
      fontSize: 28,
      lineHeight: 34,
      fontVariant: ['tabular-nums'],
    },
    1.3,
  ),
} as const;

export type TypographyVariant = keyof typeof typography;
