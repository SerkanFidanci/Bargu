import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import { CircleCheck, Flag, Ghost, LocateFixed } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { space } from '@/theme';
import { useMotion } from '@/theme/use-motion';
import { IconButton } from '@/ui/icon-button';
import { toast } from '@/ui/toast';

import { useMyFix } from '../location/engine';
import { sayArrived, updateSharing } from '../location/location-session';
import { sharedCircles, useSharing } from '../location/sharing';
import type { Place } from '../places/place-model';
import { useArrived } from '../plan/meeting';
import { hereDue } from './shortcuts-model';

export interface MapShortcutsProps {
  circles: readonly Circle[];
  /** The map looks away from this phone: "back to me" is offered. */
  away: boolean;
  onRecenter: () => void;
  /** The meeting on the chip: "start a meeting" makes way for it, "Geldim" comes near it. */
  meeting: { circle: Circle; meetAt: number; place: Place } | null;
  me: string | null;
  now: number;
  /** Where the column ends, above the dock. */
  bottom: number;
}

/**
 * Round shortcuts at the right edge of the map, above the dock (the project owner's request,
 * docs/ADR/0026 §8), three at most: back to me (once the map moved away), ghost mode, and start a
 * meeting, which gives way to the meeting's chip at the top while one is on; "Geldim" shows only
 * near its time or place.
 */
export function MapShortcuts({
  circles,
  away,
  onRecenter,
  meeting,
  me,
  now,
  bottom,
}: MapShortcutsProps) {
  const { t } = useTranslation();
  const motion = useMotion();
  const fix = useMyFix((state) => state.fix);
  const said = useArrived((state) =>
    meeting === null || me === null
      ? false
      : state[`${meeting.circle.id}:${me}`]?.meetAt === meeting.meetAt,
  );
  const here =
    meeting !== null &&
    hereDue({
      meetAt: meeting.meetAt,
      place: meeting.place,
      fix,
      now,
      said,
      paused: meeting.circle.paused === true,
    });

  return (
    <View style={[styles.column, { bottom }]} pointerEvents="box-none" testID="map-shortcuts">
      {away ? (
        <Animated.View entering={motion.pop} exiting={motion.fadeOut}>
          <IconButton
            testID="shortcut-recenter"
            icon={LocateFixed}
            label={t('map.shortcuts.recenter')}
            onPress={onRecenter}
          />
        </Animated.View>
      ) : null}
      <GhostButton circles={circles} now={now} />
      {meeting === null ? (
        <IconButton
          testID="shortcut-meet"
          icon={Flag}
          label={t('map.shortcuts.meet')}
          onPress={() => {
            router.push('/meeting/new');
          }}
        />
      ) : here ? (
        <Animated.View entering={motion.pop} exiting={motion.fadeOut}>
          <HereButton circle={meeting.circle} meetAt={meeting.meetAt} place={meeting.place} />
        </Animated.View>
      ) : null}
    </View>
  );
}

/**
 * Ghost mode in one tap (hide: off everyone's map, nothing sent). Turning it off asks first, with
 * how many circles get the location again: a stray tap must not start sharing. Its state shows in
 * colour, in the button's state and in what a screen reader says.
 */
function GhostButton({ circles, now }: { circles: readonly Circle[]; now: number }) {
  const { t } = useTranslation();
  const on = useSharing((state) => state.ghost !== 'off');
  const turnOff = () => {
    const off = () => {
      updateSharing((current) => ({ ...current, ghost: 'off' }));
    };
    const count = sharedCircles(circles, { ...useSharing.getState(), ghost: 'off' }, now).length;
    // Nothing would be shared again: nothing to warn about.
    if (count === 0) {
      off();
      return;
    }
    Alert.alert(t('map.shortcuts.ghostOffTitle'), t('map.shortcuts.ghostOffBody', { count }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('map.shortcuts.ghostOffConfirm'), onPress: off },
    ]);
  };
  return (
    <IconButton
      testID="shortcut-ghost"
      icon={Ghost}
      tone={on ? 'primary' : 'raised'}
      selected={on}
      label={on ? t('map.shortcuts.ghostOn') : t('map.shortcuts.ghostOff')}
      onPress={() => {
        if (on) {
          turnOff();
          return;
        }
        updateSharing((current) => ({ ...current, ghost: 'hide' }));
        toast.info(t('map.shortcuts.ghostOnToast'));
      }}
    />
  );
}

/** "Geldim" for the meeting on the chip: the circle hears it (no location in it, ADR 0026 §5). */
function HereButton({ circle, meetAt, place }: { circle: Circle; meetAt: number; place: Place }) {
  const { t } = useTranslation();
  const [sending, setSending] = useState(false);
  const say = async () => {
    if (sending) return;
    setSending(true);
    try {
      await sayArrived(circle, meetAt);
      toast.success(t('meeting.hereSent'));
    } catch {
      toast.error(t('plan.failed'));
    } finally {
      setSending(false);
    }
  };
  return (
    <IconButton
      testID="shortcut-here"
      icon={CircleCheck}
      tone="primary"
      label={t('map.shortcuts.here', { place: place.name })}
      onPress={() => {
        void say();
      }}
    />
  );
}

const styles = StyleSheet.create({
  column: { position: 'absolute', right: space.lg, alignItems: 'center', gap: space.sm },
});
