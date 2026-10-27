import { CHAT_TEXT_MAX, codePointsOf } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronLeft, Clock, MoreVertical, Send } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
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
  itemsOf,
  useMessages,
} from '@/features/messages/messages';
import { loadMessagesOnce, markRead } from '@/features/messages/messages-session';
import { conversationName, isOpen, memberIn } from '@/features/messages/names';
import { retry, sendText, takeBack } from '@/features/messages/outbox';
import { useSafety } from '@/features/messages/safety';
import { radius, space, touchTarget, typography, useTheme } from '@/theme';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

const CONVERSATION = /^[cp]:[0-9a-f-]{36}$/;

/**
 * One conversation of messages and moments (docs/ADR/0035): a circle's or one person's items of
 * the last 24 hours, the newest at the bottom, and a field to write in (or a photo to take). A
 * photo opens on a tap. A long press on one's own item takes it back from everyone; on someone
 * else's it reports it or blocks its sender. Reports say first that the item's words go to Bargu;
 * blocking says it does not hide one's location.
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

  useEffect(() => {
    loadMessagesOnce();
  }, []);
  const shown = useMemo(
    () => (conversation === null ? [] : itemsOf({ items }, conversation)),
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
  const safety = useSafety((userId) => {
    if (person === userId) router.back();
  });

  const send = () => {
    const text = draft.trim();
    if (conversation === null || text.length === 0) return;
    setDraft('');
    void sendText(conversation, text).then((result) => {
      if (result === 'limited') toast.info(t('messages.limited'));
    });
  };

  const memberNameOf = (userId: string) => {
    const member = memberIn(circles, userId);
    return member === undefined ? '?' : memberName(member);
  };

  /** What a reply to a story says above it (the story itself is on the pin, not here). */
  const storyReplyOf = (item: ChatItem): string | null => {
    if (item.replyTo === undefined) return null;
    const story = items.find((kept) => kept.id === item.replyTo);
    if (story?.photo?.story !== true) return null;
    return story.from === me
      ? t('messages.story.repliedToYours')
      : t('messages.story.repliedTo', { name: memberNameOf(story.from) });
  };

  const actions = (item: ChatItem) => {
    if (item.from !== me) {
      safety.itemMenu(item);
      return;
    }
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
                        safety.askReport({ userId: person });
                      },
                    },
                    {
                      text: t('messages.block'),
                      style: 'destructive',
                      onPress: () => {
                        safety.askBlock(person);
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
                  replyTo={storyReplyOf(item)}
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
            <IconButton
              testID="conversation-camera"
              icon={Camera}
              label={t('messages.camera.take')}
              tone="plain"
              onPress={() => {
                router.push({ pathname: '/camera', params: { to: conversation } });
              }}
            />
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

      {safety.sheet}
    </SafeAreaView>
  );
}

/** One item: one's own on the right in the brand colour, others' on the left. */
function Bubble({
  item,
  mine,
  author,
  replyTo,
  onLongPress,
}: {
  item: ChatItem;
  mine: boolean;
  author: string | null;
  /** "Hikayene yanıt": the story it answers (docs/ADR/0035 §1). */
  replyTo: string | null;
  onLongPress: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const time = new Date(item.at).toLocaleTimeString(i18n.language, {
    hour: '2-digit',
    minute: '2-digit',
  });
  const failed = item.state === 'failed';
  const photo = item.kind === 'photo';
  const shot = mine && (item.shotBy?.length ?? 0) > 0;
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {author === null ? null : (
        <Text variant="caption" color="textMuted" style={styles.author}>
          {author}
        </Text>
      )}
      {replyTo === null ? null : (
        <Text variant="caption" color="textMuted" style={styles.author}>
          {replyTo}
        </Text>
      )}
      <PressableScale
        testID={`item-${item.id}`}
        haptic="select"
        accessibilityRole={photo ? 'button' : 'text'}
        accessibilityHint={
          failed ? t('messages.failed') : photo ? t('messages.openPhoto') : undefined
        }
        onPress={
          failed
            ? () => {
                void retry(item.id);
              }
            : photo && item.state === 'sent'
              ? () => {
                  router.push({ pathname: '/photo/[item]', params: { item: item.id } });
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
        {photo ? (
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
        {failed
          ? t('messages.failed')
          : item.state === 'sending'
            ? t('messages.sending')
            : shot
              ? `${time} · ${t('messages.shotSeen')}`
              : time}
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
    gap: space.xs,
    margin: space.md,
    paddingHorizontal: space.xs,
    paddingVertical: space.xs,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  input: { flex: 1, minHeight: touchTarget, maxHeight: touchTarget * 3, paddingVertical: space.sm },
  closed: { padding: space.md },
});
