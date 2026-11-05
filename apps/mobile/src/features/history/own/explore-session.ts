import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { explore, type Explored, slicer } from './explore-model';
import { ownTrail } from './own-session';

export type ExploreState =
  { kind: 'idle' } | { kind: 'busy' } | { kind: 'ready'; explored: Explored };

/**
 * The discovery map while it is on screen (docs/ADR/0030 Ek 2): worked out from the days kept, a
 * slice at a time, again when they change (`version`); held only here, dropped when the screen goes.
 * Until the work for this version and focus visit is over it is "busy".
 */
export function useExplore(on: boolean, version: number): ExploreState {
  const [focus, setFocus] = useState({ focused: false, id: 0 });
  const generation = useRef(0);
  const [done, setDone] = useState<{
    focus: number;
    version: number;
    explored: Explored | null;
  } | null>(null);
  const [wasOn, setWasOn] = useState(on);
  if (wasOn !== on) {
    // Clear on every activation edge, before this revisit renders: its own result is not ready yet.
    setWasOn(on);
    setDone(null);
  }
  useFocusEffect(
    useCallback(() => {
      generation.current += 1;
      const id = generation.current;
      setFocus({ focused: true, id });
      return () => {
        // Invalidate synchronously on blur: a fog slice may finish before React cleans effects up.
        generation.current += 1;
        setFocus((current) => ({ ...current, focused: false }));
      };
    }, []),
  );
  useEffect(() => {
    if (!on || !focus.focused) return;
    const id = focus.id;
    let left = false;
    const stale = () => left || generation.current !== id;
    void explore(ownTrail.days(), (day) => ownTrail.read(day), slicer(), stale).then(
      (explored) => {
        if (!stale() && explored !== null) setDone({ focus: id, version, explored });
      },
      () => {
        if (!stale()) setDone({ focus: id, version, explored: null });
      },
    );
    return () => {
      left = true;
    };
  }, [on, version, focus.focused, focus.id]);
  if (!on || !focus.focused) return { kind: 'idle' };
  if (done?.version !== version || done.focus !== focus.id) return { kind: 'busy' };
  return done.explored === null ? { kind: 'idle' } : { kind: 'ready', explored: done.explored };
}
