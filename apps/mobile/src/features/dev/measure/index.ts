import { createElement } from 'react';

import { probe } from '../../location/probe';
import { useDevSlots } from '../slots';
import { MeasureOverlay } from './overlay';
import { recorder, useMeasures } from './store';

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
