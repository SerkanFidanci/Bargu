import * as Battery from 'expo-battery';

import type { BatteryInput } from './policy';

/**
 * The battery as background live mode needs it (docs/ADR/0028 step 3): battery saver, the level in
 * percent (-1 when the platform does not know: then it is not a stop), and whether the phone is on
 * the charger (charging or full: an emulator or a phone that cannot tell reads as not charging).
 */
export async function readBattery(): Promise<BatteryInput> {
  const [saver, state] = await Promise.all([
    Battery.isLowPowerModeEnabledAsync(),
    Battery.getPowerStateAsync(),
  ]);
  return {
    saver,
    level: state.batteryLevel < 0 ? -1 : state.batteryLevel * 100,
    charging:
      state.batteryState === Battery.BatteryState.CHARGING ||
      state.batteryState === Battery.BatteryState.FULL,
  };
}
