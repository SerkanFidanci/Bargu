import { act, renderHook } from '@testing-library/react-native';

let mockFocus: (() => void) | undefined;
let mockBlur: (() => void) | undefined;
jest.mock('expo-router', () => ({
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    const { useEffect } = jest.requireActual<typeof import('react')>('react');
    useEffect(() => {
      mockFocus = () => {
        mockBlur = effect();
      };
      mockFocus();
    }, [effect]);
  },
}));

jest.mock('./explore-model', () => ({
  explore: jest.fn(),
  slicer: () => () => Promise.resolve(),
}));
const mockDays: { current: string[] } = { current: [] };
jest.mock('./own-session', () => ({
  ownTrail: { days: () => mockDays.current, read: () => [] },
  withOwnTrailMetrics: (_listener: unknown, work: () => unknown) => work(),
}));

import { type LocationProbe, probe } from '../../location/probe';
import { explore, type Explored } from './explore-model';
import { useExplore } from './explore-session';

const mockExplore = jest.mocked(explore);

function deferred<T>() {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: (value: T) => {
      resolve?.(value);
    },
  };
}

const resultAt = (zoom: number): Explored => ({
  fog: { type: 'MultiPolygon', coordinates: [] },
  bounds: null,
  zoom,
});

function listener(): LocationProbe {
  return {
    sampled: jest.fn(),
    sent: jest.fn(),
    received: jest.fn(),
    span: jest.fn(),
    count: jest.fn(),
    max: jest.fn(),
    backgroundLive: jest.fn(),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockFocus = undefined;
  mockBlur = undefined;
  mockDays.current = [];
  probe.current = null;
});

afterEach(() => {
  probe.current = null;
  jest.restoreAllMocks();
});

describe('the discovery map focus visit', () => {
  it('cancels fog work on blur and ignores an old result after a new focus visit', async () => {
    const first = deferred<Explored | null>();
    const second = deferred<Explored | null>();
    mockExplore.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = await renderHook(() => useExplore(true, 7));
    expect(mockExplore).toHaveBeenCalledTimes(1);
    expect(result.current).toEqual({ kind: 'busy' });
    const firstCancelled = mockExplore.mock.calls[0]?.[3];

    await act(() => {
      mockBlur?.();
    });
    expect(firstCancelled?.()).toBe(true);
    expect(result.current).toEqual({ kind: 'idle' });

    await act(() => {
      mockFocus?.();
    });
    expect(mockExplore).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ kind: 'busy' });
    const secondCancelled = mockExplore.mock.calls[1]?.[3];
    expect(secondCancelled?.()).toBe(false);

    const old = resultAt(11);
    await act(async () => {
      first.resolve(old);
      await first.promise;
    });
    expect(result.current).toEqual({ kind: 'busy' });

    const current = resultAt(10);
    await act(async () => {
      second.resolve(current);
      await second.promise;
    });
    expect(result.current).toEqual({ kind: 'ready', explored: current });
  });

  it('stays busy on the second activation in the same focus and version', async () => {
    const first = deferred<Explored | null>();
    const second = deferred<Explored | null>();
    mockExplore.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = await renderHook(({ on }: { on: boolean }) => useExplore(on, 7), {
      initialProps: { on: true },
    });
    const old = resultAt(11);
    await act(async () => {
      first.resolve(old);
      await first.promise;
    });
    expect(result.current).toEqual({ kind: 'ready', explored: old });

    await rerender({ on: false });
    expect(result.current).toEqual({ kind: 'idle' });
    await rerender({ on: true });
    expect(mockExplore).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual({ kind: 'busy' });

    const current = resultAt(10);
    await act(async () => {
      second.resolve(current);
      await second.promise;
    });
    expect(result.current).toEqual({ kind: 'ready', explored: current });
  });

  it('reports the whole async exploration and its day count with fixed names only', async () => {
    mockDays.current = ['2026-11-01', '2026-11-02', '2026-11-03'];
    const work = deferred<Explored | null>();
    mockExplore.mockReturnValueOnce(work.promise);
    const span = jest.fn();
    const count = jest.fn();
    probe.current = { ...listener(), span, count };
    const now = jest.spyOn(performance, 'now').mockReturnValue(100);
    const { result } = await renderHook(() => useExplore(true, 7));
    expect(count.mock.calls).toEqual([['own.explore.days', 3]]);
    expect(result.current).toEqual({ kind: 'busy' });

    now.mockReturnValue(175);
    const current = resultAt(17);
    await act(async () => {
      work.resolve(current);
      await work.promise;
    });
    expect(result.current).toEqual({ kind: 'ready', explored: current });
    expect(span.mock.calls).toEqual([['own.explore.total', 75]]);
    expect(JSON.stringify([count.mock.calls, span.mock.calls])).not.toContain('2026-11');
  });

  it('keeps the existing idle error state and closes the total span on rejection', async () => {
    const failure = new Error('refused');
    mockExplore.mockReturnValueOnce(Promise.reject(failure));
    const span = jest.fn();
    probe.current = { ...listener(), span };
    const { result } = await renderHook(() => useExplore(true, 7));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current).toEqual({ kind: 'idle' });
    expect(span).toHaveBeenCalledWith('own.explore.total', expect.any(Number));
  });
});
