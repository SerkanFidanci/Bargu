import { useEffect, useState } from 'react';

import { explore, type Explored, slicer } from './explore-model';
import { ownTrail } from './own-session';

export type ExploreState =
  { kind: 'idle' } | { kind: 'busy' } | { kind: 'ready'; explored: Explored };

/**
 * The discovery map while it is on screen (docs/ADR/0030 Ek 2): worked out from the days kept, a
 * slice at a time, again when they change (`version`); held only here, dropped when the screen goes.
 * Until the work for this version is over it is "busy".
 */
export function useExplore(on: boolean, version: number): ExploreState {
  const [done, setDone] = useState<{ version: number; explored: Explored | null } | null>(null);
  useEffect(() => {
    if (!on) return;
    let left = false;
    void explore(
      ownTrail.days(),
      (day) => ownTrail.read(day),
      slicer(),
      () => left,
    ).then(
      (explored) => {
        if (!left && explored !== null) setDone({ version, explored });
      },
      () => {
        if (!left) setDone({ version, explored: null });
      },
    );
    return () => {
      left = true;
    };
  }, [on, version]);
  if (!on) return { kind: 'idle' };
  if (done?.version !== version) return { kind: 'busy' };
  return done.explored === null ? { kind: 'idle' } : { kind: 'ready', explored: done.explored };
}
