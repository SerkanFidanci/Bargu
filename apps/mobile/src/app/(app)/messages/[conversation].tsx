import { CHAT_TEXT_MAX, codePointsOf, REPORT_REASONS, type ReportReason } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronLeft, Clock, MoreVertical, Send } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import {
  type ChatItem,
  type Conversation,
  conversationTarget,
  useMessages,
} from '@/features/messages/messages';
import { block, loadMessagesOnce, markRead } from '@/features/messages/messages-session';
import { conversationName, isOpen, memberIn } from '@/features/messages/names';
import { retry, sendText, takeBack } from '@/features/messages/outbox';
import { report } from '@/features/messages/report';
import { radius, space, touchTarget, typography, useTheme } from '@/theme';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Sheet, type SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

const CONVERSATION = /^[cp]:[0-9a-f-]{36}$/;

/**
 * One conversation of messages and moments (docs/ADR/0035): a circle's or one person's items of
 * the last 24 hours, the newest at the bottom, and a field to write in. A long press on one's own
 * item takes it back from everyone; on someone else's it reports it or blocks its sender. Reports
 * say first that the item's words go to Bargu; blocking says it does not hide one's location.
 */
export default function ConversationScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const { conversation: raw } = useLocalSearchParams<{ conversation: string }>();
  const conversation = (CONVERSATION.test(raw) ? raw : null) as Conversation | null;
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const items = useMessages((state) => state.items);
  const [draft, setDraft] = useState('');
  const [reporting, setReporting] = useState<ChatItem | { userId: string } | null>(null);
  const sheet = useRef<SheetRef>(null);

  useEffect(() => {
    loadMessagesOnce();
  }, []);
  const shown = useMemo(
    () =>
      conversation === null
        ? []
        : items.filter((item) => item.conversation === conversation).sort((a, b) => b.at - a.at),
    [items, conversation],
  );
  const newest = shown[0]?.at ?? 0;
  useEffect(() => {
    if (conversation !== null && newest > 0) markRead(conversation, newest);
  }, [conversation, newest]);

  const name = conversation === null ? null : conversationName(conversation, circles, me);
  const open = conversation !== null && isOpen(conversation, circles, me);
  const target = conversation === null ? null : conversationTarget(conversation);
  const person = target !== null && 'userId' in target ? target.userId : null;

  const send = () => {
    const text = draft.trim();
    if (conversation === null || text.length === 0) return;
    setDraft('');
    void sendText(conversation, text).then((result) => {
      if (result === 'limited') toast.info(t('messages.limited'));
    });
  };

  const askReport = (about: ChatItem | { userId: string }) => {
    setReporting(about);
    sheet.current?.present();
  };
  const sendReport = (reason: ReportReason) => {
    const about = reporting;
    sheet.current?.dismiss();
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
    const blockedName = memberNameOf(userId);
    // PM: blocking hides messages, never the location; leaving the circle is right under it.
    const shared = circles.filter(
      (circle) =>
        circle.myStatus === 'active' && circle.members.some((member) => member.userId === userId),
    );
    Alert.alert(t('messages.blockTitle', { name: blockedName }), t('messages.blockBody'), [
      {
        text: t('messages.block'),
        style: 'destructive',
        onPress: () => {
          void block(userId).then(
            () => {
              toast.success(t('messages.blocked', { name: blockedName }));
              if (person === userId) router.back();
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

  const memberNameOf = (userId: string) => {
    const member = memberIn(circles, userId);
    return member === undefined ? '?' : memberName(member);
  };

  const actions = (item: ChatItem) => {
    if (item.from === me) {
      Alert.alert(t('messages.takeBack'), t('messages.takeBackBody'), [
        {
          text: t('messages.takeBack'),
          style: 'destructive',
          onPress: () => {
            void takeBack(item.id);
          },
        },
        { text: t('common.cancel'), style: 'cancel' },
      ]);
      return;
    }
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

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.background }]}
      testID="conversation"
    >
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.bar}>
          <IconButton
            icon={ChevronLeft}
            label={t('common.back')}
            tone="plain"
            onPress={() => {
              router.back();
            }}
          />
          <View style={styles.barTitle}>
            <Text variant="headline" numberOfLines={1} accessibilityRole="header">
              {name ?? t('messages.title')}
            </Text>
            <Text variant="footnote" color="textMuted" numberOfLines={1}>
              {t('messages.lifetime')}
            </Text>
          </View>
          <View style={styles.barAction}>
            {person === null ? null : (
              <IconButton
                testID="conversation-more"
                icon={MoreVertical}
                label={t('messages.more')}
                tone="plain"
                onPress={() => {
                  Alert.alert(name ?? '', undefined, [
                    {
                      text: t('messages.report'),
                      onPress: () => {
                        askReport({ userId: person });
                      },
                    },
                    {
                      text: t('messages.block'),
                      style: 'destructive',
                      onPress: () => {
                        askBlock(person);
                      },
                    },
                    { text: t('common.cancel'), style: 'cancel' },
                  ]);
                }}
              />
            )}
          </View>
        </View>

        {conversation === null || name === null ? (
          <View style={styles.gone}>
            <EmptyState icon={Clock} title={t('messages.gone')} />
          </View>
        ) : (
          <FlatList
            testID="conversation-items"
            inverted
            data={shown}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item, index }) => {
              const older = shown[index + 1];
              const showAuthor =
                conversation.startsWith('c:') && item.from !== me && older?.from !== item.from;
              return (
                <Bubble
                  item={item}
                  mine={item.from === me}
                  author={showAuthor ? memberNameOf(item.from) : null}
                  onLongPress={() => {
                    actions(item);
                  }}
                />
              );
            }}
          />
        )}

        {open ? (
          <View
            style={[
              styles.composer,
              { borderColor: colors.border, backgroundColor: colors.surface },
            ]}
          >
            <TextInput
              testID="conversation-input"
              value={draft}
              onChangeText={(next) => {
                if (codePointsOf(next) <= CHAT_TEXT_MAX) setDraft(next);
              }}
              placeholder={t('messages.placeholder')}
              placeholderTextColor={colors.textMuted}
              multiline
              accessibilityLabel={t('messages.placeholder')}
              style={[styles.input, typography.body.style, { color: colors.text }]}
            />
            <IconButton
              testID="conversation-send"
              icon={Send}
              label={t('messages.send')}
              tone={draft.trim().length === 0 ? 'plain' : 'primary'}
              onPress={send}
            />
          </View>
        ) : conversation !== null && name !== null ? (
          <Text variant="footnote" color="textMuted" align="center" style={styles.closed}>
            {t('messages.gone')}
          </Text>
        ) : null}
      </KeyboardAvoidingView>

      <Sheet
        ref={sheet}
        title={t('messages.reportTitle')}
        testID="report-sheet"
        onDismiss={() => {
          setReporting(null);
        }}
      >
        <Text variant="callout" color="textMuted">
          {reporting !== null && 'conversation' in reporting
            ? t('messages.reportBody')
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
    </SafeAreaView>
  );
}

