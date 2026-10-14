import type { Circle, MemberCard } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Check,
  Clock,
  Crown,
  Heart,
  Lock,
  LogOut,
  Pencil,
  ShieldAlert,
  ShieldCheck,
  UserMinus,
  UserPlus,
  Users,
  X,
} from 'lucide-react-native';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '@/features/auth/auth-store';
import { type Trust, useCircleKeys } from '@/features/circles/circle-sync';
import {
  handleOf,
  memberName,
  partnerOf,
  useCircle,
  useCircleActions,
} from '@/features/circles/queries';
import { circleSync, keys } from '@/features/live/live-session';
import { SharingCard } from '@/features/location/sharing-card';
import { PlacesCard } from '@/features/places/places-card';
import { isValidDisplayName } from '@/features/profile/profile-form';
import { radius, space, touchTarget, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { useMotion } from '@/theme/use-motion';
import { Appear } from '@/ui/appear';
import { Avatar } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

/**
 * One friend or circle: who is in it, whether its encryption is ready, warnings when someone's
 * keys changed, and the actions that fit the user's role (invite, rename, remove, leave).
 */
export default function CircleScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const circle = useCircle(id);
  const me = useAuth((state) => state.userId);

  if (circle === undefined) {
    return (
      <Screen title={t('circles.detail.goneTitle')}>
        <EmptyState
          icon={Users}
          title={t('circles.detail.goneTitle')}
          body={t('circles.detail.goneBody')}
          action={{
            label: t('common.close'),
            onPress: () => {
              router.back();
            },
          }}
        />
      </Screen>
    );
  }
  return <CircleDetail circle={circle} me={me} />;
}

function CircleDetail({ circle, me }: { circle: Circle; me: string | null }) {
  const { t } = useTranslation();
  const actions = useCircleActions();
  const status = useCircleKeys((state) => state[circle.id]);
  const celebrate = useCelebration((state) => state.celebrate);
  const [renaming, setRenaming] = useState(false);
  const pair = circle.kind === 'pair';
  const partner = partnerOf(circle, me);
  const isOwner = circle.myRole === 'owner' && !pair;
  const active = circle.myStatus === 'active';
  const others = circle.members.filter((member) => member.userId !== me);
  const changed = others.filter((member) => status?.trust[member.userId] === 'changed');
  const title = pair ? (partner === undefined ? '' : memberName(partner)) : (circle.name ?? '');

  const leave = () => {
    Alert.alert(
      pair ? t('circles.detail.unfriendTitle', { name: title }) : t('circles.detail.leaveTitle'),
      pair ? t('circles.detail.unfriendBody') : t('circles.detail.leaveBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: pair ? t('circles.detail.unfriend') : t('circles.detail.leave'),
          style: 'destructive',
          onPress: () => {
            actions.leave.mutate(circle.id, {
              onSuccess: () => {
                router.back();
              },
            });
          },
        },
      ],
    );
  };

  const openInvite = () => {
    router.push({ pathname: '/circle/[id]/invite', params: { id: circle.id } });
  };

  return (
    <Screen
      title={title}
      subtitle={pair ? handleOf(partner) : t(`circles.kinds.${circle.kind}`)}
      action={
        isOwner && active ? (
          <IconButton
            icon={renaming ? X : Pencil}
            tone="plain"
            label={renaming ? t('common.cancel') : t('circles.detail.rename')}
            onPress={() => {
              setRenaming(!renaming);
            }}
          />
        ) : undefined
      }
      testID="circle-screen"
    >
      <Appear index={0}>
        <Hero circle={circle} partner={partner} title={title} />
      </Appear>

      {renaming ? (
        <Rename
          circle={circle}
          onDone={() => {
            setRenaming(false);
          }}
        />
      ) : null}

      {circle.myStatus === 'invited' ? (
        <Appear index={1} style={styles.row}>
          <View style={styles.half}>
            <Button
              label={t('circles.sheet.accept')}
              icon={Check}
              onPress={() => {
                actions.accept.mutate(circle.id, {
                  onSuccess: () => {
                    celebrate();
                  },
                });
              }}
              loading={actions.accept.isPending}
            />
          </View>
          <View style={styles.half}>
            <Button
              label={t('circles.sheet.decline')}
              variant="secondary"
              onPress={() => {
                actions.decline.mutate(circle.id, {
                  onSuccess: () => {
                    router.back();
                  },
                });
              }}
            />
          </View>
        </Appear>
      ) : null}

      {active && pair && partner?.status === 'invited' ? (
        <Appear index={1}>
          <Notice
            icon={Clock}
            tone="muted"
            title={t('circles.detail.pendingTitle')}
            body={t('circles.detail.pendingBody', { name: title })}
          />
        </Appear>
      ) : active ? (
        <Appear index={1}>
          <EncryptionCard ready={status?.ready ?? false} waitingFor={status?.waitingFor ?? 0} />
        </Appear>
      ) : null}

      {active ? (
        <Appear index={2}>
          <SharingCard circleId={circle.id} name={pair ? title : null} />
        </Appear>
      ) : null}

      {active ? (
        <Appear index={2}>
          <PlacesCard circleId={circle.id} />
        </Appear>
      ) : null}

      {active && !pair && others.length === 0 ? (
        <Appear index={2}>
          <Notice
            icon={Users}
            tone="muted"
            title={t('circles.detail.onlyYouTitle')}
            body={t('circles.detail.onlyYouBody')}
          >
            <Button
              testID="invite-first"
              label={t('circles.detail.inviteFriends')}
              icon={UserPlus}
              onPress={openInvite}
            />
          </Notice>
        </Appear>
      ) : null}

      {changed.map((member, index) => (
        <Appear key={member.userId} index={2 + index}>
          <ChangedKeyNotice circle={circle} member={member} />
        </Appear>
      ))}

      {pair ? null : (
        <Appear index={3} style={styles.section}>
          <SectionTitle>
            {t('circles.detail.members', {
              count: circle.members.filter((m) => m.status === 'active').length,
            })}
          </SectionTitle>
          {circle.members.map((member) => (
            <MemberRow
              key={member.userId}
              circle={circle}
              member={member}
              isMe={member.userId === me}
              trust={status?.trust[member.userId]}
              canRemove={isOwner && active && member.userId !== me && member.role !== 'owner'}
            />
          ))}
        </Appear>
      )}

      {pair && partner?.status === 'active' && active ? (
        <Appear index={3}>
          <MemberRow
            circle={circle}
            member={partner}
            isMe={false}
            trust={status?.trust[partner.userId]}
            canRemove={false}
          />
        </Appear>
      ) : null}

      {active && !pair && others.length > 0 ? (
        <Appear index={4}>
          <Button
            testID="add-people"
            label={t('circles.detail.addPeople')}
            icon={UserPlus}
            onPress={openInvite}
          />
        </Appear>
      ) : null}

      {active ? (
        <Appear index={5}>
          <Button
            testID="leave-circle"
            label={
              pair
                ? partner?.status === 'invited'
                  ? t('circles.detail.withdraw')
                  : t('circles.detail.unfriend')
                : t('circles.detail.leave')
            }
            icon={LogOut}
            variant="ghost"
            onPress={leave}
            loading={actions.leave.isPending}
          />
        </Appear>
      ) : null}
    </Screen>
  );
}

