import { Check } from 'lucide-react-native';
import { forwardRef, useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedProps,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Circle } from 'react-native-svg';

import {
  choreography,
  orbit,
  radius,
  space,
  spring,
  timing,
  touchTarget,
  typography,
  useTheme,
} from '@/theme';
import { feedback } from '@/theme/haptics';

import { Text } from './text';

/** typing: boxes in a row; checking: on the orbit; verified: one green tile; wrong: back, red. */
export type CodePhase = 'typing' | 'checking' | 'verified' | 'wrong';

export interface CodeInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once all digits are in (typed, pasted or autofilled from the email). */
  onComplete?: (code: string) => void;
  length: number;
  label: string;
  phase?: CodePhase;
  disabled?: boolean;
  testID?: string;
}

const BOX = touchTarget + space.sm;
const GAP = space.md;
const RADIUS = space.xxxl + space.lg;
/** Room for the orbit: boxes circle the hub at RADIUS. */
const STAGE = RADIUS * 2 + BOX;
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Where each box sits on the orbit before it turns: left, top, right, bottom… */
function orbitAngle(index: number, count: number): number {
  'worklet';
  return Math.PI + (index * 2 * Math.PI) / count;
}

/**
 * Login code entry: one real (invisible) text field over a row of boxes, so paste and the OS
 * one-time-code autofill work and screen readers see a single labelled field. Colour is kept for
 * the verdict: the box being typed in is only lit, green comes with a verified code, red with a
 * wrong one. With the last digit the boxes curl onto an orbit and circle it while the code is
 * checked; verified, they screw down a turn and a quarter into one tile; wrong, they unwind into
 * the row and shake. All on the UI thread; Reduce Motion fades instead.
 */
export const CodeInput = forwardRef<TextInput, CodeInputProps>(function CodeInput(
  { value, onChange, onComplete, length, label, phase = 'typing', disabled = false, testID },
  ref,
) {
  const { colors } = useTheme();
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const curl = useSharedValue(0);
  const spin = useSharedValue(0);
  const screw = useSharedValue(0);
  const tile = useSharedValue(0);
  const shake = useSharedValue(0);
  const cells = Array.from({ length }, (_, index) => value[index] ?? '');
  const active = Math.min(value.length, length - 1);

  useEffect(() => {
    const config = (duration: number) => ({ duration, easing: Easing.inOut(Easing.cubic) });
    if (phase === 'checking') {
      curl.set(withTiming(1, config(reduced ? 0 : orbit.curl)));
      if (!reduced) {
        spin.set(spin.get() % (2 * Math.PI));
        spin.set(
          withRepeat(
            withTiming(spin.get() + 2 * Math.PI, { duration: orbit.turn, easing: Easing.linear }),
            -1,
          ),
        );
      }
      return;
    }
    if (phase === 'verified') {
      cancelAnimation(spin);
      const turns = reduced ? 0 : orbit.screwTurns * 2 * Math.PI;
      spin.set(withTiming(spin.get() + turns, config(orbit.screw)));
      screw.set(withTiming(1, config(reduced ? 0 : orbit.screw)));
      tile.set(
        withSequence(
          withTiming(0, { duration: reduced ? 0 : orbit.screw }),
          withSpring(1, spring.bouncy),
        ),
      );
      return;
    }
    // Typing or wrong: back into the row.
    cancelAnimation(spin);
    curl.set(withTiming(0, config(reduced ? 0 : orbit.curl)));
    spin.set(withTiming(0, config(reduced ? 0 : orbit.curl)));
    screw.set(0);
    tile.set(0);
    if (phase !== 'wrong') return;
    feedback('error');
    if (reduced) return;
    const { distance, step, times } = choreography.shake;
    const swing = Array.from({ length: times }, () => [
      withTiming(distance, { duration: step }),
      withTiming(-distance, { duration: step }),
    ]).flat();
    shake.set(
      withSequence(withTiming(0, { duration: orbit.curl }), ...swing, withSpring(0, spring.snappy)),
    );
  }, [phase, reduced, curl, spin, screw, tile, shake]);

  const stage = useAnimatedStyle(() => ({ transform: [{ translateX: shake.get() }] }));
  const ringProps = useAnimatedProps(() => ({
    opacity: curl.get() * (1 - screw.get()) * 0.6,
    r: RADIUS * (1 - screw.get()),
  }));
  const tileStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, tile.get()),
    transform: [{ scale: tile.get() }],
  }));

  return (
    <Pressable
      accessible={false}
      onPress={() => {
        if (ref !== null && typeof ref !== 'function') ref.current?.focus();
      }}
    >
      <Animated.View style={[styles.stage, stage]}>
        <Svg width={STAGE} height={STAGE} style={styles.ring} pointerEvents="none">
          <AnimatedCircle
            cx={STAGE / 2}
            cy={STAGE / 2}
            stroke={colors.textMuted}
            strokeWidth={1.5}
            strokeDasharray={[...orbit.ringDash]}
            strokeLinecap="round"
            fill="none"
            animatedProps={ringProps}
          />
        </Svg>
        {cells.map((digit, index) => (
          <Cell
            key={index}
            index={index}
            count={length}
            digit={digit}
            current={focused && index === active && phase === 'typing'}
            wrong={phase === 'wrong'}
            curl={curl}
            spin={spin}
            screw={screw}
          />
        ))}
        <Animated.View
          pointerEvents="none"
          style={[styles.tile, { backgroundColor: colors.success }, tileStyle]}
        >
          <Check color={colors.onSuccess} size={28} strokeWidth={3} />
        </Animated.View>
      </Animated.View>
      <TextInput
        ref={ref}
        testID={testID}
        value={value}
        editable={!disabled}
        onChangeText={(text) => {
          const digits = text.replace(/\D/g, '').slice(0, length);
          onChange(digits);
          if (digits.length === length) onComplete?.(digits);
        }}
        onFocus={() => {
          setFocused(true);
        }}
        onBlur={() => {
          setFocused(false);
        }}
        accessibilityLabel={label}
        keyboardType="number-pad"
        inputMode="numeric"
        autoComplete="one-time-code"
        textContentType="oneTimeCode"
        maxLength={length}
        caretHidden
        maxFontSizeMultiplier={typography.code.maxScale}
        style={styles.hiddenInput}
      />
    </Pressable>
  );
});

