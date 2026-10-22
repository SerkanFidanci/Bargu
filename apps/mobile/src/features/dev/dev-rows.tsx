import { router } from 'expo-router';
import { Wrench } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { useMyFix } from '@/features/location/engine';
import { INITIAL_VIEW } from '@/features/map/style';
import { SettingsGroup, SettingsRow } from '@/ui/settings-row';

import { startSwarm } from './map-swarm';
import { useDevSlots } from './slots';

/**
 * The developer section of the "Uygulama" screen (app/(app)/settings/about.tsx): the component
 * gallery, the measurement overlay, fake people on the map, test billing and the crypto benchmark.
 * Only builds that load features/dev/tools.ts have it.
 */
export function DevRows() {
  const { t } = useTranslation();
  const toggleMeasure = useDevSlots((state) => state.toggleOverlay);
  return (
    <SettingsGroup>
      <SettingsRow
        icon={Wrench}
        label={t('dev.ui.link')}
        onPress={() => {
          router.push('/_dev/ui');
        }}
      />
      {toggleMeasure === null ? null : (
        <SettingsRow
          icon={Wrench}
          label={t('dev.measure.link')}
          onPress={() => {
            toggleMeasure();
            router.back();
          }}
        />
      )}
      <SettingsRow
        icon={Wrench}
        label={t('dev.swarm.link')}
        onPress={() => {
          const fix = useMyFix.getState().fix;
          const [lng, lat] = INITIAL_VIEW.center;
          startSwarm(fix ?? { lat, lng });
          router.back();
        }}
      />
      <SettingsRow
        icon={Wrench}
        label={t('dev.billing.link')}
        onPress={() => {
          router.push('/_dev/billing');
        }}
      />
      <SettingsRow
        icon={Wrench}
        label={t('dev.crypto.link')}
        onPress={() => {
          router.push('/_dev/crypto');
        }}
      />
    </SettingsGroup>
  );
}
