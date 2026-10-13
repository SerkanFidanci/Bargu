import { normalizeUsername } from '@bargu/schemas';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/features/errors';
import { FormScreen } from '@/features/onboarding/form-screen';
import { useMe, useUpdateProfile, useUsernameCheck } from '@/features/profile/queries';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/text-field';

/** Onboarding step 1: the name friends find you by, checked live while typing. */
export default function UsernameScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const [input, setInput] = useState(me.data?.username ?? '');
  const [takenOnSave, setTakenOnSave] = useState<string | null>(null);
  const check = useUsernameCheck(input);
  const update = useUpdateProfile({ optimistic: false });
  const username = normalizeUsername(input);

  const status = (() => {
    if (takenOnSave === username) return { error: t('onboarding.username.taken') };
    switch (check.state) {
      case 'empty':
        return { helper: t('onboarding.username.rules') };
      case 'checking':
      case 'unknown':
        return { helper: t('onboarding.username.checking') };
      case 'done':
        if (check.result.available) {
          return { success: t('onboarding.username.available', { username }) };
        }
        return { error: t(`onboarding.username.${check.result.reason ?? 'invalid'}`) };
    }
  })();
  const available = check.state === 'done' && check.result.available && takenOnSave !== username;

  const save = async () => {
    try {
      await update.mutateAsync({ username });
      router.push('/profile');
    } catch (failure) {
      if (isApiError(failure, 'USERNAME_TAKEN')) setTakenOnSave(username);
    }
  };

  return (
    <FormScreen
      eyebrow={t('onboarding.step', { current: 1, total: 2 })}
      title={t('onboarding.username.title')}
      body={t('onboarding.username.body')}
      footer={
        <Button
          testID="username-continue"
          label={t('common.continue')}
          onPress={() => void save()}
          disabled={!available}
          loading={update.isPending}
        />
      }
    >
      <TextField
        testID="username-input"
        label={t('onboarding.username.label')}
        prefix="@"
        value={input}
        onChangeText={setInput}
        error={'error' in status ? status.error : null}
        helper={'success' in status ? status.success : 'helper' in status ? status.helper : null}
        helperTone={'success' in status ? 'success' : 'muted'}
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="username-new"
        textContentType="username"
        maxLength={21}
        returnKeyType="next"
        onSubmitEditing={() => {
          if (available) void save();
        }}
      />
    </FormScreen>
  );
}
