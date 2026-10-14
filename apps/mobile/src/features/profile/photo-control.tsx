import { ImagePlus, Trash2 } from 'lucide-react-native';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { space } from '@/theme';
import { feedback } from '@/theme/haptics';
import { useAvatarPhotos } from '@/ui/avatar-photos';
import { Button } from '@/ui/button';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import { errorMessage } from '../errors';
import { pickPhoto, removePhoto, setPhoto } from './photo';

/**
 * Profile photo instead of the emoji, if the user wants one (docs/ADR/0014): picked from the
 * library, cropped square, encrypted on the phone; only the user's circles can open it.
 */
export function PhotoControl({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const hasPhoto = useAvatarPhotos((state) => userId in state);
  const [busy, setBusy] = useState(false);

  const choose = async () => {
    setBusy(true);
    try {
      const image = await pickPhoto();
      if (image === null) return;
      await setPhoto(image);
      feedback('success');
      toast.success(t('profile.photo.saved'));
    } catch (failure) {
      toast.error(failure instanceof Error ? errorMessage(failure, t) : t('profile.photo.failed'));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      await removePhoto();
      toast.info(t('profile.photo.removed'));
    } catch (failure) {
      toast.error(errorMessage(failure, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.box}>
      <Text variant="subhead" color="textMuted">
        {t('profile.photo.title')}
      </Text>
      <Text variant="footnote" color="textMuted">
        {t('profile.photo.hint')}
      </Text>
      <Button
        testID="photo-choose"
        label={hasPhoto ? t('profile.photo.change') : t('profile.photo.choose')}
        icon={ImagePlus}
        variant="secondary"
        loading={busy}
        onPress={() => void choose()}
      />
      {hasPhoto ? (
        <Button
          label={t('profile.photo.remove')}
          icon={Trash2}
          variant="ghost"
          disabled={busy}
          onPress={() => void remove()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ box: { gap: space.sm } });
