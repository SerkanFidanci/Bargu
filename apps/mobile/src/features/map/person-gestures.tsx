import type { ReactElement } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { scheduleOnRN } from 'react-native-worklets';

import { feedback } from '@/theme/haptics';
import { choreography } from '@/theme/motion';

import {
  hoveredItem,
  menuBelow,
  menuHover,
  menuOrigin,
  opensBelow,
  type ScreenPoint,
} from './person-focus';

export interface PersonHandlers {
  /** A short tap: the person's card. */
  onTap: (point: ScreenPoint) => void;
  /** Held: the radial menu opens around this point. */
  onHold: (point: ScreenPoint) => void;
  /** The finger left the screen after a hold (on an item: that action). */
  onRelease: () => void;
  /** Safe-area top, so the menu opens below the avatar when there is no room above. */
  topInset: number;
}

function selectFeedback(): void {
  feedback('select');
}

/**
 * Tap and hold on a person's avatar (BARGU_PLAN §4.3). Holding opens the radial menu and, without
 * lifting the finger, sliding onto an item and letting go picks it: the item under the finger is
 * worked out on the UI thread as it moves.
 */
export function PersonGestures({
  handlers,
  children,
}: {
  handlers: PersonHandlers;
  children: ReactElement;
}) {
  const { onTap, onHold, onRelease, topInset } = handlers;
  const hold = Gesture.Pan()
    .activateAfterLongPress(choreography.hold)
    .onStart((event) => {
      const origin = { x: event.absoluteX, y: event.absoluteY };
      menuOrigin.set(origin);
      menuBelow.set(opensBelow(origin, topInset));
      menuHover.set(-1);
      scheduleOnRN(onHold, origin);
    })
    .onUpdate((event) => {
      const next = hoveredItem(menuOrigin.get(), menuBelow.get(), {
        x: event.absoluteX,
        y: event.absoluteY,
      });
      if (next !== menuHover.get()) {
        menuHover.set(next);
        if (next !== -1) scheduleOnRN(selectFeedback);
      }
    })
    .onEnd(() => {
      scheduleOnRN(onRelease);
    });
  const tap = Gesture.Tap()
    .maxDuration(choreography.hold)
    .onEnd((event, success) => {
      if (success) scheduleOnRN(onTap, { x: event.absoluteX, y: event.absoluteY });
    });
  return <GestureDetector gesture={Gesture.Exclusive(hold, tap)}>{children}</GestureDetector>;
}
