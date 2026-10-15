import { router } from 'expo-router';
import { EyeOff, Ghost, History, Play, Square } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName, partnerOf } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { historyAudience } from '@/features/history/viewers';
import { useNow } from '@/features/location/clock';
import { forgetAllHistory, resumeSharing, stopSharing } from '@/features/location/location-session';
import { circleSharing, seersByCircle, useSharing } from '@/features/location/sharing';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * "Seni görenler" (BARGU_PLAN §2, Faz 9): who sees this phone's location right now, circle by
 * circle, and who sees its history; one tap stops it all ("Tümünü durdur": the location leaves
 * every map, nothing more is sent or written), one more brings it back. Deleting the history too
 * asks first: it cannot be undone.
 */
export default function SeersScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const settings = useSharing();
  const now = useNow();
  const [deleting, setDeleting] = useState(false);
  const stopped = settings.ghost !== 'off';
  const groups = me === null ? [] : seersByCircle(circles, settings, me, now);
  const people = new Set(groups.flatMap(({ seers }) => seers.map((member) => member.userId)));
  const history = me === null ? [] : historyAudience(circles, settings, me);
  const historyPeople = new Set(
    history.flatMap(({ viewers }) => viewers.map((member) => member.userId)),
  );

  const stop = () => {
    stopSharing();
    toast.success(t('seers.stopped'));
  };
  const resume = () => {
    resumeSharing();
    toast.success(t('seers.resumed'));
  };
  const deleteHistory = () => {
    Alert.alert(t('seers.deleteHistoryTitle'), t('seers.deleteHistoryBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('seers.deleteHistory'),
        style: 'destructive',
        onPress: () => {
          setDeleting(true);
          void forgetAllHistory().then((result) => {
            setDeleting(false);
            toast.success(
              result === 'later'
                ? t('location.sharing.historyOffLater')
                : t('location.sharing.historyOff'),
            );
          });
        },
      },
    ]);
  };

  return (
    <Screen title={t('seers.title')} testID="seers-screen">
      {stopped ? (
        <View style={[styles.card, { backgroundColor: colors.primarySoft }]}>
          <View style={styles.head}>
            <Ghost color={colors.primary} size={22} strokeWidth={2.25} />
            <Text variant="bodyStrong" style={styles.flex}>
              {t('seers.stoppedTitle')}
            </Text>
          </View>
          <Text variant="callout" color="textMuted">
            {t(`location.ghost.${settings.ghost}Detail`)}
          </Text>
          <Button testID="seers-resume" label={t('seers.resume')} icon={Play} onPress={resume} />
        </View>
      ) : (
        <>
          {groups.length === 0 ? (
            <EmptyState icon={EyeOff} title={t('seers.nobody')} body={t('seers.nobodyBody')} />
          ) : (
            <>
              <Text variant="callout" color="textMuted">
                {t('seers.summary', { count: people.size, circles: groups.length })}
              </Text>
              {groups.map(({ circle, seers }) => {
                const partner = circle.kind === 'pair' ? partnerOf(circle, me) : undefined;
                const title = partner === undefined ? (circle.name ?? '') : memberName(partner);
                const precision = circleSharing(settings, circle.id).precision;
                return (
                  <View
                    key={circle.id}
                    style={[styles.card, { backgroundColor: colors.surface }]}
                    testID={`seers-circle-${circle.id}`}
                  >
                    <SectionTitle>{title}</SectionTitle>
                    <Text variant="footnote" color="textMuted">
                      {t(`location.precision.${precision}Detail`)}
                    </Text>
                    {seers.map((member) => (
                      <ListRow
                        key={member.userId}
                        leading={
                          <Avatar
                            avatar={member.avatar}
                            name={memberName(member)}
                            userId={member.userId}
                            size="sm"
                          />
                        }
                        title={memberName(member)}
                      />
                    ))}
                  </View>
                );
              })}
            </>
          )}
          <Button
            testID="seers-stop-all"
            label={t('seers.stopAll')}
            icon={Square}
            variant="danger"
            onPress={stop}
          />
          <Text variant="footnote" color="textMuted">
            {t('seers.stopAllHint')}
          </Text>
        </>
      )}

      {history.length > 0 ? (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.head}>
            <History color={colors.primary} size={22} strokeWidth={2.25} />
            <Text variant="bodyStrong" style={styles.flex}>
              {t('seers.history', { count: historyPeople.size, circles: history.length })}
            </Text>
          </View>
          <Button
            label={t('seers.historyWho')}
            variant="secondary"
            onPress={() => {
              router.push('/history/viewers');
            }}
          />
          <Button
            testID="seers-delete-history"
            label={t('seers.deleteHistory')}
            icon={EyeOff}
            variant="secondary"
            loading={deleting}
            onPress={deleteHistory}
          />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  head: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
