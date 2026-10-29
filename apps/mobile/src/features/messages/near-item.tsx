import { MapPin } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { avatarSize, radius, space, touchTarget, useTheme } from '@/theme';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';

import { useCircles } from '../circles/queries';
import { useNow } from '../location/clock';
import { useMyFix } from '../location/engine';
import { useLocations } from '../location/receive';
import { distanceText } from '../map/distance-text';
import type { ChatItem } from './messages';
import { nearCircleOf, nearDistance } from './near';

/**
 * Inside a "Yakındayım" bubble (docs/ADR/0037 §1, §2): the words, and under someone else's how far
 * they are, worked out on this phone from their latest location in that circle and this phone's
 * own, to 50 m; "Yakınlarda" when their location is coarse, old or missing. It follows them while
 * open (a new location renders it again); nothing moves.
 */
export function NearBody({ item, mine }: { item: ChatItem; mine: boolean }) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const circles = useCircles().data ?? [];
  const now = useNow();
  const circleId = mine ? null : nearCircleOf(item.conversation, circles, item.from);
  const theirs = useLocations((state) =>
    circleId === null ? undefined : state[`${circleId}:${item.from}`]?.loc,
  );
  const myFix = useMyFix((state) => state.fix);
  const far = mine ? null : nearDistance(theirs, myFix, now);
  return (
    <View style={styles.body}>
      <View style={[styles.icon, { backgroundColor: mine ? colors.onBrand : colors.primarySoft }]}>
        <MapPin
          color={mine ? colors.brandGradient[0] : colors.primary}
          size={18}
          strokeWidth={2.25}
        />
      </View>
      <View style={styles.words}>
        <Text variant="bodyStrong" color={mine ? 'onBrand' : 'text'}>
          {t('messages.near.said')}
        </Text>
        {far === null ? null : (
          <Text variant="caption" color="textMuted" testID={`near-far-${item.id}`}>
            {far === 'nearby'
              ? t('messages.near.nearby')
              : t('messages.near.distance', { distance: distanceText(far, i18n.language) })}
          </Text>
        )}
      </View>
    </View>
  );
}

/**
 * Two ready answers under someone's "Yakındayım" (the PM, 2026-10-29): plain text messages, in this
 * phone's language. The heart (a double tap) is there too.
 */
export function NearReplies({
  itemId,
  onReply,
}: {
  itemId: string;
  onReply: (words: string) => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const replies = [
    { key: 'coming', words: t('messages.near.coming') },
    { key: 'notNow', words: t('messages.near.notNow') },
  ];
  return (
    <View style={styles.replies}>
      {replies.map((reply) => (
        <PressableScale
          key={reply.key}
          testID={`near-${reply.key}-${itemId}`}
          haptic="select"
          accessibilityRole="button"
          accessibilityLabel={reply.words}
          onPress={() => {
            onReply(reply.words);
          }}
          hitSlop={(touchTarget - REPLY_HEIGHT) / 2}
          style={[styles.reply, { borderColor: colors.primary }]}
        >
          <Text variant="footnote" color="primary">
            {reply.words}
          </Text>
        </PressableScale>
      ))}
    </View>
  );
}

/** A small answer, its touch as large as any button's. */
const REPLY_HEIGHT = space.xxl;

const styles = StyleSheet.create({
  body: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  icon: {
    width: avatarSize.sm + space.xs,
    height: avatarSize.sm + space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  words: { flexShrink: 1 },
  replies: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  reply: {
    minHeight: REPLY_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
});
