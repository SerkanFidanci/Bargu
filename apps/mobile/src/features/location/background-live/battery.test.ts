import * as Battery from 'expo-battery';

import { readBattery } from './battery';

jest.mock('expo-battery', () => ({
  BatteryState: { UNKNOWN: 0, UNPLUGGED: 1, CHARGING: 2, FULL: 3 },
  isLowPowerModeEnabledAsync: jest.fn(),
  getPowerStateAsync: jest.fn(),
}));

const saver = Battery.isLowPowerModeEnabledAsync as jest.Mock;
const power = Battery.getPowerStateAsync as jest.Mock;
const { BatteryState } = Battery;

const read = async (state: { batteryLevel: number; batteryState: Battery.BatteryState }) => {
  saver.mockResolvedValue(false);
  power.mockResolvedValue({ ...state, lowPowerMode: false });
  return readBattery();
};

describe('the battery background live mode asks about (docs/ADR/0028 step 3)', () => {
  it('reads the level in percent, and is charging while charging or full', async () => {
    expect(await read({ batteryLevel: 0.42, batteryState: BatteryState.UNPLUGGED })).toEqual({
      saver: false,
      level: 42,
      charging: false,
    });
    expect(await read({ batteryLevel: 0.1, batteryState: BatteryState.CHARGING })).toMatchObject({
      charging: true,
    });
    expect(await read({ batteryLevel: 1, batteryState: BatteryState.FULL })).toMatchObject({
      level: 100,
      charging: true,
    });
  });

  it('does not take what the platform cannot tell for a low battery or a charger', async () => {
    expect(await read({ batteryLevel: -1, batteryState: BatteryState.UNKNOWN })).toEqual({
      saver: false,
      level: -1,
      charging: false,
    });
  });

  it('carries battery saver', async () => {
    saver.mockResolvedValue(true);
    power.mockResolvedValue({
      batteryLevel: 0.9,
      batteryState: BatteryState.CHARGING,
      lowPowerMode: true,
    });
    expect(await readBattery()).toEqual({ saver: true, level: 90, charging: true });
  });
});
