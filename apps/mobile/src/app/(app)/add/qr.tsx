import { useQuery } from '@tanstack/react-query';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { router, useLocalSearchParams } from 'expo-router';
import { RefreshCw, Share2 } from 'lucide-react-native';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, useWindowDimensions, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { circlesApi } from '@/features/circles/circles-api';
import { handleOf, memberName, partnerOf, useCircle, useCircles } from '@/features/circles/queries';
import { errorMessage } from '@/features/errors';
import { useMe } from '@/features/profile/queries';
import { space } from '@/theme';
import { Appear } from '@/ui/appear';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { QrCode } from '@/ui/qr-code';
import { Screen } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

const MAX_QR = 280;

/**
 * "Add me" in person: a one-time code (24 hours) the other phone scans. For a friend code, showing
 * it is the consent: whoever scans it first becomes a friend at once, so screenshots are blocked
 * and the code is fresh on every visit. With `circle`, it invites into that group instead.
 */
export default function ShowQrScreen() {
  usePreventScreenCapture();
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ circle?: string }>();
  const circleId = params.circle ?? null;
  const circle = useCircle(circleId ?? '');
  const me = useMe();
  const myUserId = useAuth((state) => state.userId);
  const circles = useCircles();
  const celebrate = useCelebration((state) => state.celebrate);
  const invite = useQuery({
    queryKey: ['invite', circleId],
    queryFn: () =>
      circlesApi.createInvite(
        circleId === null ? { kind: 'friend' } : { kind: 'circle', circleId },
      ),
    gcTime: 0,
    retry: false,
  });

  // A friend who scans the code shows up through events: celebrate and close.
  const knownPairs = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (circleId !== null || circles.data === undefined) return;
    const pairs = circles.data.filter((c) => c.kind === 'pair' && c.myStatus === 'active');
    if (knownPairs.current === null) {
      knownPairs.current = new Set(pairs.map((c) => c.id));
      return;
    }
    const fresh = pairs.find(
      (c) =>
        knownPairs.current?.has(c.id) === false && c.members.every((m) => m.status === 'active'),
    );
    if (fresh === undefined) return;
    const partner = partnerOf(fresh, myUserId);
    celebrate();
    toast.success(
      t('add.qr.connected', { name: partner === undefined ? '' : memberName(partner) }),
    );
    router.back();
  }, [celebrate, circleId, circles.data, myUserId, t]);

  const size = Math.min(width - space.xxxl * 2, MAX_QR);
  const share = async () => {
    if (invite.data === undefined) return;
    try {
      await Share.share({ message: t('add.shareMessage', { link: invite.data.link }) });
    } catch (error) {
      toast.error(errorMessage(error, t));
    }
  };

  return (
    <Screen
      title={circleId === null ? t('sheets.add.showQr') : t('add.qr.circleTitle')}
      subtitle={circle?.name ?? handleOf(me.data)}
      footer={
        <>
          <Button
            label={t('add.qr.share')}
            icon={Share2}
            variant="secondary"
            onPress={() => void share()}
            disabled={invite.data === undefined}
          />
          <Button
            label={t('add.qr.renew')}
            icon={RefreshCw}
            variant="ghost"
            onPress={() => void invite.refetch()}
            loading={invite.isFetching}
          />
        </>
      }
    >
      <View style={styles.code}>
        {invite.data === undefined ? (
          invite.isError ? (
            <Text variant="callout" color="danger" align="center">
              {errorMessage(invite.error, t)}
            </Text>
          ) : (
            <Skeleton width={size} height={size} />
          )
        ) : (
          <QrCode
            key={invite.data.token}
            value={invite.data.link}
            size={size}
            label={t('add.qr.label')}
          />
        )}
      </View>
      <Appear index={2}>
        <Text variant="callout" color="textMuted" align="center">
          {circleId === null ? t('add.qr.body') : t('add.qr.circleBody')}
        </Text>
      </Appear>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { alignItems: 'center', paddingVertical: space.lg },
});
