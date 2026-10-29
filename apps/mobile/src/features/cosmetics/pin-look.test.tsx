import { COSMETIC_PACKS, type FrameStyle, type RingPattern } from '@bargu/schemas';
import { configure, render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import i18n from '@/i18n';
import { cosmeticFx } from '@/theme';
import { darkColors, lightColors } from '@/theme/colors';
import { contrastRatio } from '@/theme/contrast';
import { AvatarMarker } from '@/ui/avatar-marker';

import type { Look } from './look-styles';

// The look's layer is hidden from screen readers on purpose; the tests look at it all the same.
configure({ defaultIncludeHiddenElements: true });

// The system's light or dark appearance, switched by a test.
let mockScheme: 'light' | 'dark' = 'light';
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  __esModule: true,
  default: () => mockScheme,
}));

/** The flattened style of a rendered element (the test renderer types props loosely). */
const styleOf = (element: { props: unknown }): ViewStyle & TextStyle =>
  StyleSheet.flatten((element.props as { style?: StyleProp<ViewStyle & TextStyle> }).style);

const RINGS: readonly (RingPattern | undefined)[] = [undefined, ...COSMETIC_PACKS.rings];
const FRAMES: readonly (FrameStyle | undefined)[] = [undefined, ...COSMETIC_PACKS.frames];
const EVERY_LOOK = RINGS.flatMap((ring) =>
  FRAMES.flatMap((frame) =>
    ring === undefined && frame === undefined ? [] : [[ring ?? 'none', frame ?? 'none'] as const],
  ),
);
const lookOf = (ring: string, frame: string): Look => ({
  ring: ring === 'none' ? undefined : (ring as RingPattern),
  frame: frame === 'none' ? undefined : (frame as FrameStyle),
  until: Infinity,
});

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
afterEach(() => {
  mockScheme = 'light';
});

describe('a look drawn on the map pin (docs/ADR/0025, the pin addendum)', () => {
  it('draws the ring pattern and the frame, and nothing for a plain pin', async () => {
    const { rerender } = await render(<AvatarMarker name="Ayşe" avatar={null} />);
    expect(screen.queryByTestId('pin-look')).toBeNull();
    await rerender(<AvatarMarker name="Ayşe" avatar={null} look={lookOf('dots', 'gold')} />);
    expect(screen.getByTestId('pin-look-ring-dots')).toBeTruthy();
    expect(screen.getByTestId('pin-look-frame-gold')).toBeTruthy();
    // The own pin and the preview of it draw the same.
    await rerender(
      <AvatarMarker name="Ayşe" avatar={null} look={lookOf('none', 'dashed')} lookMine />,
    );
    expect(screen.queryByTestId(/^pin-look-ring-/)).toBeNull();
    expect(screen.getByTestId('pin-look-frame-dashed')).toBeTruthy();
  });

  it('draws it in a pin shared with others too, around their own face (the owner, 2026-10-29)', async () => {
    await render(
      <AvatarMarker name="Ayşe" avatar={null} look={lookOf('stripes', 'neon')} framed />,
    );
    expect(screen.getByTestId('pin-look-ring-stripes')).toBeTruthy();
    expect(screen.getByTestId('pin-look-frame-neon')).toBeTruthy();
  });

  it('is laid over the pin without taking room, touches or the screen reader', async () => {
    await render(<AvatarMarker name="Ayşe" avatar={null} look={lookOf('sparkle', 'holo')} />);
    const layer = screen.getByTestId('pin-look');
    expect(layer.props.pointerEvents).toBe('none');
    expect(layer.props.accessibilityElementsHidden).toBe(true);
    expect(styleOf(layer)).toMatchObject({ position: 'absolute' });
    // The pin still reads out who and where, and nothing of its look.
    expect(screen.getByLabelText('Ayşe, canlı konum')).toBeTruthy();
  });

  it('is faint for an old location', async () => {
    const { rerender } = await render(
      <AvatarMarker name="Ayşe" avatar={null} look={lookOf('stripes', 'gold')} />,
    );
    expect(styleOf(screen.getByTestId('pin-look')).opacity).toBe(1);
    await rerender(
      <AvatarMarker name="Ayşe" avatar={null} look={lookOf('stripes', 'gold')} staleMinutes={12} />,
    );
    expect(styleOf(screen.getByTestId('pin-look')).opacity).toBe(cosmeticFx.staleOpacity);
  });
});

describe.each([
  ['light', lightColors],
  ['dark', darkColors],
] as const)('the age under a pin stays readable on every look, %s theme', (scheme, colors) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it.each(EVERY_LOOK)('ring %s, frame %s', async (ring, frame) => {
    await render(
      <AvatarMarker name="Ayşe" avatar={null} staleMinutes={12} look={lookOf(ring, frame)} />,
    );
    const age = screen.getByText('12 dk');
    // Outside the look's layer, on a pill of its own that no style paints over…
    expect(within(screen.getByTestId('pin-look')).queryByText('12 dk')).toBeNull();
    const pill = styleOf(screen.getByTestId('marker-age'));
    expect(pill.backgroundColor).toBe(colors.surfaceRaised);
    // …in the theme's own text colour, which reads on that pill (AA).
    expect(styleOf(age).color).toBe(colors.textMuted);
    expect(contrastRatio(colors.textMuted, colors.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.text, colors.surfaceRaised)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the speed line under a live pin readable too', async () => {
    await render(
      <AvatarMarker
        name="Ayşe"
        avatar={null}
        activity="driving"
        detail={{ kind: 'speed', kmh: 40 }}
        look={lookOf('sparkle', 'neon')}
      />,
    );
    const pill = styleOf(screen.getByTestId('marker-detail'));
    expect(pill.backgroundColor).toBe(colors.surfaceRaised);
    expect(within(screen.getByTestId('pin-look')).queryByText('40 km/sa')).toBeNull();
    expect(styleOf(screen.getByText('40 km/sa')).color).toBe(colors.text);
  });
});
