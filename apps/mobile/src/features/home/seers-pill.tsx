import { ChevronRight, Eye, Ghost } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';
import { AvatarStack, type StackPerson } from '@/ui/avatar-stack';
import { Pill } from '@/ui/pill';
import { Text } from '@/ui/text';

import type { GhostMode } from '../location/sharing';
import type { LocationPermission } from '../location/tracker';

export interface SeersPillProps {
  /** People who can currently see this user's location. */
  seers: readonly StackPerson[];
  ghost: GhostMode;
  permission: LocationPermission;
  onPress: () => void;
}

/**
 * What the second line says about this phone's location, from what is really so (the PM: a
 * safety text): never "shared now" while a ghost (hidden or frozen), with nobody to see it,
 * without the location permission, or before the permission is known (QA 24 B-1: "checking").
 */
export type SharingNow = 'shared' | 'hidden' | 'frozen' | 'nobody' | 'noPermission' | 'checking';

export function sharingNow(input: {
  ghost: GhostMode;
  seers: number;
  permission: LocationPermission;
}): SharingNow {
  if (input.ghost === 'hide') return 'hidden';
  if (input.ghost === 'freeze') return 'frozen';
  if (input.seers === 0) return 'nobody';
  if (input.permission === 'blocked' || input.permission === 'undetermined') return 'noPermission';
  return input.permission === 'granted' ? 'shared' : 'checking';
}

/**
 * "Who sees me", always on screen (BARGU_PLAN §2: no hidden sharing): who, and on a second line
 * what is happening to the location right now. Opens the list of who sees it.
 */
export function SeersPill({ seers, ghost, permission, onPress }: SeersPillProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const now = sharingNow({ ghost, seers: seers.length, permission });
  const title =
    ghost !== 'off'
      ? t('main.seers.ghost')
      : seers.length === 0
        ? t('main.seers.none')
        : t('main.seers.count', { count: seers.length });
  const line = t(`main.seers.now.${now}`);
  return (
    <Pill
      testID="seers-pill"
      onPress={onPress}
      accessibilityLabel={`${title}. ${line}`}
      accessibilityHint={t('main.seers.hint')}
    >
      {ghost !== 'off' ? (
        <Ghost color={colors.primary} size={20} strokeWidth={2.25} />
      ) : seers.length === 0 ? (
        <Eye color={colors.textMuted} size={20} strokeWidth={2.25} />
      ) : (
        <AvatarStack people={seers} />
      )}
      <View style={styles.text}>
        <Text variant="bodyStrong" numberOfLines={2} maxFontSizeMultiplier={1.6}>
          {title}
        </Text>
        <Text
          testID="seers-now"
          variant="footnote"
          color="textMuted"
          numberOfLines={2}
          maxFontSizeMultiplier={1.6}
        >
          {line}
        </Text>
      </View>
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2.25} />
    </Pill>
  );
}

const styles = StyleSheet.create({
  text: { flexShrink: 1 },
});
