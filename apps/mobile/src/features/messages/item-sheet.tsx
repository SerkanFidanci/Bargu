import { CHAT_REACTIONS, type ChatReaction } from '@bargu/schemas';
import { Flag, type LucideIcon, Trash2, UserX } from 'lucide-react-native';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { avatarSize, radius, space, touchTarget, typography, useTheme } from '@/theme';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';

/**
 * Six reactions in a row (docs/ADR/0035 Ek 2): this user's own one marked; choosing it again takes
 * it back. Under a held message, and over the reply of someone's story.
 */
export function ReactionBar({
  current,
  onReact,
  testID,
}: {
  current: ChatReaction | undefined;
  onReact: (emoji: ChatReaction | null) => void;
  testID?: string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  return (
    <View style={styles.bar} testID={testID} accessibilityRole="toolbar">
      {CHAT_REACTIONS.map((emoji) => {
        const chosen = emoji === current;
        return (
          <PressableScale
            key={emoji}
            testID={`react-${emoji}`}
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={
              chosen ? t('messages.react.takeBack', { emoji }) : t('messages.react.with', { emoji })
            }
            accessibilityState={{ selected: chosen }}
            onPress={() => {
              onReact(chosen ? null : emoji);
            }}
            style={[styles.emoji, chosen ? { backgroundColor: colors.primarySoft } : null]}
          >
            <Text style={typography.title2.style} allowFontScaling={false}>
              {emoji}
            </Text>
          </PressableScale>
        );
      })}
    </View>
  );
}

/**
 * A held message (the owner, 2026-10-28: "like Instagram's DMs"; docs/ADR/0035 Ek 2): the six
 * reactions on top for one that went out, then what can be done with it: one's own taken back from
 * everyone, someone else's reported or its sender blocked.
 */
export const ItemSheet = forwardRef<
  SheetRef,
  {
    mine: boolean;
    /** Reactions only to what went out. */
    reactable: boolean;
    current: ChatReaction | undefined;
    onReact: (emoji: ChatReaction | null) => void;
    onTakeBack: () => void;
    onReport: () => void;
    onBlock: () => void;
  }
>(function ItemSheet({ mine, reactable, current, onReact, onTakeBack, onReport, onBlock }, ref) {
  const { t } = useTranslation();
  const rows: { key: string; icon: LucideIcon; title: string; onPress: () => void }[] = mine
    ? [{ key: 'take-back', icon: Trash2, title: t('messages.takeBack'), onPress: onTakeBack }]
    : [
        { key: 'report', icon: Flag, title: t('messages.report'), onPress: onReport },
        { key: 'block', icon: UserX, title: t('messages.block'), onPress: onBlock },
      ];
  return (
    <Sheet ref={ref} title={t('messages.itemActions')} testID="item-sheet">
      {reactable ? <ReactionBar current={current} onReact={onReact} /> : null}
      {rows.map((row) => (
        <ListRow
          key={row.key}
          testID={`item-${row.key}`}
          leading={<RowIcon icon={row.icon} />}
          title={row.title}
          onPress={row.onPress}
        />
      ))}
    </Sheet>
  );
});

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.rowIcon, { backgroundColor: colors.surface }]}>
      <Icon color={colors.text} size={20} strokeWidth={2.25} />
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', gap: space.xs },
  emoji: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowIcon: {
    width: avatarSize.md,
    height: avatarSize.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
