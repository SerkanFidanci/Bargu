import { create } from 'zustand';

/**
 * The server no longer serves this app (426 UPGRADE_REQUIRED, QA 19 P4): the app says so instead of
 * failing everywhere. Kept in memory only: after the update (a restart) the server is asked again.
 */
export const useUpgradeRequired = create<{ required: boolean }>(() => ({ required: false }));

/** From a request or the event socket answering UPGRADE_REQUIRED. */
export function upgradeRequired(): void {
  if (!useUpgradeRequired.getState().required) useUpgradeRequired.setState({ required: true });
}
