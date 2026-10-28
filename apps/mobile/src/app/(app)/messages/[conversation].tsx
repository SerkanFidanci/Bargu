import { type Avatar as AvatarData, CHAT_TEXT_MAX, codePointsOf } from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronLeft, Clock, MoreVertical, Send, Users } from 'lucide-react-native';
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
import { useNow } from '@/features/location/clock';
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
import { useRulesGate } from '@/features/messages/rules';
import { canResend } from '@/features/messages/photo';
import { dayOf, placeIn } from '@/features/messages/runs';
import { useSafety } from '@/features/messages/safety';
import { avatarSize, radius, space, touchTarget, typography, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

const CONVERSATION = /^[cp]:[0-9a-f-]{36}$/;
const DAY_MS = 24 * 60 * 60_000;

/**
 * One conversation of messages and moments (docs/ADR/0035): a circle's or one person's items of
 * the last 24 hours, the newest at the bottom, and a field to write in (or a photo to take). A
 * photo opens on a tap. A long press on one's own item takes it back from everyone; on someone
 * else's it reports it or blocks its sender. Reports say first that the item's words go to Bargu;
 * blocking says it does not hide one's location. Drawn so each part stands apart (the owner,
 * 2026-10-28): the bar, the items on their own ground (one's own in the brand colour on the right,
 * others' raised on the left, each run with one name and one time, a line for each day) and the
 * field to write in.
 */
export default function ConversationScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const { conversation: raw } = useLocalSearchParams<{ conversation: string }>();
  const conversation = (CONVERSATION.test(raw) ? raw : null) as Conversation | null;
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const items = useMessages((state) => state.items);
  const [draft, setDraft] = useState('');
  const now = useNow();

  useEffect(() => {
    loadMessagesOnce();
  }, []);
  // The community rules come as the conversation opens (K14); until then nothing of it shows.
  const rules = useRulesGate({ atOpen: true });
  const shown = useMemo(
    () => (conversation === null || !rules.open ? [] : itemsOf({ items }, conversation)),
    [items, conversation, rules.open],
  );
  const newest = shown[0]?.at ?? 0;
  useEffect(() => {
    if (conversation !== null && newest > 0) markRead(conversation, newest);
  }, [conversation, newest]);

  const name = conversation === null ? null : conversationName(conversation, circles, me);
  const open = conversation !== null && isOpen(conversation, circles, me);
  const target = conversation === null ? null : conversationTarget(conversation);
  const person = target !== null && 'userId' in target ? target.userId : null;
  const group = conversation?.startsWith('c:') === true;
  const safety = useSafety((userId) => {
    if (person === userId) router.back();
  });

  const send = () => {
    const text = draft.trim();
    if (conversation === null || text.length === 0) return;
    rules.ensure(() => {
      setDraft('');
      void sendText(conversation, text).then((result) => {
        if (result === 'limited') toast.info(t('messages.limited'));
      });
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

  const dayLabel = (at: number) => {
    const day = dayOf(at);
    if (day === dayOf(now)) return t('messages.today');
    if (day === dayOf(now - DAY_MS)) return t('messages.yesterday');
    return new Date(at).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric' });
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

  const personCard = person === null ? undefined : memberIn(circles, person);

  return (
    <SafeAreaView
      style={[styles.screen, { backgroundColor: colors.surface }]}
      testID="conversation"
    >
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={[styles.bar, { borderColor: colors.border }]}>
          <IconButton
            icon={ChevronLeft}
            label={t('common.back')}
            tone="plain"
            onPress={() => {
              router.back();
            }}
          />
          {name === null ? null : person === null ? (
            <View style={[styles.circleIcon, { backgroundColor: colors.primarySoft }]}>
              <Users color={colors.primary} size={20} strokeWidth={2.25} />
            </View>
          ) : (
            <Avatar avatar={personCard?.avatar ?? null} name={name} userId={person} />
          )}
          <View style={styles.barTitle}>
            <Text variant="headline" numberOfLines={1} accessibilityRole="header">
              {name ?? t('messages.title')}
            </Text>
            <Text variant="caption" color="textMuted" numberOfLines={1}>
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

        <View style={[styles.screen, { backgroundColor: colors.background }]}>
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
                const mine = item.from === me;
                const place = placeIn(item, shown[index + 1], shown[index - 1]);
                const author = memberIn(circles, item.from);
                return (
                  <View style={place.first ? styles.runStart : null}>
                    {place.newDay ? (
                      <View style={[styles.day, { backgroundColor: colors.surfaceRaised }]}>
                        <Text variant="caption" color="textMuted">
                          {dayLabel(item.at)}
                        </Text>
                      </View>
                    ) : null}
                    <Bubble
                      item={item}
                      mine={mine}
                      first={place.first}
                      last={place.last}
                      author={
                        group && !mine
                          ? { name: memberNameOf(item.from), avatar: author?.avatar ?? null }
                          : null
                      }
                      replyTo={storyReplyOf(item)}
                      onRetry={() => {
                        rules.ensure(() => {
                          void retry(item.id);
                        });
                      }}
                      onRetake={() => {
                        // Its file is gone (the app restarted): a new photo for here, this one goes.
                        rules.ensure(() => {
                          void takeBack(item.id);
                          router.push({ pathname: '/camera', params: { to: conversation } });
                        });
                      }}
                      onLongPress={() => {
                        actions(item);
                      }}
                    />
                  </View>
                );
              }}
            />
          )}
        </View>

        {open ? (
          <View style={[styles.composer, { borderColor: colors.border }]}>
            <IconButton
              testID="conversation-camera"
              icon={Camera}
              label={t('messages.camera.take')}
              tone="plain"
              onPress={() => {
                rules.ensure(() => {
                  router.push({ pathname: '/camera', params: { to: conversation } });
                });
              }}
            />
            <View
              style={[
                styles.field,
                { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
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
            </View>
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
      {rules.sheet}
    </SafeAreaView>
  );
}

/**
 * One item: one's own on the right in the brand colour, others' on the left on a raised card with
 * its edge. The last of a run has the tail corner and the time; in a circle, others' runs have
 * the name over the first and the avatar beside the last.
 */
function Bubble({
  item,
  mine,
  first,
  last,
  author,
  replyTo,
  onRetry,
  onRetake,
  onLongPress,
}: {
  item: ChatItem;
  mine: boolean;
  first: boolean;
  last: boolean;
  /** Someone else's item in a circle: who wrote it. */
  author: { name: string; avatar: AvatarData | null } | null;
  /** "Hikayene yanıt": the story it answers (docs/ADR/0035 §1). */
  replyTo: string | null;
  onRetry: () => void;
  /** A photo that can no longer be sent again: take a new one. */
  onRetake: () => void;
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
  // Not sent, and its file is gone with a restart: it cannot be tried again, only taken again.
  const lost = failed && item.photo !== undefined && !canResend(item.photo.blobId);
  const shot = mine && (item.shotBy?.length ?? 0) > 0;
  const ink = mine ? 'onPrimary' : 'text';
  const meta = failed
    ? t(lost ? 'messages.retake' : 'messages.failed')
    : item.state === 'sending'
      ? t('messages.sending')
      : !last
        ? null
        : shot
          ? `${time} · ${t('messages.shotSeen')}`
          : time;
  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      {author === null ? null : (
        <View style={styles.side}>
          {last ? (
            <Avatar avatar={author.avatar} name={author.name} size="sm" userId={item.from} />
          ) : null}
        </View>
      )}
      <View style={[styles.column, mine ? styles.columnMine : styles.columnTheirs]}>
        {author !== null && first ? (
          <Text variant="caption" color="textMuted" style={styles.author}>
            {author.name}
          </Text>
        ) : null}
        <PressableScale
          testID={`item-${item.id}`}
          haptic="select"
          accessibilityRole={photo ? 'button' : 'text'}
          accessibilityHint={
            lost
              ? t('messages.retake')
              : failed
                ? t('messages.failed')
                : photo
                  ? t('messages.openPhoto')
                  : undefined
          }
          onPress={
            lost
              ? onRetake
              : failed
                ? onRetry
                : photo && item.state === 'sent'
                  ? () => {
                      router.push({ pathname: '/photo/[item]', params: { item: item.id } });
                    }
                  : undefined
          }
          onLongPress={onLongPress}
          style={[
            styles.bubble,
            mine
              ? { backgroundColor: colors.primary, borderColor: colors.primary }
              : { backgroundColor: colors.surfaceRaised, borderColor: colors.border },
            failed ? { borderColor: colors.danger } : null,
            last ? (mine ? styles.tailMine : styles.tailTheirs) : null,
          ]}
        >
          {replyTo === null ? null : (
            <View style={[styles.quote, { borderColor: mine ? colors.onPrimary : colors.primary }]}>
              <Text variant="caption" color={mine ? 'onPrimary' : 'textMuted'}>
                {replyTo}
              </Text>
            </View>
          )}
          {photo ? (
            <View style={styles.photo}>
              <View style={[styles.photoIcon, { backgroundColor: colors.primarySoft }]}>
                <Camera color={colors.primary} size={18} strokeWidth={2.25} />
              </View>
              <View style={styles.photoText}>
                <Text variant="bodyStrong" color={ink}>
                  {item.photo?.caption ??
                    t(item.photo?.story === true ? 'messages.story.one' : 'messages.photo')}
                </Text>
                {item.state === 'sent' ? (
                  <Text variant="caption" color={mine ? 'onPrimary' : 'textMuted'}>
                    {t('messages.tapToOpen')}
                  </Text>
                ) : null}
              </View>
            </View>
          ) : (
            <Text variant="body" color={ink} selectable>
              {item.text ?? ''}
            </Text>
          )}
        </PressableScale>
        {meta === null ? null : (
          <Text variant="caption" color={failed ? 'danger' : 'textMuted'} style={styles.meta}>
            {meta}
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    borderBottomWidth: StyleSheet.hairlineWidth * 2,
  },
  barTitle: { flex: 1 },
  barAction: { minWidth: touchTarget, alignItems: 'flex-end' },
  circleIcon: {
    width: avatarSize.md,
    height: avatarSize.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gone: { flex: 1, padding: space.xl, justifyContent: 'center' },
  list: { paddingHorizontal: space.md, paddingVertical: space.md, gap: space.xxs },
  runStart: { paddingTop: space.md },
  day: {
    alignSelf: 'center',
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    marginBottom: space.md,
  },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.xs },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  side: { width: avatarSize.sm },
  column: { maxWidth: '80%', gap: space.xxs },
  columnMine: { alignItems: 'flex-end' },
  columnTheirs: { alignItems: 'flex-start' },
  author: { marginHorizontal: space.sm },
  bubble: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: space.xs,
  },
  tailMine: { borderBottomRightRadius: space.xs },
  tailTheirs: { borderBottomLeftRadius: space.xs },
  quote: { borderLeftWidth: space.xxs, paddingLeft: space.sm },
  photo: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  photoIcon: {
    width: avatarSize.sm + space.xs,
    height: avatarSize.sm + space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoText: { flexShrink: 1 },
  meta: { marginHorizontal: space.sm },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.xs,
    paddingHorizontal: space.sm,
    paddingVertical: space.sm,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
  },
  field: {
    flex: 1,
    borderRadius: radius.xl,
    borderWidth: StyleSheet.hairlineWidth * 2,
    paddingHorizontal: space.md,
  },
  input: { minHeight: touchTarget, maxHeight: touchTarget * 3, paddingVertical: space.sm },
  closed: { padding: space.md },
});
