import i18n from '@/i18n';
import { toast } from '@/ui/toast';

import { updateSharing } from './location-session';

/**
 * Ghost mode in one tap ("hide": off everyone's map, nothing sent), the one way it is switched on
 * from the map's ghost button and from the warnings that say what friends see when the location
 * permission or the location services are off (docs/ADR/0028). Turning it off asks first, with
 * how many circles get the location again; that stays with the ghost button.
 */
export function turnGhostOn(): void {
  updateSharing((current) => ({ ...current, ghost: 'hide' }));
  toast.info(i18n.t('map.shortcuts.ghostOnToast'));
}
