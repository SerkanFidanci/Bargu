import type { Avatar as AvatarData } from '@bargu/schemas';
import { Image, StyleSheet, View } from 'react-native';

import { avatarPalette, avatarSize, avatarText, useTheme } from '@/theme';

import { useAvatarPhotos } from './avatar-photos';
import { Text } from './text';

export interface AvatarProps {
  avatar: AvatarData | null;
  /** Name for the initial and the screen reader label. */
  name: string;
  size?: keyof typeof avatarSize;
  /** Greyed out: stale location or ghost mode. */
  muted?: boolean;
  /** Ring in the screen background colour, so stacked avatars stay separate. */
  ring?: boolean;
  /** Whose avatar: their profile photo shows instead of the emoji when this phone has it. */
  userId?: string | undefined;
}

/** First letter of the name in its own locale casing (`i` → `İ` for Turkish names). */
export function initialOf(name: string): string {
  const code = name.trim().codePointAt(0);
  return code === undefined ? '?' : String.fromCodePoint(code).toLocaleUpperCase('tr');
}

export function Avatar({
  avatar,
  name,
  size = 'md',
  muted = false,
  ring = false,
  userId,
}: AvatarProps) {
  const { colors } = useTheme();
  const photo = useAvatarPhotos((state) => (userId === undefined ? undefined : state[userId]));
  const diameter = avatarSize[size];
  const background = muted ? colors.ghost : avatarPalette[avatar?.color ?? 0];
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={name}
      style={[
        styles.circle,
        {
          width: diameter,
          height: diameter,
          backgroundColor: background,
          borderColor: colors.background,
          borderWidth: ring ? Math.max(2, diameter / 20) : 0,
        },
      ]}
    >
      {photo === undefined ? null : (
        <Image
          source={{ uri: photo }}
          style={[StyleSheet.absoluteFill, muted ? styles.muted : null]}
          accessibilityIgnoresInvertColors
        />
      )}
      <Text
        // The avatar has a fixed size: its glyph must not grow with the text size setting.
        allowFontScaling={false}
        variant="headline"
        style={{
          color: avatarText,
          fontSize: diameter * (avatar?.emoji ? 0.55 : 0.42),
          lineHeight: diameter * 0.7,
        }}
        importantForAccessibility="no"
      >
        {photo === undefined ? (avatar?.emoji ?? initialOf(name)) : ''}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  circle: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Stale or invited: the photo fades towards the ghost colour behind it.
  muted: { opacity: 0.35 },
});
