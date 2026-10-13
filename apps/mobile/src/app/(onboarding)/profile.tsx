import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FormScreen } from '@/features/onboarding/form-screen';
import {
  isValidDisplayName,
  ProfileForm,
  type ProfileDraft,
} from '@/features/profile/profile-form';
import { useMe, useUpdateProfile } from '@/features/profile/queries';
import { feedback } from '@/theme/haptics';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';

/** Onboarding step 2: name and avatar. Saving completes the profile and opens the map. */
export default function ProfileScreen() {
  const { t } = useTranslation();
  const me = useMe();
  const update = useUpdateProfile({ optimistic: false });
  const celebrate = useCelebration((state) => state.celebrate);
  const [draft, setDraft] = useState<ProfileDraft>({
    displayName: me.data?.displayName ?? '',
    avatar: me.data?.avatar ?? { color: 9, emoji: null },
  });
  const [touched, setTouched] = useState(false);
  const valid = isValidDisplayName(draft.displayName);

  const finish = async () => {
    setTouched(true);
    if (!valid) return;
    await update.mutateAsync({ displayName: draft.displayName, avatar: draft.avatar });
    feedback('success');
    // Played by the map, which replaces this screen as soon as the profile is complete.
    celebrate();
    // The root layout switches to the map once the saved profile is complete.
  };

  return (
    <FormScreen
      eyebrow={t('onboarding.step', { current: 2, total: 2 })}
      title={t('onboarding.profile.title')}
      footer={
        <Button
          testID="profile-finish"
          label={t('onboarding.profile.finish')}
          onPress={() => void finish().catch(() => undefined)}
          loading={update.isPending}
          disabled={draft.displayName.trim().length === 0}
        />
      }
    >
      <ProfileForm draft={draft} onChange={setDraft} nameError={touched && !valid} />
    </FormScreen>
  );
}