function Hero({
  circle,
  partner,
  title,
}: {
  circle: Circle;
  partner: MemberCard | undefined;
  title: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const Icon = circle.kind === 'family' ? Heart : Users;
  return (
    <View style={styles.hero}>
      <Animated.View entering={motion.pop}>
        {circle.kind === 'pair' ? (
          <Avatar
            avatar={partner?.avatar ?? null}
            name={title}
            size="xl"
            userId={partner?.userId}
          />
        ) : (
          <View style={[styles.heroIcon, { backgroundColor: colors.primarySoft }]}>
            <Icon color={colors.primary} size={44} strokeWidth={2} />
          </View>
        )}
      </Animated.View>
      <Text variant="title1" align="center" numberOfLines={2}>
        {title}
      </Text>
      {circle.kind === 'pair' ? null : (
        <Text variant="callout" color="textMuted">
          {t('circles.sheet.memberCount', {
            count: circle.members.filter((member) => member.status === 'active').length,
          })}
        </Text>
      )}
    </View>
  );
}

function Rename({ circle, onDone }: { circle: Circle; onDone: () => void }) {
  const { t } = useTranslation();
  const { rename } = useCircleActions();
  const [name, setName] = useState(circle.name ?? '');
  const valid = isValidDisplayName(name.trim()) && name.trim() !== circle.name;
  const save = () => {
    rename.mutate({ circleId: circle.id, name: name.trim() }, { onSuccess: onDone });
  };
  return (
    <Appear style={styles.section}>
      <TextField
        label={t('circles.new.name')}
        value={name}
        onChangeText={setName}
        maxLength={40}
        autoFocus
        returnKeyType="done"
        onSubmitEditing={() => {
          if (valid) save();
        }}
      />
      <Button
        label={t('common.save')}
        onPress={save}
        disabled={!valid}
        loading={rename.isPending}
      />
    </Appear>
  );
}

function EncryptionCard({ ready, waitingFor }: { ready: boolean; waitingFor: number }) {
  const { t } = useTranslation();
  return ready ? (
    <Notice
      icon={Lock}
      tone="success"
      title={t('circles.detail.encrypted')}
      body={t('circles.detail.encryptedBody')}
    />
  ) : (
    <Notice
      icon={Clock}
      tone="muted"
      title={t('circles.detail.waitingTitle')}
      body={t('circles.detail.waitingBody', { count: waitingFor })}
    />
  );
}

/** Someone's identity key changed: on hold until the user compares numbers or accepts it. */
function ChangedKeyNotice({ circle, member }: { circle: Circle; member: MemberCard }) {
  const { t } = useTranslation();
  const name = memberName(member);
  const accept = () => {
    Alert.alert(t('circles.detail.acceptKeyTitle'), t('circles.detail.acceptKeyBody', { name }), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('circles.detail.acceptKey'),
        onPress: () => {
          keys().acknowledgeChange(member.userId);
          feedback('success');
          void circleSync.resync(circle.id).catch(() => undefined);
        },
      },
    ]);
  };
  return (
    <Notice
      icon={ShieldAlert}
      tone="danger"
      title={t('circles.detail.keyChangedTitle', { name })}
      body={t('circles.detail.keyChangedBody')}
    >
      <View style={styles.row}>
        <View style={styles.half}>
          <Button
            label={t('circles.detail.compare')}
            icon={ShieldCheck}
            onPress={() => {
              router.push({
                pathname: '/circle/[id]/verify/[userId]',
                params: { id: circle.id, userId: member.userId },
              });
            }}
          />
        </View>
        <View style={styles.half}>
          <Button label={t('circles.detail.acceptKey')} variant="secondary" onPress={accept} />
        </View>
      </View>
    </Notice>
  );
}

