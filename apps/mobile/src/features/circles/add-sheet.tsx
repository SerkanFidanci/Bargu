import { router } from 'expo-router';
import {
  Flag,
  type LucideIcon,
  QrCode,
  ScanLine,
  Search,
  Share2,
  Users,
} from 'lucide-react-native';
import { forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Share, StyleSheet, View } from 'react-native';

import { radius, space, touchTarget, useTheme } from '@/theme';
import { Appear } from '@/ui/appear';
import { ListRow } from '@/ui/list-row';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { toast } from '@/ui/toast';

import { errorMessage } from '../errors';
import { circlesApi } from './circles-api';

export interface AddSheetProps {
  onDismiss: () => void;
  onClose: () => void;
}

/**
 * Adding (UX düzeni 5; the + quick things open it since T2, 2026-10-29): a friend by username, by
 * showing or scanning a QR code in person, or by sharing a one-time link; a new circle; a meeting.
 * Whoever is added still has to say yes (except for a code they scanned: showing it is the yes).
 */
export const AddSheet = forwardRef<SheetRef, AddSheetProps>(function AddSheet(
  { onDismiss, onClose },
  ref,
) {
  const { t } = useTranslation();
  const [sharing, setSharing] = useState(false);
  const go = (path: '/add/username' | '/add/qr' | '/add/scan' | '/circle/new' | '/meeting/new') => {
    onClose();
    router.push(path);
  };
  const shareLink = async () => {
    setSharing(true);
    try {
      const invite = await circlesApi.createInvite({ kind: 'friend' });
      await Share.share({ message: t('add.shareMessage', { link: invite.link }) });
    } catch (error) {
      toast.error(errorMessage(error, t));
    } finally {
      setSharing(false);
    }
  };
  const options: { icon: LucideIcon; title: string; subtitle: string; onPress: () => void }[] = [
    {
      icon: Search,
      title: t('sheets.add.byUsername'),
      subtitle: t('add.byUsernameHint'),
      onPress: () => {
        go('/add/username');
      },
    },
    {
      icon: QrCode,
      title: t('sheets.add.showQr'),
      subtitle: t('add.showQrHint'),
      onPress: () => {
        go('/add/qr');
      },
    },
    {
      icon: ScanLine,
      title: t('add.scan'),
      subtitle: t('add.scanHint'),
      onPress: () => {
        go('/add/scan');
      },
    },
    {
      icon: Share2,
      title: t('sheets.add.shareLink'),
      subtitle: t('add.shareLinkHint'),
      onPress: () => void shareLink(),
    },
    {
      icon: Users,
      title: t('sheets.add.newCircle'),
      subtitle: t('sheets.add.newCircleHint'),
      onPress: () => {
        go('/circle/new');
      },
    },
    // A meeting in one of the circles (the project owner's request, docs/ADR/0026).
    {
      icon: Flag,
      title: t('meeting.start'),
      subtitle: t('meeting.startFromPlus'),
      onPress: () => {
        go('/meeting/new');
      },
    },
  ];
  return (
    <Sheet ref={ref} title={t('sheets.add.title')} testID="add-sheet" onDismiss={onDismiss}>
      {options.map((option, index) => (
        <Appear key={option.title} index={index}>
          <ListRow
            testID={`add-${String(index)}`}
            leading={<OptionIcon icon={option.icon} busy={option.icon === Share2 && sharing} />}
            title={option.title}
            subtitle={option.subtitle}
            onPress={option.onPress}
          />
        </Appear>
      ))}
    </Sheet>
  );
});

function OptionIcon({ icon: Icon, busy }: { icon: LucideIcon; busy: boolean }) {
  const { colors } = useTheme();
  return (
    <View style={[styles.icon, { backgroundColor: colors.primarySoft }]}>
      {busy ? (
        <ActivityIndicator color={colors.primary} />
      ) : (
        <Icon color={colors.primary} size={22} strokeWidth={2.25} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: touchTarget - space.sm,
    height: touchTarget - space.sm,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
