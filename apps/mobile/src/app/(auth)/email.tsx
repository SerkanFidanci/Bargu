import { emailSchema } from '@bargu/schemas';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { requestCode } from '@/features/auth/auth-store';
import { errorMessage } from '@/features/errors';
import { FormScreen } from '@/features/onboarding/form-screen';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/text-field';

export default function EmailScreen() {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const parsed = emailSchema.safeParse(email.trim());
    if (!parsed.success) {
      setError(t('auth.email.invalid'));
      return;
    }
    setError(null);
    setSending(true);
    try {
      const challenge = await requestCode(parsed.data);
      router.push({
        pathname: '/code',
        params: {
          email: parsed.data,
          challengeId: challenge.challengeId,
          expiresIn: String(challenge.expiresIn),
        },
      });
    } catch (failure) {
      setError(errorMessage(failure, t));
    } finally {
      setSending(false);
    }
  };

  return (
    <FormScreen
      title={t('auth.email.title')}
      body={t('auth.email.body')}
      footer={
        <Button
          label={t('auth.email.submit')}
          onPress={() => void submit()}
          loading={sending}
          disabled={email.trim().length === 0}
          testID="email-submit"
        />
      }
    >
      <TextField
        testID="email-input"
        label={t('auth.email.label')}
        placeholder={t('auth.email.placeholder')}
        value={email}
        onChangeText={(text) => {
          setEmail(text);
          if (error !== null) setError(null);
        }}
        error={error}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        inputMode="email"
        returnKeyType="send"
        onSubmitEditing={() => void submit()}
      />
    </FormScreen>
  );
}
