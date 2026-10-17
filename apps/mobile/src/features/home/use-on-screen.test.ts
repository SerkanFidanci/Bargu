import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';

// The screen is focused once mounted; the test plays the user leaving it.
let mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      mockBlur = effect();
    }, [effect]);
  },
}));

import { useOnScreen } from './use-on-screen';

describe('the map on screen (docs/ADR/0027)', () => {
  it('is not while another page covers it or the app is in the background', async () => {
    let change: ((state: AppStateStatus) => void) | undefined;
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
      change = listener;
      return { remove: jest.fn() };
    });
    const { result } = await renderHook(() => useOnScreen());
    await act(() => {
      change?.('active');
    });
    expect(result.current).toBe(true);
    await act(() => {
      change?.('background');
    });
    expect(result.current).toBe(false);
    await act(() => {
      change?.('active');
    });
    expect(result.current).toBe(true);
    // Another page over the map.
    await act(() => {
      mockBlur?.();
    });
    expect(result.current).toBe(false);
  });
});
