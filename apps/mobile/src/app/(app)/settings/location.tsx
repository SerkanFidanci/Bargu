import { router } from 'expo-router';
import { Eye, History } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/auth-store';
import { useCircles } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import { seersOf, useSharing } from '@/features/location/sharing';
import { GhostControl } from '@/features/location/sharing-card';
import { Screen } from '@/ui/screen';
import { SettingsGroup, SettingsRow } from '@/ui/settings-row';
import { Text } from '@/ui/text';

/**
 * "Konum ve gizlilik" (from Me, the first of its rows): the ghost for every circle at once, who
 * sees the location now, and the location history. What one circle gets is set on its own screen.
 */
export default function LocationSettingsScreen() {
  const { t } = useTranslation();
  const sharing = useSharing();
  const myUserId = useAuth((state) => state.userId);
  const now = useNow();
  const seers = seersOf(useCircles().data ?? [], sharing, myUserId, now).length;
  const historyCircles = Object.values(sharing.circles).filter(
    (circle) => circle.history === true,
  ).length;
  return (
    <Screen title={t('sheets.me.sectionLocation')} testID="location-settings">
      <GhostControl />
      <SettingsGroup>
        <SettingsRow
          testID="location-seers"
          icon={Eye}
          label={t('sheets.me.seers')}
          detail={
            sharing.ghost !== 'off'
              ? t('sheets.me.seersGhost')
              : seers === 0
                ? t('sheets.me.seersNone')
                : t('sheets.me.seersCount', { count: seers })
          }
          onPress={() => {
            router.push('/seers');
          }}
        />
        <SettingsRow
          testID="location-history"
          icon={History}
          label={t('sheets.me.history')}
          detail={
            historyCircles === 0
              ? t('sheets.me.historyOff')
              : t('sheets.me.historyOn', { count: historyCircles })
          }
          onPress={() => {
            router.push('/history/viewers');
          }}
        />
      </SettingsGroup>
      <Text variant="footnote" color="textMuted">
        {t('settingsLocation.perCircle')}
      </Text>
    </Screen>
  );
}
