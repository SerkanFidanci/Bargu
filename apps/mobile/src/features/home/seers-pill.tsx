import { ChevronRight, Eye, Ghost } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';

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
 * "Who sees me", always on screen (BARGU_PLAN §2: no hidden sharing), on one line as thin as the
 * weather beside it (the owner, 2026-10-23): how many see it while it is shared, otherwise what is
 * happening to the location right now, in short. The whole of both is read out. Opens the list of
 * who sees it.
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
  const shown =
    now === 'shared'
      ? t('main.seers.short', { count: seers.length })
      : t(`main.seers.shortNow.${now}`);
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
      <Text
        testID="seers-now"
        variant="bodyStrong"
        numberOfLines={1}
        maxFontSizeMultiplier={1.4}
        style={styles.text}
      >
        {shown}
      </Text>
      <ChevronRight color={colors.textMuted} size={20} strokeWidth={2.25} />
    </Pill>
  );
}

const styles = StyleSheet.create({
  text: { flexShrink: 1 },
});
