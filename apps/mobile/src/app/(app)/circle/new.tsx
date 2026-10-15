import type { CircleCreate } from '@bargu/schemas';
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { EVENT_ENDS, type EventEnd, eventEndAt } from '@/features/circles/event-time';
import { FriendPicker } from '@/features/circles/friend-picker';
import type { Friend } from '@/features/circles/names';
import { useCircleActions, useFriends, useInviteFriends } from '@/features/circles/queries';
import { isValidDisplayName } from '@/features/profile/profile-form';
import { useNow } from '@/features/location/clock';
import { radius, space, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Appear } from '@/ui/appear';
import { Button } from '@/ui/button';
import { PressableScale } from '@/ui/pressable-scale';
import { useCelebration } from '@/ui/confetti';
import { Screen, SectionTitle } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';

type Kind = CircleCreate['kind'];

/**
 * A new group (family, friends) or event (BARGU_PLAN Faz 8: it ends on its own): its name, its
 * kind, an event's end, and, in the same step, which friends to invite (one tap each). More
 * people can join later, an event's with its QR code.
 */
export default function NewCircleScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const now = useNow();
  const [kind, setKind] = useState<Kind>('family');
  const [end, setEnd] = useState<EventEnd>('hours3');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const { create } = useCircleActions();
  const invite = useInviteFriends();
  const friends = useFriends();
  const celebrate = useCelebration((state) => state.celebrate);
  const valid = isValidDisplayName(name.trim());
  const picked = friends.filter((friend) => selected.has(friend.userId));

  const toggle = (friend: Friend) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(friend.userId)) next.delete(friend.userId);
      else next.add(friend.userId);
      return next;
    });
  };

  const endsAt = eventEndAt(end, now);
  const submit = async () => {
    let input: CircleCreate;
    if (kind === 'event') {
      // `now` follows the clock (useNow), so the end is never more than half a minute stale.
      if (endsAt === null) return;
      input = { kind, name: name.trim(), endsAt };
    } else {
      input = { kind, name: name.trim() };
    }
    let circle;
    try {
      circle = await create.mutateAsync(input);
    } catch {
      return; // The action hook already explained the failure.
    }
    if (picked.length > 0) {
      const { invited, failed } = await invite.mutateAsync({
        circleId: circle.id,
        friends: picked,
      });
      if (failed.length > 0) {
        toast.error(
          t('circles.invite.partial', { names: failed.map((friend) => friend.name).join(', ') }),
        );
      } else if (invited > 0) {
        toast.success(t('circles.invite.sent', { count: invited }));
      }
    }
    celebrate();
    router.replace({ pathname: '/circle/[id]', params: { id: circle.id } });
    // An event is joined with its QR code: show it at once.
    if (kind === 'event') router.push({ pathname: '/add/qr', params: { circle: circle.id } });
  };

  return (
    <Screen
      title={t('circles.new.title')}
      footer={
        <Button
          testID="create-circle"
          label={
            picked.length === 0
              ? t('circles.new.create')
              : t('circles.new.createWith', { count: picked.length })
          }
          icon={Sparkles}
          onPress={() => void submit()}
          disabled={!valid || (kind === 'event' && endsAt === null)}
          loading={create.isPending || invite.isPending}
        />
      }
    >
      <Appear index={0}>
        <Text variant="callout" color="textMuted">
          {kind === 'event' ? t('circles.new.body_event') : t('circles.new.body')}
        </Text>
      </Appear>
      <Appear index={1}>
        <Segmented
          label={t('circles.new.kind')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'family', label: t('circles.kinds.family') },
            { value: 'friends', label: t('circles.kinds.friends') },
            { value: 'event', label: t('circles.kinds.event') },
          ]}
        />
      </Appear>
      {kind === 'event' ? (
        <Appear index={1} style={styles.section}>
          <SectionTitle>{t('circles.event.ends')}</SectionTitle>
          <View style={styles.ends}>
            {EVENT_ENDS.map((option) => {
              const fits = eventEndAt(option, now) !== null;
              const chosen = option === end;
              return (
                <PressableScale
                  key={option}
                  testID={`event-end-${option}`}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen, disabled: !fits }}
                  disabled={!fits}
                  onPress={() => {
                    feedback('select');
                    setEnd(option);
                  }}
                  style={[
                    styles.end,
                    {
                      backgroundColor: chosen ? colors.primary : colors.surfaceRaised,
                      opacity: fits ? 1 : 0.4,
                    },
                  ]}
                >
                  <Text variant="callout" color={chosen ? 'onPrimary' : 'text'}>
                    {t(`circles.event.end_${option}`)}
                  </Text>
                </PressableScale>
              );
            })}
          </View>
        </Appear>
      ) : null}
      <Appear index={2}>
        <TextField
          label={t('circles.new.name')}
          placeholder={t(`circles.new.placeholder_${kind}`)}
          value={name}
          onChangeText={setName}
          maxLength={40}
          returnKeyType="done"
        />
      </Appear>
      {friends.length === 0 ? null : (
        <Appear index={3} style={styles.section}>
          <SectionTitle>{t('circles.new.inviteTitle')}</SectionTitle>
          <Text variant="footnote" color="textMuted">
            {t('circles.new.inviteBody')}
          </Text>
          <View style={styles.picker}>
            <FriendPicker friends={friends} selected={selected} onToggle={toggle} />
          </View>
        </Appear>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { gap: space.sm },
  picker: { marginTop: space.xs },
  ends: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  end: { paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill },
});
