import type { WeatherSnapshot } from '@bargu/schemas';
import { act, renderHook } from '@testing-library/react-native';

import { useWeatherHere } from '../weather/use-weather';
import { useWeather } from '../weather/weather';
import { useMyFix } from './engine';
import { useFirstPosition, useMyCell } from './my-position';
import { GALATA, moved } from './test-support';

// The weather hook fetches and listens through the signed-in session: not what is tested here.
jest.mock('../auth/auth-store', () => ({ api: { authed: jest.fn() }, onSignedOut: jest.fn() }));
jest.mock('../live/live-session', () => ({ onLiveMessage: jest.fn(), onOnline: jest.fn() }));

/** A grid of 2 × 2 cells (0.5° apart) round Istanbul: clear in the south, cloudy at Galata. */
const snapshot: WeatherSnapshot = {
  at: 1,
  grid: { south: 40.5, west: 28.5, step: 0.5, rows: 2, cols: 2 },
  cells: [
    [0, 1, 18, 10, 0, 5],
    [0, 1, 17, 10, 0, 5],
    [3, 1, 15, 90, 0, 9],
    [3, 1, 14, 90, 0, 9],
  ],
};

beforeEach(() => {
  useMyFix.setState({ fix: null, since: null });
  useWeather.setState({ snapshot: null });
});

/** One position a second, for a minute: the phone with the map open, walking a little. */
async function aMinuteOfFixes(): Promise<void> {
  for (let second = 0; second < 60; second += 1) {
    await act(() => {
      useMyFix.setState({ fix: moved(GALATA, second * 0.8, second * 1_000) });
    });
  }
}

describe('what the map screen follows of the phone’s own position', () => {
  it('the first position stays the same array however many come after it', async () => {
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useFirstPosition();
    });
    expect(result.current).toBeNull();
    await act(() => {
      useMyFix.setState({ fix: GALATA });
    });
    const first = result.current;
    expect(first).toEqual([GALATA.lng, GALATA.lat]);
    const rendersAtFirst = renders;
    await aMinuteOfFixes();
    // 60 positions came: not one more drawing, and still the very same array.
    expect(renders).toBe(rendersAtFirst);
    expect(result.current).toBe(first);
    // Signed out: nothing; signed in again: the new first position, not the old one.
    await act(() => {
      useMyFix.setState({ fix: null });
    });
    expect(result.current).toBeNull();
    await act(() => {
      useMyFix.setState({ fix: { ...GALATA, lat: 39.9 } });
    });
    expect(result.current).toEqual([GALATA.lng, 39.9]);
  });

  it('the square it is in changes only when the phone leaves the square', async () => {
    await act(() => {
      useMyFix.setState({ fix: GALATA });
    });
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useMyCell();
    });
    expect(result.current).toBe('28.97:41.03');
    const rendersAtHome = renders;
    await aMinuteOfFixes();
    expect(renders).toBe(rendersAtHome);
    await act(() => {
      useMyFix.setState({ fix: { ...GALATA, lng: 29.2 } });
    });
    expect(result.current).toBe('29.20:41.03');
    expect(renders).toBe(rendersAtHome + 1);
  });

  it('the weather here is the same object while the phone stays in one cell of the grid', async () => {
    await act(() => {
      useWeather.setState({ snapshot });
      useMyFix.setState({ fix: GALATA });
    });
    let renders = 0;
    const { result } = await renderHook(() => {
      renders += 1;
      return useWeatherHere();
    });
    const here = result.current;
    expect(here?.kind).toBe('clouds');
    const rendersBefore = renders;
    await aMinuteOfFixes();
    expect(renders).toBe(rendersBefore);
    expect(result.current).toBe(here);
    // Into the next cell of the grid, to the south: its weather.
    await act(() => {
      useMyFix.setState({ fix: { ...GALATA, lat: 40.55 } });
    });
    expect(result.current).not.toBe(here);
    expect(result.current?.kind).toBe('clear');
  });
});
