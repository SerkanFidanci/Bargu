import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { type StyleProp, StyleSheet, type ViewStyle } from 'react-native';

import '@/i18n';
import { touchTarget } from '@/theme';

// The map's pieces are plain views here: what is drawn and what a tap does, not where.
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { Marker: View, Layer: View, GeoJSONSource: View };
});
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
}));

import type { Place } from './place-model';
import { usePlaces } from './places';
import { PlacesLayer } from './places-layer';

const cafe: Place = {
  id: 'p1',
  circleId: 'c1',
  version: 1,
  name: 'Kahve',
  emoji: '☕',
  lat: 39.907,
  lng: 30.037,
  radius: 250,
  ts: 1,
};

beforeEach(() => {
  jest.mocked(router.push).mockClear();
  usePlaces.setState({ p1: cafe }, true);
});

describe('a saved place on the map', () => {
  it("opens the place's own screen with a tap on its tag", async () => {
    await render(<PlacesLayer />);
    await fireEvent.press(screen.getByTestId('map-place-p1'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/place/[circleId]',
      params: { circleId: 'c1', id: 'p1' },
    });
  });

  it('gives the small tag a full touch target, named for screen readers', async () => {
    await render(<PlacesLayer />);
    const target = screen.getByTestId('map-place-p1');
    const style: ViewStyle = StyleSheet.flatten(target.props.style as StyleProp<ViewStyle>);
    expect(style.minWidth).toBeGreaterThanOrEqual(touchTarget);
    expect(style.minHeight).toBeGreaterThanOrEqual(touchTarget);
    expect(touchTarget).toBeGreaterThanOrEqual(44);
    expect(screen.getByRole('button', { name: 'Kahve' })).toBeTruthy();
  });

  it('leaves out the places drawn as meetings', async () => {
    await render(<PlacesLayer except={new Set(['p1'])} />);
    expect(screen.queryByTestId('map-place-p1')).toBeNull();
  });
});
