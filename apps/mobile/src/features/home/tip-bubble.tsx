import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';

import { useCardShowing } from '../location/map-cards';
import { useLocations } from '../location/receive';
import { storiesOf, useMessages } from '../messages/messages';
import { markTipSeen, restoreTips, type Tip, tipNow, useTipsSeen } from './tips';

/**
 * The tip whose moment has come (features/home/tips.ts), as a bubble above the dock: the +'s points
 * down at it. One at a time, after any card that asks something; "Tamam" puts it away for good. In
 * sade mod "Kapalı" it just appears, with no movement at all (the PM report T6).
 */
export function TipBubble({ me, bottom }: { me: string | null; bottom: number }) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  useEffect(() => {
    restoreTips();
  }, []);
  const seen = useTipsSeen((state) => state.seen);
  const people = useLocations((state) => Object.keys(state).length > 0);
  const newStory = useMessages((state) =>
    storiesOf(state, me).some((person) => person.userId !== me && person.unseen),
  );
  const busy = useCardShowing();
  const tip: Tip | null = tipNow(seen, { people, newStory, busy });
  if (tip === null) return null;
  const words: Record<Tip, { title: string; body: string }> = {
    plus: { title: t('tips.plus.title'), body: t('tips.plus.body') },
    hold: { title: t('tips.hold.title'), body: t('tips.hold.body') },
    ring: { title: t('tips.ring.title'), body: t('tips.ring.body') },
  };
  return (
    <Animated.View
      key={tip}
      testID={`tip-${tip}`}
      {...(motion.reduced ? {} : { entering: motion.enterUp })}
      style={[styles.place, { bottom }]}
      pointerEvents="box-none"
    >
      <View
        accessibilityLiveRegion="polite"
        style={[
          styles.bubble,
          { backgroundColor: colors.surfaceRaised, boxShadow: elevation.floating },
        ]}
      >
        <Text variant="headline">{words[tip].title}</Text>
        <Text variant="callout" color="textMuted">
          {words[tip].body}
        </Text>
        <Button
          testID="tip-ok"
          label={t('tips.ok')}
          variant="secondary"
          fill={false}
          onPress={() => {
            markTipSeen(tip);
          }}
        />
      </View>
      {tip === 'plus' ? (
        <View style={[styles.pointer, { borderTopColor: colors.surfaceRaised }]} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  place: { position: 'absolute', left: space.lg, right: space.lg, alignItems: 'center' },
  bubble: {
    alignSelf: 'stretch',
    gap: space.xs,
    padding: space.lg,
    borderRadius: radius.lg,
  },
  // A small triangle under the bubble, pointing at the + in the middle of the dock.
  pointer: {
    width: 0,
    height: 0,
    borderLeftWidth: space.sm,
    borderRightWidth: space.sm,
    borderTopWidth: space.sm,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
});
