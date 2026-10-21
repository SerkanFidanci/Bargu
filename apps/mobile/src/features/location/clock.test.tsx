import { render } from '@testing-library/react-native';

import { CLOCK_TICK_MS, timerAt, useNow } from './clock';

function Reader() {
  useNow();
  return null;
}

jest.useFakeTimers();

/** Screens that read the time come and go all the time (every sheet and page that shows an age). */
describe('the shared clock', () => {
  it('starts one timer however many screens read it, and stops it with the last one', async () => {
    const started = jest.spyOn(globalThis, 'setInterval');
    const stopped = jest.spyOn(globalThis, 'clearInterval');
    const clockTimers = () =>
      started.mock.calls.filter(([, delay]) => delay === CLOCK_TICK_MS).length;
    const views = [];
    for (let index = 0; index < 40; index += 1) views.push(await render(<Reader />));
    expect(clockTimers()).toBe(1);
    for (const view of views.slice(0, 39)) await view.unmount();
    expect(stopped).not.toHaveBeenCalled();
    await views[39]?.unmount();
    expect(stopped).toHaveBeenCalledTimes(1);
    // Opened and closed again many times: one start and one stop each time, never a pile.
    started.mockClear();
    stopped.mockClear();
    for (let index = 0; index < 50; index += 1) {
      const view = await render(<Reader />);
      await view.unmount();
    }
    expect(clockTimers()).toBe(50);
    expect(stopped).toHaveBeenCalledTimes(50);
    started.mockRestore();
    stopped.mockRestore();
  });
});

describe('a timer at a moment', () => {
  it('is one timer at a time, also for a moment weeks away, and none once cancelled', () => {
    const before = jest.getTimerCount();
    const now = Date.now();
    const soon = timerAt(now + CLOCK_TICK_MS, jest.fn());
    const far = timerAt(now + 40 * 24 * 3_600_000, jest.fn());
    expect(jest.getTimerCount() - before).toBe(2);
    soon();
    far();
    expect(jest.getTimerCount() - before).toBe(0);
  });
});
