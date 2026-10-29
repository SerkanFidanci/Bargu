import { router } from 'expo-router';
import { Eye, History } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { useAuth } from '@/features/auth/auth-store';
import { useCircles } from '@/features/circles/queries';
import { OWN_HISTORY_ENABLED } from '@/features/history/own/own-flag';
import { ownTrail } from '@/features/history/own/own-session';
import { useBackgroundLiveSlots } from '@/features/location/background-live/slot';
import { useNow } from '@/features/location/clock';
import { seersOf, useSharing } from '@/features/location/sharing';
import { GhostControl } from '@/features/location/sharing-card';
import { isVaultOpen } from '@/features/storage/vault';
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
  // One's own history (docs/ADR/0030), from package D: on or off, and how long it keeps.
  const mine = OWN_HISTORY_ENABLED && isVaultOpen() ? ownTrail.settings() : null;
  // Only builds that have background live mode (docs/ADR/0028 step 3) fill this.
  const backgroundLiveRow = useBackgroundLiveSlots((state) => state.settingsRow);
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
              ? t(
                  sharing.ghost === 'freeze'
                    ? 'location.ghost.statusFreeze'
                    : 'location.ghost.statusHide',
                )
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
          label={OWN_HISTORY_ENABLED ? t('history.mine.title') : t('sheets.me.history')}
          detail={
            mine !== null
              ? mine.on
                ? t(mine.keep === 365 ? 'history.mine.onYear' : 'history.mine.on30')
                : t('history.mine.off')
              : historyCircles === 0
                ? t('sheets.me.historyOff')
                : t('sheets.me.historyOn', { count: historyCircles })
          }
          onPress={() => {
            router.push(OWN_HISTORY_ENABLED ? '/history/mine' : '/history/viewers');
          }}
        />
      </SettingsGroup>
      {backgroundLiveRow}
      <Text variant="footnote" color="textMuted">
        {t('settingsLocation.perCircle')}
      </Text>
    </Screen>
  );
}
