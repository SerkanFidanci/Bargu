import * as Battery from 'expo-battery';
import * as SecureStore from 'expo-secure-store';
import { z } from 'zod';

import {
  EFFECT_LEVELS,
  type EffectLevel,
  savingFrom,
  useDeviceSaving,
  useEffectChoice,
} from '@/theme/effects';

const STORED_AS = 'bargu.prefs.effects.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const storedSchema = z.object({ level: z.enum(EFFECT_LEVELS) });

/** Sade mod chosen on this phone (a display choice, never sent to the server). */
export function setEffectLevel(level: EffectLevel): void {
  useEffectChoice.setState({ level });
  SecureStore.setItemAsync(STORED_AS, JSON.stringify({ level }), OPTIONS).catch(() => undefined);
}

/** Restores the saved choice at start-up; anything unreadable keeps "full". */
export async function loadEffectLevel(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(STORED_AS, OPTIONS);
    if (raw === null) return;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (parsed.success) useEffectChoice.setState({ level: parsed.data.level });
  } catch {
    // Keep the default.
  }
}

/**
 * Follows the phone's battery for sade mod (docs/ADR/0027): its power saving mode, or a low battery
 * not charging, plays "full" as "reduced" until it ends. Read on this phone only.
 */
export function watchDeviceSaving(): void {
  const update = async () => {
    try {
      const power = await Battery.getPowerStateAsync();
      useDeviceSaving.setState({
        saving: savingFrom({
          lowPowerMode: power.lowPowerMode,
          batteryLevel: power.batteryLevel,
          charging:
            power.batteryState === Battery.BatteryState.CHARGING ||
            power.batteryState === Battery.BatteryState.FULL,
        }),
      });
    } catch {
      // Unknown: as if not saving.
    }
  };
  void update();
  Battery.addLowPowerModeListener(() => void update());
  Battery.addBatteryLevelListener(() => void update());
  Battery.addBatteryStateListener(() => void update());
}
