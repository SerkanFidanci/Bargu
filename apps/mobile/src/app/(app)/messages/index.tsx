import { router } from 'expo-router';
import { Camera, MessageCircle, Users } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import {
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
import { StoryAvatar } from '@/features/messages/story-avatar';
import { storyCircles } from '@/features/messages/stories';
import {
  conversationName,
  memberIn,
  writableCircles,
  writablePeople,
} from '@/features/messages/names';
import { avatarSize, radius, space, useTheme } from '@/theme';
import { Avatar } from '@/ui/avatar';
import { Badge } from '@/ui/badge';
import { EmptyState } from '@/ui/empty-state';
import { Hint } from '@/ui/hint';
import { ListGroup } from '@/ui/list-group';
import { ListRow } from '@/ui/list-row';
import { PressableScale } from '@/ui/pressable-scale';
import { Screen, SectionTitle } from '@/ui/screen';
import { Text } from '@/ui/text';

/**
 * "Mesajlar" (docs/ADR/0035 §1): stories first (one's own to share, then whoever has one, the
 * unseen first); the conversations of the last 24 hours, the newest first, each with what came
 * last, when, and how many are unread; then the circles and people to start one with. A friendship
 * is the person's own conversation, not a circle's. Each group on its own card, a line between its
 * rows (the owner, 2026-10-28).
 */
export default function MessagesScreen() {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const state = useMessages();
  // The community rules come as the Messages section opens (K14); nothing of it shows before.
  const rules = useRulesGate({ atOpen: true });
  useEffect(() => {
    loadMessagesOnce();
  }, []);

  const open = (conversation: Conversation) => {
    router.push(`/messages/${conversation}`);
  };
  const recent = conversations(state).flatMap(({ conversation, last }) => {
    const name = conversationName(conversation, circles, me);
    return name === null ? [] : [{ conversation, last, name }];
  });
  const started = new Set(recent.map((row) => row.conversation));
  const groups = writableCircles(circles).filter(
    (circle) => !started.has(circleConversation(circle.id)),
  );
  const people = writablePeople(circles, me).filter(
    (person) => !started.has(personConversation(person.userId)),
  );
  const stories = storiesOf(state, me).flatMap((person) => {
    const member = memberIn(circles, person.userId);
    if (person.userId !== me && member === undefined) return [];
    return [{ ...person, member }];
  });
  const canShare = storyCircles(circles, me, { events: true }).length > 0;
  const storyRow =
    !canShare && stories.length === 0 ? null : (
      <View style={styles.group}>
        <SectionTitle>{t('messages.story.title')}</SectionTitle>
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
      </View>
    );

  if (!rules.open) {
    return (
      <Screen title={t('messages.title')} subtitle={t('messages.lifetime')} testID="messages">
        {rules.sheet}
      </Screen>
    );
  }

  if (groups.length === 0 && people.length === 0 && recent.length === 0 && stories.length === 0) {
    return (
      <Screen title={t('messages.title')} subtitle={t('messages.lifetime')} testID="messages">
        <EmptyState
          icon={MessageCircle}
          title={t('messages.empty')}
          body={t('messages.noCircles')}
        />
      </Screen>
    );
  }

  return (
    <Screen title={t('messages.title')} subtitle={t('messages.lifetime')} testID="messages">
      {storyRow}
      {recent.length === 0 ? (
        <Hint>{t('messages.emptyBody')}</Hint>
      ) : (
        <View style={styles.group}>
          <SectionTitle>{t('messages.conversations')}</SectionTitle>
          <ListGroup testID="conversations">
            {recent.map(({ conversation, last, name }) => {
              const unread = me === null ? 0 : unreadIn(state, conversation, me);
              const author = memberIn(circles, last.from);
              const sender =
                last.from === me
                  ? t('messages.you')
                  : author === undefined
                    ? '?'
                    : memberName(author);
              const words = last.kind === 'photo' ? t('messages.photo') : (last.text ?? '');
              const person = conversation.startsWith('p:')
                ? memberIn(circles, last.from)
                : undefined;
              const time = new Date(last.at).toLocaleTimeString(i18n.language, {
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <ListRow
                  key={conversation}
                  testID={`conversation-${conversation}`}
                  leading={
                    conversation.startsWith('c:') ? (
                      <View style={[styles.circleIcon, { backgroundColor: colors.primarySoft }]}>
                        <Users color={colors.primary} size={20} strokeWidth={2.25} />
                      </View>
                    ) : (
                      <Avatar
                        avatar={person?.avatar ?? null}
                        name={name}
                        userId={conversation.slice(2)}
                      />
                    )
                  }
                  title={name}
                  subtitle={conversation.startsWith('c:') ? `${sender}: ${words}` : words}
                  trailing={
                    <View style={styles.trailing}>
                      <Text variant="caption" color={unread > 0 ? 'primary' : 'textMuted'}>
                        {time}
                      </Text>
                      {unread > 0 ? <Badge label={String(unread)} tone="primary" /> : null}
                    </View>
                  }
                  accessibilityLabel={
                    unread > 0 ? `${name}, ${t('messages.unread', { count: unread })}` : name
                  }
                  onPress={() => {
                    open(conversation);
                  }}
                />
              );
            })}
          </ListGroup>
        </View>
      )}
      {groups.length === 0 ? null : (
        <View style={styles.group}>
          <SectionTitle>{t('messages.circles')}</SectionTitle>
          <ListGroup>
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
          </ListGroup>
        </View>
      )}
      {people.length === 0 ? null : (
        <View style={styles.group}>
          <SectionTitle>{t('messages.people')}</SectionTitle>
          <ListGroup>
            {people.map((person) => (
              <ListRow
                key={person.userId}
                testID={`start-${person.userId}`}
                leading={
                  <Avatar avatar={person.avatar} name={person.name} userId={person.userId} />
                }
                title={person.name}
                onPress={() => {
                  open(personConversation(person.userId));
                }}
              />
            ))}
          </ListGroup>
        </View>
      )}
      {rules.sheet}
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  stories: { gap: space.md, paddingVertical: space.xs },
  story: { width: avatarSize.lg + space.lg, alignItems: 'center', gap: space.xs },
  shareIcon: {
    width: avatarSize.lg + space.sm,
    height: avatarSize.lg + space.sm,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailing: { alignItems: 'flex-end', gap: space.xs },
  circleIcon: {
    width: avatarSize.md,
    height: avatarSize.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
