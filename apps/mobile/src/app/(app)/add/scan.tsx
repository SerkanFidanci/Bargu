import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { inviteTokenFrom } from '@/features/circles/invite-link';
import { guardianTokenFrom } from '@/features/guardians/guardian-link';
import { ambient, space } from '@/theme';
import { feedback } from '@/theme/haptics';
import { useMotion } from '@/theme/use-motion';
import { Appear } from '@/ui/appear';
import { QrScanner } from '@/ui/qr-scanner';
import { Screen } from '@/ui/screen';
import { Text } from '@/ui/text';

const MAX_VIEWFINDER = 320;

/** Scans a friend's or a circle's Bargu code, then shows who invites before anything happens. */
export default function ScanScreen() {
  const { t } = useTranslation();
  const motion = useMotion();
  const { width } = useWindowDimensions();
  const [wrong, setWrong] = useState(false);

  // A code that is not Bargu's: say so, then keep scanning.
  useEffect(() => {
    if (!wrong) return;
    const timer = setTimeout(() => {
      setWrong(false);
    }, ambient.noticeHold);
    return () => {
      clearTimeout(timer);
    };
  }, [wrong]);

  return (
    <Screen title={t('add.scan')}>
      <Appear index={0}>
        <Text variant="callout" color="textMuted" align="center">
          {t('add.scanBody')}
        </Text>
      </Appear>
      <Appear index={1} style={styles.viewfinder}>
        <QrScanner
          size={Math.min(width - space.xl * 2, MAX_VIEWFINDER)}
          paused={wrong}
          onScan={(data) => {
            // A child's guardian code: the parent's yes (docs/ADR/0023 §4).
            const guardian = guardianTokenFrom(data);
            if (guardian !== null) {
              feedback('success');
              router.replace({ pathname: '/g/[token]', params: { token: guardian } });
              return;
            }
            const invite = inviteTokenFrom(data);
            if (invite === null) {
              feedback('error');
              setWrong(true);
              return;
            }
            feedback('success');
            router.replace({ pathname: '/i/[token]', params: { token: invite } });
          }}
        />
      </Appear>
      <View style={styles.message}>
        {wrong ? (
          <Animated.View entering={motion.pop} exiting={motion.fadeOut}>
            <Text variant="callout" color="danger" align="center">
              {t('add.notBargu')}
            </Text>
          </Animated.View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  viewfinder: { alignItems: 'center' },
  message: { minHeight: space.xxxl, justifyContent: 'center' },
});