function MemberRow({
  circle,
  member,
  isMe,
  trust,
  canRemove,
}: {
  circle: Circle;
  member: MemberCard;
  isMe: boolean;
  trust: Trust | undefined;
  canRemove: boolean;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { remove } = useCircleActions();
  const name = memberName(member);
  const subtitle = [
    member.role === 'owner' && circle.kind !== 'pair' ? t('circles.detail.owner') : null,
    member.status === 'invited' ? t('circles.detail.invited') : null,
    isMe ? t('circles.detail.you') : null,
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const confirmRemove = () => {
    Alert.alert(t('circles.detail.removeTitle', { name }), t('circles.detail.removeBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('circles.detail.remove'),
        style: 'destructive',
        onPress: () => {
          remove.mutate({ circleId: circle.id, userId: member.userId });
        },
      },
    ]);
  };
  const verifiable = !isMe && member.status === 'active' && member.device !== null;
  return (
    <ListRow
      leading={
        <Avatar
          avatar={member.avatar}
          name={name}
          muted={member.status === 'invited'}
          userId={member.userId}
        />
      }
      title={name}
      subtitle={subtitle === '' ? undefined : subtitle}
      onPress={
        verifiable
          ? () => {
              router.push({
                pathname: '/circle/[id]/verify/[userId]',
                params: { id: circle.id, userId: member.userId },
              });
            }
          : undefined
      }
      trailing={
        <View style={styles.trailing}>
          {member.role === 'owner' && circle.kind !== 'pair' ? (
            <Crown size={16} color={colors.accent} />
          ) : null}
          {verifiable ? <TrustBadge trust={trust} /> : null}
          {canRemove ? (
            <IconButton
              icon={UserMinus}
              tone="plain"
              size={touchTarget - space.sm}
              label={t('circles.detail.removeTitle', { name })}
              onPress={confirmRemove}
            />
          ) : null}
        </View>
      }
    />
  );
}

function TrustBadge({ trust }: { trust: Trust | undefined }) {
  const { t } = useTranslation();
  if (trust === 'verified') {
    return <Badge label={t('circles.trust.verified')} tone="success" icon={ShieldCheck} />;
  }
  if (trust === 'changed') {
    return <Badge label={t('circles.trust.changed')} tone="danger" icon={ShieldAlert} />;
  }
  return <Badge label={t('circles.trust.unverified')} icon={ShieldCheck} />;
}

function Notice({
  icon: Icon,
  tone,
  title,
  body,
  children,
}: {
  icon: typeof Lock;
  tone: 'success' | 'muted' | 'danger';
  title: string;
  body: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const color =
    tone === 'success' ? colors.success : tone === 'danger' ? colors.danger : colors.textMuted;
  return (
    <View
      style={[styles.notice, { backgroundColor: colors.surface, borderColor: color }]}
      accessible={children === undefined}
      accessibilityLabel={`${title}. ${body}`}
    >
      <View style={styles.noticeHead}>
        <Icon color={color} size={22} strokeWidth={2.25} />
        <View style={styles.noticeText}>
          <Text variant="bodyStrong">{title}</Text>
          <Text variant="footnote" color="textMuted">
            {body}
          </Text>
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', gap: space.sm, paddingVertical: space.md },
  heroIcon: {
    width: 96,
    height: 96,
    borderRadius: radius.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  section: { gap: space.sm },
  row: { flexDirection: 'row', gap: space.sm },
  half: { flex: 1 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  notice: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    borderLeftWidth: space.xs,
  },
  noticeHead: { flexDirection: 'row', gap: space.md, alignItems: 'flex-start' },
  noticeText: { flex: 1, gap: space.xxs },
});
