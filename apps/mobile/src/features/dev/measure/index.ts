import { createElement } from 'react';

import { onSignedOut } from '../../auth/auth-store';
import { probe } from '../../location/probe';
import { isVaultOpen, vault } from '../../storage/vault';
import { useDevSlots } from '../slots';
import { MeasureOverlay } from './overlay';
import { backgroundLiveStore, forgetBackgroundLive, recorder, useMeasures } from './store';
import { startStallWatch } from './watch';

/**
 * The measurement overlay, loaded only by development and preview builds (index.ts,
 * docs/ADR/0028): from here on the location pipeline reports to it, the map screen draws it and
 * the Me sheet's developer section can show it. Measures stay in memory, except the counters of
 * background live mode: those are kept in this phone's encrypted vault for the phone trial
 * (ADR 0028 step 3), numbers only, and never leave it.
 */
probe.current = recorder;
backgroundLiveStore.current = () => (isVaultOpen() ? vault() : null);
onSignedOut(forgetBackgroundLive);
useDevSlots.setState({
  mapOverlay: createElement(MeasureOverlay),
  toggleOverlay: () => {
    useMeasures.setState((state) => ({ open: !state.open }));
  },
});

// The stall meter starts with the app: the first ten seconds are when the start-up work happens
// (the circles, the keys, the snapshots), and the overlay is opened only after them.
startStallWatch();
