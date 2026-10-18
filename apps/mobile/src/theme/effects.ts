import { createContext, useContext } from 'react';
import { type AnimatableValue, useReducedMotion, withRepeat } from 'react-native-reanimated';
import { create } from 'zustand';

import { useTheme } from './index';

/**
 * Sade mod (docs/ADR/0027): how much effect, motion and vibration this phone wants. "full" plays
 * everything, the map lively; "reduced" only short, one-off effects (an avatar moves once per new
 * location, nothing loops); "off" none, vibration included.
 */
export const EFFECT_LEVELS = ['full', 'reduced', 'off'] as const;
export type EffectLevel = (typeof EFFECT_LEVELS)[number];

/** This phone's choice (never sent anywhere); effect-prefs.ts keeps it across starts. */
export const useEffectChoice = create<{ level: EffectLevel }>(() => ({ level: 'full' }));

/**
 * The phone saves battery (its power saving mode, or under SAVING_BATTERY and not charging):
 * "full" plays as "reduced" until it no longer does; the choice itself stays (effect-prefs.ts).
 */
export const useDeviceSaving = create<{ saving: boolean }>(() => ({ saving: false }));
export const SAVING_BATTERY = 0.2;

export function savingFrom(power: {
  lowPowerMode: boolean;
  /** 0–1; below 0 the platform does not know (emulators). */
  batteryLevel: number;
  charging: boolean;
}): boolean {
  if (power.lowPowerMode) return true;
  return !power.charging && power.batteryLevel >= 0 && power.batteryLevel < SAVING_BATTERY;
}

/**
 * True where what is drawn is not on screen (the map under another page, the app in the
 * background): everything below plays as "off" and nothing runs.
 */
export const EffectsPaused = createContext(false);

/** The level in force, from the choice and what the phone says. */
export function effectLevel(input: {
  chosen: EffectLevel;
  /** The system's Reduce Motion. */
  reduced: boolean;
  paused: boolean;
  saving: boolean;
}): EffectLevel {
  if (input.reduced || input.paused || input.chosen === 'off') return 'off';
  return input.saving ? 'reduced' : input.chosen;
}

/** The level in force for motion here (see effectLevel). */
export function useEffects(): EffectLevel {
  const reduced = useReducedMotion();
  const paused = useContext(EffectsPaused);
  const chosen = useEffectChoice((state) => state.level);
  const saving = useDeviceSaving((state) => state.saving);
  return effectLevel({ chosen, reduced, paused, saving });
}

/** How many times a repeated effect plays: `full` at the full level, one when reduced, none off. */
export function timesAt(level: EffectLevel, full: number): number {
  if (level === 'off') return 0;
  return level === 'reduced' ? Math.min(1, full) : full;
}

/**
 * An animation played `times` times (each there and back with `reverse`), never endlessly: the
 * effects added since sade mod have no animation that runs on its own forever (docs/ADR/0027).
 */
export function repeatFinite<T extends AnimatableValue>(
  animation: T,
  times: number,
  reverse = false,
): T {
  const count = Math.max(1, Math.floor(times));
  return withRepeat(animation, reverse ? count * 2 : count, reverse);
}

/**
 * A still glow around what is chosen or primary (ColorTokens.glow; a box-shadow, never animated),
 * or none at "off" (docs/ADR/0008, the theme of 2026-10-18).
 */
export function useGlow(): string | undefined {
  const { colors } = useTheme();
  return useEffects() === 'off' ? undefined : `0px 0px 16px ${colors.glow}`;
}
