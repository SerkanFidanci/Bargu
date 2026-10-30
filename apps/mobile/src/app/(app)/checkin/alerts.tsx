import { toBase64url } from '@bargu/crypto';
import { router } from 'expo-router';
import { Check, MapPin, MessageCircle, TriangleAlert } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { minutesAgo, type ReceivedAlert } from '@/features/checkin/checkin-model';
import { ackAlert, fetchAlerts, nameOf, useAlerts } from '@/features/checkin/checkin-session';
import { Emergency } from '@/features/checkin/emergency';
import { useCircles } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import { clockOf } from '@/features/location/person-share';
import { showSpot } from '@/features/social/safe-spot';
import { space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Card } from '@/ui/card';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** A check's id as a message id the map's spot takes (16 bytes, base64url). */
function spotIdOf(checkinId: string): string {
  const hex = checkinId.replaceAll('-', '');
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 16; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return toBase64url(bytes);
}

/**
 * Safety alerts that came to this person (docs/ADR/0039 §8): who did not answer their arrival check,
 * where they were going, their last location and how old it is, their battery and note; if it came
 * early, that too. Opened here only. "Bargu acil servis değildir", 112 and KADES under it.
 */
export default function CheckinAlertsScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const circles = useCircles().data ?? [];
  const alerts = useAlerts((state) => state.alerts);
  const unreadable = useAlerts((state) => state.unreadable);

  useEffect(() => {
    void fetchAlerts().catch(() => undefined);
  }, []);

  const seen = (checkinId: string) => {
    void ackAlert(checkinId).catch(() => {
      toast.error(t('checkin.refused.failed'));
    });
  };
  const onMap = (alert: ReceivedAlert) => {
    const circle = circles.find((each) =>
      each.members.some((member) => member.userId === alert.ownerId),
    );
    if (alert.last === null || circle === undefined) return;
    showSpot({
      id: spotIdOf(alert.checkinId),
      circleId: circle.id,
      userId: alert.ownerId,
      name: nameOf(alert.ownerId),
      lat: alert.last.lat,
      lng: alert.last.lng,
      acc: alert.last.acc,
      bat: alert.bat ?? 0,
      ts: alert.last.ts,
    });
    router.navigate('/');
  };

  return (
    <Screen title={t('checkin.alert.title')} testID="checkin-alerts-screen">
      {alerts.length === 0 && unreadable.length === 0 ? (
        <Text variant="body" color="textMuted">
          {t('checkin.alert.none')}
        </Text>
      ) : null}
      {alerts.map((alert) => {
        const name = nameOf(alert.ownerId);
        const ago = alert.last === null ? null : minutesAgo(alert.last.ts, now);
        return (
          <Card key={alert.checkinId} testID={`checkin-alert-${alert.checkinId}`}>
            <View style={styles.head}>
              <TriangleAlert color={colors.danger} size={24} strokeWidth={2.25} />
              <Text variant="headline" style={styles.flex}>
                {t('checkin.alert.headline', { name, time: clockOf(alert.due, i18n.language) })}
              </Text>
            </View>
            {alert.early ? (
              <Text variant="footnote" color="danger" testID="checkin-alert-early">
                {t('checkin.alert.early', {
                  time: clockOf(alert.due + alert.grace * 60_000, i18n.language),
                })}
              </Text>
            ) : null}
            {alert.place === null ? null : (
              <Text variant="body">
                {t('checkin.alert.place', { place: `${alert.place.emoji} ${alert.place.name}` })}
              </Text>
            )}
            <Text variant="body" testID="checkin-alert-last">
              {ago === null
                ? t('checkin.alert.noLast')
                : ago === 0
                  ? t('checkin.alert.lastNow')
                  : t('checkin.alert.last', { minutes: ago })}
              {alert.bat === null
                ? ''
                : ` · ${t('checkin.alert.battery', { level: alert.bat })}, ${
                    alert.chg === true
                      ? t('checkin.alert.charging')
                      : t('checkin.alert.notCharging')
                  }`}
            </Text>
            {alert.note === undefined ? null : (
              <Text variant="body" testID="checkin-alert-note">
                “{alert.note}”
              </Text>
            )}
            <View style={styles.buttons}>
              {alert.last === null ? null : (
                <View style={styles.cell}>
                  <Button
                    testID={`checkin-alert-map-${alert.checkinId}`}
                    label={t('checkin.alert.onMap')}
                    icon={MapPin}
                    variant="secondary"
                    onPress={() => {
                      onMap(alert);
                    }}
                  />
                </View>
              )}
              <View style={styles.cell}>
                <Button
                  testID={`checkin-alert-message-${alert.checkinId}`}
                  label={t('checkin.alert.message')}
                  icon={MessageCircle}
                  variant="secondary"
                  onPress={() => {
                    router.push(`/messages/p:${alert.ownerId}`);
                  }}
                />
              </View>
            </View>
            <Button
              testID={`checkin-alert-seen-${alert.checkinId}`}
              label={t('checkin.alert.seen')}
              icon={Check}
              variant="secondary"
              onPress={() => {
                seen(alert.checkinId);
              }}
            />
          </Card>
        );
      })}
      {unreadable.map((alert) => (
        <Card key={alert.checkinId} testID={`checkin-unreadable-${alert.checkinId}`}>
          <Text variant="body">
            {t('checkin.alert.unreadable', { name: nameOf(alert.ownerId) })}
          </Text>
          <View style={styles.buttons}>
            <View style={styles.cell}>
              <Button
                label={t('checkin.alert.message')}
                icon={MessageCircle}
                variant="secondary"
                onPress={() => {
                  router.push(`/messages/p:${alert.ownerId}`);
                }}
              />
            </View>
            <View style={styles.cell}>
              <Button
                label={t('checkin.alert.seen')}
                icon={Check}
                variant="secondary"
                onPress={() => {
                  seen(alert.checkinId);
                }}
              />
            </View>
          </View>
        </Card>
      ))}
      <Emergency />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', gap: space.sm, alignItems: 'flex-start' },
  flex: { flex: 1 },
  buttons: { flexDirection: 'row', gap: space.sm },
  cell: { flex: 1 },
});
