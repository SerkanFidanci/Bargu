import { HandHeart } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { duration, space } from '@/theme';
import { useEffects } from '@/theme/effects';

import { RoundButton } from './map-shortcuts';

/**
 * "Güvendeyim" on the map (docs/ADR/0029): one tap to the sheet that tells the circles you pick
 * that you are safe. At the left edge, above the dock: the right edge keeps its three shortcuts
 * (docs/ADR/0026 §8). It does not move, glow or pulse on its own.
 */
export function SafeButton({ bottom, onPress }: { bottom: number; onPress: () => void }) {
  const { t } = useTranslation();
  const level = useEffects();
  return (
    <View style={[styles.column, { bottom }]} pointerEvents="box-none" testID="map-safe">
      <Animated.View entering={FadeIn.duration(level === 'off' ? duration.instant : duration.fast)}>
        <RoundButton
          testID="shortcut-safe"
          icon={HandHeart}
          label={t('map.shortcuts.safe')}
          onPress={onPress}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { position: 'absolute', left: space.lg, alignItems: 'center' },
});
