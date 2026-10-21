import { randomUuid } from '@bargu/crypto';

import type { SendCircle } from '../engine';
import {
  DEFAULT_SHARING,
  type SharingSettings,
  withAdultDefaults,
  withMinorSharing,
} from '../sharing';
import { batteryRefusal, LOW_BATTERY_PERCENT, sharingRefusal } from './policy';

const NOW = 1_800_000_000_000;
const id = randomUuid();
const circle: SendCircle = { id, epoch: 1, myStatus: 'active', withOthers: true };
const adult: SharingSettings = withAdultDefaults(DEFAULT_SHARING);

const refusal = (settings: SharingSettings, asked: SendCircle | undefined = circle, now = NOW) =>
  sharingRefusal({ settings, circle: asked, now });
const sharing = (change: Partial<SharingSettings['circles'][string]>): SharingSettings => ({
  ...adult,
  circles: { [id]: { sharing: true, precision: 'exact', until: null, ...change } },
});

describe('when a phone goes live in the background (docs/ADR/0028 step 3)', () => {
  it('goes live for a circle that gets its exact location, with the setting on', () => {
    expect(refusal(adult)).toBeNull();
    expect(refusal(sharing({}))).toBeNull();
  });

  it('never with the setting off, and a phone not told its age band has it off', () => {
    expect(refusal({ ...adult, backgroundLive: 'off' })).toBe('setting');
    expect(refusal(DEFAULT_SHARING)).toBe('setting');
    expect(refusal(withMinorSharing(DEFAULT_SHARING, []))).toBe('setting');
  });

  it('never in ghost mode, frozen or hidden', () => {
    expect(refusal({ ...adult, ghost: 'freeze' })).toBe('ghost');
    expect(refusal({ ...adult, ghost: 'hide' })).toBe('ghost');
  });

  it('never for a circle that gets only a neighbourhood or a city', () => {
    expect(refusal(sharing({ precision: 'neighborhood' }))).toBe('coarse');
    expect(refusal(sharing({ precision: 'city' }))).toBe('coarse');
  });

  it('never once the timed share with the circle is over, or when it is not shared', () => {
    expect(refusal(sharing({ until: NOW + 1 }))).toBeNull();
    expect(refusal(sharing({ until: NOW }))).toBe('expired');
    expect(refusal(sharing({ until: NOW - 60_000 }))).toBe('expired');
    expect(refusal(sharing({ sharing: false }))).toBe('notShared');
    // New circles of a teen start unshared.
    expect(refusal({ ...adult, newCircles: 'off', circles: {} })).toBe('notShared');
  });

  it('never for a circle nobody keeps open (paused), or one this phone is not active in', () => {
    expect(refusal(adult, { ...circle, paused: true })).toBe('paused');
    expect(refusal(adult, { ...circle, paused: false })).toBeNull();
    expect(refusal(adult, { ...circle, myStatus: 'invited' })).toBe('notShared');
    expect(sharingRefusal({ settings: adult, circle: undefined, now: NOW })).toBe('notShared');
  });

  it('never on battery saver, nor below 20 %; an unknown level is not a stop', () => {
    expect(LOW_BATTERY_PERCENT).toBe(20);
    expect(batteryRefusal({ saver: false, level: 100 })).toBeNull();
    expect(batteryRefusal({ saver: false, level: 20 })).toBeNull();
    expect(batteryRefusal({ saver: false, level: 19.9 })).toBe('batteryLow');
    expect(batteryRefusal({ saver: true, level: 90 })).toBe('batterySaver');
    expect(batteryRefusal({ saver: false, level: -1 })).toBeNull();
  });
});
