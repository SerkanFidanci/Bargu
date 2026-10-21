import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, useTheme } from '@/theme';
import { Text } from '@/ui/text';
import { Toggle } from '@/ui/toggle';

import { updateSharing } from '../location-session';
import { backgroundLiveOn, useSharing } from '../sharing';
import { dismissCard } from './notice-card';

/**
 * "Arka planda canlı konum" in the location settings (docs/ADR/0028 step 3): while someone looks
 * at the user on the map, this phone sends its location more often for a few minutes even with
 * the app closed. On for 18+, off for 15-17 until the teen turns it on; no one else can change it
 * (a parent's tools do not carry it, ADR 0023). Seeing it here is the explanation: the card on the
 * map does not come after.
 */
export function BackgroundLiveRow() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const on = backgroundLiveOn(useSharing());
  useEffect(() => {
    dismissCard();
  }, []);
  return (
    <>
      <View
        style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.border }]}
        testID="background-live"
      >
        <Toggle
          testID="background-live-toggle"
          value={on}
          label={t('location.backgroundLive.title')}
          description={t('location.backgroundLive.battery')}
          onChange={(value) => {
            updateSharing((current) => ({ ...current, backgroundLive: value ? 'on' : 'off' }));
          }}
        />
      </View>
      <Text variant="footnote" color="textMuted">
        {t('location.backgroundLive.explain')}
      </Text>
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space.md,
  },
});