function Cell({
  index,
  count,
  digit,
  current,
  wrong,
  curl,
  spin,
  screw,
}: {
  index: number;
  count: number;
  digit: string;
  current: boolean;
  wrong: boolean;
  curl: SharedValue<number>;
  spin: SharedValue<number>;
  screw: SharedValue<number>;
}) {
  const { colors } = useTheme();
  const pop = useSharedValue(1);

  useEffect(() => {
    if (digit === '') return;
    pop.set(withSequence(withTiming(choreography.pop, timing.fast), withSpring(1, spring.bouncy)));
  }, [digit, pop]);

  const rowX = (index - (count - 1) / 2) * (BOX + GAP);
  const motion = useAnimatedStyle(() => {
    const c = curl.get();
    const s = screw.get();
    const angle = orbitAngle(index, count) + spin.get();
    const reach = RADIUS * (1 - s);
    const x = rowX + (Math.cos(angle) * reach - rowX) * c;
    const y = Math.sin(angle) * reach * c;
    const scale = pop.get() * (1 - c * (1 - orbit.orbitScale)) * (1 - s * 0.6);
    return {
      opacity: 1 - s,
      transform: [{ translateX: x }, { translateY: y }, { scale }],
    };
  });

  // Attention is light, not colour: the current box glows in the text colour; red only for wrong.
  const border = wrong ? colors.danger : current ? colors.text : colors.border;
  return (
    <Animated.View
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      style={[
        styles.cell,
        {
          backgroundColor: colors.surface,
          borderColor: border,
          boxShadow: current ? `0px 0px 12px ${colors.textMuted}` : undefined,
        },
        motion,
      ]}
    >
      <Text variant="code" numberOfLines={1} align="center" color={wrong ? 'danger' : 'text'}>
        {digit}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    width: '100%',
    height: STAGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: { position: 'absolute', alignSelf: 'center' },
  cell: {
    position: 'absolute',
    width: BOX,
    height: BOX,
    borderRadius: radius.md,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tile: {
    position: 'absolute',
    width: BOX,
    height: BOX,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Covers the boxes so a tap anywhere focuses it; invisible but still focusable and autofillable.
  hiddenInput: { ...StyleSheet.absoluteFill, opacity: 0.011, color: 'transparent' },
});
