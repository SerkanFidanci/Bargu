import { type GuardianView } from '@bargu/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { errorMessage } from '@/features/errors';
import { GuardianTools } from '@/features/guardians/guardian-tools';
import { guardiansApi, guardiansKey, guardianViewKey } from '@/features/guardians/guardians-api';
import { radius, space, useTheme } from '@/theme';
import { Button } from '@/ui/button';
import { Screen, SectionTitle } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

type Circles = GuardianView['circles'];

/**
 * What the parent sees (docs/ADR/0023 §4), and the child sees the very same screen: the age band,
 * since when, everyone who could see the child's location, and the guardian tools (minutes open,
 * what waits for a yes, the settings). Never the location itself.
 */
export default function GuardianViewScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const { id } = useLocalSearchParams<{ id: string }>();
  const view = useQuery({ queryKey: guardianViewKey(id), queryFn: () => guardiansApi.view(id) });
  const end = useMutation({
    mutationFn: () => guardiansApi.end(id),
    onSuccess: (result) => {
      toast.info(result.ended ? t('guardians.ended') : t('guardians.endAsked'));
      void queryClient.invalidateQueries({ queryKey: guardiansKey });
      if (result.ended) router.back();
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });

  const data = view.data;
  const link = data?.link;
  const child = link?.role === 'child';
  const date = (at: number) => new Date(at).toLocaleDateString(i18n.language);
  const childName = data === undefined ? '' : (data.child.displayName ?? `@${data.child.username}`);
  const parentName =
    link === undefined ? '' : (link.other.displayName ?? `@${link.other.username}`);

  const askEnd = () => {
    if (link === undefined) return;
    const [title, body] =
      link.role === 'guardian'
        ? [t('guardians.endTitle'), t('guardians.endBodyParent', { name: childName })]
        : [t('guardians.endTitle'), t('guardians.endBodyChild', { name: parentName })];
    Alert.alert(title, body, [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('guardians.end'),
        style: 'destructive',
        onPress: () => {
          end.mutate();
        },
      },
    ]);
  };

  const people = (circles: Circles) =>
    circles.map((circle, index) => {
      // Someone who came in lately is marked new (PM decision on QA 5c F-2).
      const names = circle.members.map((member) => {
        const name = member.displayName ?? t('guardians.unnamed');
        return member.isNew ? t('guardians.newMember', { name }) : name;
      });
      return (
        <View
          key={`${circle.kind}-${String(index)}`}
          style={[styles.card, { backgroundColor: colors.surface }]}
        >
          <Text variant="bodyStrong">{circle.name ?? names[0] ?? t('guardians.friend')}</Text>
          <Text variant="footnote" color="textMuted">
            {circle.kind === 'pair'
              ? t('guardians.friendship')
              : t('guardians.circleOf', { names: names.join(', ') })}
          </Text>
        </View>
      );
    });

  const footer =
    link === undefined ? undefined : link.role === 'guardian' ? (
      <Button
        testID="guardian-end"
        label={link.endsAt === null ? t('guardians.end') : t('guardians.agreeEnd')}
        variant="danger"
        loading={end.isPending}
        onPress={askEnd}
      />
    ) : link.endsAt === null ? (
      <Button
        testID="guardian-end"
        label={t('guardians.askEnd')}
        variant="secondary"
        loading={end.isPending}
        onPress={askEnd}
      />
    ) : undefined;

  return (
    <Screen
      title={child ? t('guardians.seenTitle') : childName}
      subtitle={child ? t('guardians.seenBy', { name: parentName }) : undefined}
      testID="guardian-view"
      footer={footer}
    >
      {data === undefined || link === undefined ? (
        view.isError ? (
          <Text variant="callout" color="danger">
            {errorMessage(view.error, t)}
          </Text>
        ) : (
          <Skeleton width="100%" height={120} />
        )
      ) : (
        <>
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Text variant="callout">
              {t('guardians.ageBand', {
                band: data.ageBand === '15-17' ? t('age.teen') : t('age.adult'),
              })}
            </Text>
            <Text variant="footnote" color="textMuted">
              {t('guardians.since', { date: date(link.activeAt ?? link.createdAt) })}
            </Text>
            {link.endsAt === null ? null : (
              <Text variant="footnote" color="danger">
                {link.role === 'guardian'
                  ? t('guardians.childAskedEnd', { date: date(link.endsAt) })
                  : t('guardians.endsOn', { date: date(link.endsAt) })}
              </Text>
            )}
          </View>
          <SectionTitle>{t('guardians.whoSees')}</SectionTitle>
          {data.circles.length === 0 ? (
            <Text variant="callout" color="textMuted">
              {t('guardians.noCircles')}
            </Text>
          ) : (
            people(data.circles)
          )}
          <Text variant="footnote" color="textMuted">
            {t('guardians.notSees')}
          </Text>
          <GuardianTools view={data} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.xs, padding: space.lg, borderRadius: radius.lg },
});
