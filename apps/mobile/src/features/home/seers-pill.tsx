import { Eye, Ghost } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/theme';
import { AvatarStack, type StackPerson } from '@/ui/avatar-stack';
import { Pill } from '@/ui/pill';
import { Text } from '@/ui/text';

export interface SeersPillProps {
  /** People who can currently see this user's location. */
  seers: readonly StackPerson[];
  /** Ghost mode on: nobody gets new locations, whatever the circles say. */
  ghost: boolean;
  onPress: () => void;
}

/**
 * "Who sees me", always on screen (BARGU_PLAN §2: no hidden sharing). With nobody it says so
 * plainly; with people it shows their avatars; in ghost mode it says that instead.
 */
export function SeersPill({ seers, ghost, onPress }: SeersPillProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const label = ghost
    ? t('main.seers.ghost')
    : seers.length === 0
      ? t('main.seers.none')
      : t('main.seers.count', { count: seers.length });
  return (
    <Pill
      testID="seers-pill"
      onPress={onPress}
      accessibilityLabel={label}
      accessibilityHint={t('main.seers.hint')}
    >
      {ghost ? (
        <Ghost color={colors.primary} size={18} strokeWidth={2.25} />
      ) : seers.length === 0 ? (
        <Eye color={colors.textMuted} size={18} strokeWidth={2.25} />
      ) : (
        <AvatarStack people={seers} />
      )}
      <Text variant="subhead" maxFontSizeMultiplier={1.6}>
        {label}
      </Text>
    </Pill>
  );
}
