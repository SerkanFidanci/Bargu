import {
  type Avatar as AvatarData,
  CHAT_TEXT_MAX,
  type ChatReaction,
  codePointsOf,
} from '@bargu/schemas';
import { router, useLocalSearchParams } from 'expo-router';
import { Camera, ChevronLeft, Clock, Lock, MoreVertical } from 'lucide-react-native';
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
import { useNow } from '@/features/location/clock';
import { ChatAvatar } from '@/features/messages/chat-avatar';
import {
  type ChatItem,
  type Conversation,
  conversationTarget,
  itemsOf,
  useMessages,
} from '@/features/messages/messages';
import { loadMessagesOnce, markRead } from '@/features/messages/messages-session';
import { conversationName, isOpen, memberIn } from '@/features/messages/names';
import { ItemSheet } from '@/features/messages/item-sheet';
import { react, retry, sendText, takeBack } from '@/features/messages/outbox';
import { useRulesGate } from '@/features/messages/rules';
import { canResend } from '@/features/messages/photo';
import { dayOf, placeIn } from '@/features/messages/runs';
import { useSafety } from '@/features/messages/safety';
import {
  avatarSize,
  gradientAt,
  radius,
  reactFx,
  space,
  touchTarget,
  typography,
  useTheme,
} from '@/theme';
import { Avatar } from '@/ui/avatar';
import { EmptyState } from '@/ui/empty-state';
import { IconButton } from '@/ui/icon-button';
import { PressableScale } from '@/ui/pressable-scale';
import type { SheetRef } from '@/ui/sheet';
import { Text } from '@/ui/text';
import { toast } from '@/ui/toast';

const CONVERSATION = /^[cp]:[0-9a-f-]{36}$/;
const DAY_MS = 24 * 60 * 60_000;
/** One's own items go from the newest colour to the older one over this many of them. */
const OWN_SHADES = 12;

