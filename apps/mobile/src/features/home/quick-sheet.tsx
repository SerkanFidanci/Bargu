import { Camera, Flag, type LucideIcon, MapPin, ShieldCheck, UserPlus } from 'lucide-react-native';
import { forwardRef } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { Appear } from '@/ui/appear';
import { PressableScale } from '@/ui/pressable-scale';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';

export interface QuickSheetProps {
  onPhoto: () => void;
  onAddFriend: () => void;
  onMeeting: () => void;
  onSafe: () => void;
  /** "Yakındayım" (docs/ADR/0037): its sheet says where it can go, or why nowhere now. */
  onNear: () => void;
  /** Somewhere it can go now; otherwise its tile is faint. */
  nearReady: boolean;
  onDismiss: () => void;
}

/**
 * The "+" in the middle of the dock (the PM's product report T2, 2026-10-29: "Ortadaki en büyük
 * düğme en sık işi açmalı"): quick things, each one tap: a photo now, a friend, a meeting,
 * "Güvendeyim", and "Yakındayım" (docs/ADR/0037 §6). Adding a friend opens its own sheet (a
 * username, a QR code, a link, a new circle).
 */
export const QuickSheet = forwardRef<SheetRef, QuickSheetProps>(function QuickSheet(
  { onPhoto, onAddFriend, onMeeting, onSafe, onNear, nearReady, onDismiss },
  ref,
) {
  const { t } = useTranslation();
  const actions: {
    key: string;
    icon: LucideIcon;
    label: string;
    hint: string;
    onPress: () => void;
    faint?: boolean;
  }[] = [
    {
      key: 'photo',
      icon: Camera,
      label: t('main.quick.photo'),
      hint: t('main.quick.photoHint'),
      onPress: onPhoto,
    },
    {
      key: 'friend',
      icon: UserPlus,
      label: t('main.quick.friend'),
      hint: t('main.quick.friendHint'),
      onPress: onAddFriend,
    },
    {
      key: 'meeting',
      icon: Flag,
      label: t('main.quick.meeting'),
      hint: t('main.quick.meetingHint'),
      onPress: onMeeting,
    },
    {
      key: 'safe',
      icon: ShieldCheck,
      label: t('main.quick.safe'),
      hint: t('main.quick.safeHint'),
      onPress: onSafe,
    },
    {
      key: 'near',
      icon: MapPin,
      label: t('main.quick.near'),
      hint: nearReady ? t('main.quick.nearHint') : t('main.quick.nearOff'),
      onPress: onNear,
      faint: !nearReady,
    },
  ];
  return (
    <Sheet ref={ref} title={t('main.quick.title')} testID="quick-sheet" onDismiss={onDismiss}>
      <View style={styles.grid}>
        {actions.map((action, index) => (
          <Appear key={action.key} index={index} style={styles.cell}>
            <Tile
              testID={`quick-${action.key}`}
              icon={action.icon}
              label={action.label}
              hint={action.hint}
              onPress={action.onPress}
              faint={action.faint === true}
            />
          </Appear>
        ))}
      </View>
    </Sheet>
  );
});

function Tile({
  testID,
  icon: Icon,
  label,
  hint,
  onPress,
  faint,
}: {
  testID: string;
  icon: LucideIcon;
  label: string;
  hint: string;
  onPress: () => void;
  /** Nothing to do with it now: faint, still a tap away from why. */
  faint: boolean;
}) {
  const { colors } = useTheme();
  return (
    <PressableScale
      testID={testID}
      haptic="select"
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      style={[styles.tile, { backgroundColor: colors.surface }, faint ? styles.faint : null]}
    >
      <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
        <Icon color={colors.primary} size={26} strokeWidth={2.25} />
      </View>
      <Text variant="bodyStrong" align="center" numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  cell: { flexBasis: '47%', flexGrow: 1 },
  tile: {
    minHeight: touchTarget * 2.5,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space.sm,
    padding: space.md,
    borderRadius: radius.lg,
  },
  faint: { opacity: 0.5 },
  icon: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
