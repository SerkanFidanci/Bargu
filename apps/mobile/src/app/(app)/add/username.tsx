import { normalizeUsername, USERNAME_PATTERN } from '@bargu/schemas';
import { useQuery } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import { Send, UserX } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ApiError } from '@/features/auth/api-client';
import { circlesApi } from '@/features/circles/circles-api';
import { useCircle, useInviteByUsername } from '@/features/circles/queries';
import { isApiError } from '@/features/errors';
import { radius, space, typingDebounceMs, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Appear } from '@/ui/appear';
import { Avatar } from '@/ui/avatar';
import { Button } from '@/ui/button';
import { Screen } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';

/**
 * Find someone by username and ask them: a friend request, or (with `circle`) an invitation into
 * that group. Their card shows before anything is sent, so a typo never reaches a stranger.
 */
export default function AddByUsernameScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const params = useLocalSearchParams<{ circle?: string }>();
  const circleId = params.circle ?? null;
  const circle = useCircle(circleId ?? '');
  const [input, setInput] = useState('');
  const username = normalizeUsername(input);
  const [settled, setSettled] = useState(username);
  const send = useInviteByUsername(circleId);
  const [notFound, setNotFound] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(username);
    }, typingDebounceMs);
    return () => {
      clearTimeout(timer);
    };
  }, [username]);

  const wellFormed = USERNAME_PATTERN.test(settled);
  const profile = useQuery({
    queryKey: ['profile', settled],
    queryFn: () => circlesApi.profile(settled),
    enabled: wellFormed && settled === username,
    staleTime: 30_000,
    gcTime: 60_000,
    retry: false,
  });
  const missing =
    notFound === username ||
    (profile.error instanceof ApiError && profile.error.code === 'NOT_FOUND');
  const found = profile.data?.username === username ? profile.data : undefined;

  const submit = () => {
    if (found === undefined) return;
    send.mutate(found.username, {
      onSuccess: () => {
        toast.success(
          circleId === null
            ? t('add.username.sent', { name: found.displayName ?? found.username })
            : t('add.username.invited', { name: found.displayName ?? found.username }),
        );
        router.back();
      },
      onError: (error) => {
        if (isApiError(error, 'NOT_FOUND')) setNotFound(found.username);
      },
    });
  };

  return (
    <Screen
      title={circleId === null ? t('sheets.add.byUsername') : t('add.username.inviteTitle')}
      subtitle={circle?.name ?? undefined}
      footer={
        <Button
          testID="send-request"
          label={circleId === null ? t('add.username.send') : t('add.username.invite')}
          icon={Send}
          onPress={submit}
          disabled={found === undefined || missing}
          loading={send.isPending}
        />
      }
    >
      <Appear index={0}>
        <TextField
          label={t('onboarding.username.label')}
          prefix="@"
          value={input}
          onChangeText={setInput}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
          maxLength={21}
          helper={t('add.username.helper')}
        />
      </Appear>
      <View style={styles.result}>
        {username.length === 0 || !USERNAME_PATTERN.test(username) ? null : missing ? (
          <Animated.View key="missing" entering={motion.pop} style={styles.missing}>
            <UserX color={colors.textMuted} size={28} />
            <Text variant="callout" color="textMuted" align="center">
              {t('add.username.notFound')}
            </Text>
          </Animated.View>
        ) : found === undefined ? (
          <View style={[styles.card, { backgroundColor: colors.surface }]}>
            <Skeleton width={64} height={64} round />
            <View style={styles.cardText}>
              <Skeleton width="70%" height={space.xl} />
              <Skeleton width="40%" height={space.lg} />
            </View>
          </View>
        ) : (
          <Animated.View
            key={found.username}
            entering={motion.pop}
            style={[styles.card, { backgroundColor: colors.surface }]}
          >
            <Avatar avatar={found.avatar} name={found.displayName ?? found.username} size="lg" />
            <View style={styles.cardText}>
              <Text variant="title2" numberOfLines={1}>
                {found.displayName ?? `@${found.username}`}
              </Text>
              <Text variant="callout" color="textMuted">{`@${found.username}`}</Text>
            </View>
          </Animated.View>
        )}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  result: { minHeight: 96 },
  missing: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    padding: space.lg,
    borderRadius: radius.lg,
  },
  cardText: { flex: 1, gap: space.xs },
});