/**
 * One conversation of messages and moments (docs/ADR/0035): a circle's or one person's items of
 * the last 24 hours, the newest at the bottom, and a field to write in (or a photo to take). A
 * photo opens on a tap. A long press on one's own item takes it back from everyone; on someone
 * else's it reports it or blocks its sender. Reports say first that the item's words go to Bargu;
 * blocking says it does not hide one's location. Laid out as people know it from Instagram's
 * messages (the owner, 2026-10-28): who it is with on top and again above the first item, runs of
 * joined bubbles (one's own in colour, others' grey beside their avatar), the time centred after a
 * pause, and a rounded field with the camera in it.
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
  // One's own items by how new they are: the newest in one colour, older ones toward the other.
  const ownShade = useMemo(() => {
    const shades = new Map<string, number>();
    for (const item of shown) {
      if (item.from === me) shades.set(item.id, Math.min(shades.size / OWN_SHADES, 1));
    }
    return shades;
  }, [shown, me]);
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

  /** "Bugün 14:32", "Dün 21:05", or the weekday: centred above an item after a pause. */
  const stampOf = (at: number) => {
    const day = dayOf(at);
    const clock = new Date(at).toLocaleTimeString(i18n.language, {
      hour: '2-digit',
      minute: '2-digit',
    });
    const date =
      day === dayOf(now)
        ? t('messages.today')
        : day === dayOf(now - DAY_MS)
          ? t('messages.yesterday')
          : new Date(at).toLocaleDateString(i18n.language, { weekday: 'long' });
    return `${date} ${clock}`;
  };

  /** Who a person is (their username), or how many a circle has: under the name on top. */
  const subtitle = (() => {
    if (target === null) return null;
    if ('userId' in target) {
      const username = memberIn(circles, target.userId)?.username;
      return username === null || username === undefined ? null : `@${username}`;
    }
    const circle = circles.find((candidate) => candidate.id === target.circleId);
    const count = circle?.members.filter((member) => member.status === 'active').length ?? 0;
    return count === 0 ? null : t('messages.members', { count });
  })();

  // A held item: its reactions and what can be done with it (docs/ADR/0035 Ek 2).
  const [held, setHeld] = useState<ChatItem | null>(null);
  const itemSheet = useRef<SheetRef>(null);
  const hold = (item: ChatItem) => {
    setHeld(item);
    itemSheet.current?.present();
  };
  const reactTo = (item: ChatItem, emoji: ChatReaction | null) => {
    rules.ensure(() => {
      void react(item, emoji);
    });
  };
  const askTakeBack = (item: ChatItem) => {
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

  const camera = () => {
    rules.ensure(() => {
      router.push({ pathname: '/camera', params: { to: conversation } });
    });
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
        <View style={[styles.bar, { borderColor: colors.border }]}>
          <IconButton
            icon={ChevronLeft}
            label={t('common.back')}
            tone="plain"
            onPress={() => {
              router.back();
            }}
          />
          {conversation === null || name === null ? null : (
            <ChatAvatar conversation={conversation} circles={circles} me={me} size="header" />
          )}
          <View style={styles.barTitle}>
            <Text variant="headline" numberOfLines={1} accessibilityRole="header">
              {name ?? t('messages.title')}
            </Text>
            {subtitle === null ? null : (
              <Text variant="caption" color="textMuted" numberOfLines={1}>
                {subtitle}
              </Text>
            )}
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
            // Inverted: the footer is the top, above the oldest item.
            ListFooterComponent={
              <View style={styles.intro}>
                <ChatAvatar conversation={conversation} circles={circles} me={me} size="intro" />
                <Text variant="title2" align="center">
                  {name}
                </Text>
                <View style={styles.lock}>
                  <Lock color={colors.textMuted} size={14} strokeWidth={2.25} />
                  <Text variant="caption" color="textMuted" align="center">
                    {t('messages.lifetime')}
                  </Text>
                </View>
              </View>
            }
            renderItem={({ item, index }) => {
              const mine = item.from === me;
              const place = placeIn(item, shown[index + 1], shown[index - 1]);
              const author = memberIn(circles, item.from);
              return (
                <View style={place.first ? styles.runStart : null}>
                  {place.stamp ? (
                    <Text variant="caption" color="textMuted" align="center" style={styles.stamp}>
                      {stampOf(item.at)}
                    </Text>
                  ) : null}
                  <Bubble
                    item={item}
                    mine={mine}
                    first={place.first}
                    last={place.last}
                    shade={ownShade.get(item.id) ?? 0}
                    author={
                      mine
                        ? null
                        : {
                            name: memberNameOf(item.from),
                            avatar: author?.avatar ?? null,
                            named: group,
                          }
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
                      hold(item);
                    }}
                    onReact={(emoji) => {
                      reactTo(item, emoji);
                    }}
                    nameOf={(userId) => (userId === me ? t('messages.you') : memberNameOf(userId))}
                  />
                </View>
              );
            }}
          />
        )}

        {open ? (
          <View style={[styles.composer, { backgroundColor: colors.bubble }]}>
            <PressableScale
              testID="conversation-camera"
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={t('messages.camera.take')}
              onPress={camera}
              style={[styles.camera, { backgroundColor: colors.primary }]}
            >
              <Camera color={colors.onPrimary} size={20} strokeWidth={2.25} />
            </PressableScale>
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
            {draft.trim().length === 0 ? null : (
              <PressableScale
                testID="conversation-send"
                haptic="select"
                accessibilityRole="button"
                accessibilityLabel={t('messages.send')}
                onPress={send}
                style={styles.send}
              >
                <Text variant="bodyStrong" color="primary">
                  {t('messages.send')}
                </Text>
              </PressableScale>
            )}
          </View>
        ) : conversation !== null && name !== null ? (
          <Text variant="footnote" color="textMuted" align="center" style={styles.closed}>
            {t('messages.gone')}
          </Text>
        ) : null}
      </KeyboardAvoidingView>

      <ItemSheet
        ref={itemSheet}
        mine={held?.from === me}
        reactable={held?.state === 'sent'}
        current={held === null || me === null ? undefined : held.reactions?.[me]}
        onReact={(emoji) => {
          itemSheet.current?.dismiss();
          if (held !== null) reactTo(held, emoji);
        }}
        onTakeBack={() => {
          itemSheet.current?.dismiss();
          if (held !== null) askTakeBack(held);
        }}
        onReport={() => {
          itemSheet.current?.dismiss();
          if (held !== null) safety.askReport(held);
        }}
        onBlock={() => {
          itemSheet.current?.dismiss();
          if (held !== null) safety.askBlock(held.from);
        }}
      />
      {safety.sheet}
      {rules.sheet}
    </SafeAreaView>
  );
}

