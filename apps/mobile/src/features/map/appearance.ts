import * as SecureStore from 'expo-secure-store';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { z } from 'zod';
import { create } from 'zustand';

import type { ColorScheme } from '@/theme';

export const MAP_APPEARANCES = ['auto', 'light', 'dark'] as const;
export type MapAppearance = (typeof MAP_APPEARANCES)[number];

/** "Automatic" map (BARGU_PLAN §4.3: dark map at night): dark from 20:00 to 07:00 local time. */
const NIGHT = { fromHour: 20, untilHour: 7 } as const;

export function isNight(date: Date): boolean {
  const hour = date.getHours();
  return hour >= NIGHT.fromHour || hour < NIGHT.untilHour;
}

export function mapSchemeAt(mode: MapAppearance, date: Date): ColorScheme {
  if (mode !== 'auto') return mode;
  return isNight(date) ? 'dark' : 'light';
}

/** The next moment the automatic map changes (07:00 or 20:00), so one timer suffices. */
export function nextSwitch(date: Date): Date {
  const next = new Date(date);
  next.setMinutes(0, 0, 0);
  const hour = date.getHours();
  if (hour < NIGHT.untilHour) next.setHours(NIGHT.untilHour);
  else if (hour < NIGHT.fromHour) next.setHours(NIGHT.fromHour);
  else {
    next.setDate(next.getDate() + 1);
    next.setHours(NIGHT.untilHour);
  }
  return next;
}

const STORAGE_KEY = 'bargu.prefs.map.v1';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};
const storedSchema = z.object({ appearance: z.enum(MAP_APPEARANCES) });

interface AppearanceState {
  mode: MapAppearance;
  setMode: (mode: MapAppearance) => void;
}

/** A per-phone display choice; never sent to the server. */
export const useMapAppearance = create<AppearanceState>((set) => ({
  mode: 'auto',
  setMode: (mode) => {
    set({ mode });
    SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ appearance: mode }), OPTIONS).catch(
      () => undefined,
    );
  },
}));

/** Restores the saved choice at start-up; anything unreadable falls back to automatic. */
export async function loadMapAppearance(): Promise<void> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY, OPTIONS);
    if (raw === null) return;
    const parsed = storedSchema.safeParse(JSON.parse(raw));
    if (parsed.success) useMapAppearance.setState({ mode: parsed.data.appearance });
  } catch {
    // Keep the default.
  }
}

/**
 * The map's colour scheme now. In automatic mode one timer fires at the next switch (07:00 or
 * 20:00); coming back to the foreground re-checks, since timers sleep in the background.
 */
export function useMapScheme(): ColorScheme {
  const mode = useMapAppearance((state) => state.mode);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (mode !== 'auto') return;
    const timer = setTimeout(
      () => {
        setNow(new Date());
      },
      Math.max(0, nextSwitch(now).getTime() - Date.now()),
    );
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') setNow(new Date());
    });
    return () => {
      clearTimeout(timer);
      subscription.remove();
    };
  }, [mode, now]);

  return mapSchemeAt(mode, now);
}
