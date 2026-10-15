import { type GuardianLink, MAX_GUARDIANS } from '@bargu/schemas';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { ChevronRight, QrCode, ScanLine } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { ageKey, fetchAge, isMinor } from '@/features/account/age-api';
import { errorMessage } from '@/features/errors';
import { guardiansApi, guardiansKey } from '@/features/guardians/guardians-api';
import { radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

const nameOf = (link: GuardianLink) => link.other.displayName ?? `@${link.other.username}`;

/**
 * "Ebeveyn bağlantısı" (docs/ADR/0023 §4): for 15-17, their parents (adding one, the last yes,
 * ending it); for a parent, their children. Nothing hidden: the child sees what the parent sees.
 */
export default function GuardiansScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const queryClient = useQueryClient();
  const links = useQuery({ queryKey: guardiansKey, queryFn: () => guardiansApi.list() });
  const age = useQuery({ queryKey: ageKey, queryFn: fetchAge });
  const teen = isMinor(age.data);
  const parents = links.data?.filter((link) => link.role === 'child') ?? [];
  const children = links.data?.filter((link) => link.role === 'guardian') ?? [];
  const date = (at: number) => new Date(at).toLocaleDateString(i18n.language);

  const confirm = useMutation({
    mutationFn: (linkId: string) => guardiansApi.confirm(linkId),
    onSuccess: () => {
      toast.success(t('guardians.confirmed'));
      void queryClient.invalidateQueries({ queryKey: guardiansKey });
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });
  const end = useMutation({
    mutationFn: (linkId: string) => guardiansApi.end(linkId),
    onSuccess: (result) => {
      toast.info(result.ended ? t('guardians.ended') : t('guardians.endAsked'));
      void queryClient.invalidateQueries({ queryKey: guardiansKey });
    },
    onError: (error) => {
      toast.error(errorMessage(error, t));
    },
  });

  const decline = (link: GuardianLink) => {
    Alert.alert(t('guardians.declineTitle'), t('guardians.declineBody', { name: nameOf(link) }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('guardians.decline'),
        style: 'destructive',
        onPress: () => {
          end.mutate(link.id);
        },
      },
    ]);
  };

  const status = (link: GuardianLink) => {
    if (link.status === 'confirming') {
      return link.role === 'child' ? t('guardians.wantsToBe') : t('guardians.waitingChild');
    }
    if (link.endsAt !== null) return t('guardians.endsOn', { date: date(link.endsAt) });
    return t('guardians.since', { date: date(link.activeAt ?? link.createdAt) });
  };

  const row = (link: GuardianLink) => (
    <View key={link.id} style={[styles.card, { backgroundColor: colors.surface }]}>
      <ListRow
        testID={`guardian-${link.id}`}
        leading={<Avatar avatar={link.other.avatar} name={nameOf(link)} />}
        title={nameOf(link)}
        subtitle={status(link)}
        trailing={
          link.status === 'active' ? <ChevronRight size={20} color={colors.textMuted} /> : null
        }
        onPress={
          link.status === 'active'
            ? () => {
                router.push({ pathname: '/guardians/[id]', params: { id: link.id } });
              }
            : undefined
        }
      />
      {link.status === 'confirming' && link.role === 'child' ? (
        <>
          <Text variant="footnote" color="textMuted">
            {t('guardians.confirmWhat')}
          </Text>
          <Button
            testID={`guardian-confirm-${link.id}`}
            label={t('guardians.confirm')}
            loading={confirm.isPending}
            onPress={() => {
              confirm.mutate(link.id);
            }}
          />
          <Button
            label={t('guardians.decline')}
            variant="secondary"
            onPress={() => {
              decline(link);
            }}
          />
        </>
      ) : null}
      {link.status === 'confirming' && link.role === 'guardian' ? (
        <Button
          label={t('guardians.cancel')}
          variant="secondary"
          loading={end.isPending}
          onPress={() => {
            end.mutate(link.id);
          }}
        />
      ) : null}
    </View>
  );

  return (
    <Screen
      title={t('guardians.title')}
      testID="guardians-screen"
      footer={
        teen && parents.length < MAX_GUARDIANS ? (
          <Button
            testID="guardians-add"
            label={t('guardians.add')}
            icon={QrCode}
            onPress={() => {
              router.push('/guardians/code');
            }}
          />
        ) : !teen ? (
          <Button
            testID="guardians-scan"
            label={t('guardians.scan')}
            icon={ScanLine}
            variant="secondary"
            onPress={() => {
              router.push('/add/scan');
            }}
          />
        ) : undefined
      }
    >
      <View style={[styles.card, { backgroundColor: colors.surface }]}>
        <Text variant="callout" color="textMuted">
          {teen ? t('guardians.childIntro') : t('guardians.parentIntro')}
        </Text>
      </View>
      {links.data === undefined ? (
        links.isError ? (
          <Text variant="callout" color="danger">
            {errorMessage(links.error, t)}
          </Text>
        ) : (
          <Skeleton width="100%" height={72} />
        )
      ) : null}
      {parents.length > 0 ? (
        <>
          <SectionTitle>{t('guardians.parents')}</SectionTitle>
          {parents.map(row)}
        </>
      ) : null}
      {children.length > 0 ? (
        <>
          <SectionTitle>{t('guardians.children')}</SectionTitle>
          {children.map(row)}
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.sm, padding: space.lg, borderRadius: radius.lg },
});
