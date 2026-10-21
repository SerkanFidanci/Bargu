import { HOME, incomingPath } from '@/features/links/incoming-link';

/**
 * Every link from outside the app (an invite, a guardian request, anything another app sends)
 * passes here before expo-router parses it: only Bargu's own links get through, the rest open the
 * map (features/links/incoming-link.ts). Must never throw: a throw here can crash the app.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    return incomingPath(path);
  } catch {
    return HOME;
  }
}
