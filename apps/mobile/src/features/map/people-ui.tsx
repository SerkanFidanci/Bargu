import type { Circle } from '@bargu/schemas';
import { type RefObject, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import { router } from 'expo-router';

import { duration } from '@/theme/motion';
import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import type { SheetRef } from '@/ui/sheet';

import { useAuth } from '../auth/auth-store';
import { useMyFix } from '../location/engine';
import { useLocations } from '../location/receive';
import { useMe } from '../profile/queries';
import { writablePeople } from '../messages/names';
import { MuteSheet } from '../notifications/mute-sheet';
import { poke, pokeWith } from '../social/poke';
import { type PokeChoice, PokeSheet } from '../social/poke-sheet';
import { circlesApi } from '../circles/circles-api';
import { errorMessage } from '../errors';
import { circleSync } from '../live/live-session';
import { startMeetingWith } from '../plan/quick-meeting';
import type { BarguMapHandle } from './bargu-map';
import { type PersonView, circleActionLabel, personView, runPersonAction } from './person-actions';
import { MyCard } from './my-card';
import { PersonCard } from './person-card';
import {
  closeCard,
  closeMenu,
  menuHover,
  openCard,
  openMenu,
  PERSON_ACTIONS,
  type PersonAction,
  type ScreenPoint,
  usePersonFocus,
} from './person-focus';
import type { PersonHandlers } from './person-gestures';
import { RadialMenu } from './radial-menu';
import { type GroupMember, TogetherSheet } from './together-sheet';

/**
 * Everything that happens when the user touches a person on the map: the card on a tap, the
 * radial menu on a hold, and their actions (poke, directions, profile). Returns the handlers for
 * the markers, what to draw over the map, and what a tap on the bare map does.
 */
export function usePeopleUi(
  map: RefObject<BarguMapHandle | null>,
  circles: readonly Circle[],
  topInset: number,
  /** The user's own status, from their own card. */
  onMyStatus: () => void,
) {
  const myUserId = useAuth((state) => state.userId);
  const me = useMe().data;
  const { t, i18n } = useTranslation();
  const selected = usePersonFocus((state) => state.selected);
  const locations = useLocations();
  const [place, setPlace] = useState<{ userId: string; name: string | null } | null>(null);
  const focused = useRef<string | null>(null);
  const muteSheet = useRef<SheetRef>(null);
  const [muting, setMuting] = useState<{ userId: string; name: string } | null>(null);
  const groupSheet = useRef<SheetRef>(null);
  const [group, setGroup] = useState<{ people: GroupMember[]; from: ScreenPoint } | null>(null);

  // "Dürt" opens the ways to poke them (docs/ADR/0031): a plain poke, a feeling, a question.
  const pokeSheet = useRef<SheetRef>(null);
  const [poking, setPoking] = useState<PersonView | null>(null);
  const sendPoke = useCallback(
    async (person: PersonView, choice: PokeChoice) => {
      if (person.circleId === null) return;
      const result =
        choice === 'bump'
          ? await poke(person.circleId)
          : await pokeWith(person.circleId, person.userId, choice);
      if (result === 'sent') {
        feedback('success');
        toast.success(
          choice === 'bump'
            ? t('map.poke.sent', { name: person.name })
            : t(`map.poke.sentStyle.${choice}`, { name: person.name }),
        );
      } else if (result === 'limited') {
        toast.info(t('map.poke.limited'));
      } else {
        toast.error(t('map.poke.failed'));
      }
    },
    [t],
  );
  const choosePoke = useCallback((person: PersonView) => {
    setPoking(person);
    pokeSheet.current?.present();
  }, []);

  /** A meeting being set up: one at a time, whatever is tapped meanwhile (QA 3a-B1). */
  const meeting = useRef(false);
  const meet = useCallback(
    (person: PersonView) => {
      const username = person.username;
      if (username === null || meeting.current) return;
      Alert.alert(t('map.meetUp.title', { name: person.name }), t('map.meetUp.body'), [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('map.meetUp.start'),
          onPress: () => {
            if (meeting.current) return;
            meeting.current = true;
            closeCard();
            void startMeetingWith(
              { username, name: person.name },
              (name) => t('map.meetUp.name', { name }),
              {
                create: (input) => circlesApi.create(input),
                invite: (id, who) => circlesApi.invite(id, who),
                adopt: (circle) => {
                  void circleSync.adopt(circle).catch(() => undefined);
                },
                end: (id) => circlesApi.end(id),
                drop: (id) => {
                  circleSync.drop(id);
                },
              },
              Date.now(),
            ).then(
              (event) => {
                meeting.current = false;
                feedback('success');
                toast.success(t('map.meetUp.started', { name: person.name }));
                router.push({ pathname: '/circle/[id]', params: { id: event.id } });
              },
              (error: unknown) => {
                meeting.current = false;
                feedback('error');
                toast.error(t('map.meetUp.failed', { reason: errorMessage(error, t) }));
              },
            );
          },
        },
      ]);
    },
    [t],
  );

  const act = useCallback(
    (userId: string, action: PersonAction | 'meet' | 'message' | 'story') => {
      const person = personView(userId, circles, useLocations.getState());
      if (person === null) return;
      if (action === 'meet') {
        meet(person);
        return;
      }
      if (action === 'story') {
        closeCard();
        router.push({ pathname: '/story/[userId]', params: { userId: person.userId } });
        return;
      }
      if (action === 'message') {
        // Their own conversation (docs/ADR/0035 §1); "Bildir" and "Engelle" are under its ⋮.
        closeCard();
        router.push(`/messages/p:${person.userId}`);
        return;
      }
      if (action === 'profile') closeCard();
      runPersonAction(action, person, {
        poke: (who) => {
          choosePoke(who);
        },
        notifications: (who) => {
          setMuting({ userId: who.userId, name: who.name });
          muteSheet.current?.present();
        },
      });
    },
    [circles, choosePoke, meet],
  );

  const handlersFor = useCallback(
    (userId: string): PersonHandlers => ({
      onTap: (point) => {
        focused.current = null;
        setPlace(null);
        openCard(userId, point);
      },
      // The user's own pin: their card on a hold too (no menu of things to do to oneself).
      onHold: (point) => {
        feedback('bump');
        if (userId === myUserId) {
          openCard(userId, point);
          return;
        }
        openMenu(userId, point, topInset);
      },
      onRelease: () => {
        const menu = usePersonFocus.getState().menu;
        const action = PERSON_ACTIONS[menuHover.get()];
        if (menu === null || action === undefined) return;
        closeMenu();
        act(menu.userId, action);
      },
      topInset,
    }),
    [act, topInset, myUserId],
  );

  /** More than two standing together: everyone there in a window; a pick opens their card. */
  const openGroup = useCallback((people: GroupMember[], from: ScreenPoint) => {
    closeMenu();
    closeCard();
    setGroup({ people, from });
    groupSheet.current?.present();
  }, []);

  const mine = selected !== null && selected.userId === myUserId;
  const person = selected === null || mine ? null : personView(selected.userId, circles, locations);

  /** The user's own card: the map shows their pin above it. */
  const onMyCardHeight = (height: number) => {
    if (focused.current === myUserId) return;
    focused.current = myUserId;
    const fix = useMyFix.getState().fix;
    if (fix !== null) map.current?.focusOn([fix.lng, fix.lat], height);
  };

  /** Once the card's height is known: bring the person into view above it, then name the place. */
  const onCardHeight = (height: number) => {
    if (person === null || focused.current === person.userId) return;
    focused.current = person.userId;
    const loc = person.location?.loc;
    if (loc === undefined) {
      setPlace({ userId: person.userId, name: null });
      return;
    }
    map.current?.focusOn([loc.lng, loc.lat], height);
    const userId = person.userId;
    // The labels around them are drawn once the camera has arrived.
    setTimeout(() => {
      void map.current
        ?.placeName([loc.lng, loc.lat], i18n.language)
        .then((name) => {
          setPlace({ userId, name });
        })
        .catch(() => {
          setPlace({ userId, name: null });
        });
    }, duration.slow * 2);
  };

  const overlay = (
    <>
      {person === null || selected === null ? null : (
        <PersonCard
          key={person.userId}
          person={person}
          from={selected.from}
          place={place?.userId === person.userId ? place.name : undefined}
          onAction={(action) => {
            act(person.userId, action);
          }}
          onHeight={onCardHeight}
          canMessage={writablePeople(circles, myUserId).some(
            (writable) => writable.userId === person.userId,
          )}
        />
      )}
      {mine && me !== undefined ? (
        <MyCard
          key="me"
          me={me}
          from={selected.from}
          onHeight={onMyCardHeight}
          onStatus={onMyStatus}
        />
      ) : null}
      <RadialMenu
        onPick={act}
        circleOf={(userId) => {
          const person = personView(userId, circles, useLocations.getState());
          return person === null ? 'circle' : circleActionLabel(person);
        }}
      />
      <MuteSheet ref={muteSheet} person={muting} />
      <PokeSheet
        ref={pokeSheet}
        name={poking?.name ?? null}
        onChoose={(choice) => {
          pokeSheet.current?.dismiss();
          if (poking !== null) void sendPoke(poking, choice);
        }}
      />
      <TogetherSheet
        ref={groupSheet}
        people={group?.people ?? []}
        onPick={(userId) => {
          groupSheet.current?.dismiss();
          focused.current = null;
          setPlace(null);
          openCard(userId, group?.from ?? { x: 0, y: 0 });
        }}
      />
    </>
  );

  const onMapPress = () => {
    closeMenu();
    closeCard();
  };

  return { handlersFor, openGroup, overlay, onMapPress };
}
