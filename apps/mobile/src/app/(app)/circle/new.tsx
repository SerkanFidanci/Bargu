import type { GROUP_KINDS } from '@bargu/schemas';
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { FriendPicker } from '@/features/circles/friend-picker';
import type { Friend } from '@/features/circles/names';
import { useCircleActions, useFriends, useInviteFriends } from '@/features/circles/queries';
import { isValidDisplayName } from '@/features/profile/profile-form';
import { space } from '@/theme';
import { Appear } from '@/ui/appear';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { Screen, SectionTitle } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';

type GroupKind = (typeof GROUP_KINDS)[number];

/**
 * A new group (family, friends): its name, its kind, and, in the same step, which friends to
 * invite (one tap each). More people can be added from the circle's screen later.
 */
export default function NewCircleScreen() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<GroupKind>('family');
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

  const submit = async () => {
    let circle;
    try {
      circle = await create.mutateAsync({ kind, name: name.trim() });
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
          disabled={!valid}
          loading={create.isPending || invite.isPending}
        />
      }
    >
      <Appear index={0}>
        <Text variant="callout" color="textMuted">
          {t('circles.new.body')}
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
          ]}
        />
      </Appear>
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
});