/** One item: one's own on the right in the brand colour, others' on the left. */
function Bubble({
  item,
  mine,
  author,
  onLongPress,
}: {
  item: ChatItem;
  mine: boolean;
  author: string | null;
  onLongPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const time = new Date(item.at).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const failed = item.state === 'failed';
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {author === null ? null : (
        <Text variant="caption" color="textMuted" style={styles.author}>
          {author}
        </Text>
      )}
      <PressableScale
        testID={`item-${item.id}`}
        haptic="select"
        accessibilityRole="text"
        accessibilityHint={failed ? t('messages.failed') : undefined}
        onPress={
          failed
            ? () => {
                void retry(item.id);
              }
            : undefined
        }
        onLongPress={onLongPress}
        style={[
          styles.bubble,
          {
            backgroundColor: mine ? colors.primary : colors.surface,
            borderColor: failed ? colors.danger : 'transparent',
          },
        ]}
      >
        {item.kind === 'photo' ? (
          <View style={styles.photo}>
            <Camera color={mine ? colors.onPrimary : colors.text} size={18} strokeWidth={2.25} />
            <Text variant="body" color={mine ? 'onPrimary' : 'text'}>
              {item.photo?.caption ?? t('messages.photo')}
            </Text>
          </View>
        ) : (
          <Text variant="body" color={mine ? 'onPrimary' : 'text'} selectable>
            {item.text ?? ''}
          </Text>
        )}
      </PressableScale>
      <Text variant="caption" color={failed ? 'danger' : 'textMuted'} style={styles.meta}>
        {failed ? t('messages.failed') : item.state === 'sending' ? t('messages.sending') : time}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  barTitle: { flex: 1, alignItems: 'center' },
  barAction: { minWidth: space.xxxl, alignItems: 'flex-end' },
  gone: { flex: 1, padding: space.xl, justifyContent: 'center' },
  list: { paddingHorizontal: space.lg, paddingVertical: space.md, gap: space.xs },
  row: { maxWidth: '82%', gap: space.xxs },
  rowMine: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start', alignItems: 'flex-start' },
  author: { marginHorizontal: space.sm },
  bubble: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  photo: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  meta: { marginHorizontal: space.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    margin: space.md,
    paddingLeft: space.md,
    paddingRight: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  input: { flex: 1, minHeight: touchTarget, maxHeight: touchTarget * 3, paddingVertical: space.sm },
  closed: { padding: space.md },
});
