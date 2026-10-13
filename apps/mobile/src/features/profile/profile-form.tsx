import {
  AVATAR_COLORS,
  AVATAR_EMOJIS,
  type Avatar as AvatarData,
  displayNameSchema,
} from '@bargu/schemas';
import { Check } from 'lucide-react-native';
import { type ReactNode, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { type StyleProp, StyleSheet, View, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { avatarPalette, choreography, radius, space, spring, touchTarget, useTheme } from '@/theme';
import { useMotion } from '@/theme/use-motion';
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
  const motion = useMotion();
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
        {/* Re-mounted on every avatar change, so the preview pops with the new look. */}
        <Animated.View
          key={`${String(draft.avatar.color)}-${draft.avatar.emoji ?? ''}`}
          entering={motion.pop}
        >
          <AvatarMarker name={draft.displayName || '?'} avatar={draft.avatar} />
        </Animated.View>
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
            <Choice
              key={color}
              label={t('onboarding.profile.colorOption', { number: color + 1 })}
              selected={selected}
              onPress={() => {
                setAvatar({ color });
              }}
              style={{
                backgroundColor: avatarPalette[color],
                borderColor: selected ? colors.text : 'transparent',
              }}
            >
              {selected ? (
                <Animated.View entering={motion.pop}>
                  <Check color={colors.onPrimary} size={20} strokeWidth={3} />
                </Animated.View>
              ) : null}
            </Choice>
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

/** A round radio choice that grows a little while selected. */
function Choice({
  label,
  selected,
  onPress,
  style,
  children,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  style: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const scale = useSharedValue(selected ? choreography.pop : 1);
  useEffect(() => {
    scale.set(withSpring(selected ? choreography.pop : 1, spring.bouncy));
  }, [scale, selected]);
  const grow = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  return (
    <PressableScale
      haptic="select"
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
    >
      <Animated.View style={[styles.swatch, style, grow]}>{children}</Animated.View>
    </PressableScale>
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
    <Choice
      label={label}
      selected={selected}
      onPress={onPress}
      style={{
        backgroundColor: selected ? colors.primarySoft : colors.surface,
        borderColor: selected ? colors.primary : 'transparent',
      }}
    >
      <Text variant="headline" allowFontScaling={false} importantForAccessibility="no">
        {glyph}
      </Text>
    </Choice>
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
