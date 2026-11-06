import type { Me } from '@bargu/schemas';
import { render } from '@testing-library/react-native';

import { type LocationProbe, probe } from '../location/probe';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
}));
jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-battery', () => ({
  getPowerStateAsync: () => Promise.resolve({ batteryLevel: 0.5, batteryState: 1 }),
  BatteryState: { UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
}));
const mockGeoJSON: { current: unknown } = { current: null };
jest.mock('@maplibre/maplibre-react-native', () => ({
  GeoJSONSource: (props: { data: unknown }) => {
    mockGeoJSON.current = props.data;
    return null;
  },
  Layer: () => null,
}));
jest.mock('./use-meetings', () => ({ useMeetingWatcher: () => null }));
jest.mock('../live/live-session', () => ({ keys: jest.fn(), liveRequest: jest.fn() }));
jest.mock('../storage/vault', () => ({ isVaultOpen: () => false, vault: jest.fn() }));
jest.mock('./gliding-marker', () => ({ GlidingMarker: () => null }));
jest.mock('./map-avatar', () => ({ MapAvatar: () => null }));
jest.mock('./cluster-bubble', () => ({ ClusterBubble: () => null }));

import { PeopleLayer } from './people-layer';
import { UncertaintyLayer } from './uncertainty-layer';

const ME: Me = {
  userId: '0190f7a4-1111-7111-8111-000000000001',
  username: 'seko',
  displayName: 'Seko',
  avatar: null,
  device: { id: '0190f7a4-1111-7111-8111-000000000002', platform: 'android', attested: true },
  passkeys: 0,
};

function listener(spans: string[]): LocationProbe {
  return {
    sampled: () => undefined,
    sent: () => undefined,
    received: () => undefined,
    span: (name) => spans.push(name),
    backgroundLive: () => undefined,
  };
}

beforeEach(() => {
  mockGeoJSON.current = null;
});

afterEach(() => {
  probe.current = null;
});

describe('people measurement call sites', () => {
  it('times derive, cluster and uncertainty separately without changing an empty render', async () => {
    const spans: string[] = [];
    probe.current = listener(spans);
    await render(<PeopleLayer me={ME} circles={[]} />);
    expect(spans.slice(0, 4)).toEqual([
      'people.derive',
      'people.cluster',
      'people.uncertainty',
      'people.uncertainty',
    ]);
    expect(new Set(spans)).toEqual(
      new Set(['people.derive', 'people.cluster', 'people.uncertainty']),
    );
    expect(mockGeoJSON.current).toBeNull();
  });

  it('times GeoJSON derivation and keeps the same rough-spot feature', async () => {
    const spans: string[] = [];
    probe.current = listener(spans);
    await render(
      <UncertaintyLayer spots={[{ id: 'rough', lat: 41.0256, lng: 28.9742, acc: 500 }]} />,
    );
    expect(spans).toEqual(['people.uncertainty']);
    expect(mockGeoJSON.current).toMatchObject({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', id: 'rough', geometry: { type: 'Polygon' } }],
    });
  });
});
