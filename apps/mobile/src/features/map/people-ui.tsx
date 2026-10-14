import type { Circle } from '@bargu/schemas';
import { type RefObject, useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { duration } from '@/theme/motion';
import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import { useLocations } from '../location/receive';
import { poke } from '../social/poke';
import type { BarguMapHandle } from './bargu-map';
import { type PersonView, personView, runPersonAction } from './person-actions';
import { PersonCard } from './person-card';
import {
  closeCard,
  closeMenu,
  menuHover,
  openCard,
  openMenu,
  PERSON_ACTIONS,
  type PersonAction,
  usePersonFocus,
} from './person-focus';
import type { PersonHandlers } from './person-gestures';
import { RadialMenu } from './radial-menu';

/**
 * Everything that happens when the user touches a person on the map: the card on a tap, the
 * radial menu on a hold, and their actions (poke, directions, profile). Returns the handlers for
 * the markers, what to draw over the map, and what a tap on the bare map does.
 */
export function usePeopleUi(
  map: RefObject<BarguMapHandle | null>,
  circles: readonly Circle[],
  topInset: number,
) {
  const { t, i18n } = useTranslation();
  const selected = usePersonFocus((state) => state.selected);
  const locations = useLocations();
  const [place, setPlace] = useState<{ userId: string; name: string | null } | null>(null);
  const focused = useRef<string | null>(null);

  const sendPoke = useCallback(
    async (person: PersonView) => {
      if (person.circleId === null) return;
      const result = await poke(person.circleId);
      if (result === 'sent') {
        feedback('success');
        toast.success(t('map.poke.sent', { name: person.name }));
      } else if (result === 'limited') {
        toast.info(t('map.poke.limited'));
      } else {
        toast.error(t('map.poke.failed'));
      }
    },
    [t],
  );

  const act = useCallback(
    (userId: string, action: PersonAction) => {
      const person = personView(userId, circles, useLocations.getState());
      if (person === null) return;
      if (action === 'profile') closeCard();
      runPersonAction(action, person, {
        poke: (who) => void sendPoke(who),
        soon: () => {
          toast.info(t('map.soon'));
        },
      });
    },
    [circles, sendPoke, t],
  );

  const handlersFor = useCallback(
    (userId: string): PersonHandlers => ({
      onTap: (point) => {
        focused.current = null;
        setPlace(null);
        openCard(userId, point);
      },
      onHold: (point) => {
        feedback('bump');
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
    [act, topInset],
  );

  const person = selected === null ? null : personView(selected.userId, circles, locations);

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
        />
      )}
      <RadialMenu onPick={act} />
    </>
  );

  const onMapPress = () => {
    closeMenu();
    closeCard();
  };

  return { handlersFor, overlay, onMapPress };
}
