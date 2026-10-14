import { onSignedOut } from '../auth/auth-store';
import { isVaultOpen, vault } from '../storage/vault';
import { shareMutesWithExtension } from './extension-share';
import { loadMutes, type Mutes, NO_MUTES, saveMutes, useMutes } from './mutes';

let loaded = false;

/** The user's mutes from the vault, once per run (screens then change them in memory). */
export function loadMuteSettings(): Mutes {
  if (!loaded && isVaultOpen()) {
    useMutes.setState(loadMutes(vault()), true);
    loaded = true;
  }
  return useMutes.getState();
}

/** Changes the mutes: kept in the vault and, on iPhone, given to the notification extension. */
export function updateMutes(change: (current: Mutes) => Mutes): void {
  const next = change(loadMuteSettings());
  useMutes.setState(next, true);
  if (isVaultOpen()) saveMutes(vault(), next);
  void shareMutesWithExtension(next).catch(() => undefined);
}

onSignedOut(() => {
  loaded = false;
  useMutes.setState(NO_MUTES, true);
});
