import type { Avatar } from '@bargu/schemas';
import { create } from 'zustand';

import { type GlideFix, type GlidePoint, project } from '../map/glide';

/**
 * Dev tool for the Faz 6 DoD ("50 avatars at 60 fps"): fake people moving around a point, shown
 * on the map like real ones. Local only: nothing is sent, nothing is stored.
 */
export interface SwarmPerson {
  id: string;
  name: string;
  avatar: Avatar;
  fix: GlideFix & { bat: number; chg: boolean };
  receivedAt: number;
}

export const useSwarm = create<{ people: SwarmPerson[] }>(() => ({ people: [] }));

export const SWARM_SIZE = 50;
/** People spread over about this many metres around the centre. */
const SPREAD_M = 1_500;
/** Each fake phone "sends" every second (live mode), the worst case for the map. */
const TICK_MS = 1_000;
const EMOJIS = ['😺', '🐻', '🦊', '🐼', '🐸', '🦁', '🐯', '🐨', '🐵', '🦄'] as const;
/** Speeds (m/s): standing, walking, cycling, driving. */
const SPEEDS = [0, 1.4, 5, 14] as const;

let timer: ReturnType<typeof setInterval> | null = null;
let tick = 0;

/**
 * A number in [0, 1) that varies with its input: enough to scatter fake people (nothing secret
 * depends on it, so it need not be random; real randomness comes only from @bargu/crypto).
 */
function varied(seed: number): number {
  const x = Math.sin(seed * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

function pick<T>(items: readonly T[], index: number): T {
  const item = items[index % items.length];
  if (item === undefined) throw new Error('empty list');
  return item;
}

/** Starts the swarm around `center` (or moves it there). */
export function startSwarm(center: GlidePoint, count = SWARM_SIZE): void {
  stopSwarm();
  const now = Date.now();
  const people = Array.from({ length: count }, (_, index): SwarmPerson => {
    const start = project(center, varied(index) * 360, varied(index + 0.5) * SPREAD_M);
    return {
      id: `swarm-${String(index)}`,
      name: `Test ${String(index + 1)}`,
      avatar: { color: index % 8, emoji: pick(EMOJIS, index) },
      fix: {
        ...start,
        spd: pick(SPEEDS, index),
        hdg: varied(index + 0.25) * 360,
        ts: now,
        bat: (index * 7) % 100,
        chg: index % 5 === 0,
      },
      receivedAt: now,
    };
  });
  useSwarm.setState({ people });
  timer = setInterval(() => {
    const at = Date.now();
    tick += 1;
    useSwarm.setState((state) => ({
      people: state.people.map((person, index) => {
        const spd = person.fix.spd ?? 0;
        // A gentle turn now and then, like a street.
        const hdg = ((person.fix.hdg ?? 0) + (varied(tick * 100 + index) - 0.5) * 30 + 360) % 360;
        const next = project(person.fix, hdg, (spd * TICK_MS) / 1000);
        return { ...person, fix: { ...person.fix, ...next, hdg, ts: at }, receivedAt: at };
      }),
    }));
  }, TICK_MS);
}

export function stopSwarm(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  useSwarm.setState({ people: [] });
}
