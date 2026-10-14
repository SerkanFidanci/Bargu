import { Check, Search } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Appear } from '@/ui/appear';
import { Avatar } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

import type { Friend } from './names';

/** Above this many friends a search field helps find someone. */
const SEARCH_FROM = 7;

export interface FriendPickerProps {
  friends: readonly Friend[];
  selected: ReadonlySet<string>;
  onToggle: (friend: Friend) => void;
  /** Friends who cannot be picked, with the reason shown instead of a check (e.g. "In circle"). */
  locked?: ReadonlyMap<string, string>;
}

/** The user's friends as a tap-to-select list: one tap per person, no typing. */
export function FriendPicker({ friends, selected, onToggle, locked }: FriendPickerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase('tr');
  const shown =
    needle === ''
      ? friends
      : friends.filter(
          (friend) =>
            friend.name.toLocaleLowerCase('tr').includes(needle) ||
            friend.username.includes(needle.replace(/^@/, '')),
        );
  return (
    <View style={styles.list}>
      {friends.length >= SEARCH_FROM ? (
        <TextField
          label={t('circles.invite.search')}
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          autoCorrect={false}
          trailing={<Search size={18} color={colors.textMuted} />}
        />
      ) : null}
      {shown.map((friend, index) => (
        <Appear key={friend.userId} index={index}>
          <FriendRow
            friend={friend}
            checked={selected.has(friend.userId)}
            lockedReason={locked?.get(friend.userId)}
            onToggle={onToggle}
          />
        </Appear>
      ))}
    </View>
  );
}

function FriendRow({
  friend,
  checked,
  lockedReason,
  onToggle,
}: {
  friend: Friend;
  checked: boolean;
  lockedReason: string | undefined;
  onToggle: (friend: Friend) => void;
}) {
  const { colors } = useTheme();
  const motion = useMotion();
  const content = (
    <>
      <Avatar avatar={friend.avatar} name={friend.name} muted={lockedReason !== undefined} />
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={1}>
          {friend.name}
        </Text>
        <Text variant="footnote" color="textMuted" numberOfLines={1}>
          {`@${friend.username}`}
        </Text>
      </View>
    </>
  );
  if (lockedReason !== undefined) {
    return (
      <View style={styles.row} accessible accessibilityLabel={`${friend.name}, ${lockedReason}`}>
        {content}
        <Badge label={lockedReason} />
      </View>
    );
  }
  return (
    <PressableScale
      haptic="select"
      onPress={() => {
        onToggle(friend);
      }}
      accessibilityRole="checkbox"
      accessibilityState={{ checked }}
      accessibilityLabel={`${friend.name}, @${friend.username}`}
      style={styles.row}
    >
      {content}
      <View
        style={[
          styles.check,
          checked
            ? { backgroundColor: colors.primary, borderColor: colors.primary }
            : { borderColor: colors.border },
        ]}
      >
        {checked ? (
          <Animated.View entering={motion.pop}>
            <Check color={colors.onPrimary} size={18} strokeWidth={3} />
          </Animated.View>
        ) : null}
      </View>
    </PressableScale>
  );
}

const CHECK_SIZE = touchTarget - space.lg;

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.md, minHeight: touchTarget },
  text: { flex: 1, gap: space.xxs },
  check: {
    width: CHECK_SIZE,
    height: CHECK_SIZE,
    borderRadius: radius.pill,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
