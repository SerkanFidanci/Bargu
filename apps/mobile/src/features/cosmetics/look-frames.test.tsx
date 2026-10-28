import { act, render } from '@testing-library/react-native';

import i18n from '@/i18n';
import { AvatarMarker } from '@/ui/avatar-marker';
import { EffectsPaused, useDeviceSaving, useEffectChoice } from '@/theme/effects';

import { useSlots } from './animation-slots';
import type { Look } from './look-styles';
import { PinLook } from './pin-look';

/**
 * The measurement of docs/ADR/0027 for looks on the pin: frames asked for while nobody touches the
 * map, counted as requestAnimationFrame calls. An endless animation asks for one every frame; a
 * still look, or one in calm mode, asks for none. (A missing 'worklet' directive cannot show here:
 * jest runs worklets on the JS thread. src/worklet-calls.test.ts checks them by reading the source.)
 */
async function frames(settleMs = 1_000, windowMs = 1_000): Promise<number> {
  await act(() => {
    jest.advanceTimersByTime(settleMs);
  });
  const asked = jest.spyOn(globalThis, 'requestAnimationFrame');
  await act(() => {
    jest.advanceTimersByTime(windowMs);
  });
  const count = asked.mock.calls.length;
  asked.mockRestore();
  return count;
}

const worn = (look: Omit<Look, 'until'>, stale = false, id = 'me') => (
  <PinLook
    look={{ ...look, until: Infinity }}
    size={46}
    ringColor="#1E3F8A"
    stale={stale}
    id={id}
    mine
  />
);

const MOVING: readonly (readonly [string, Omit<Look, 'until'>])[] = [
  ['sparkle', { ring: 'sparkle' }],
  ['holo', { frame: 'holo' }],
  ['neon', { frame: 'neon' }],
];
const STILL: readonly (readonly [string, Omit<Look, 'until'>])[] = [
  ['stripes and gold', { ring: 'stripes', frame: 'gold' }],
  ['dots and dashed', { ring: 'dots', frame: 'dashed' }],
  ['gradient', { ring: 'gradient' }],
];

// Reanimated runs its frames on these timers: installed once, as the animations start on them.
jest.useFakeTimers();
jest.setTimeout(30_000);

beforeAll(async () => {
  await i18n.changeLanguage('tr');
});
afterEach(() => {
  useEffectChoice.setState({ level: 'full' });
  useDeviceSaving.setState({ saving: false });
  useSlots.setState({ claims: [] }, true);
});

describe('the moving looks cost frames only at sade mod "full" (docs/ADR/0025, the pin addendum)', () => {
  it.each(MOVING)('%s moves at "full": the map stays lively', async (_, look) => {
    await render(worn(look));
    expect(await frames()).toBeGreaterThan(0);
  });

  it.each(STILL)('%s never asks for a frame, at "full" too', async (_, look) => {
    await render(worn(look));
    expect(await frames()).toBe(0);
  });

  it.each(['reduced', 'off'] as const)(
    'none from any moving look in calm mode ("%s")',
    async (level) => {
      useEffectChoice.setState({ level });
      await render(
        <>
          {worn({ ring: 'sparkle', frame: 'holo' }, false, 'a')}
          {worn({ frame: 'neon' }, false, 'b')}
        </>,
      );
      expect(await frames()).toBe(0);
    },
  );

  it('none in battery saving or with a low battery, which play "full" as "reduced"', async () => {
    useDeviceSaving.setState({ saving: true });
    await render(worn({ ring: 'sparkle', frame: 'neon' }));
    expect(await frames()).toBe(0);
  });

  it('none while the map is not on screen', async () => {
    await render(
      <EffectsPaused.Provider value>
        {worn({ ring: 'sparkle', frame: 'holo' })}
      </EffectsPaused.Provider>,
    );
    expect(await frames()).toBe(0);
  });

  it('none for an old location, which shows its look faint and still', async () => {
    await render(worn({ ring: 'sparkle', frame: 'neon' }, true));
    expect(await frames()).toBe(0);
  });

  it('stops at once when sade mod leaves "full" while it plays, and starts again after', async () => {
    await render(worn({ frame: 'holo' }));
    expect(await frames()).toBeGreaterThan(0);
    await act(() => {
      useEffectChoice.setState({ level: 'reduced' });
    });
    expect(await frames()).toBe(0);
    await act(() => {
      useEffectChoice.setState({ level: 'full' });
    });
    expect(await frames()).toBeGreaterThan(0);
  });

  it('none from a whole pin in calm mode, its look included', async () => {
    useEffectChoice.setState({ level: 'reduced' });
    await render(
      <AvatarMarker
        name="Ayşe"
        avatar={null}
        news={1}
        look={{ ring: 'sparkle', frame: 'neon', until: Infinity }}
        lookMine
      />,
    );
    // The pin's own one-off motion for a new location is over within the first seconds.
    expect(await frames(10_000, 3_000)).toBe(0);
  });
});
