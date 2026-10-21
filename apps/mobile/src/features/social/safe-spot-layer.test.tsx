import { act, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

// The map's pieces are plain views here: what is drawn, not where, is tested. A source keeps the
// shapes it was given where the test can read them.
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Map: View,
    Camera: () => null,
    Marker: View,
    Layer: View,
    GeoJSONSource: ({ children, data }: { children?: React.ReactNode; data: unknown }) => (
      <View testID="safe-spot-source" accessibilityValue={{ text: JSON.stringify(data) }}>
        {children}
      </View>
    ),
  };
});

import { distanceM } from '../location/send';
import { SafeSpotLayer } from './safe-spot-layer';
import {
  clearSpot,
  type SafeSpot,
  showSpot,
  SPOT_KEEP_MS,
  resetSpot,
  useSafeSpot,
} from './safe-spot';

const spot = (overrides: Partial<SafeSpot> = {}): SafeSpot => ({
  id: 'AAAAAAAAAAAAAAAAAAAAAA',
  circleId: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  name: 'Ayşe',
  lat: 41.025_6,
  lng: 28.974_2,
  acc: 8,
  bat: 45,
  ts: Date.now(),
  ...overrides,
});

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  resetSpot();
});

describe('where somebody said "Güvendeyim" (docs/ADR/0029 §5)', () => {
  it('draws nothing until a place is asked for, and nothing again after a tap on the map', async () => {
    await render(<SafeSpotLayer />);
    expect(screen.queryByTestId('safe-spot')).toBeNull();
    await act(() => {
      showSpot(spot());
    });
    expect(screen.getByTestId('safe-spot')).toBeTruthy();
    await act(() => {
      clearSpot();
    });
    expect(screen.queryByTestId('safe-spot')).toBeNull();
  });

  it('is a dot for an exact place: no circle, the name above it', async () => {
    await render(<SafeSpotLayer />);
    await act(() => {
      showSpot(spot({ acc: 8 }));
    });
    expect(screen.getByTestId('safe-spot-dot')).toBeTruthy();
    expect(screen.queryByTestId('safe-spot-source')).toBeNull();
    expect(screen.getByText('✓ Ayşe')).toBeTruthy();
    expect(screen.getByTestId('safe-spot').props.accessibilityLabel).toBe(
      'Ayşe iyiyim dedi, buradan',
    );
  });

  it('is a circle with the accuracy for a coarse place: no dot that claims more', async () => {
    await render(<SafeSpotLayer />);
    const coarse = spot({ acc: 708 });
    await act(() => {
      showSpot(coarse);
    });
    expect(screen.queryByTestId('safe-spot-dot')).toBeNull();
    const source = screen.getByTestId('safe-spot-source');
    const shapes = JSON.parse(
      (source.props as { accessibilityValue: { text: string } }).accessibilityValue.text,
    ) as {
      features: { geometry: { coordinates: [number, number][][] } }[];
    };
    const ring = shapes.features[0]?.geometry.coordinates[0] ?? [];
    expect(ring.length).toBeGreaterThan(8);
    // Every point of it is the accuracy away from the place the sender gave.
    for (const [lng = 0, lat = 0] of ring) {
      expect(distanceM({ lat, lng }, coarse)).toBeGreaterThan(700);
      expect(distanceM({ lat, lng }, coarse)).toBeLessThan(716);
    }
    expect(screen.getByTestId('safe-spot').props.accessibilityLabel).toBe(
      'Ayşe iyiyim dedi, buradan, yaklaşık konum',
    );
  });

  it('is gone after a day', async () => {
    await render(<SafeSpotLayer />);
    await act(() => {
      useSafeSpot.setState({ spot: spot({ ts: Date.now() - SPOT_KEEP_MS - 60_000 }) });
    });
    expect(screen.queryByTestId('safe-spot')).toBeNull();
  });
});
