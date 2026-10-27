import { router } from 'expo-router';
import { MessageCircle, Users } from 'lucide-react-native';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { useAuth } from '@/features/auth/auth-store';
import { memberName } from '@/features/circles/names';
import { useCircles } from '@/features/circles/queries';
import {
  circleConversation,
  type Conversation,
  conversations,
  personConversation,
  unreadIn,
  useMessages,
} from '@/features/messages/messages';
import { loadMessagesOnce } from '@/features/messages/messages-session';
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
import { ListRow } from '@/ui/list-row';
import { Screen, SectionTitle } from '@/ui/screen';

/**
 * "Mesajlar" (docs/ADR/0035 §1): the conversations of the last 24 hours, the newest first, each
 * with what came last and how many are unread; then the circles and people to start one with. A
 * friendship is the person's own conversation, not a circle's.
 */
export default function MessagesScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const me = useAuth((state) => state.userId);
  const circles = useCircles().data ?? [];
  const state = useMessages();
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

  if (groups.length === 0 && people.length === 0 && recent.length === 0) {
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
      {recent.length === 0 ? (
        <Hint>{t('messages.emptyBody')}</Hint>
      ) : (
        <View style={styles.group}>
          <SectionTitle>{t('messages.conversations')}</SectionTitle>
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
            const person = conversation.startsWith('p:') ? memberIn(circles, last.from) : undefined;
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
                trailing={unread > 0 ? <Badge label={String(unread)} tone="primary" /> : undefined}
                accessibilityLabel={
                  unread > 0 ? `${name}, ${t('messages.unread', { count: unread })}` : name
                }
                onPress={() => {
                  open(conversation);
                }}
              />
            );
          })}
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
    </Screen>
  );
}

const styles = StyleSheet.create({
  group: { gap: space.sm },
  circleIcon: {
    width: avatarSize.md,
    height: avatarSize.md,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
