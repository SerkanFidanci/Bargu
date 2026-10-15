import { router } from 'expo-router';
import { EyeOff } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName, partnerOf } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { historyAudience } from '@/features/history/viewers';
import { setHistory } from '@/features/location/location-session';
import { useSharing } from '@/features/location/sharing';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * "Geçmişimi kim görüyor" (BARGU_PLAN, docs/ADR/0019): every circle the user's location history
 * goes to, and the people there who can see it, each circle off with one tap.
 */
export default function HistoryViewersScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const settings = useSharing();
  const [turning, setTurning] = useState<string | null>(null);
  const audience = me === null ? [] : historyAudience(circles, settings, me);

  const turnOff = async (circleId: string) => {
    setTurning(circleId);
    const result = await setHistory(circleId, false);
    setTurning(null);
    toast.success(
      result === 'later' ? t('location.sharing.historyOffLater') : t('location.sharing.historyOff'),
    );
  };

  return (
    <Screen title={t('history.viewersTitle')} testID="history-viewers">
      {audience.length === 0 ? (
        <EmptyState
          icon={EyeOff}
          title={t('history.viewersEmpty')}
          body={t('history.viewersEmptyBody')}
          action={{
            label: t('common.close'),
            onPress: () => {
              router.back();
            },
          }}
        />
      ) : (
        <>
          <Text variant="callout" color="textMuted">
            {t('history.viewersHint')}
          </Text>
          {audience.map(({ circle, viewers }) => {
            const partner = circle.kind === 'pair' ? partnerOf(circle, me) : undefined;
            const title = partner === undefined ? (circle.name ?? '') : memberName(partner);
            return (
              <View
                key={circle.id}
                style={[styles.card, { backgroundColor: colors.surface }]}
                testID={`history-audience-${circle.id}`}
              >
                <SectionTitle>{title}</SectionTitle>
                {viewers.length === 0 ? (
                  <Text variant="body" color="textMuted">
                    {t('location.sharing.historyNobody')}
                  </Text>
                ) : (
                  viewers.map((member) => (
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
                  ))
                )}
                <Button
                  testID={`history-off-${circle.id}`}
                  label={t('history.turnOff')}
                  icon={EyeOff}
                  variant="secondary"
                  loading={turning === circle.id}
                  onPress={() => {
                    void turnOff(circle.id);
                  }}
                />
              </View>
            );
          })}
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
});
