import type { Avatar as AvatarData } from '@bargu/schemas';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient } from 'react-native-svg';

import { avatarSize, storyFx, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { brandStops } from '@/ui/brand-fill';

const OFFSET = storyFx.gap + storyFx.ring;

/**
 * An avatar with its story ring (docs/ADR/0035 §8), as on the map's pin: the brand's sweep while
 * one is not opened yet, grey after.
 */
export function StoryAvatar({
  userId,
  name,
  avatar,
  seen,
}: {
  userId: string;
  name: string;
  avatar: AvatarData | null;
  seen: boolean;
}) {
  const { colors } = useTheme();
  const size = avatarSize.lg + OFFSET * 2;
  const gradient = `story-list-${userId}`;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            {brandStops(colors.brandGradient)}
          </LinearGradient>
        </Defs>
        <Circle
          cx={size / 2}
          cy={size / 2}
          r={(size - storyFx.ring) / 2}
          stroke={seen ? colors.textMuted : `url(#${gradient})`}
          strokeWidth={storyFx.ring}
          fill="none"
        />
      </Svg>
      <View style={styles.inner}>
        <Avatar avatar={avatar} name={name} size="lg" userId={userId} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { position: 'absolute', top: OFFSET, left: OFFSET },
});
