import { Bell, BellOff, MapPin } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { loadMuteSettings, updateMutes } from '@/features/notifications/mute-session';
import { useMutes, withPersonMuted, withPlaceMuted } from '@/features/notifications/mutes';
import { usePushState } from '@/features/notifications/push';
import { askForPush } from '@/features/notifications/use-push';
import { usePlaces } from '@/features/places/places';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';

/**
 * "Bildirim tercihleri" (UX düzeni 9, from Me): whether this phone gets Bargu's notifications (the
 * system's switch, which only the phone's settings change once refused), and who and which places
 * are silenced here, each with its sound back a tap away. Mutes stay on this phone (mutes.ts).
 */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const push = usePushState((state) => state.state);
  loadMuteSettings();
  const mutes = useMutes();
  const circles = useCircles().data ?? [];
  const places = usePlaces();
  const cardOf = (userId: string) =>
    circles.flatMap((circle) => circle.members).find((member) => member.userId === userId);
  const people = Object.entries(mutes.people);
  const silencedPlaces = Object.keys(mutes.places);

  return (
    <Screen title={t('notificationPrefs.title')} testID="notifications-screen">
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <View style={styles.head}>
          {push === 'enabled' ? (
            <Bell color={colors.primary} size={22} strokeWidth={2.25} />
          ) : (
            <BellOff color={colors.textMuted} size={22} strokeWidth={2.25} />
          )}
          <Text variant="bodyStrong" style={styles.flex}>
            {t(`notificationPrefs.push_${push}`)}
          </Text>
        </View>
        <Text variant="footnote" color="textMuted">
          {t('notificationPrefs.pushHint')}
        </Text>
        {push === 'undetermined' ? (
          <Button
            testID="push-allow"
            label={t('notificationPrefs.allow')}
            icon={Bell}
            onPress={() => void askForPush()}
          />
        ) : push === 'unavailable' ? null : (
          <Button
            testID="push-settings"
            label={t('notificationPrefs.settings')}
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        )}
      </View>

      <SectionTitle>{t('notificationPrefs.people')}</SectionTitle>
      {people.length === 0 && silencedPlaces.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={t('notificationPrefs.noneTitle')}
          body={t('notificationPrefs.noneBody')}
        />
      ) : null}
      {people.map(([userId, muted]) => {
        const card = cardOf(userId);
        const name = card === undefined ? t('notificationPrefs.someone') : memberName(card);
        const what = [
          muted.places ? t('notificationPrefs.comings') : null,
          muted.pokes ? t('notificationPrefs.pokes') : null,
        ]
          .filter((part) => part !== null)
          .join(' · ');
        return (
          <ListRow
            key={userId}
            testID={`muted-${userId}`}
            leading={<Avatar avatar={card?.avatar ?? null} name={name} userId={userId} size="sm" />}
            title={name}
            subtitle={what}
            trailing={
              <Button
                testID={`unmute-${userId}`}
                label={t('notificationPrefs.unmute')}
                accessibilityHint={t('notificationPrefs.unmuteLabel', { name })}
                variant="secondary"
                fill={false}
                onPress={() => {
                  updateMutes((all) =>
                    withPersonMuted(all, userId, { places: false, pokes: false }),
                  );
                }}
              />
            }
          />
        );
      })}
      {silencedPlaces.length === 0 ? null : (
        <SectionTitle>{t('notificationPrefs.places')}</SectionTitle>
      )}
      {silencedPlaces.map((placeId) => {
        const place = places[placeId];
        const name =
          place === undefined ? t('notificationPrefs.somePlace') : `${place.emoji} ${place.name}`;
        return (
          <ListRow
            key={placeId}
            testID={`muted-place-${placeId}`}
            leading={<MapPin color={colors.textMuted} size={22} strokeWidth={2.25} />}
            title={name}
            subtitle={t('notificationPrefs.comings')}
            trailing={
              <Button
                testID={`unmute-place-${placeId}`}
                label={t('notificationPrefs.unmute')}
                accessibilityHint={t('notificationPrefs.unmuteLabel', { name })}
                variant="secondary"
                fill={false}
                onPress={() => {
                  updateMutes((all) => withPlaceMuted(all, placeId, false));
                }}
              />
            }
          />
        );
      })}
      <Text variant="footnote" color="textMuted">
        {t('notificationPrefs.howTo')}
      </Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { padding: space.lg, borderRadius: radius.lg, gap: space.sm },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
