import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { errorMessage, isApiError } from '@/features/errors';
import { guardianTokenFrom } from '@/features/guardians/guardian-link';
import { guardiansApi, guardiansKey } from '@/features/guardians/guardians-api';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * A parent opened the child's code (docs/ADR/0023 §4): whose it is, what being their parent shows
 * and what it does not, then the parent's yes. The child says the last one on their phone.
 */
export default function GuardianOfferScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ token: string }>();
  const token = guardianTokenFrom(`bargu://g/${params.token}`);
  const preview = useQuery({
    queryKey: ['guardian-preview', token],
    queryFn: () => guardiansApi.preview(token ?? ''),
    enabled: token !== null,
    retry: false,
  });
  const accept = useMutation({
    mutationFn: () => guardiansApi.accept(token ?? ''),
    onSuccess: () => {
      toast.success(t('guardians.accepted'));
      void queryClient.invalidateQueries({ queryKey: guardiansKey });
      router.replace('/guardians');
    },
    onError: (error) => {
      toast.error(problem(error));
    },
  });

  function problem(error: unknown): string {
    if (isApiError(error, 'INVITE_INVALID')) return t('guardians.codeInvalid');
    if (isApiError(error, 'GUARDIAN_ADULT_ONLY')) return t('guardians.adultOnly');
    if (isApiError(error, 'GUARDIAN_LIMIT')) return t('guardians.limit');
    if (isApiError(error, 'ALREADY_GUARDIAN')) return t('guardians.already');
    return errorMessage(error, t);
  }

  const child = preview.data?.child;
  const name = child === undefined ? '' : (child.displayName ?? `@${child.username}`);

  return (
    <Screen
      title={t('guardians.offerTitle')}
      testID="guardian-offer"
      footer={
        child === undefined ? undefined : (
          <>
            <Button
              testID="guardian-accept"
              label={t('guardians.acceptAction')}
              loading={accept.isPending}
              onPress={() => {
                accept.mutate();
              }}
            />
            <Button
              label={t('common.cancel')}
              variant="secondary"
              onPress={() => {
                router.back();
              }}
            />
          </>
        )
      }
    >
      {token === null || preview.isError ? (
        <Text variant="callout" color="danger">
          {token === null ? t('guardians.codeInvalid') : problem(preview.error)}
        </Text>
      ) : child === undefined ? (
        <Skeleton width="100%" height={72} />
      ) : (
        <View style={[styles.card, { backgroundColor: colors.surface }]}>
          <View style={styles.who}>
            <Avatar avatar={child.avatar} name={name} size="lg" />
            <Text variant="bodyStrong">{t('guardians.offerBody', { name })}</Text>
          </View>
          <Text variant="bodyStrong">{t('guardians.seesTitle')}</Text>
          <Text variant="callout" color="textMuted">
            {t('guardians.sees')}
          </Text>
          <Text variant="bodyStrong">{t('guardians.notSeesTitle')}</Text>
          <Text variant="callout" color="textMuted">
            {t('guardians.notSees')}
          </Text>
        </View>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  who: { flexDirection: 'row', alignItems: 'center', gap: space.md },
});
