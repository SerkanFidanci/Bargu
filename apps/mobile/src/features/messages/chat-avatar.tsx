import type { Circle } from '@bargu/schemas';
import { Users } from 'lucide-react-native';
import { StyleSheet, View } from 'react-native';

import { memberName } from '@/features/circles/names';
import { avatarSize, radius, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';

import { type Conversation, conversationTarget } from './messages';
import { memberIn } from './names';

/** Each place's size, and the smaller one two faces of a circle are drawn at inside it. */
const SIZES = {
  header: { box: 'md', face: 'sm' },
  row: { box: 'lg', face: 'md' },
  intro: { box: 'xl', face: 'lg' },
} as const;

/**
 * Who a conversation is with (the owner, 2026-10-28: "like Instagram's DMs"): a person's avatar,
 * or for a circle two of its other members, one over the other's corner.
 */
export function ChatAvatar({
  conversation,
  circles,
  me,
  size,
}: {
  conversation: Conversation;
  circles: readonly Circle[];
  me: string | null;
  size: keyof typeof SIZES;
}) {
  const { colors } = useTheme();
  const { box, face } = SIZES[size];
  const target = conversationTarget(conversation);
  if ('userId' in target) {
    const member = memberIn(circles, target.userId);
    return (
      <Avatar
        avatar={member?.avatar ?? null}
        name={member === undefined ? '?' : memberName(member)}
        size={box}
        userId={target.userId}
      />
    );
  }
  const others =
    circles
      .find((circle) => circle.id === target.circleId)
      ?.members.filter((member) => member.userId !== me && member.status === 'active') ?? [];
  const [back, front] = others;
  const outer = avatarSize[box];
  if (back === undefined) {
    return (
      <View
        style={[styles.round, { width: outer, height: outer, backgroundColor: colors.primarySoft }]}
      >
        <Users color={colors.primary} size={outer / 2} strokeWidth={2.25} />
      </View>
    );
  }
  if (front === undefined) {
    return <Avatar avatar={back.avatar} name={memberName(back)} size={box} userId={back.userId} />;
  }
  const inner = avatarSize[face];
  return (
    <View style={{ width: outer, height: outer }}>
      <Avatar avatar={back.avatar} name={memberName(back)} size={face} userId={back.userId} />
      <View
        style={[
          styles.front,
          { left: outer - inner, top: outer - inner, borderColor: colors.background },
        ]}
      >
        <Avatar avatar={front.avatar} name={memberName(front)} size={face} userId={front.userId} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  round: { borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  front: { position: 'absolute', borderRadius: radius.pill, borderWidth: 2, margin: -2 },
});
