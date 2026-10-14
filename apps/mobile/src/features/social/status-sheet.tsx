import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { elevation, radius, space, touchTarget, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { useMotion } from '@/theme/use-motion';
import { Button } from '@/ui/button';
import { PressableScale } from '@/ui/pressable-scale';
import { Segmented } from '@/ui/segmented';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';
import { toast } from '@/ui/toast';

import { errorMessage } from '../errors';
import {
  clearStatus,
  type Status,
  STATUS_DURATIONS_H,
  STATUS_TEXT_MAX,
  setStatus,
  useMyStatus,
} from './status';

/** Quick picks; any text can go with them. */
const EMOJIS = ['☕', '🍔', '🏃', '🚗', '📚', '💼', '🏠', '🎉', '😴', '🎧', '✈️', '🏖️'] as const;

/** A status as a small bubble above someone's avatar on the map: only the emoji, no text. */
export function StatusBubble({ status }: { status: Status }) {
  const { colors } = useTheme();
  const motion = useMotion();
  if (status.emoji === undefined) return null;
  return (
    <Animated.View
      entering={motion.pop}
      style={[
        styles.bubble,
        { backgroundColor: colors.surfaceRaised, boxShadow: elevation.raised },
      ]}
    >
      <Text variant="callout" allowFontScaling={false}>
        {status.emoji}
      </Text>
    </Animated.View>
  );
}

/**
 * "What are you up to": an emoji and a few words for every circle, for 1, 4 or 24 hours
 * (BARGU_PLAN §4.3). Encrypted per circle like a location; it ends by itself.
 */
export const StatusSheet = forwardRef<SheetRef, { onClose: () => void }>(function StatusSheet(
  { onClose },
  ref,
) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const current = useMyStatus((state) => state.status);
  const [emoji, setEmoji] = useState<string | null>(current?.emoji ?? EMOJIS[0]);
  const [text, setText] = useState(current?.text ?? '');
  const [hours, setHours] = useState<(typeof STATUS_DURATIONS_H)[number]>(4);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const trimmed = text.trim();
      await setStatus({ emoji, text: trimmed === '' ? null : trimmed, hours });
      feedback('success');
      onClose();
    } catch (failure) {
      toast.error(errorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await clearStatus();
      setText('');
      onClose();
    } catch (failure) {
      toast.error(errorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet ref={ref} title={t('status.title')} testID="status-sheet">
      <View
        style={styles.emojis}
        accessibilityRole="radiogroup"
        accessibilityLabel={t('status.emoji')}
      >
        {EMOJIS.map((value) => {
          const selected = value === emoji;
          return (
            <PressableScale
              key={value}
              haptic="select"
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={value}
              onPress={() => {
                setEmoji(selected ? null : value);
              }}
              style={[
                styles.emoji,
                {
                  backgroundColor: selected ? colors.primarySoft : colors.surface,
                  borderColor: selected ? colors.primary : 'transparent',
                },
              ]}
            >
              <Text variant="title2" allowFontScaling={false}>
                {value}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      <TextField
        label={t('status.text')}
        value={text}
        onChangeText={setText}
        maxLength={STATUS_TEXT_MAX}
        placeholder={t('status.placeholder')}
        helper={t('status.helper')}
      />
      <Segmented
        label={t('status.duration')}
        value={String(hours)}
        onChange={(value) => {
          setHours(STATUS_DURATIONS_H.find((option) => String(option) === value) ?? hours);
        }}
        options={STATUS_DURATIONS_H.map((value) => ({
          value: String(value),
          label: t('status.hours', { hours: value }),
        }))}
      />
      <Button
        testID="status-save"
        label={t('status.save')}
        onPress={() => void save()}
        loading={busy}
        disabled={emoji === null && text.trim() === ''}
      />
      {current === null ? null : (
        <Button label={t('status.clear')} variant="ghost" onPress={() => void remove()} />
      )}
    </Sheet>
  );
});

const styles = StyleSheet.create({
  bubble: {
    minWidth: touchTarget - space.md,
    paddingHorizontal: space.sm,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
    alignItems: 'center',
  },
  emojis: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  emoji: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
