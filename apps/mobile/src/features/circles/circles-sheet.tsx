import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import {
  Check,
  Clock,
  Heart,
  Lock,
  type LucideIcon,
  Plus,
  ShieldAlert,
  UserPlus,
  Users,
  X,
} from 'lucide-react-native';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { Appear } from '@/ui/appear';
import { Avatar } from '@/ui/avatar';
import { AvatarStack } from '@/ui/avatar-stack';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { SectionTitle } from '@/ui/screen';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';

import { useAuth } from '../auth/auth-store';
import { leaveSheet, rememberScroll, useSheetReturn } from '../home/sheet-return';
import { useNow } from '../location/clock';
import { useCircleKeys } from './circle-sync';
import { EventBadge, timeLeftText } from './event-ui';
import {
  groupCircles,
  handleOf,
  memberName,
  partnerOf,
  useCircleActions,
  useCircles,
} from './queries';

export interface CirclesSheetProps {
  onAdd: () => void;
  /** Closes the sheet before moving to another screen. */
  onClose: () => void;
}

/**
 * Friends and circles: requests waiting for an answer first, then friends, then groups. Each row
 * shows whether its keys are in place; nothing is shared with anyone before they accept.
 */
export const CirclesSheet = forwardRef<SheetRef, CirclesSheetProps>(function CirclesSheet(
  { onAdd, onClose },
  ref,
) {
  const { t } = useTranslation();
  const circles = useCircles();
  const open = (circle: Circle) => {
    leaveSheet('circles');
    onClose();
    router.push({ pathname: '/circle/[id]', params: { id: circle.id } });
  };
  const newCircle = () => {
    leaveSheet('circles');
    onClose();
    router.push('/circle/new');
  };

  let body;
  if (circles.data === undefined) {
    body = [0, 1, 2].map((index) => (
      <View key={index} style={styles.skeleton}>
        <Skeleton width={touchTarget} height={touchTarget} round />
        <View style={styles.skeletonText}>
          <Skeleton width="60%" height={space.lg} />
          <Skeleton width="35%" height={space.md} />
        </View>
      </View>
    ));
  } else if (circles.data.length === 0) {
    body = (
      <EmptyState
        icon={Users}
        title={t('sheets.circles.emptyTitle')}
        body={t('sheets.circles.emptyBody')}
        action={{ label: t('sheets.circles.emptyAction'), onPress: onAdd }}
      />
    );
  } else {
    const { requests, friends, groups } = groupCircles(circles.data);
    body = (
      <>
        {requests.length === 0 ? null : (
          <View style={styles.section}>
            <SectionTitle>{t('circles.sheet.requests')}</SectionTitle>
            {requests.map((circle, index) => (
              <Appear key={circle.id} index={index}>
                <RequestRow circle={circle} />
              </Appear>
            ))}
          </View>
        )}
        {friends.length === 0 ? (
          <EmptySection
            testID="no-friends"
            title={t('circles.sheet.friends')}
            body={t('circles.sheet.noFriends')}
            action={t('circles.sheet.addFriend')}
            icon={UserPlus}
            onPress={onAdd}
          />
        ) : (
          <View style={styles.section}>
            <SectionTitle>{t('circles.sheet.friends')}</SectionTitle>
            {friends.map((circle, index) => (
              <Appear key={circle.id} index={requests.length + index}>
                <FriendRow
                  circle={circle}
                  onPress={() => {
                    open(circle);
                  }}
                />
              </Appear>
            ))}
          </View>
        )}
        {groups.length === 0 ? (
          <EmptySection
            testID="no-groups"
            title={t('circles.sheet.groups')}
            body={t('circles.sheet.noGroups')}
            action={t('circles.sheet.newCircle')}
            icon={Plus}
            onPress={newCircle}
          />
        ) : (
          <View style={styles.section}>
            <SectionTitle>{t('circles.sheet.groups')}</SectionTitle>
            {groups.map((circle, index) => (
              <Appear key={circle.id} index={requests.length + friends.length + index}>
                <GroupRow
                  circle={circle}
                  onPress={() => {
                    open(circle);
                  }}
                />
              </Appear>
            ))}
          </View>
        )}
        <View style={styles.actions}>
          {friends.length === 0 ? null : (
            <Button label={t('circles.sheet.addFriend')} icon={UserPlus} onPress={onAdd} />
          )}
          {groups.length === 0 ? null : (
            <Button
              label={t('circles.sheet.newCircle')}
              icon={Plus}
              variant="secondary"
              onPress={newCircle}
            />
          )}
        </View>
      </>
    );
  }

  return (
    <Sheet
      ref={ref}
      title={t('sheets.circles.title')}
      testID="circles-sheet"
      onScrolled={(y) => {
        rememberScroll('circles', y);
      }}
      scrollTo={() => useSheetReturn.getState().scroll.circles ?? 0}
    >
      {body}
    </Sheet>
  );
});

