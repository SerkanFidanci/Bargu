import { normalizeUsername } from '@bargu/schemas';
import { router } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isApiError } from '@/features/errors';
import { FormScreen } from '@/features/onboarding/form-screen';
import {
  isValidDisplayName,
  ProfileForm,
  type ProfileDraft,
} from '@/features/profile/profile-form';
import { useMe, useUpdateProfile, useUsernameCheck } from '@/features/profile/queries';
import { UsernameStatus } from '@/features/profile/username-status';
import { Button } from '@/ui/button';
import { TextField } from '@/ui/text-field';

/** Edit username, name and avatar; saved optimistically (rolls back with a toast on refusal). */
export default function EditProfileScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const update = useUpdateProfile();
  const [username, setUsername] = useState(me.data?.username ?? '');
  const [takenOnSave, setTakenOnSave] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: me.data?.displayName ?? '',
    avatar: me.data?.avatar ?? { color: 9, emoji: null },
  });
  const check = useUsernameCheck(username);
  const normalized = normalizeUsername(username);
  const usernameChanged = normalized !== me.data?.username;
  const usernameOk =
    !usernameChanged ||
    (check.state === 'done' && check.result.available && takenOnSave !== normalized);
  const nameOk = isValidDisplayName(draft.displayName);

  const usernameError =
    takenOnSave === normalized
      ? t('onboarding.username.taken')
      : usernameChanged && check.state === 'done' && !check.result.available
        ? t(`onboarding.username.${check.result.reason ?? 'invalid'}`)
        : null;

  const save = async () => {
    try {
      await update.mutateAsync({
        ...(usernameChanged ? { username: normalized } : {}),
        displayName: draft.displayName,
        avatar: draft.avatar,
      });
      router.back();
    } catch (failure) {
      if (isApiError(failure, 'USERNAME_TAKEN')) setTakenOnSave(normalized);
    }
  };

  return (
    <FormScreen
      title={t('sheets.me.editProfile')}
      footer={
        <>
          <Button
            label={t('common.done')}
            onPress={() => void save()}
            disabled={!usernameOk || !nameOk}
            loading={update.isPending}
          />
          <Button
            label={t('common.cancel')}
            variant="ghost"
            onPress={() => {
              router.back();
            }}
          />
        </>
      }
    >
      <TextField
        label={t('onboarding.username.label')}
        prefix="@"
        trailing={usernameChanged ? <UsernameStatus check={check} /> : null}
        value={username}
        onChangeText={setUsername}
        error={usernameError}
        autoCapitalize="none"
        autoCorrect={false}
        maxLength={21}
      />
      <ProfileForm
        draft={draft}
        onChange={setDraft}
        nameError={!nameOk && draft.displayName !== ''}
      />
    </FormScreen>
  );
}
