import type { GROUP_KINDS } from '@bargu/schemas';
import { router } from 'expo-router';
import { Sparkles } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCircleActions } from '@/features/circles/queries';
import { isValidDisplayName } from '@/features/profile/profile-form';
import { Appear } from '@/ui/appear';
import { Button } from '@/ui/button';
import { useCelebration } from '@/ui/confetti';
import { Screen } from '@/ui/screen';
import { Segmented } from '@/ui/segmented';
import { Text } from '@/ui/text';
import { TextField } from '@/ui/text-field';

type GroupKind = (typeof GROUP_KINDS)[number];

/** A new group (family, friends): its name and kind; members are invited from its screen next. */
export default function NewCircleScreen() {
  const { t } = useTranslation();
  const [kind, setKind] = useState<GroupKind>('family');
  const [name, setName] = useState('');
  const { create } = useCircleActions();
  const celebrate = useCelebration((state) => state.celebrate);
  const valid = isValidDisplayName(name.trim());

  const submit = () => {
    create.mutate(
      { kind, name: name.trim() },
      {
        onSuccess: (circle) => {
          celebrate();
          router.replace({ pathname: '/circle/[id]', params: { id: circle.id } });
        },
      },
    );
  };

  return (
    <Screen
      title={t('circles.new.title')}
      footer={
        <Button
          testID="create-circle"
          label={t('circles.new.create')}
          icon={Sparkles}
          onPress={submit}
          disabled={!valid}
          loading={create.isPending}
        />
      }
    >
      <Appear index={0}>
        <Text variant="callout" color="textMuted">
          {t('circles.new.body')}
        </Text>
      </Appear>
      <Appear index={1}>
        <Segmented
          label={t('circles.new.kind')}
          value={kind}
          onChange={setKind}
          options={[
            { value: 'family', label: t('circles.kinds.family') },
            { value: 'friends', label: t('circles.kinds.friends') },
          ]}
        />
      </Appear>
      <Appear index={2}>
        <TextField
          label={t('circles.new.name')}
          placeholder={t(`circles.new.placeholder_${kind}`)}
          value={name}
          onChangeText={setName}
          maxLength={40}
          returnKeyType="done"
          onSubmitEditing={() => {
            if (valid) submit();
          }}
        />
      </Appear>
    </Screen>
  );
}
