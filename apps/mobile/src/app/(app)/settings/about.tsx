import { Map as MapIcon, Smartphone } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { env } from '@/config/env';
import { useDevSlots } from '@/features/dev/slots';
import { useMe } from '@/features/profile/queries';
import { Screen } from '@/ui/screen';
import { SettingsGroup, SettingsRow } from '@/ui/settings-row';
import { Text } from '@/ui/text';

/** Licence page of the map data (ODbL), the credit's permanent home. */
const OSM_COPYRIGHT_URL = 'https://www.openstreetmap.org/copyright';

/**
 * "Uygulama" (from Me): this phone, the map data's licence and the version; in development and
 * preview builds also the developer tools (features/dev/tools.ts puts them in a slot).
 */
export default function AboutScreen() {
  const { t } = useTranslation();
  const me = useMe().data;
  const devRows = useDevSlots((state) => state.aboutRows);
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
      {devRows}
      <Text variant="caption" color="textMuted" align="center">
        {t('sheets.me.version', { version: env.appVersion })}
      </Text>
    </Screen>
  );
}
