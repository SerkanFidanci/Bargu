import { act, renderHook } from '@testing-library/react-native';

import { MAX_TIMER_MS, timerAt, useNow } from './clock';
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

  it('waits weeks for a share timed past the timer limit, without firing at once (QA 25)', async () => {
    const month = 30 * 24 * 3_600_000;
    useSharing.setState({ ghost: 'off', circles: { a: share(T + month) } });
    const onEnd = jest.fn();
    await renderHook(() => {
      useSharingEnd(onEnd);
    });
    await act(() => {
      jest.advanceTimersByTime(1_000);
    });
    expect(onEnd).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(month - 2_000);
    });
    expect(onEnd).not.toHaveBeenCalled();
    await act(() => {
      jest.advanceTimersByTime(1_002);
    });
    expect(onEnd).toHaveBeenCalledTimes(1);
  });

  it('timerAt reaches a moment beyond the limit in steps', () => {
    const fn = jest.fn();
    const at = T + MAX_TIMER_MS * 2 + 5;
    timerAt(at, fn);
    jest.advanceTimersByTime(MAX_TIMER_MS * 2);
    expect(fn).not.toHaveBeenCalled();
    jest.advanceTimersByTime(5);
    expect(fn).toHaveBeenCalledTimes(1);
    const cancelled = jest.fn();
    const cancel = timerAt(Date.now() + MAX_TIMER_MS + 10, cancelled);
    jest.advanceTimersByTime(MAX_TIMER_MS);
    cancel();
    jest.advanceTimersByTime(100);
    expect(cancelled).not.toHaveBeenCalled();
  });
});
