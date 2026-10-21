import { router } from 'expo-router';
import { Map as MapIcon, Smartphone, Wrench } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { DEV_TOOLS_ENABLED, env } from '@/config/env';
import { startSwarm } from '@/features/dev/map-swarm';
import { useDevSlots } from '@/features/dev/slots';
import { useMyFix } from '@/features/location/engine';
import { INITIAL_VIEW } from '@/features/map/style';
import { useMe } from '@/features/profile/queries';
import { Screen } from '@/ui/screen';
import { SettingsGroup, SettingsRow } from '@/ui/settings-row';
import { Text } from '@/ui/text';

/** Licence page of the map data (ODbL), the credit's permanent home. */
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/**
 * "Uygulama" (from Me): this phone, the map data's licence and the version; in development and
 * preview builds also the developer tools.
 */
export default function AboutScreen() {
  const { t } = useTranslation();
  const me = useMe().data;
  const toggleMeasure = useDevSlots((state) => state.toggleOverlay);
  return (
    <Screen title={t('sheets.me.sectionApp')} testID="about-screen">
      <SettingsGroup>
        <SettingsRow
          icon={Smartphone}
          label={t('sheets.me.device')}
          detail={
            me?.device.attested === true
              ? t('sheets.me.deviceAttested')
              : t('sheets.me.deviceNotAttested')
          }
        />
        <SettingsRow
          icon={MapIcon}
          label={t('sheets.me.mapData')}
          detail={t('sheets.me.mapDataDetail')}
          onPress={() => void Linking.openURL(OSM_COPYRIGHT_URL)}
        />
      </SettingsGroup>
      {DEV_TOOLS_ENABLED ? (
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
            label={t('home.devTools')}
            onPress={() => {
              router.push('/_dev/crypto');
            }}
          />
        </SettingsGroup>
      ) : null}
      <Text variant="caption" color="textMuted" align="center">
        {t('sheets.me.version', { version: env.appVersion })}
      </Text>
    </Screen>
  );
}
