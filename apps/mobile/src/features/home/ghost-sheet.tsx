import type { Circle } from '@bargu/schemas';
import { Check, Ghost, MapPin, Snowflake, type LucideIcon } from 'lucide-react-native';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, StyleSheet, View } from 'react-native';

import { avatarSize, radius, useTheme } from '@/theme';
import { ListRow } from '@/ui/list-row';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { toast } from '@/ui/toast';

import { turnGhostOn } from '../location/ghost-now';
import { updateSharing } from '../location/location-session';
import { type GhostMode, sharedCircles, useSharing } from '../location/sharing';

const MODES: readonly { mode: GhostMode; icon: LucideIcon }[] = [
  { mode: 'off', icon: MapPin },
  { mode: 'freeze', icon: Snowflake },
  { mode: 'hide', icon: Ghost },
];

/**
 * Ghost mode from the map (the PM report T5, 2026-10-29): the same three choices with the same
 * names as in Me, "Kapalı / Dondur / Gizle", each with what it does. Back to "Kapalı" asks first,
 * with how many circles get the location again (a stray tap must not start sharing).
 */
export const GhostSheet = forwardRef<
  SheetRef,
  { circles: readonly Circle[]; now: number; onClose: () => void }
>(function GhostSheet({ circles, now, onClose }, ref) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const current = useSharing((state) => state.ghost);

  const choose = (mode: GhostMode) => {
    onClose();
    if (mode === current) return;
    if (mode === 'hide') {
      turnGhostOn();
      return;
    }
    if (mode === 'freeze') {
      updateSharing((settings) => ({ ...settings, ghost: 'freeze' }));
      toast.info(t('map.shortcuts.ghostFreezeToast'));
      return;
    }
    const off = () => {
      updateSharing((settings) => ({ ...settings, ghost: 'off' }));
    };
    const count = sharedCircles(circles, { ...useSharing.getState(), ghost: 'off' }, now).length;
    // Nothing would be shared again: nothing to warn about.
    if (count === 0) {
      off();
      return;
    }
    Alert.alert(t('map.shortcuts.ghostOffTitle'), t('map.shortcuts.ghostOffBody', { count }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('map.shortcuts.ghostOffConfirm'), onPress: off },
    ]);
  };

  return (
    <Sheet ref={ref} title={t('location.ghost.title')} testID="ghost-sheet">
      {MODES.map(({ mode, icon: Icon }) => (
        <ListRow
          key={mode}
          testID={`ghost-${mode}`}
          leading={
            <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
              <Icon color={colors.primary} size={20} strokeWidth={2.25} />
            </View>
          }
          title={t(`location.ghost.${mode}`)}
          subtitle={t(`location.ghost.${mode}Detail`)}
          trailing={
            mode === current ? <Check color={colors.primary} size={22} strokeWidth={2.5} /> : null
          }
          accessibilityLabel={[
            t(`location.ghost.${mode}`),
            t(`location.ghost.${mode}Detail`),
            mode === current ? t('map.shortcuts.ghostChosen') : null,
          ]
            .filter((part) => part !== null)
            .join('. ')}
          onPress={() => {
            choose(mode);
          }}
        />
      ))}
    </Sheet>
  );
});

const styles = StyleSheet.create({
  icon: {
    width: avatarSize.md,
    height: avatarSize.md,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
