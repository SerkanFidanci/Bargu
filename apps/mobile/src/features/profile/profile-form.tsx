import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  type Avatar as AvatarData,
  displayNameSchema,
} from '@bargu/schemas';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { avatarPalette, radius, space, touchTarget, useTheme } from '@/theme';
import { AvatarMarker } from '@/ui/avatar-marker';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

export interface ProfileDraft {
  displayName: string;
  avatar: AvatarData;
}

export interface ProfileFormProps {
  draft: ProfileDraft;
  onChange: (draft: ProfileDraft) => void;
  nameError: boolean;
}

/** Validity of a draft as the server will judge it (same shared schema). */
export function isValidDisplayName(name: string): boolean {
  return displayNameSchema.safeParse(name).success;
}

/** Name, colour and emoji, with a live preview of the map marker friends will see. */
export function ProfileForm({ draft, onChange, nameError }: ProfileFormProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const set = (patch: Partial<ProfileDraft>) => {
    onChange({ ...draft, ...patch });
  };
  const setAvatar = (patch: Partial<AvatarData>) => {
    set({ avatar: { ...draft.avatar, ...patch } });
  };

  return (
    <View style={styles.form}>
      <View
        style={[styles.preview, { backgroundColor: colors.surface }]}
        accessible
        accessibilityLabel={t('onboarding.profile.preview')}
      >
        <AvatarMarker name={draft.displayName || '?'} avatar={draft.avatar} />
        <Text variant="footnote" color="textMuted" importantForAccessibility="no">
          {t('onboarding.profile.preview')}
        </Text>
      </View>

      <TextField
        testID="name-input"
        label={t('onboarding.profile.nameLabel')}
        placeholder={t('onboarding.profile.namePlaceholder')}
        value={draft.displayName}
        onChangeText={(displayName) => {
          set({ displayName });
        }}
        error={nameError ? t('onboarding.profile.nameInvalid') : null}
        autoComplete="name"
        textContentType="nickname"
        maxLength={40}
      />

      <Text variant="subhead" color="textMuted">
        {t('onboarding.profile.color')}
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        {Array.from({ length: AVATAR_COLORS }, (_, color) => {
          const selected = draft.avatar.color === color;
          return (
            <PressableScale
              key={color}
              haptic="select"
              accessibilityRole="radio"
              accessibilityLabel={t('onboarding.profile.colorOption', { number: color + 1 })}
              accessibilityState={{ selected }}
              onPress={() => {
                setAvatar({ color });
              }}
              style={[
                styles.swatch,
                {
                  backgroundColor: avatarPalette[color],
                  borderColor: selected ? colors.text : 'transparent',
                },
              ]}
            >
              {selected ? <Check color={colors.onPrimary} size={20} strokeWidth={3} /> : null}
            </PressableScale>
          );
        })}
      </View>

      <Text variant="subhead" color="textMuted">
        {t('onboarding.profile.emoji')}
      </Text>
      <View style={styles.grid} accessibilityRole="radiogroup">
        <EmojiChoice
          label={t('onboarding.profile.noEmoji')}
          glyph="Aa"
          selected={draft.avatar.emoji === null}
          onPress={() => {
            setAvatar({ emoji: null });
          }}
        />
        {AVATAR_EMOJIS.map((emoji) => (
          <EmojiChoice
            key={emoji}
            label={emoji}
            glyph={emoji}
            selected={draft.avatar.emoji === emoji}
            onPress={() => {
              setAvatar({ emoji });
            }}
          />
        ))}
      </View>
    </View>
  );
}

function EmojiChoice({
  label,
  glyph,
  selected,
  onPress,
}: {
  label: string;
  glyph: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      haptic="select"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.swatch,
        {
          backgroundColor: selected ? colors.primarySoft : colors.surface,
          borderColor: selected ? colors.primary : 'transparent',
        },
      ]}
    >
      <Text variant="headline" allowFontScaling={false} importantForAccessibility="no">
        {glyph}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  form: { gap: space.md },
  preview: {
    alignItems: 'center',
    gap: space.sm,
    paddingVertical: space.xl,
    borderRadius: radius.lg,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  swatch: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
