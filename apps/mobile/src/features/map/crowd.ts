import { create } from 'zustand';

import { crowdFx } from '@/theme';

/**
 * How many people the map draws now: the people layer's pins and, in a test build, the fake swarm
 * (features/dev/map-swarm.ts). Past a few, each moving pin costs a frame (theme crowdFx).
 */
export const useMapCrowd = create<{ people: number; swarm: number }>(() => ({
  people: 0,
  swarm: 0,
}));

/** Pins hold still: no loops. */
export function useCalmCrowd(): boolean {
  return useMapCrowd((state) => state.people + state.swarm > crowdFx.calmAbove);
}

/** Pins jump to each new spot instead of gliding there. */
export function useStillCrowd(): boolean {
  return useMapCrowd((state) => state.people + state.swarm > crowdFx.stillAbove);
}
