import type { SendCircle } from '../engine';
import { backgroundLiveOn, circleSharing, type SharingSettings } from '../sharing';

/**
 * Why a phone did not go live in the background for a `watch` notice (docs/ADR/0028 step 3). The
 * measurement overlay counts them; none of them is ever told to anyone else.
 */
export const BACKGROUND_LIVE_REFUSALS = [
  /** The user's setting is off (18+ default on, 15-17 default off). */
  'setting',
  /** Ghost mode: "freeze" and "hide" both send nothing. */
  'ghost',
  /** This phone does not share with that circle at all (or is not in it). */
  'notShared',
  /** The circle gets only a neighbourhood or city cell: a one-second GPS would be wasted. */
  'coarse',
  /** The timed share with that circle is over. */
  'expired',
  /** Nobody keeps the circle open (ADR 0024): nothing is sent to it. */
  'paused',
  'batterySaver',
  /** Under {@link LOW_BATTERY_PERCENT}. */
  'batteryLow',
  /** The phone's own allowance (budget.ts) has no room for another window. */
  'cap',
  /** The OS gave the background no location (service not running, or no fix came). */
  'os',
] as const;
export type BackgroundLiveRefusal = (typeof BACKGROUND_LIVE_REFUSALS)[number];

/** Below this a phone does not go live in the background. */
export const LOW_BATTERY_PERCENT = 20;

export interface PolicyInput {
  settings: SharingSettings;
  /** The circle the notice names, as sending sees it; undefined when this phone is not in it. */
  circle: SendCircle | undefined;
  now: number;
}

/**
 * The stops that depend on how this phone shares (the user's setting, ghost mode, what the
 * circle gets): checked when a notice arrives and again with every live position, so a ghost
 * turned on meanwhile ends the window at once. Null: nothing stops it.
 */
export function sharingRefusal(input: PolicyInput): BackgroundLiveRefusal | null {
  const { settings, circle, now } = input;
  if (!backgroundLiveOn(settings)) return 'setting';
  if (settings.ghost !== 'off') return 'ghost';
  if (circle?.myStatus !== 'active') return 'notShared';
  const sharing = circleSharing(settings, circle.id);
  if (sharing.until !== null && sharing.until <= now) return 'expired';
  if (!sharing.sharing) return 'notShared';
  if (circle.paused === true) return 'paused';
  if (sharing.precision !== 'exact') return 'coarse';
  return null;
}

export interface BatteryInput {
  /** Android's battery saver (iOS: low power mode). */
  saver: boolean;
  /** 0-100; negative or not a number when the platform does not know (then it is not a stop). */
  level: number;
  /** On the charger (charging or full): a low battery is no reason to hold back then. */
  charging: boolean;
}

/**
 * The stops that depend on the battery: battery saver always stops it; under 20 % stops it unless
 * the phone is charging (the PM, 2026-10-21: a phone on the charger has no battery to spare).
 */
export function batteryRefusal(battery: BatteryInput): BackgroundLiveRefusal | null {
  if (battery.saver) return 'batterySaver';
  if (!battery.charging && battery.level >= 0 && battery.level < LOW_BATTERY_PERCENT) {
    return 'batteryLow';
  }
  return null;
}
