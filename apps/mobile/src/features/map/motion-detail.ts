import { activityFx } from '@/theme/motion';

import type { MarkerDetail } from '@/ui/avatar-marker';

/**
 * The line under someone on the map (proje sahibi 2026-10-16: "kaç km hızla gittiğini, duruyorsa
 * kaç saattir durduğunu"): their speed while they move, rounded so it is not a speedometer; while
 * still, how long they have stayed (the sender says since when, location/stay.ts). Only exact
 * locations carry either (applyPrecision), and a sender who hides their speed sends none.
 */
export function motionDetail(
  loc: { spd?: number | null | undefined; since?: number | undefined },
  now: number,
): MarkerDetail | undefined {
  const { minSpeed, kmhStep, minStayMin } = activityFx.label;
  if (loc.spd !== null && loc.spd !== undefined && loc.spd >= minSpeed) {
    const kmh = Math.max(kmhStep, Math.round((loc.spd * 3.6) / kmhStep) * kmhStep);
    return { kind: 'speed', kmh };
  }
  if (loc.since === undefined) return undefined;
  const minutes = Math.floor((now - loc.since) / 60_000);
  if (minutes < minStayMin) return undefined;
  if (minutes < 60) return { kind: 'stay', unit: 'minutes', count: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: 'stay', unit: 'hours', count: hours };
  return { kind: 'stay', unit: 'days', count: Math.floor(hours / 24) };
}
