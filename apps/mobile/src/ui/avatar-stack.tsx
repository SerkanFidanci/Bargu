import type { Avatar as AvatarData } from '@bargu/schemas';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { avatarSize, space, useTheme } from '@/theme';

import { Avatar } from './avatar';
import { Text } from './text';

export interface StackPerson {
  id: string;
  name: string;
  avatar: AvatarData | null;
}

export interface AvatarStackProps {
  people: readonly StackPerson[];
  /** How many avatars to draw before collapsing the rest into "+N". */
  max?: number;
  size?: 'sm' | 'md';
}

/** Overlapping avatars (e.g. "who can see me"), read out as one sentence. */
export function AvatarStack({ people, max = 3, size = 'sm' }: AvatarStackProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;
  const diameter = avatarSize[size];

  return (
    <View
      accessible
      accessibilityLabel={t('ui.avatarStack', {
        count: people.length,
        names: people.map((person) => person.name).join(', '),
      })}
      style={styles.row}
    >
      {shown.map((person, index) => (
        <View key={person.id} style={{ marginLeft: index === 0 ? 0 : -diameter / 3 }}>
          <Avatar avatar={person.avatar} name={person.name} size={size} ring userId={person.id} />
        </View>
      ))}
      {rest > 0 ? (
        <View
          style={[
            styles.more,
            {
              marginLeft: -diameter / 3,
              height: diameter,
              minWidth: diameter,
              borderRadius: diameter / 2,
              backgroundColor: colors.surface,
              borderColor: colors.background,
            },
          ]}
        >
          <Text variant="caption" allowFontScaling={false}>{`+${String(rest)}`}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  more: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
    borderWidth: 2,
  },
});
