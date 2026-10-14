import { router, useLocalSearchParams } from 'expo-router';
import { AtSign, QrCode, Send, Share2, Users } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';

import { circlesApi } from '@/features/circles/circles-api';
import { FriendPicker } from '@/features/circles/friend-picker';
import type { Friend } from '@/features/circles/names';
import { useCircle, useFriends, useInviteFriends } from '@/features/circles/queries';
import { errorMessage } from '@/features/errors';
import { radius, space, touchTarget, useTheme } from '@/theme';
import { Appear } from '@/ui/appear';
import { Button } from '@/ui/button';
import { EmptyState } from '@/ui/empty-state';
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';
import { toast } from '@/ui/toast';

/**
 * Adding people to a group: friends are one tap each; anyone else by username, QR code or link.
 * Everyone invited still has to accept before they see anything.
 */
export default function InviteToCircleScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const circle = useCircle(id);
  const friends = useFriends();
  const invite = useInviteFriends();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  // Friends already in the circle (or invited) are shown, but cannot be picked again.
  const locked = new Map<string, string>();
  for (const member of circle?.members ?? []) {
    locked.set(
      member.userId,
      member.status === 'active' ? t('circles.invite.inCircle') : t('circles.detail.invited'),
    );
  }
  const picked = friends.filter((friend) => selected.has(friend.userId));

  const toggle = (friend: Friend) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(friend.userId)) next.delete(friend.userId);
      else next.add(friend.userId);
      return next;
    });
  };

  const send = () => {
    invite.mutate(
      { circleId: id, friends: picked },
      {
        onSuccess: ({ invited, failed }) => {
          if (failed.length > 0) {
            toast.error(
              t('circles.invite.partial', {
                names: failed.map((friend) => friend.name).join(', '),
              }),
            );
          }
          if (invited > 0) {
            toast.success(t('circles.invite.sent', { count: invited }));
            router.back();
          }
        },
      },
    );
  };

  const shareLink = async () => {
    try {
      const link = await circlesApi.createInvite({ kind: 'circle', circleId: id });
      await Share.share({
        message: t('circles.detail.shareMessage', { name: circle?.name ?? '', link: link.link }),
      });
    } catch (error) {
      toast.error(errorMessage(error, t));
    }
  };

  return (
    <Screen
      title={t('circles.invite.title')}
      subtitle={circle?.name ?? undefined}
      footer={
        friends.length === 0 ? undefined : (
          <Button
            testID="invite-friends"
            label={
              picked.length === 0
                ? t('circles.invite.pick')
                : t('circles.invite.send', { count: picked.length })
            }
            icon={Send}
            onPress={send}
            disabled={picked.length === 0}
            loading={invite.isPending}
            haptic={undefined}
          />
        )
      }
    >
      <View style={styles.section}>
        <SectionTitle>{t('circles.invite.friends')}</SectionTitle>
        {friends.length === 0 ? (
          <EmptyState
            icon={Users}
            title={t('circles.invite.noFriendsTitle')}
            body={t('circles.invite.noFriendsBody')}
          />
        ) : (
          <FriendPicker friends={friends} selected={selected} onToggle={toggle} locked={locked} />
        )}
      </View>
      <Appear index={friends.length + 1} style={styles.section}>
        <SectionTitle>{t('circles.invite.otherWays')}</SectionTitle>
        <ListRow
          leading={<WayIcon icon={AtSign} />}
          title={t('circles.invite.byUsername')}
          subtitle={t('circles.invite.byUsernameHint')}
          onPress={() => {
            router.push({ pathname: '/add/username', params: { circle: id } });
          }}
        />
        <ListRow
          leading={<WayIcon icon={QrCode} />}
          title={t('circles.invite.byQr')}
          subtitle={t('circles.invite.byQrHint')}
          onPress={() => {
            router.push({ pathname: '/add/qr', params: { circle: id } });
          }}
        />
        <ListRow
          leading={<WayIcon icon={Share2} />}
          title={t('circles.invite.byLink')}
          subtitle={t('circles.invite.byLinkHint')}
          onPress={() => void shareLink()}
        />
      </Appear>
    </Screen>
  );
}

function WayIcon({ icon: Icon }: { icon: typeof Users }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
      <Icon color={colors.primary} size={22} strokeWidth={2.25} />
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  icon: {
    width: touchTarget - space.sm,
    height: touchTarget - space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
