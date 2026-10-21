import { act, renderHook } from '@testing-library/react-native';

const mockCanDismiss = jest.fn<boolean, []>(() => true);
const mockDismissAll = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    canDismiss: () => mockCanDismiss(),
    dismissAll: () => {
      mockDismissAll();
    },
  },
}));

import { type SafeSpot, resetSpot, showSpot } from './safe-spot';
import { useSafeSpotNavigation } from './use-safe-spot';

const spot: SafeSpot = {
  id: 'AAAAAAAAAAAAAAAAAAAAAA',
  circleId: '0190f7a4-5b6c-7d8e-9f01-23456789abcd',
  name: 'Ayşe',
  lat: 41,
  lng: 29,
  acc: 8,
  bat: 45,
  ts: 1,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCanDismiss.mockReturnValue(true);
  resetSpot();
});

describe('a tapped "Güvendeyim" and the screens over the map', () => {
  it('makes them make way, every time a place is asked for, and not before', async () => {
    await renderHook(() => {
      useSafeSpotNavigation();
    });
    expect(mockDismissAll).not.toHaveBeenCalled();
    await act(() => {
      showSpot(spot);
    });
    expect(mockDismissAll).toHaveBeenCalledTimes(1);
    await act(() => {
      showSpot(spot);
    });
    expect(mockDismissAll).toHaveBeenCalledTimes(2);
  });

  it('leaves the map alone when nothing stands over it (the app was opened by the tap)', async () => {
    mockCanDismiss.mockReturnValue(false);
    await renderHook(() => {
      useSafeSpotNavigation();
    });
    await act(() => {
      showSpot(spot);
    });
    expect(mockDismissAll).not.toHaveBeenCalled();
  });
});
