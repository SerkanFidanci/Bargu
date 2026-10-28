import type { Circle } from '@bargu/schemas';
import { router } from 'expo-router';
import { Camera, MessageCircle, Search, Users } from 'lucide-react-native';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import { useNow } from '@/features/location/clock';
import { ChatAvatar } from '@/features/messages/chat-avatar';
import {
  type ChatItem,
  circleConversation,
  type Conversation,
  conversations,
  personConversation,
  storiesOf,
  unreadIn,
  useMessages,
} from '@/features/messages/messages';
import { loadMessagesOnce } from '@/features/messages/messages-session';
import { useRulesGate } from '@/features/messages/rules';
import { useShareInvite } from '@/features/circles/share-invite';
import { ago } from '@/features/messages/runs';
import { StoryAvatar } from '@/features/messages/story-avatar';
import { storyCircles } from '@/features/messages/stories';
import {
  conversationName,
  memberIn,
  writableCircles,
  writablePeople,
} from '@/features/messages/names';
import { avatarSize, radius, space, touchTarget, typography, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { EmptyState } from '@/ui/empty-state';
import { Hint } from '@/ui/hint';
import { IconButton } from '@/ui/icon-button';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';

/**
 * "Mesajlar" (docs/ADR/0035 §1), laid out as people know it from Instagram's messages (the owner,
 * 2026-10-28): a search on top, then stories (one's own to share, then whoever has one, the
 * unseen first); the conversations of the last 24 hours, the newest first, each with who it is
 * with, what came last and how long ago, a dot while unread and a camera to send a photo there;
 * then the circles and people to start one with. A friendship is the person's own conversation,
 * not a circle's.
 */
export default function MessagesScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const state = useMessages();
  const now = useNow();
  const [query, setQuery] = useState('');
  // The community rules come as the Messages section opens (K14); nothing of it shows before.
  const rules = useRulesGate({ atOpen: true });
  // Nobody to write to yet: one link away (T7).
  const invite = useShareInvite();
  useEffect(() => {
    loadMessagesOnce();
  }, []);

  const open = (conversation: Conversation) => {
    router.push(`/messages/${conversation}`);
  };
  const camera = (conversation: Conversation) => {
    rules.ensure(() => {
      router.push({ pathname: '/camera', params: { to: conversation } });
    });
  };
  const wanted = query.trim().toLocaleLowerCase(i18n.language);
  const matches = (name: string) =>
    wanted === '' || name.toLocaleLowerCase(i18n.language).includes(wanted);

  const recent = conversations(state).flatMap(({ conversation, last }) => {
    const name = conversationName(conversation, circles, me);
    return name === null || !matches(name) ? [] : [{ conversation, last, name }];
  });
  const started = new Set(conversations(state).map((row) => row.conversation));
  const groups = writableCircles(circles).filter(
    (circle) => !started.has(circleConversation(circle.id)) && matches(circle.name ?? ''),
  );
  const people = writablePeople(circles, me).filter(
    (person) => !started.has(personConversation(person.userId)) && matches(person.name),
  );
  const stories = storiesOf(state, me).flatMap((person) => {
    const member = memberIn(circles, person.userId);
    if (person.userId !== me && member === undefined) return [];
    return [{ ...person, member }];
  });
  const canShare = storyCircles(circles, me, { events: true }).length > 0;
  const storyRow =
    wanted !== '' || (!canShare && stories.length === 0) ? null : (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.stories}
      >
        {canShare ? (
          <PressableScale
            testID="story-share"
            haptic="select"
            accessibilityRole="button"
            accessibilityLabel={t('messages.story.share')}
            onPress={() => {
              rules.ensure(() => {
                router.push('/camera');
              });
            }}
            style={styles.story}
          >
            <View style={[styles.shareIcon, { backgroundColor: colors.primarySoft }]}>
              <Camera color={colors.primary} size={26} strokeWidth={2.25} />
            </View>
            <Text variant="caption" numberOfLines={1} align="center">
              {t('messages.story.share')}
            </Text>
          </PressableScale>
        ) : null}
        {stories.map((person) => {
          const name =
            person.userId === me
              ? t('messages.story.yours')
              : person.member === undefined
                ? '?'
                : memberName(person.member);
          return (
            <PressableScale
              key={person.userId}
              testID={`story-${person.userId}`}
              haptic="select"
              accessibilityRole="button"
              accessibilityLabel={
                person.unseen
                  ? t('messages.story.openNew', { name })
                  : t('messages.story.open', { name })
              }
              onPress={() => {
                router.push({ pathname: '/story/[userId]', params: { userId: person.userId } });
              }}
              style={styles.story}
            >
              <StoryAvatar
                userId={person.userId}
                name={name}
                avatar={person.member?.avatar ?? null}
                seen={!person.unseen}
              />
              <Text variant="caption" numberOfLines={1} align="center">
                {name}
              </Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    );

  if (!rules.open) {
    return (
      <Screen title={t('messages.title')} subtitle={t('messages.lifetime')} testID="messages">
        {rules.sheet}
      </Screen>
    );
  }

  if (
    groups.length === 0 &&
    people.length === 0 &&
    recent.length === 0 &&
    stories.length === 0 &&
    wanted === ''
  ) {
    return (
      <Screen title={t('messages.title')} subtitle={t('messages.lifetime')} testID="messages">
        <EmptyState
          icon={MessageCircle}
          title={t('messages.empty')}
          body={t('messages.noCircles')}
          action={{ label: t('main.invite.share'), onPress: () => void invite.share() }}
        />
      </Screen>
    );
  }

  const nothingFound =
    wanted !== '' && recent.length === 0 && groups.length === 0 && people.length === 0;

  return (
    <Screen title={t('messages.title')} subtitle={t('messages.lifetime')} testID="messages">
      <View style={[styles.search, { backgroundColor: colors.bubble }]}>
        <Search color={colors.textMuted} size={18} strokeWidth={2.25} />
        <TextInput
          testID="messages-search"
          value={query}
          onChangeText={setQuery}
          placeholder={t('messages.search')}
          placeholderTextColor={colors.textMuted}
          accessibilityLabel={t('messages.search')}
          autoCorrect={false}
          style={[styles.searchInput, typography.body.style, { color: colors.text }]}
        />
      </View>
      {storyRow}
      {nothingFound ? <Hint>{t('messages.noResults')}</Hint> : null}
      {recent.length === 0 ? (
        wanted === '' ? (
          <Hint>{t('messages.emptyBody')}</Hint>
        ) : null
      ) : (
        <View style={styles.group}>
          <SectionTitle>{t('messages.conversations')}</SectionTitle>
          {recent.map(({ conversation, last, name }) => (
            <ConversationRow
              key={conversation}
              conversation={conversation}
              last={last}
              name={name}
              unread={me === null ? 0 : unreadIn(state, conversation, me)}
              circles={circles}
              me={me}
              now={now}
              onOpen={() => {
                open(conversation);
              }}
              onCamera={() => {
                camera(conversation);
              }}
            />
          ))}
        </View>
      )}
      {groups.length === 0 ? null : (
        <View style={styles.group}>
          <SectionTitle>{t('messages.circles')}</SectionTitle>
          {groups.map((circle) => (
            <ListRow
              key={circle.id}
              testID={`start-${circle.id}`}
              leading={
                <View style={[styles.circleIcon, { backgroundColor: colors.primarySoft }]}>
                  <Users color={colors.primary} size={20} strokeWidth={2.25} />
                </View>
              }
              title={circle.name ?? ''}
              onPress={() => {
                open(circleConversation(circle.id));
              }}
            />
          ))}
        </View>
      )}
      {people.length === 0 ? null : (
        <View style={styles.group}>
          <SectionTitle>{t('messages.people')}</SectionTitle>
          {people.map((person) => (
            <ListRow
              key={person.userId}
              testID={`start-${person.userId}`}
              leading={<Avatar avatar={person.avatar} name={person.name} userId={person.userId} />}
              title={person.name}
              onPress={() => {
                open(personConversation(person.userId));
              }}
            />
          ))}
        </View>
      )}
      {rules.sheet}
    </Screen>
  );
}

/**
 * A conversation in the list: who it is with, what came last ("Sen: ..." for one's own, the
 * sender's name in a circle) and how long ago; while unread the name and words are bold and a dot
 * shows. The camera beside it sends a photo there.
 */
function ConversationRow({
  conversation,
  last,
  name,
  unread,
  circles,
  me,
  now,
  onOpen,
  onCamera,
}: {
  conversation: Conversation;
  last: ChatItem;
  name: string;
  unread: number;
  circles: readonly Circle[];
  me: string | null;
  now: number;
  onOpen: () => void;
  onCamera: () => void;
}) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const author = memberIn(circles, last.from);
  const sender =
    last.from === me ? t('messages.you') : author === undefined ? '?' : memberName(author);
  const words = last.kind === 'photo' ? t('messages.photo') : (last.text ?? '');
  const preview = conversation.startsWith('c:') || last.from === me ? `${sender}: ${words}` : words;
  const since = ago(last.at, now);
  const when = since.key === 'now' ? t('messages.ago.now') : t(`messages.ago.${since.key}`, since);
  return (
    <View style={styles.row}>
      <PressableScale
        testID={`conversation-${conversation}`}
        haptic="select"
        accessibilityRole="button"
        accessibilityLabel={
          unread > 0
            ? `${name}, ${t('messages.unread', { count: unread })}, ${preview}`
            : `${name}, ${preview}`
        }
        onPress={onOpen}
        style={styles.rowMain}
      >
        <ChatAvatar conversation={conversation} circles={circles} me={me} size="row" />
        <View style={styles.rowText}>
          <Text variant={unread > 0 ? 'bodyStrong' : 'body'} numberOfLines={1}>
            {name}
          </Text>
          <View style={styles.preview}>
            <Text
              variant={unread > 0 ? 'bodyStrong' : 'subhead'}
              color={unread > 0 ? 'text' : 'textMuted'}
              numberOfLines={1}
              style={styles.previewWords}
            >
              {preview}
            </Text>
            <Text variant="subhead" color="textMuted">
              {` · ${when}`}
            </Text>
          </View>
        </View>
        {unread > 0 ? <View style={[styles.dot, { backgroundColor: colors.primary }]} /> : null}
      </PressableScale>
      <IconButton
        testID={`camera-${conversation}`}
        icon={Camera}
        label={t('messages.photoTo', { name })}
        tone="plain"
        onPress={onCamera}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.xs },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.md,
    borderRadius: radius.md,
  },
  searchInput: { flex: 1, minHeight: touchTarget },
  stories: { gap: space.md, paddingVertical: space.xs },
  story: { width: avatarSize.lg + space.lg, alignItems: 'center', gap: space.xs },
  shareIcon: {
    width: avatarSize.lg + space.sm,
    height: avatarSize.lg + space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingVertical: space.xs,
  },
  rowText: { flex: 1, gap: space.xxs },
  preview: { flexDirection: 'row', alignItems: 'center' },
  previewWords: { flexShrink: 1 },
  dot: { width: space.sm, height: space.sm, borderRadius: radius.pill },
  circleIcon: {
    width: avatarSize.md,
    height: avatarSize.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