/**
 * One item. One's own on the right in its colour; others' grey on the left, their avatar beside
 * the last of a run and, in a circle, their name over the first. The items of a run are joined:
 * round outside, a small corner on the sender's side between them.
 */
function Bubble({
  item,
  mine,
  first,
  last,
  shade,
  author,
  replyTo,
  onRetry,
  onRetake,
  onLongPress,
  onReact,
  nameOf,
}: {
  item: ChatItem;
  mine: boolean;
  first: boolean;
  last: boolean;
  /** One's own: 0 for the newest, toward 1 for older ones (its colour). */
  shade: number;
  /** Someone else's item: who wrote it, and whether to name them (in a circle). */
  author: { name: string; avatar: AvatarData | null; named: boolean } | null;
  /** "Hikayene yanıt": the story it answers (docs/ADR/0035 §1). */
  replyTo: string | null;
  onRetry: () => void;
  /** A photo that can no longer be sent again: take a new one. */
  onRetake: () => void;
  onLongPress: () => void;
  /** This user's reaction, or none any more (docs/ADR/0035 Ek 2). */
  onReact: (emoji: ChatReaction | null) => void;
  nameOf: (userId: string) => string;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useAuth((state) => state.userId);
  const lastTap = useRef(0);
  const single = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (single.current !== null) clearTimeout(single.current);
    },
    [],
  );
  const failed = item.state === 'failed';
  const photo = item.kind === 'photo';
  // Not sent, and its file is gone with a restart: it cannot be tried again, only taken again.
  const lost = failed && item.photo !== undefined && !canResend(item.photo.blobId);
  const shot = mine && (item.shotBy?.length ?? 0) > 0;
  const ink = mine ? 'onBrand' : 'text';
  const meta = failed
    ? t(lost ? 'messages.retake' : 'messages.failed')
    : item.state === 'sending'
      ? t('messages.sending')
      : shot
        ? t('messages.shotSeen')
        : null;
  const mineNow = me === null ? undefined : item.reactions?.[me];
  const reactions = Object.entries(item.reactions ?? {});
  /** What a tap does on its own: open the photo, try again, take again. */
  const tapAlone = lost
    ? onRetake
    : failed
      ? onRetry
      : photo && item.state === 'sent'
        ? () => {
            router.push({ pathname: '/photo/[item]', params: { item: item.id } });
          }
        : undefined;
  // Two taps close together on something that went out: a heart, or the heart taken back. A single
  // tap's own action waits that long, so the two do not both happen.
  const tap =
    item.state !== 'sent'
      ? tapAlone
      : () => {
          const now = Date.now();
          if (now - lastTap.current < reactFx.doubleTapMs) {
            lastTap.current = 0;
            if (single.current !== null) clearTimeout(single.current);
            single.current = null;
            onReact(mineNow === '❤️' ? null : '❤️');
            return;
          }
          lastTap.current = now;
          if (tapAlone === undefined) return;
          single.current = setTimeout(() => {
            single.current = null;
            tapAlone();
          }, reactFx.doubleTapMs);
        };
  // Joined corners: small on the sender's side wherever the run goes on.
  const joined = mine
    ? {
        borderTopRightRadius: first ? radius.lg : space.xs,
        borderBottomRightRadius: last ? radius.lg : space.xs,
      }
    : {
        borderTopLeftRadius: first ? radius.lg : space.xs,
        borderBottomLeftRadius: last ? radius.lg : space.xs,
      };
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
        {author?.named === true && first ? (
          <Text variant="caption" color="textMuted" style={styles.label}>
            {author.name}
          </Text>
        ) : null}
        {replyTo === null ? null : (
          <Text variant="caption" color="textMuted" style={styles.label}>
            {replyTo}
          </Text>
        )}
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
          onPress={tap}
          onLongPress={onLongPress}
          style={[
            styles.bubble,
            {
              backgroundColor: mine ? gradientAt(colors.brandGradient, shade) : colors.bubble,
              borderColor: failed ? colors.danger : 'transparent',
            },
            joined,
          ]}
        >
          {photo ? (
            <View style={styles.photo}>
              <View
                style={[
                  styles.photoIcon,
                  { backgroundColor: mine ? colors.onBrand : colors.primarySoft },
                ]}
              >
                <Camera
                  color={mine ? colors.brandGradient[0] : colors.primary}
                  size={18}
                  strokeWidth={2.25}
                />
              </View>
              <View style={styles.photoText}>
                <Text variant="bodyStrong" color={ink}>
                  {item.photo?.caption ??
                    t(item.photo?.story === true ? 'messages.story.one' : 'messages.photo')}
                </Text>
                {item.state === 'sent' ? (
                  <Text variant="caption" color={mine ? 'onBrand' : 'textMuted'}>
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
        {reactions.length === 0 ? null : (
          <View
            testID={`reactions-${item.id}`}
            accessible
            accessibilityLabel={t('messages.react.summary', {
              list: reactions.map(([userId, emoji]) => `${emoji} ${nameOf(userId)}`).join(', '),
            })}
            style={[
              styles.reactions,
              { backgroundColor: colors.surfaceRaised, borderColor: colors.background },
            ]}
          >
            <Text variant="footnote" allowFontScaling={false}>
              {[...new Set(reactions.map(([, emoji]) => emoji))].join('')}
              {reactions.length > 1 ? ` ${String(reactions.length)}` : ''}
            </Text>
          </View>
        )}
        {meta === null ? null : (
          <Text variant="caption" color={failed ? 'danger' : 'textMuted'} style={styles.label}>
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
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  barTitle: { flex: 1 },
  barAction: { minWidth: touchTarget, alignItems: 'flex-end' },
  gone: { flex: 1, padding: space.xl, justifyContent: 'center' },
  list: { paddingHorizontal: space.md, paddingVertical: space.md, gap: space.xxs },
  intro: { alignItems: 'center', gap: space.sm, paddingVertical: space.xl },
  lock: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  runStart: { paddingTop: space.sm },
  stamp: { paddingVertical: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: space.sm },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  side: { width: avatarSize.sm },
  column: { maxWidth: '75%', gap: space.xxs },
  columnMine: { alignItems: 'flex-end' },
  columnTheirs: { alignItems: 'flex-start' },
  label: { marginHorizontal: space.md },
  // Over the bubble's lower edge, as in Instagram.
  reactions: {
    marginTop: -space.sm,
    marginHorizontal: space.sm,
    paddingHorizontal: space.xs,
    paddingVertical: space.xxs,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  bubble: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  photo: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  photoIcon: {
    width: avatarSize.sm + space.xs,
    height: avatarSize.sm + space.xs,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  photoText: { flexShrink: 1 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    margin: space.sm,
    padding: space.xs,
    borderRadius: radius.xl,
  },
  camera: {
    width: touchTarget,
    height: touchTarget,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: touchTarget,
    maxHeight: touchTarget * 3,
    paddingVertical: space.sm,
  },
  send: {
    minHeight: touchTarget,
    justifyContent: 'center',
    paddingHorizontal: space.md,
  },
  closed: { padding: space.md },
});
