import type { Avatar as AvatarData } from '@bargu/schemas';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient } from 'react-native-svg';

import { avatarSize, storyFx, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { brandStops, useGradientId } from '@/ui/brand-fill';

const OFFSET = storyFx.gap + storyFx.ring;

/**
 * The story ring around an avatar of `inner` size (docs/ADR/0035 §8), as on the map's pin: the
 * brand's sweep while one is not opened yet, grey after. It lies around its parent, outside it.
 */
export function StoryRing({ inner, seen }: { inner: number; seen: boolean }) {
  const { colors } = useTheme();
  const size = inner + OFFSET * 2;
  const gradient = useGradientId('story');
  return (
    <Svg
      width={size}
      height={size}
      pointerEvents="none"
      style={[styles.ring, { top: -OFFSET, left: -OFFSET }]}
    >
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
  );
}

/** An avatar with its story ring, room for the ring included (the stories' row). */
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
  const size = avatarSize.lg + OFFSET * 2;
  return (
    <View style={{ width: size, height: size }}>
      <View style={styles.inner}>
        <StoryRing inner={avatarSize.lg} seen={seen} />
        <Avatar avatar={avatar} name={name} size="lg" userId={userId} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  ring: { position: 'absolute' },
  inner: { position: 'absolute', top: OFFSET, left: OFFSET },
});
