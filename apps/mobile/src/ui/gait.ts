/** How a walking or running pin is posed at one moment of its gait. */
export interface GaitPose {
  x: number;
  y: number;
  /** Degrees, clockwise; the pin pivots on its tip (the person's position). */
  rotate: number;
  scaleX: number;
  scaleY: number;
  /** 0 on the ground … 1 at the top of a step (the shadow follows it). */
  lift: number;
}

export interface Gait {
  lift: number;
  sway: number;
  tilt: number;
  lean: number;
  squash: number;
}

/**
 * The pose at `phase` (0–1 over one cycle of two steps). Each step is a soft arc (sine), landing
 * with a short squash that eases off as the pin rises; the weight moves to one side and back once
 * per cycle; the whole body leans towards `leanSide` (-1 left … 1 right: east is right on a
 * north-up map).
 */
export function gaitPose(phase: number, gait: Gait, leanSide: number): GaitPose {
  'worklet';
  const step = (phase * 2) % 1;
  const lift = Math.sin(Math.PI * step);
  const ground = (1 - lift) ** 3;
  const shift = Math.sin(2 * Math.PI * phase);
  return {
    x: shift * gait.sway,
    y: -lift * gait.lift,
    rotate: leanSide * gait.lean + shift * gait.tilt,
    scaleX: 1 + gait.squash * 0.6 * ground,
    scaleY: 1 - gait.squash * ground,
    lift,
  };
}

/** Which way someone leans on a north-up map: -1 (west) … 1 (east), from their heading. */
export function leanSideOf(headingDeg: number | null | undefined): number {
  'worklet';
  if (headingDeg === null || headingDeg === undefined) return 0;
  return Math.sin((headingDeg * Math.PI) / 180);
}
