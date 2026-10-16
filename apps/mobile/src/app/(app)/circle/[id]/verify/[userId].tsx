import {
  checkSafetyNumberQr,
  fromBase64url,
  type SafetyNumber,
  safetyNumberAsync,
  safetyNumberQrMatches,
  type SafetyNumberQrCheck,
} from '@bargu/crypto';
import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams } from 'expo-router';
import { QrCode, ScanLine, ShieldAlert, ShieldCheck, WifiOff } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { useAuth } from '@/features/auth/auth-store';
import { cachedCircle } from '@/features/circles/circle-cache';
import { useCircleKeys } from '@/features/circles/circle-sync';
import { memberName, useCircle } from '@/features/circles/queries';
import { circleSync, keys } from '@/features/live/live-session';
import { radius, space, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { useMotion } from '@/theme/use-motion';
import { Appear } from '@/ui/appear';
import { Badge } from '@/ui/badge';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { QrCode as QrImage } from '@/ui/qr-code';
import { QrScanner } from '@/ui/qr-scanner';
import { Screen } from '@/ui/screen';
import { Skeleton } from '@/ui/skeleton';
import { Text } from '@/ui/text';

const MAX_CODE = 240;

/** Waits one frame: the hashing runs in slices between frames, so the screen keeps animating. */
const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });

/** What a scan came to: a match, a code that is not one, which side differs, or no connection. */
type ScanResult = 'match' | 'checking' | 'offline' | Exclude<SafetyNumberQrCheck, 'match'>;

/** The words for a scan that did not match. */
const MISMATCH = {
  notSafetyNumber: { title: 'verify.notCode', body: 'verify.notCodeBody' },
  theirsDiffers: { title: 'verify.mismatch', body: 'verify.theirsDiffer' },
  mineDiffers: { title: 'verify.mismatch', body: 'verify.mineDiffer' },
  bothDiffer: { title: 'verify.otherPair', body: 'verify.otherPairBody' },
  offline: { title: 'verify.offline', body: 'verify.offlineBody' },
} as const;

/**
 * Safety number with one member (BARGU_PLAN §3.1): the same 60 digits on both phones when nobody is
 * in the middle. Side by side, one phone scans the other's code; a match marks the member verified
 * (and settles a pending key change). Comparing the digits by eye works too. The keys come fresh
 * from the server when the screen opens, and a code that does not match is checked again against
 * fresh keys before the screen says which side sees a different one (proje sahibi 2026-10-16:
 * "Anahtar değişti" on one phone and codes that never matched, an old key kept on the phone).
 */
