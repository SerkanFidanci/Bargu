import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';

import i18n from '@/i18n';

import type { Place } from '../places/place-model';
import { MeetingStack, STACK_MAX } from './meeting-points-layer';
import { groupMeetingPoints, type MeetingGroup, type MeetingPoint } from './meeting-points';

jest.mock('@/config/env', () => ({
  env: { apiUrl: 'https://api.test', mapUrl: 'https://api.test/map', appVersion: '0.0.0' },
  DEV_TOOLS_ENABLED: false,
}));
const mockPush = jest.fn<undefined, [unknown]>();
// expo-router's native stack needs a native view jest does not have on Linux (CI).
jest.mock('expo-router', () => ({
  router: {
    push: (route: unknown) => {
      mockPush(route);
    },
  },
}));

// The map's markers: plain views here, keeping their props (the tap Android gives the marker).
const mockMarkers = new Map<string, { onPress?: () => void; offset?: [number, number] }>();
jest.mock('@maplibre/maplibre-react-native', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return {
    Marker: (props: {
      id: string;
      onPress?: () => void;
      offset?: [number, number];
      children: ReactNode;
    }) => {
      mockMarkers.set(props.id, props);
      return <View>{props.children}</View>;
    },
  };
});

const NOW = 1_800_000_000_000;
const MALTEPE = { lat: 40.9405, lng: 29.1291 };
const event = '0190f7a4-5b6c-7d8e-9f01-23456789abcd';

/** One of the event's places `metres` north of Maltepe. */
function option(id: string, name: string, metres: number, state: MeetingPoint['state'] = 'option') {
  const place: Place = {
    id,
    circleId: event,
    version: 1,
    name,
    emoji: '📍',
    lat: MALTEPE.lat + metres / 111_320,
    lng: MALTEPE.lng,
    radius: 150,
    ts: 1,
  };
  return { circleId: event, title: 'Konser', place, meetAt: undefined, state };
}

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
beforeEach(() => {
  mockPush.mockClear();
  mockMarkers.clear();
});

const stack = (points: MeetingPoint[]): MeetingGroup => ({
  key: 'g',
  points,
  lat: MALTEPE.lat,
  lng: MALTEPE.lng,
});

describe('meetings standing together (the owner, 2026-10-18)', () => {
  const hilltown = option('a', 'Hilltown', 0);
  const avm = option('b', 'Avm', 30);

  it('share one card when their tags would overlap, and part when zoomed in', () => {
    // At street level 30 m is about 33 px: the two tags would lie on each other.
    const together = groupMeetingPoints([hilltown, avm], 16);
    expect(together).toHaveLength(1);
    expect(together[0]?.points.map((point) => point.place.name)).toEqual(['Avm', 'Hilltown']);
    // Closer in, 30 m is some 260 px: each has its own tag.
    expect(groupMeetingPoints([hilltown, avm], 19)).toHaveLength(2);
    // Across town they never meet.
    expect(groupMeetingPoints([hilltown, option('c', 'Kadıköy', 5_000)], 16)).toHaveLength(2);
  });

  it('chain: tags touching one another in a row are one card, the meeting itself first', () => {
    // The meeting's flag stands above its point: it touches Avm's tag, not Hilltown's.
    const set = option('d', 'Sahne', 40, 'set');
    const groups = groupMeetingPoints([hilltown, avm, set], 16);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.points[0]?.state).toBe('set');
  });

  it('gives every meeting its own row and tap', async () => {
    await render(<MeetingStack group={stack([avm, hilltown])} now={NOW} />);
    expect(screen.getByText('📍 Avm')).toBeTruthy();
    expect(screen.getByText('📍 Hilltown')).toBeTruthy();
    expect(screen.getAllByText('aday')).toHaveLength(2);
    await fireEvent.press(screen.getByTestId('meeting-option-a'));
    await fireEvent.press(screen.getByTestId('meeting-option-b'));
    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/meeting/[circleId]',
      params: { circleId: event },
    });
  });

  it('counts those past the card', async () => {
    const many = Array.from({ length: STACK_MAX + 2 }, (_, index) =>
      option(`p${String(index)}`, `Yer ${String(index)}`, index),
    );
    await render(<MeetingStack group={stack(many)} now={NOW} />);
    expect(screen.getByText('+2')).toBeTruthy();
  });

  it('opens a row with the tap Android gives its marker, once even when its button hears it too', async () => {
    await render(<MeetingStack group={stack([avm, hilltown])} now={NOW} />);
    // One marker a row, one under the other around the point.
    expect(mockMarkers.get('meetings-g-0')?.offset).toEqual([0, -25]);
    expect(mockMarkers.get('meetings-g-1')?.offset).toEqual([0, 25]);
    await act(() => {
      mockMarkers.get('meetings-g-1')?.onPress?.();
    });
    expect(mockPush).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByTestId('meeting-option-a'));
    expect(mockPush).toHaveBeenCalledTimes(1);
  });
});
