import { Check } from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { Hint } from '@/ui/hint';
import { PressableScale } from '@/ui/pressable-scale';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { StepSlider } from '@/ui/step-slider';
import { Text } from '@/ui/text';

import { useNow } from './clock';
import { updateSharing } from './location-session';
import {
  clockOf,
  type PersonShareChoice,
  type PersonShareMode,
  personShareOf,
  untilChoices,
  withPersonShare,
} from './person-share';
import { cancelShareEnd, scheduleShareEnd } from './share-ends';
import { useSharing } from './sharing';

/** A friendship and its friend's name: whose sharing the sheet sets. */
export interface PersonShareTarget {
  circleId: string;
  name: string;
}

/** The default end: two hours from now, the fourth half hour offered. */
const DEFAULT_UNTIL = 3;

/**
 * "Paylaşım" from a friend's card (docs/ADR/0038): show them the location with no end, until a
 * time, frozen (the last location stays, nothing new goes, and they are not told), or not at all.
 * For this friendship only; the user's groups keep their own settings. Each choice applies at once;
 * a time sets the phone's own line for its end.
 */
function PersonShareBody({ target }: { target: PersonShareTarget }) {
  const { t, i18n } = useTranslation();
  const settings = useSharing();
  const now = useNow();
  const current = personShareOf(settings, target.circleId, now);
  const ends = untilChoices(now);
  const [picked, setPicked] = useState<number | null>(null);
  const until =
    current.mode === 'until' && current.until !== null
      ? current.until
      : (picked ?? ends[DEFAULT_UNTIL] ?? now);
  // The slider's stops, with the current end among them even if it is not on a half hour.
  const stops = [...new Set([...ends, ...(current.mode === 'until' ? [until] : [])])].sort(
    (a, b) => a - b,
  );

  const choose = (choice: PersonShareChoice) => {
    updateSharing((settings) => withPersonShare(settings, target.circleId, choice));
    if (choice.mode === 'until') {
      setPicked(choice.until);
      void scheduleShareEnd(target.circleId, choice.until, {
        title: 'Bargu',
        body: t('location.personShare.endedMine', { name: target.name }),
      }).catch(() => undefined);
    } else {
      void cancelShareEnd(target.circleId).catch(() => undefined);
    }
  };

  const rows: {
    mode: PersonShareMode;
    title: string;
    detail: string;
    choice: PersonShareChoice;
  }[] = [
    {
      mode: 'always',
      title: t('location.personShare.always'),
      detail: t('location.personShare.alwaysDetail'),
      choice: { mode: 'always' },
    },
    {
      mode: 'until',
      title:
        current.mode === 'until'
          ? t('location.personShare.untilTime', { time: clockOf(until, i18n.language) })
          : t('location.personShare.until'),
      detail: t('location.personShare.untilDetail'),
      choice: { mode: 'until', until },
    },
    {
      mode: 'frozen',
      title: t('location.personShare.frozen'),
      detail: t('location.personShare.frozenDetail', { name: target.name }),
      choice: { mode: 'frozen' },
    },
    {
      mode: 'off',
      title: t('location.personShare.off'),
      detail: t('location.personShare.offDetail', { name: target.name }),
      choice: { mode: 'off' },
    },
  ];

  return (
    <View style={styles.body}>
      <Text variant="callout" color="textMuted">
        {t('location.personShare.intro', { name: target.name })}
      </Text>
      {settings.ghost === 'off' ? null : <Hint>{t('location.personShare.ghost')}</Hint>}
      <View accessibilityRole="radiogroup" style={styles.choices}>
        {rows.map((row) => (
          <Choice
            key={row.mode}
            testID={`person-share-${row.mode}`}
            title={row.title}
            detail={row.detail}
            selected={current.mode === row.mode}
            onPress={() => {
              choose(row.choice);
            }}
          />
        ))}
      </View>
      {current.mode === 'until' ? (
        <StepSlider
          testID="person-share-until-slider"
          label={t('location.personShare.untilLabel')}
          steps={stops.map((at) => ({ value: String(at), label: clockOf(at, i18n.language) }))}
          value={String(until)}
          onChange={(value) => {
            choose({ mode: 'until', until: Number(value) });
          }}
        />
      ) : null}
    </View>
  );
}

/** One of the four choices, read as a radio button. */
function Choice({
  testID,
  title,
  detail,
  selected,
  onPress,
}: {
  testID: string;
  title: string;
  detail: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      haptic="select"
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${title}, ${detail}`}
      onPress={onPress}
      style={[
        styles.choice,
        { backgroundColor: colors.surface, borderColor: selected ? colors.primary : 'transparent' },
      ]}
    >
      <View style={styles.choiceText}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="footnote" color="textMuted">
          {detail}
        </Text>
      </View>
      {selected ? <Check color={colors.primary} size={20} strokeWidth={2.5} /> : null}
    </PressableScale>
  );
}

/** The sheet over the map, opened from a friend's card. */
export const PersonShareSheet = forwardRef<SheetRef, { target: PersonShareTarget | null }>(
  function PersonShareSheet({ target }, ref) {
    const { t } = useTranslation();
    return (
      <Sheet ref={ref} title={t('location.personShare.title')} testID="person-share-sheet">
        {target === null ? null : <PersonShareBody key={target.circleId} target={target} />}
      </Sheet>
    );
  },
);

const styles = StyleSheet.create({
  body: { gap: space.lg },
  choices: { gap: space.sm },
  choice: {
    minHeight: touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  choiceText: { flex: 1, gap: space.xxs },
});