export default function VerifyScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const motion = useMotion();
  const { width } = useWindowDimensions();
  const { id, userId } = useLocalSearchParams<{ id: string; userId: string }>();
  const circle = useCircle(id);
  const member = circle?.members.find((candidate) => candidate.userId === userId);
  const me = useAuth((state) => state.userId);
  const device = useAuth((state) => state.device);
  const trust = useCircleKeys((state) => state[id]?.trust[userId]);
  const celebrate = useCelebration((state) => state.celebrate);
  const [computed, setComputed] = useState<{ key: string; number: SafetyNumber } | null>(null);
  const [mode, setMode] = useState<'show' | 'scan'>('show');
  const [result, setResult] = useState<ScanResult | null>(null);
  const queryClient = useQueryClient();
  // The code last looked at: the scanner keeps reading it, it is checked once.
  const scanned = useRef<string | null>(null);
  const identityKey = member?.device?.bundle.identityKey ?? null;

  useEffect(() => {
    void circleSync.refresh(id).catch(() => undefined);
  }, [id]);
  // A number computed for an earlier key (it changed meanwhile) is never shown.
  const number = computed !== null && computed.key === identityKey ? computed.number : null;

  useEffect(() => {
    if (identityKey === null || device === null || me === null) return;
    let cancelled = false;
    safetyNumberAsync(
      { userId: me, identityKey: device.identity.publicKey },
      { userId, identityKey: fromBase64url(identityKey, 32) },
      nextFrame,
    ).then(
      (result) => {
        if (!cancelled) setComputed({ key: identityKey, number: result });
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [device, identityKey, me, userId]);

  const name = member === undefined ? '' : memberName(member);
  const size = Math.min(width - space.xxxl * 2, MAX_CODE);

  const verified = (key: string) => {
    keys().markVerified(userId, key);
    void circleSync.resyncMember(userId).catch(() => undefined);
    feedback('success');
    celebrate();
    setResult('match');
    setMode('show');
  };

  /** A code that did not match: their key once more from the server, then which half differs. */
  const recheck = async (data: string, mine: { userId: string; identityKey: Uint8Array }) => {
    const reached = await circleSync.refresh(id).then(
      () => true,
      () => false,
    );
    const fresh =
      cachedCircle(queryClient, id)?.members.find((candidate) => candidate.userId === userId)
        ?.device?.bundle.identityKey ?? identityKey;
    if (fresh === null) return;
    const check = await checkSafetyNumberQr(
      data,
      mine,
      { userId, identityKey: fromBase64url(fresh, 32) },
      nextFrame,
    );
    if (check === 'match') {
      verified(fresh);
      return;
    }
    feedback('error');
    // Their key could not be asked for again: say so rather than suspect anyone.
    setResult(!reached && check === 'theirsDiffers' ? 'offline' : check);
  };

  const onScan = (data: string) => {
    if (number === null || identityKey === null || device === null || me === null) return;
    if (data === scanned.current) return;
    scanned.current = data;
    if (safetyNumberQrMatches(data, number)) {
      verified(identityKey);
      return;
    }
    setResult('checking');
    void recheck(data, { userId: me, identityKey: device.identity.publicKey }).catch(() => {
      setResult('offline');
    });
  };

  return (
    <Screen
      title={t('verify.title')}
      subtitle={name}
      footer={
        <Button
          label={mode === 'show' ? t('verify.scanTheirs') : t('verify.showMine')}
          icon={mode === 'show' ? ScanLine : QrCode}
          variant="secondary"
          disabled={number === null}
          onPress={() => {
            setResult(null);
            scanned.current = null;
            setMode(mode === 'show' ? 'scan' : 'show');
          }}
        />
      }
    >
      <Appear index={0} style={styles.center}>
        {trust === 'verified' || result === 'match' ? (
          <Badge label={t('circles.trust.verified')} tone="success" icon={ShieldCheck} />
        ) : trust === 'changed' ? (
          <Badge label={t('circles.trust.changed')} tone="danger" icon={ShieldAlert} />
        ) : (
          <Badge label={t('circles.trust.unverified')} icon={ShieldCheck} />
        )}
      </Appear>
      <Appear index={1}>
        <Text variant="callout" color="textMuted" align="center">
          {t('verify.body', { name })}
        </Text>
      </Appear>

      {result === 'match' ? (
        <Animated.View
          entering={motion.pop}
          style={[styles.result, { backgroundColor: colors.surface }]}
        >
          <ShieldCheck color={colors.success} size={40} strokeWidth={2} />
          <Text variant="headline" align="center">
            {t('verify.matched', { name })}
          </Text>
        </Animated.View>
      ) : null}
      {result === 'checking' ? (
        <Text variant="footnote" color="textMuted" align="center">
          {t('verify.checking')}
        </Text>
      ) : null}
      {result !== null && result !== 'match' && result !== 'checking' ? (
        <Animated.View
          entering={motion.pop}
          style={[styles.result, { backgroundColor: colors.surface }]}
        >
          {result === 'offline' ? (
            <WifiOff color={colors.textMuted} size={40} strokeWidth={2} />
          ) : (
            <ShieldAlert color={colors.danger} size={40} strokeWidth={2} />
          )}
          <Text variant="headline" align="center">
            {t(MISMATCH[result].title)}
          </Text>
          <Text variant="footnote" color="textMuted" align="center">
            {t(MISMATCH[result].body, { name })}
          </Text>
        </Animated.View>
      ) : null}

      {mode === 'scan' ? (
        <Appear style={styles.center}>
          <QrScanner
            size={size}
            onScan={onScan}
            paused={result === 'match' || result === 'checking'}
          />
        </Appear>
      ) : (
        <>
          <View style={styles.center}>
            {number === null ? (
              <Skeleton width={size} height={size} />
            ) : (
              <QrImage value={number.qr} size={size} label={t('verify.codeLabel', { name })} />
            )}
          </View>
          <View
            style={styles.grid}
            accessible
            accessibilityLabel={
              number === null
                ? t('verify.computing')
                : t('verify.digitsLabel', { digits: number.groups.join(' ') })
            }
          >
            {number === null
              ? Array.from({ length: 12 }, (_, index) => (
                  <View key={index} style={styles.cell}>
                    <Skeleton width="100%" height={space.xl} />
                  </View>
                ))
              : number.groups.map((group, index) => (
                  <Animated.View key={index} entering={motion.popAt(index)} style={styles.cell}>
                    <Text variant="code" align="center">
                      {group}
                    </Text>
                  </Animated.View>
                ))}
          </View>
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  result: { alignItems: 'center', gap: space.sm, padding: space.lg, borderRadius: radius.lg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space.md },
  cell: { width: '33.33%', paddingHorizontal: space.xs },
});