/**
 * A section with nothing in it yet (UX düzeni 7): what would be there and the way to start it,
 * instead of leaving the section out.
 */
function EmptySection({
  title,
  body,
  action,
  icon,
  onPress,
  testID,
}: {
  title: string;
  body: string;
  action: string;
  icon: LucideIcon;
  onPress: () => void;
  testID: string;
}) {
  return (
    <View style={styles.section} testID={testID}>
      <SectionTitle>{title}</SectionTitle>
      <Text variant="footnote" color="textMuted">
        {body}
      </Text>
      <Button label={action} icon={icon} variant="secondary" onPress={onPress} />
    </View>
  );
}

/** An invitation waiting for an answer: who asks, and accept or decline right here. */
function RequestRow({ circle }: { circle: Circle }) {
  const { t } = useTranslation();
  const me = useAuth((state) => state.userId);
  const actions = useCircleActions();
  const celebrate = useCelebration((state) => state.celebrate);
  const inviter = circle.members.find((member) => member.userId !== me);
  const name = inviter === undefined ? '?' : memberName(inviter);
  const subtitle =
    circle.kind === 'pair'
      ? t('circles.sheet.friendRequest')
      : t('circles.sheet.groupInvite', { name: circle.name ?? '' });
  return (
    <ListRow
      testID={`request-${circle.id}`}
      actions
      leading={<Avatar avatar={inviter?.avatar ?? null} name={name} />}
      title={name}
      subtitle={subtitle}
      trailing={
        <View style={styles.answer}>
          <IconButton
            icon={Check}
            tone="primary"
            label={t('circles.sheet.accept')}
            haptic={undefined}
            onPress={() => {
              actions.accept.mutate(circle.id, {
                onSuccess: () => {
                  celebrate();
                },
              });
            }}
          />
          <IconButton
            icon={X}
            tone="plain"
            label={t('circles.sheet.decline')}
            onPress={() => {
              actions.decline.mutate(circle.id);
            }}
          />
        </View>
      }
    />
  );
}

function FriendRow({ circle, onPress }: { circle: Circle; onPress: () => void }) {
  const { t } = useTranslation();
  const me = useAuth((state) => state.userId);
  const partner = partnerOf(circle, me);
  const name = partner === undefined ? '?' : memberName(partner);
  return (
    <ListRow
      testID={`friend-${circle.id}`}
      leading={<Avatar avatar={partner?.avatar ?? null} name={name} userId={partner?.userId} />}
      title={name}
      subtitle={handleOf(partner)}
      trailing={
        partner?.status === 'invited' ? (
          <Badge label={t('circles.sheet.pending')} icon={Clock} />
        ) : (
          <KeyBadge circleId={circle.id} />
        )
      }
      onPress={onPress}
    />
  );
}

function GroupRow({ circle, onPress }: { circle: Circle; onPress: () => void }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const active = circle.members.filter((member) => member.status === 'active');
  const Icon = circle.kind === 'family' ? Heart : Users;
  const members = t('circles.sheet.memberCount', { count: active.length });
  return (
    <ListRow
      testID={`group-${circle.id}`}
      leading={
        circle.expiresAt === undefined ? (
          <View style={[styles.groupIcon, { backgroundColor: colors.primarySoft }]}>
            <Icon color={colors.primary} size={22} strokeWidth={2.25} />
          </View>
        ) : (
          // An event: its countdown ring (BARGU_PLAN §4.3).
          <EventBadge circle={circle} now={now} size={44} />
        )
      }
      title={circle.name ?? ''}
      subtitle={
        circle.expiresAt === undefined
          ? members
          : `${timeLeftText(t, circle.expiresAt, now)} · ${members}`
      }
      trailing={
        <AvatarStack
          people={active.map((member) => ({
            id: member.userId,
            name: memberName(member),
            avatar: member.avatar,
          }))}
        />
      }
      onPress={onPress}
    />
  );
}

/** Encryption state of a circle at a glance: ready, waiting for keys, or someone to verify. */
export function KeyBadge({ circleId }: { circleId: string }) {
  const { t } = useTranslation();
  const status = useCircleKeys((state) => state[circleId]);
  if (status === undefined) return null;
  if (Object.values(status.trust).includes('changed')) {
    return <Badge label={t('circles.keys.check')} tone="danger" icon={ShieldAlert} />;
  }
  if (status.ready) return <Badge label={t('circles.keys.ready')} tone="success" icon={Lock} />;
  return <Badge label={t('circles.keys.waiting')} icon={Clock} />;
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  actions: { gap: space.sm, marginTop: space.sm },
  answer: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  groupIcon: {
    width: touchTarget - space.sm,
    height: touchTarget - space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skeleton: { flexDirection: 'row', alignItems: 'center', gap: space.md },
  skeletonText: { flex: 1, gap: space.xs },
});
