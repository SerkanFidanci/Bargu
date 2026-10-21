import { createElement } from 'react';

import { probe } from '../../location/probe';
import { useDevSlots } from '../slots';
import { MeasureOverlay } from './overlay';
import { addStall, watchStalls } from './stalls';
import { recorder, useMeasures, useStalls } from './store';

/**
 * The measurement overlay, loaded only by development and preview builds (index.ts,
 * docs/ADR/0028): from here on the location pipeline reports to it, the map screen draws it and
 * the Me sheet's developer section can show it. Measures stay in memory.
 */
probe.current = recorder;
useDevSlots.setState({
  mapOverlay: createElement(MeasureOverlay),
  toggleOverlay: () => {
    useMeasures.setState((state) => ({ open: !state.open }));
  },
});

// The stall meter starts with the app: the first ten seconds are when the start-up work happens
// (the circles, the keys, the snapshots), and the overlay is opened only after them.
useStalls.setState({ watching: true });
watchStalls({
  now: () => performance.now(),
  setTimer: (run, ms) => setTimeout(run, ms),
  clearTimer: (timer) => {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
  spans: () => useStalls.getState().spans,
  onStall: (stall) => {
    useStalls.setState((state) => ({ list: addStall(state.list, stall) }));
  },
  onEnd: () => {
    useStalls.setState({ watching: false });
  },
});
