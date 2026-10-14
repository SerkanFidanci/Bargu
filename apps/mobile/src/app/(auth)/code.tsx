import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { ClipboardPaste, Mail } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, type TextInput, View } from 'react-native';

import { requestCode, verifyCode } from '@/features/auth/auth-store';
import { errorMessage, isApiError } from '@/features/errors';
import { FormScreen } from '@/features/onboarding/form-screen';
import { elevation, orbit, radius, space, useTheme } from '@/theme';
import { feedback } from '@/theme/haptics';
import { Button } from '@/ui/button';
import { type CodePhase, CodeInput } from '@/ui/code-input';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** Login codes have 4 digits (docs/ADR/0012). */
const CODE_LENGTH = 4;
/** Seconds before another code can be requested (the server allows 3 per hour per device). */
const RESEND_AFTER_SECONDS = 60;
/** A code of exactly CODE_LENGTH digits inside copied text (e.g. the whole line of the email). */
const CODE_PATTERN = /(?:^|\D)(\d{4})(?:\D|$)/;

export default function CodeScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ email: string; challengeId: string }>();
  const input = useRef<TextInput>(null);
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<CodePhase>('typing');
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(RESEND_AFTER_SECONDS);

  useEffect(() => {
    if (wait <= 0) return;
    const timer = setTimeout(() => {
      setWait(wait - 1);
    }, 1000);
    return () => {
      clearTimeout(timer);
    };
  }, [wait]);

  // A wrong code stays red for a moment, then the boxes empty for another try.
  useEffect(() => {
    if (phase !== 'wrong') return;
    const timer = setTimeout(() => {
      setCode('');
      setPhase('typing');
      input.current?.focus();
    }, orbit.errorHold);
    return () => {
      clearTimeout(timer);
    };
  }, [phase]);

  const verify = async (value: string) => {
    setPhase('checking');
    setError(null);
    try {
      await verifyCode(challengeId, value);
      feedback('success');
      setPhase('verified');
      // The root layout moves on to onboarding or the map as soon as the profile loads.
    } catch (failure) {
      if (isApiError(failure, 'OTP_INVALID')) setError(t('auth.code.invalid'));
      else if (isApiError(failure, 'OTP_EXPIRED')) setError(t('auth.code.expired'));
      else if (isApiError(failure, 'OTP_LOCKED')) setError(t('auth.code.locked'));
      else if (isApiError(failure, 'ACCOUNT_UNAVAILABLE')) setError(t('auth.code.unavailable'));
      else setError(errorMessage(failure, t));
      setPhase('wrong');
    }
  };

  /** The clipboard is read only when asked to (a login code copied from the email). */
  const paste = async () => {
    const text = await Clipboard.getStringAsync();
    const found = CODE_PATTERN.exec(text)?.[1];
    if (found === undefined) {
      toast.info(t('auth.code.nothingToPaste'));
      return;
    }
    setCode(found);
    void verify(found);
  };

  const resend = async () => {
    try {
      const challenge = await requestCode(params.email);
      setChallengeId(challenge.challengeId);
      setCode('');
      setError(null);
      setPhase('typing');
      setWait(RESEND_AFTER_SECONDS);
      toast.success(t('auth.code.resent'));
    } catch (failure) {
      setError(errorMessage(failure, t));
    }
  };

  const busy = phase === 'checking' || phase === 'verified';
  const status =
    phase === 'checking'
      ? t('auth.code.verifying')
      : phase === 'verified'
        ? t('auth.code.verified')
        : error;

  return (
    <FormScreen
      title={t('auth.code.title')}
      body={t('auth.code.body', { email: params.email })}
      footer={
        <>
          <Button
            label={wait > 0 ? t('auth.code.resendIn', { seconds: wait }) : t('auth.code.resend')}
            variant="secondary"
            disabled={wait > 0 || busy}
            onPress={() => void resend()}
          />
          <Button
            label={t('auth.code.changeEmail')}
            variant="ghost"
            onPress={() => {
              router.back();
            }}
          />
        </>
      }
    >
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surfaceRaised, boxShadow: elevation.raised },
        ]}
      >
        <CodeInput
          ref={input}
          testID="code-input"
          label={t('auth.code.label')}
          length={CODE_LENGTH}
          value={code}
          phase={phase}
          onChange={(value) => {
            setCode(value);
            if (error !== null) setError(null);
          }}
          onComplete={(value) => void verify(value)}
          disabled={busy}
        />
        <Text
          variant="footnote"
          align="center"
          color={phase === 'wrong' ? 'danger' : phase === 'verified' ? 'success' : 'textMuted'}
          accessibilityLiveRegion={phase === 'wrong' ? 'assertive' : 'polite'}
        >
          {status ?? t('auth.code.hint')}
        </Text>
        <PressableScale
          haptic="select"
          disabled={busy}
          onPress={() => void paste()}
          accessibilityRole="button"
          accessibilityLabel={t('auth.code.paste')}
          style={[styles.message, { backgroundColor: colors.surface, borderColor: colors.border }]}
        >
          <View style={[styles.messageIcon, { backgroundColor: colors.background }]}>
            <Mail color={colors.textMuted} size={16} strokeWidth={2.25} />
          </View>
          <View style={styles.messageText}>
            <Text variant="caption" color="textMuted">
              {t('auth.code.messageEyebrow')}
            </Text>
            <Text variant="footnote" numberOfLines={1}>
              {t('auth.code.messageBody')}
            </Text>
          </View>
          <View style={[styles.fill, { backgroundColor: colors.text }]}>
            <ClipboardPaste color={colors.background} size={14} strokeWidth={2.5} />
            <Text variant="caption" style={{ color: colors.background }}>
              {t('auth.code.pasteShort')}
            </Text>
          </View>
        </PressableScale>
      </View>
      <Text variant="footnote" color="textMuted">
        {t('auth.code.oneDevice')}
      </Text>
    </FormScreen>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: radius.xl, padding: space.lg, gap: space.md },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm,
    borderRadius: radius.lg,
    borderWidth: 1,
  },
  messageIcon: {
    width: space.xxl,
    height: space.xxl,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageText: { flex: 1 },
  fill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
  },
});
