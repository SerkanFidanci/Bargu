import type { ReactNode } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';

import { useMotion } from '@/theme/use-motion';

export interface AppearProps {
  /** Position in its group: later elements enter a little after earlier ones. */
  index?: number;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/** Wraps content so it slides up into place when it mounts (fades only with Reduce Motion). */
export function Appear({ index = 0, style, children }: AppearProps) {
  const motion = useMotion();
  return (
    <Animated.View entering={motion.enterUpAt(index)} style={style}>
      {children}
    </Animated.View>
  );
}
