jest.mock('expo-secure-store', () => ({
  AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
}));

import { isNight, mapSchemeAt, nextSwitch } from './appearance';

const at = (hour: number, minute = 0) => new Date(2026, 9, 13, hour, minute);

describe('automatic map appearance', () => {
  it('is dark from 20:00 to 07:00 and light during the day', () => {
    expect(isNight(at(6, 59))).toBe(true);
    expect(isNight(at(7, 0))).toBe(false);
    expect(isNight(at(19, 59))).toBe(false);
    expect(isNight(at(20, 0))).toBe(true);
    expect(isNight(at(23, 30))).toBe(true);
  });

  it('follows the clock only in automatic mode', () => {
    expect(mapSchemeAt('auto', at(13))).toBe('light');
    expect(mapSchemeAt('auto', at(22))).toBe('dark');
    expect(mapSchemeAt('light', at(22))).toBe('light');
    expect(mapSchemeAt('dark', at(13))).toBe('dark');
  });

  it('schedules the next switch at 07:00 or 20:00', () => {
    expect(nextSwitch(at(3, 15))).toEqual(at(7));
    expect(nextSwitch(at(12, 40))).toEqual(at(20));
    expect(nextSwitch(at(21, 5))).toEqual(new Date(2026, 9, 14, 7, 0));
  });
});
