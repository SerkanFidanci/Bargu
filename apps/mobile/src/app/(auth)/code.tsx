import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TextInput } from 'react-native';

import { requestCode, verifyCode } from '@/features/auth/auth-store';
import { errorMessage, isApiError } from '@/features/errors';
import { FormScreen } from '@/features/onboarding/form-screen';
import { feedback } from '@/theme/haptics';
import { Button } from '@/ui/button';
import { CodeInput } from '@/ui/code-input';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

/** Login codes have 8 digits (docs/ADR/0005). */
const CODE_LENGTH = 8;
/** Seconds before another code can be requested (the server allows 3 per hour per device). */
const RESEND_AFTER_SECONDS = 60;

export default function CodeScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ email: string; challengeId: string }>();
  const input = useRef<TextInput>(null);
  const [challengeId, setChallengeId] = useState(params.challengeId);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
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

  const verify = async (value: string) => {
    setVerifying(true);
    setError(null);
    try {
      await verifyCode(challengeId, value);
      feedback('success');
      // The root layout moves on to onboarding or the map as soon as the profile loads.
    } catch (failure) {
      setCode('');
      if (isApiError(failure, 'OTP_INVALID')) setError(t('auth.code.invalid'));
      else if (isApiError(failure, 'OTP_EXPIRED')) setError(t('auth.code.expired'));
      else if (isApiError(failure, 'OTP_LOCKED')) setError(t('auth.code.locked'));
      else if (isApiError(failure, 'ACCOUNT_UNAVAILABLE')) setError(t('auth.code.unavailable'));
      else setError(errorMessage(failure, t));
      input.current?.focus();
    } finally {
      setVerifying(false);
    }
  };

  const resend = async () => {
    try {
      const challenge = await requestCode(params.email);
      setChallengeId(challenge.challengeId);
      setCode('');
      setError(null);
      setWait(RESEND_AFTER_SECONDS);
      toast.success(t('auth.code.resent'));
    } catch (failure) {
      setError(errorMessage(failure, t));
    }
  };

  return (
    <FormScreen
      title={t('auth.code.title')}
      body={t('auth.code.body', { email: params.email })}
      footer={
        <>
          <Button
            label={wait > 0 ? t('auth.code.resendIn', { seconds: wait }) : t('auth.code.resend')}
            variant="secondary"
            disabled={wait > 0 || verifying}
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
      <CodeInput
        ref={input}
        testID="code-input"
        label={t('auth.code.label')}
        length={CODE_LENGTH}
        value={code}
        onChange={(value) => {
          setCode(value);
          if (error !== null) setError(null);
        }}
        onComplete={(value) => void verify(value)}
        error={error !== null}
        disabled={verifying}
      />
      {verifying ? (
        <Text variant="footnote" color="textMuted" accessibilityLiveRegion="polite">
          {t('auth.code.verifying')}
        </Text>
      ) : error === null ? null : (
        <Text variant="footnote" color="danger" accessibilityLiveRegion="assertive">
          {error}
        </Text>
      )}
      <Text variant="footnote" color="textMuted">
        {t('auth.code.oneDevice')}
      </Text>
    </FormScreen>
  );
}
