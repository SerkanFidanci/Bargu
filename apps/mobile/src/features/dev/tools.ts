import { createElement } from 'react';

import i18n from '@/i18n';
import { devResources } from '@/i18n/dev-resources';

import { DevRows } from './dev-rows';
import { SwarmLayer, SwarmPanel } from './swarm-panel';
import { BillingDevScreen } from './screens/billing-screen';
import { CryptoBenchmarkScreen } from './screens/crypto-screen';
import { UiGalleryScreen } from './screens/ui-screen';
import { useDevSlots } from './slots';

/**
 * The developer tools other than the measurement overlay (measure/index.ts), loaded only by
 * development and preview builds (index.ts): their texts, the developer rows of the "Uygulama"
 * screen, the fake people on the map and the developer screens. A production bundle contains none
 * of it, not even switched off: the condition that loads this file is a constant when a release
 * bundle is built (apps/mobile/scripts/check-bundle.mjs checks that).
 */
for (const [language, resource] of Object.entries(devResources)) {
  i18n.addResourceBundle(language, 'translation', resource, true, false);
}

useDevSlots.setState({
  aboutRows: createElement(DevRows),
  swarmLayer: createElement(SwarmLayer),
  swarmPanel: createElement(SwarmPanel),
  screens: {
    crypto: createElement(CryptoBenchmarkScreen),
    ui: createElement(UiGalleryScreen),
    billing: createElement(BillingDevScreen),
  },
});
