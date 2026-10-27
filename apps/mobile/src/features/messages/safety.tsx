import { REPORT_REASONS, type ReportReason } from '@bargu/schemas';
import { router } from 'expo-router';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';

import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { ListRow } from '@/ui/list-row';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

import type { ChatItem } from './messages';
import { block } from './messages-session';
import { memberIn } from './names';
import { report } from './report';

type About = ChatItem | { userId: string };

export interface Safety {
  /** "Bildir": the reasons first; an item's own words go to Bargu, the screen says so. */
  askReport: (about: About) => void;
  /** "Engelle": says it does not hide the location, with leaving the circle right under it. */
  askBlock: (userId: string) => void;
  /** The menu of someone else's item: report it, or block its sender. */
  itemMenu: (item: ChatItem) => void;
  /** The reasons' sheet, to render once in the screen. */
  sheet: ReactNode;
}

/**
 * "Bildir" and "Engelle" (docs/ADR/0035 §6, §9, §13): one tap away on every conversation, photo and
 * story screen. `onBlocked` runs once the block is in (a screen of that person closes).
 */
export function useSafety(onBlocked?: (userId: string) => void): Safety {
  const { t } = useTranslation();
  const circles = useCircles().data ?? [];
  const [reporting, setReporting] = useState<About | null>(null);
  const ref = useRef<SheetRef>(null);

  const nameOf = (userId: string) => {
    const member = memberIn(circles, userId);
    return member === undefined ? '?' : memberName(member);
  };

  const askReport = (about: About) => {
    setReporting(about);
    ref.current?.present();
  };
  const sendReport = (reason: ReportReason) => {
    const about = reporting;
    ref.current?.dismiss();
    setReporting(null);
    if (about === null) return;
    const done =
      'conversation' in about
        ? report({ item: about, reason })
        : report({ userId: about.userId, reason });
    void done.then((ok) => {
      if (ok) toast.success(t('messages.reported'));
      else toast.error(t('messages.reportFailed'));
    });
  };

  const askBlock = (userId: string) => {
    const name = nameOf(userId);
    // PM: blocking hides messages, never the location; leaving the circle is right under it.
    const shared = circles.filter(
      (circle) =>
        circle.myStatus === 'active' && circle.members.some((member) => member.userId === userId),
    );
    Alert.alert(t('messages.blockTitle', { name }), t('messages.blockBody'), [
      {
        text: t('messages.block'),
        style: 'destructive',
        onPress: () => {
          void block(userId).then(
            () => {
              toast.success(t('messages.blocked', { name }));
              onBlocked?.(userId);
            },
            () => {
              toast.error(t('messages.reportFailed'));
            },
          );
        },
      },
      ...(shared.length === 0
        ? []
        : [
            {
              text: t('messages.leave'),
              onPress: () => {
                const [first] = shared;
                if (first !== undefined) router.push(`/circle/${first.id}`);
              },
            },
          ]),
      { text: t('common.cancel'), style: 'cancel' as const },
    ]);
  };

  const itemMenu = (item: ChatItem) => {
    Alert.alert(t('messages.itemActions'), undefined, [
      {
        text: t('messages.report'),
        onPress: () => {
          askReport(item);
        },
      },
      {
        text: t('messages.block'),
        style: 'destructive',
        onPress: () => {
          askBlock(item.from);
        },
      },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  };

  const sheet = (
    <Sheet
      ref={ref}
      title={t('messages.reportTitle')}
      testID="report-sheet"
      onDismiss={() => {
        setReporting(null);
      }}
    >
      <Text variant="callout" color="textMuted">
        {reporting !== null && 'conversation' in reporting
          ? t(reporting.kind === 'photo' ? 'messages.reportPhotoBody' : 'messages.reportBody')
          : t('messages.reportPersonBody')}
      </Text>
      {REPORT_REASONS.map((reason) => (
        <ListRow
          key={reason}
          testID={`report-${reason}`}
          leading={null}
          title={t(`messages.reasons.${reason}`)}
          onPress={() => {
            sendReport(reason);
          }}
        />
      ))}
    </Sheet>
  );

  return { askReport, askBlock, itemMenu, sheet };
}
