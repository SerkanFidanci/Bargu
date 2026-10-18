import { CameraView, useCameraPermissions } from 'expo-camera';
import { Camera } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { ambient, qrColors, radius, space, useTheme } from '@/theme';
import { useEffects } from '@/theme/effects';

import { Button } from './button';
import { EmptyState } from './empty-state';

export interface QrScannerProps {
  /** Called once per code; scanning resumes when `paused` turns false again. */
  onScan: (data: string) => void;
  paused?: boolean;
  /** Side length of the square viewfinder. */
  size: number;
}

const CORNER = 28;
const CORNER_WIDTH = 4;
const LINE_HEIGHT = 3;

/**
 * Camera viewfinder for QR codes: a rounded square with corner marks and a line sweeping over it.
 * Asks for the camera only here, explaining why first; a refused permission links to settings.
 */
export function QrScanner({ onScan, paused = false, size }: QrScannerProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const reduced = useEffects() !== 'full';
  const sweep = useSharedValue(0);
  const last = useRef<string | null>(null);
  const [asking, setAsking] = useState(false);

  // Stops (and settles) the moment sade mod leaves "full", not only on the next visit (QA 23).
  useEffect(() => {
    if (reduced) {
      cancelAnimation(sweep);
      sweep.set(0);
      return;
    }
    sweep.set(
      withRepeat(
        withTiming(1, { duration: ambient.scanLine, easing: Easing.inOut(Easing.sin) }),
        -1,
        true,
      ),
    );
    return () => {
      cancelAnimation(sweep);
    };
  }, [reduced, sweep]);

  useEffect(() => {
    if (!paused) last.current = null;
  }, [paused]);

  const lineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: sweep.get() * (size - LINE_HEIGHT - CORNER_WIDTH * 2) }],
  }));

  if (permission === null) return <View style={{ width: size, height: size }} />;

  if (!permission.granted) {
    const ask = async () => {
      setAsking(true);
      try {
        await requestPermission();
      } finally {
        setAsking(false);
      }
    };
    return (
      <View style={styles.permission}>
        <EmptyState
          icon={Camera}
          title={t('scan.permissionTitle')}
          body={t('scan.permissionBody')}
        />
        {permission.canAskAgain ? (
          <Button label={t('scan.allow')} onPress={() => void ask()} loading={asking} />
        ) : (
          <Button
            label={t('scan.openSettings')}
            variant="secondary"
            onPress={() => void Linking.openSettings()}
          />
        )}
      </View>
    );
  }

  return (
    <View
      style={[styles.frame, { width: size, height: size, backgroundColor: qrColors.dark }]}
      accessible
      accessibilityLabel={t('scan.viewfinder')}
    >
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={
          paused
            ? undefined
            : ({ data }) => {
                // The camera reports the same code many times a second: hand it over once.
                if (last.current === data) return;
                last.current = data;
                onScan(data);
              }
        }
      />
      {(['topLeft', 'topRight', 'bottomLeft', 'bottomRight'] as const).map((corner) => (
        <View
          key={corner}
          style={[styles.corner, styles[corner], { borderColor: qrColors.light }]}
        />
      ))}
      {reduced ? null : (
        <Animated.View style={[styles.line, { backgroundColor: colors.primary }, lineStyle]} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  permission: { gap: space.lg, alignSelf: 'stretch' },
  frame: { alignSelf: 'center', borderRadius: radius.xl, overflow: 'hidden' },
  corner: { position: 'absolute', width: CORNER, height: CORNER },
  topLeft: {
    top: space.md,
    left: space.md,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: radius.md,
  },
  topRight: {
    top: space.md,
    right: space.md,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: radius.md,
  },
  bottomLeft: {
    bottom: space.md,
    left: space.md,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: radius.md,
  },
  bottomRight: {
    bottom: space.md,
    right: space.md,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: radius.md,
  },
  line: {
    position: 'absolute',
    top: CORNER_WIDTH,
    left: space.xl,
    right: space.xl,
    height: LINE_HEIGHT,
    borderRadius: radius.pill,
  },
});
