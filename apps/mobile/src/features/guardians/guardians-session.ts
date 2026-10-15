import { onOnline, onServerEvents } from '../live/live-session';
import { queryClient } from '../query-client';
import { guardiansApi, guardiansKey } from './guardians-api';
import { refreshRules } from './screen-time-session';

/**
 * A link changed, on either side (docs/ADR/0023 §4): its list and views are fetched again, and the
 * child's rules (a parent changed them) with them.
 */
function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: guardiansKey });
  void queryClient
    .query({ queryKey: guardiansKey, queryFn: () => guardiansApi.list(), staleTime: 0 })
    .catch(() => undefined);
  void refreshRules();
}

onServerEvents((events) => {
  if (events.some((event) => event.type === 'guardians.changed')) refresh();
});

// After every (re)connection: what changed while away.
onOnline(refresh);
