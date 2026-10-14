import { router } from 'expo-router';

import i18n from '@/i18n';
import { feedback } from '@/theme/haptics';
import { useCelebration } from '@/ui/confetti';
import { toast, type ToastTone } from '@/ui/toast';

import type { Notice } from './notices';

function describe(notice: Notice): { text: string; tone: ToastTone } {
  const t = i18n.t.bind(i18n);
  switch (notice.kind) {
    case 'invited':
      return {
        text: notice.pair
          ? t('notices.friendRequest', { name: notice.from })
          : t('notices.circleInvite', { name: notice.from, circle: notice.circleName ?? '' }),
        tone: 'info',
      };
    case 'accepted':
    case 'friendAdded':
      return { text: t('notices.nowFriends', { name: notice.name }), tone: 'success' };
    case 'joined':
      return {
        text: t('notices.joined', {
          names: notice.names.join(', '),
          circle: notice.circleName ?? '',
        }),
        tone: 'success',
      };
    case 'keyChanged':
      return { text: t('notices.keyChanged', { names: notice.names.join(', ') }), tone: 'error' };
  }
}

/**
 * Shows what other people did while the app is open (BARGU_PLAN §3.4: events, not polling):
 * a notice sliding in from the top, a haptic, confetti for a new friend. Tapping it opens the
 * circle. Several at once show the first and how many more.
 */
export function announce(notices: Notice[]): void {
  const [first] = notices;
  if (first === undefined) return;
  const { text, tone } = describe(first);
  const more = notices.length - 1;
  toast.notice(more > 0 ? i18n.t('notices.andMore', { text, count: more }) : text, tone, () => {
    router.push({ pathname: '/circle/[id]', params: { id: first.circleId } });
  });
  if (first.kind === 'invited') feedback('bump');
  if (first.kind === 'keyChanged') feedback('error');
  if (first.kind === 'accepted' || first.kind === 'friendAdded') {
    useCelebration.getState().celebrate();
  }
}
