import { onOnline, onServerEvents } from '../live/live-session';
import { queryClient } from '../query-client';
import { guardiansKey } from './guardians-api';

/** A link changed, on either side (docs/ADR/0023 §4): its list and views are fetched again. */
function refresh(): void {
  void queryClient.invalidateQueries({ queryKey: guardiansKey });
}

onServerEvents((events) => {
  if (events.some((event) => event.type === 'guardians.changed')) refresh();
});

// After every (re)connection: what changed while away.
onOnline(refresh);
