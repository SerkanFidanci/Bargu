import { act, renderHook } from '@testing-library/react-native';

import { useNow } from './clock';
import { DEFAULT_SHARING, useSharing } from './sharing';
import { nextSharingEnd, useSharingEnd } from './sharing-end';

const T = Date.UTC(2026, 9, 18, 12, 0);
const share = (until: number | null) => ({ sharing: true, precision: 'exact' as const, until });

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T);
  useSharing.setState(DEFAULT_SHARING, true);
});
afterEach(() => {
  jest.useRealTimers();
});

describe('the end of a timed share (QA 24 B-2)', () => {
  it('is the earliest end still ahead', () => {
    const settings = {
      ghost: 'off' as const,
      circles: { a: share(T + 60_000), b: share(T + 10_000), c: share(null), d: share(T - 1) },
    };
    expect(nextSharingEnd(settings, T)).toBe(T + 10_000);
    expect(nextSharingEnd(DEFAULT_SHARING, T)).toBeNull();
  });

  it('reaches the engine and every screen at that moment, not a clock beat later', async () => {
    useSharing.setState({ ghost: 'off', circles: { a: share(T + 10_000), b: share(T + 40_000) } });
    const onEnd = jest.fn();
    const { result } = await renderHook(() => {
      useSharingEnd(onEnd);
      return useNow();
    });
    expect(result.current).toBe(T);
    await act(() => {
      jest.advanceTimersByTime(9_999);
    });
    expect(onEnd).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(2);
    });
    // Right after the first end: the engine is told, the screens' clock has caught up.
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(result.current).toBeGreaterThan(T + 10_000);
    // The next one too, with one timer each.
    await act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(onEnd).toHaveBeenCalledTimes(2);
    expect(result.current).toBeGreaterThan(T + 40_000);
  });
});
