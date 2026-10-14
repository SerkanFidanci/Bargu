import type { Circle, Me } from '@bargu/schemas';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { avatarPalette } from '@/theme';
import { feedback } from '@/theme/haptics';
import { toast } from '@/ui/toast';

import { memberName } from '../circles/names';
import { useMyFix } from '../location/engine';
import { bestPerPerson, useLocations } from '../location/receive';
import { circleSharing, isSharingWith, useSharing } from '../location/sharing';
import { meetings, useMeetings } from './meeting';

/**
 * Watches for friends coming within 50 m (both sharing exact positions with each other) and
 * celebrates once per meeting: a buzz, a line saying who, and a burst around the user's avatar.
 * Returns what the user's marker needs to draw the burst.
 */
export function useMeetingWatcher(me: Me, circles: readonly Circle[]) {
  const { t } = useTranslation();
  const locations = useLocations();
  const myFix = useMyFix((state) => state.fix);
  const sharing = useSharing();

  useEffect(() => {
    const now = Date.now();
    const others = bestPerPerson(locations).map((entry) => ({
      userId: entry.userId,
      at: { lat: entry.loc.lat, lng: entry.loc.lng, acc: entry.loc.acc },
      // This phone gives them its exact position too (no meeting through a coarse cell).
      exact:
        isSharingWith(sharing, entry.circleId, now) &&
        circleSharing(sharing, entry.circleId).precision === 'exact',
    }));
    const result = meetings(
      { me: myFix === null ? null : { ...myFix }, others, now },
      useMeetings.getState().together,
    );
    useMeetings.setState({ together: result.together });
    const first = result.met[0];
    if (first === undefined) return;
    const member = circles
      .flatMap((circle) => circle.members)
      .find((candidate) => candidate.userId === first);
    if (member === undefined) return;
    feedback('success');
    toast.success(t('map.meet', { name: memberName(member) }));
    useMeetings.setState({
      burst: {
        at: now,
        colors: [
          avatarPalette[me.avatar?.color ?? 0] ?? avatarPalette[0] ?? '',
          avatarPalette[member.avatar?.color ?? 1] ?? avatarPalette[1] ?? '',
        ],
      },
    });
  }, [locations, myFix, sharing, circles, me.avatar, t]);

  return useMeetings((state) => state.burst);
}
