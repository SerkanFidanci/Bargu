import {
  BottomSheetBackdrop,
  type BottomSheetBackdropProps,
  BottomSheetModal,
  BottomSheetScrollView,
  useBottomSheetSpringConfigs,
} from '@gorhom/bottom-sheet';
import { forwardRef, type ReactNode, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet } from 'react-native';
import { ReduceMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, space, spring, useTheme } from '@/theme';

import { Text } from './text';

export type SheetRef = BottomSheetModal;

export interface SheetProps {
  title: string;
  children: ReactNode;
  onDismiss?: () => void;
  testID?: string;
}

/**
 * Every secondary screen is a sheet over the map (BARGU_PLAN §4.1). Sized to its content, dragged
 * on the UI thread, dismissed by swipe or by tapping the dimmed map.
 */
export const Sheet = forwardRef<SheetRef, SheetProps>(function Sheet(
  { title, children, onDismiss, testID },
  ref,
) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const animationConfigs = useBottomSheetSpringConfigs(spring.snappy);

  const backdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior="close"
        style={[props.style, { backgroundColor: colors.scrim }]}
        opacity={1}
        accessibilityLabel={t('ui.sheet.close')}
      />
    ),
    [colors.scrim, t],
  );

  return (
    <BottomSheetModal
      ref={ref}
      enableDynamicSizing
      animationConfigs={animationConfigs}
      overrideReduceMotion={ReduceMotion.System}
      backdropComponent={backdrop}
      backgroundStyle={{ backgroundColor: colors.surfaceRaised, borderRadius: radius.xl }}
      handleIndicatorStyle={{ backgroundColor: colors.border }}
      topInset={insets.top}
      {...(onDismiss === undefined ? {} : { onDismiss })}
    >
      <BottomSheetScrollView
        testID={testID}
        contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + space.xl }]}
      >
        <Text variant="title2" accessibilityRole="header">
          {title}
        </Text>
        {children}
      </BottomSheetScrollView>
    </BottomSheetModal>
  );
});

const styles = StyleSheet.create({
  content: { paddingHorizontal: space.xl, paddingTop: space.sm, gap: space.lg },
});
