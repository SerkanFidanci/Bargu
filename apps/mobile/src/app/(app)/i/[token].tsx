import { useMutation, useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Check, LinkIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { circlesApi } from '@/features/circles/circles-api';
import { inviteTokenFrom } from '@/features/circles/invite-link';
import { errorMessage, isApiError } from '@/features/errors';
import { endClock } from '@/features/circles/event-ui';
import { useNow } from '@/features/location/clock';
import { circleSync } from '@/features/live/live-session';
import { space } from '@/theme';
import { feedback } from '@/theme/haptics';
import { useMotion } from '@/theme/use-motion';
import { Appear } from '@/ui/appear';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { EmptyState } from '@/ui/empty-state';
import { Screen } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/**
 * An invite link or scanned code: who invites, to what, and a clear yes or no. Nothing is joined or
 * shared until the user accepts here.
 */
export default function InviteScreen() {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const motion = useMotion();
  const params = useLocalSearchParams<{ token: string }>();
  // Links arrive from outside the app: the token is checked like any other input.
  const token = inviteTokenFrom(`bargu://i/${params.token}`);
  const celebrate = useCelebration((state) => state.celebrate);
  const preview = useQuery({
    queryKey: ['invite-preview', token],
    queryFn: () => circlesApi.previewInvite(token ?? ''),
    enabled: token !== null,
    retry: false,
    gcTime: 0,
  });
  const accept = useMutation({
    mutationFn: async () => {
      const circleId = await circlesApi.acceptInvite(token ?? '');
      await circleSync.refresh(circleId).catch(() => undefined);
      return circleId;
    },
    onSuccess: (circleId) => {
      feedback('success');
      celebrate();
      router.replace({ pathname: '/circle/[id]', params: { id: circleId } });
    },
    onError: (error) => {
      feedback('error');
      if (isApiError(error, 'INVITE_INVALID')) toast.error(t('invite.invalid'));
      else if (isApiError(error, 'ALREADY_MEMBER')) toast.info(t('invite.already'));
      else if (isApiError(error, 'CIRCLE_FULL')) toast.error(t('circles.errors.full'));
      else toast.error(errorMessage(error, t));
    },
  });

  const close = () => {
    router.back();
  };

  if (token === null || (preview.isError && isApiError(preview.error, 'INVITE_INVALID'))) {
    return (
      <Screen title={t('invite.title')}>
        <EmptyState
          icon={LinkIcon}
          title={t('invite.invalid')}
          body={t('invite.invalidBody')}
          action={{ label: t('common.close'), onPress: close }}
        />
      </Screen>
    );
  }

  const data = preview.data;
  const inviterName =
    data === undefined ? '' : (data.inviter.displayName ?? `@${data.inviter.username}`);
  return (
    <Screen
      title={t('invite.title')}
      footer={
        <>
          <Button
            testID="accept-invite"
            label={data?.kind === 'circle' ? t('invite.join') : t('invite.befriend')}
            icon={Check}
            onPress={() => {
              accept.mutate();
            }}
            disabled={data === undefined}
            loading={accept.isPending}
            haptic={undefined}
          />
          <Button label={t('common.cancel')} variant="ghost" onPress={close} />
        </>
      }
    >
      <View style={styles.hero}>
        {data === undefined ? (
          preview.isError ? (
            <Text variant="callout" color="danger" align="center">
              {errorMessage(preview.error, t)}
            </Text>
          ) : (
            <>
              <Skeleton width={96} height={96} round />
              <Skeleton width="70%" height={space.xl} />
            </>
          )
        ) : (
          <>
            <Animated.View entering={motion.pop}>
              <Avatar avatar={data.inviter.avatar} name={inviterName} size="xl" />
            </Animated.View>
            <Appear index={1}>
              <Text variant="title1" align="center">
                {data.circle === null
                  ? t('invite.friendTitle', { name: inviterName })
                  : t('invite.circleTitle', { name: inviterName, circle: data.circle.name ?? '' })}
              </Text>
            </Appear>
            {data.circle === null ? null : (
              <Appear index={2}>
                <Text variant="callout" color="textMuted" align="center">
                  {t('circles.sheet.memberCount', { count: data.circle.memberCount })}
                </Text>
              </Appear>
            )}
            {data.circle?.expiresAt === undefined ? null : (
              <Appear index={2}>
                <Text variant="bodyStrong" align="center">
                  {t('invite.eventEnds', {
                    time: endClock(data.circle.expiresAt, now, i18n.language),
                  })}
                </Text>
              </Appear>
            )}
            <Appear index={3}>
              <Text variant="callout" color="textMuted" align="center">
                {data.circle?.expiresAt === undefined ? t('invite.body') : t('invite.eventBody')}
              </Text>
            </Appear>
          </>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.lg, paddingTop: space.xl },
});
