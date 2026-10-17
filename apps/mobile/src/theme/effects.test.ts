import * as Haptics from 'expo-haptics';

import { effectLevel, savingFrom, timesAt, useEffectChoice } from './effects';
import { feedback } from './haptics';

afterEach(() => {
  useEffectChoice.setState({ level: 'full' });
});

describe('sade mod (docs/ADR/0027)', () => {
  it('plays the choice, as "off" with Reduce Motion or off screen, "full" as "reduced" saving', () => {
    const base = { chosen: 'full', reduced: false, paused: false, saving: false } as const;
    expect(effectLevel(base)).toBe('full');
    expect(effectLevel({ ...base, chosen: 'reduced' })).toBe('reduced');
    expect(effectLevel({ ...base, reduced: true })).toBe('off');
    expect(effectLevel({ ...base, paused: true })).toBe('off');
    // Saving battery: "full" plays as "reduced"; "off" stays off; the choice itself is kept.
    expect(effectLevel({ ...base, saving: true })).toBe('reduced');
    expect(effectLevel({ ...base, chosen: 'off', saving: true })).toBe('off');
  });

  it('saves battery in power saving mode, or under 20 % when not charging', () => {
    const power = { lowPowerMode: false, batteryLevel: 0.5, charging: false };
    expect(savingFrom(power)).toBe(false);
    expect(savingFrom({ ...power, lowPowerMode: true })).toBe(true);
    expect(savingFrom({ ...power, batteryLevel: 0.19 })).toBe(true);
    expect(savingFrom({ ...power, batteryLevel: 0.19, charging: true })).toBe(false);
    // An emulator says -1: not known, not saving.
    expect(savingFrom({ ...power, batteryLevel: -1 })).toBe(false);
  });

  it('plays a repeated effect fully, once when reduced, not at all when off', () => {
    expect(timesAt('full', 3)).toBe(3);
    expect(timesAt('reduced', 3)).toBe(1);
    expect(timesAt('off', 3)).toBe(0);
  });

  it('silences vibration when off', () => {
    jest.clearAllMocks();
    useEffectChoice.setState({ level: 'off' });
    feedback('select');
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
    useEffectChoice.setState({ level: 'reduced' });
    feedback('select');
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});
